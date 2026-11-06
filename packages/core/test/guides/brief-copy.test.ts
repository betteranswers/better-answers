import { describe, expect, it } from "vitest";

import { briefCopy, recordCopy } from "../../src/concepts/index.ts";
import { includeAvailable } from "../../src/guides/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { addToGroup } from "../../src/members/index.ts";
import { withMember } from "../../src/store/postgres/index.ts";
import { EMPLOYERS_LIABILITY } from "../fixtures/northgate-concepts.ts";
import { typedBy } from "../fixtures/northgate.ts";
import { doorsOf, principalFor, suiteWithBundles } from "../fixtures/workspace-with-bundle.ts";
import { answered, readingAs, seedingWith } from "../support/suite-postgres.ts";
import {
  briefCiting,
  guideSeededOnce,
  includeIdsOf,
  latestVersionOf,
  saveBriefAs,
  writeUpOf,
  type SeededGuide,
} from "./northgate-guide.ts";

const { db, arrange } = suiteWithBundles();

const seededOnce = guideSeededOnce(db, arrange);

const NOW = new Date("2026-06-01T00:00:00Z");

const OVERVIEW = "Company overview";

const INSURANCE = "Insurance and financial standing";

const SUPPORT = "Support and service levels";

const OFFER = "What we offer";

const SECURITY = "Information security";

const TESTING = "Security testing";

type Section = {
  readonly guide: SeededGuide;
  readonly writeUpId: string;
  readonly version: number;
};

const briefed = new Map<string, Promise<Section>>();

const briefedSection = (prompt: string): Promise<Section> => {
  const held = briefed.get(prompt);
  if (held !== undefined) return held;
  const made = (async () => {
    const guide = await seededOnce();
    const writeUpId = await writeUpOf(db(), guide, prompt);
    answered(
      await saveBriefAs(guide.ng.scenario, guide.ng.editor, {
        writeUpId,
        markdown: briefCiting(await includeIdsOf(db(), writeUpId)),
        base: await latestVersionOf(db(), writeUpId),
      }),
    );
    return { guide, writeUpId, version: await latestVersionOf(db(), writeUpId) };
  })();
  briefed.set(prompt, made);
  return made;
};

const copyingAs = (reader: UserPrincipal, writeUpId: string) =>
  readingAs(db().runtimePool, reader, (principal, tx) =>
    briefCopy(principal, tx, { writeUpId }, NOW),
  );

const recordingAs = async (
  section: Section,
  reader: UserPrincipal,
  input: { readonly writeUpId: string; readonly version: number },
) => {
  const recorded = await withMember(reader, section.guide.ng.scenario.postgres, (fresh, tx) =>
    recordCopy(fresh, tx, input, NOW),
  );
  if (!recorded.ok) throw new Error(`the copy was not recorded: ${String(recorded.error)}`);
  return recorded.value;
};

const copiedAndRecorded = async (section: Section, reader: UserPrincipal) => {
  const copy = answered(await copyingAs(reader, section.writeUpId));
  answered(
    await recordingAs(section, reader, { writeUpId: section.writeUpId, version: copy.version }),
  );
  return copy;
};

type UsageRow = {
  act: string;
  write_up_version: number;
  actor: string;
  row: string;
  columns: string[];
};

const usageRows = async (writeUpId: string) =>
  (
    await db().pool.query<UsageRow>(
      `SELECT act, write_up_version, actor, to_jsonb(u)::text AS row,
              ARRAY(SELECT jsonb_object_keys(to_jsonb(u)) ORDER BY 1) AS columns
         FROM usage u WHERE write_up_id = $1 ORDER BY at, id`,
      [writeUpId],
    )
  ).rows;

const auditEvents = async (section: Section): Promise<number> => {
  const found = await db().pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_event WHERE workspace_id = $1",
    [section.guide.ng.scenario.workspaceId],
  );
  return found.rows[0]?.n ?? -1;
};

const viewerIn = async (section: Section, group: string): Promise<UserPrincipal> => {
  const { workspaceId } = section.guide.ng.scenario;
  const person = await seedingWith(db().pool, async (seed) => {
    const made = await seed.user();
    await seed.member({ workspaceId, userId: made.id, role: "Viewer" });
    return made;
  });
  answered(
    await readingAs(db().runtimePool, section.guide.ng.admin, (admin, tx) =>
      addToGroup(admin, tx, { groupId: group, userId: person.id }),
    ),
  );
  return principalFor(db(), workspaceId, person.id);
};

type Included = { readonly iri: string; readonly title: string; readonly sensitivity: string };

const firstIncluded = async (writeUpId: string): Promise<Included> => {
  const found = await db().pool.query<Included>(
    `SELECT i.iri, c.title, c.sensitivity FROM write_up_include i
       JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
      WHERE i.write_up_id = $1 ORDER BY i.ordinal`,
    [writeUpId],
  );
  const [first] = found.rows;
  if (first === undefined) throw new Error("the section includes nothing");
  return first;
};

const copiedWhileRestricted = async (
  reader: UserPrincipal,
  writeUpId: string,
  concept: Included,
) => {
  const setSensitivity = (sensitivity: string) =>
    db().pool.query("UPDATE concept_index SET sensitivity = $1 WHERE iri = $2", [
      sensitivity,
      concept.iri,
    ]);
  await setSensitivity("Restricted");
  try {
    return answered(await copyingAs(reader, writeUpId));
  } finally {
    await setSensitivity(concept.sensitivity);
  }
};

describe("copying a section's Brief", () => {
  it("records a copy as one usage row naming the version", async () => {
    const section = await briefedSection(OVERVIEW);
    const { editor } = section.guide.ng;

    const copy = await copiedAndRecorded(section, editor);

    expect(copy.version).toBe(section.version);
    expect(
      (await usageRows(section.writeUpId)).map(({ act, write_up_version: version, actor }) => ({
        act,
        version,
        actor,
      })),
    ).toEqual([{ act: "copied", version: section.version, actor: `human:${editor.userId}` }]);
  });

  it("stores no copied text in the usage row", async () => {
    const section = await briefedSection(SUPPORT);
    await copiedAndRecorded(section, section.guide.ng.editor);

    const rows = await usageRows(section.writeUpId);
    expect(rows.map(({ row }) => /Claim|Sources/u.test(row))).toEqual([false]);
    expect(rows.map(({ columns }) => columns)).toEqual([
      ["act", "actor", "at", "id", "iri", "workspace_id", "write_up_id", "write_up_version"],
    ]);
  });

  it("refuses a copy below the role's threshold", async () => {
    const section = await briefedSection(OVERVIEW);
    const { editor, viewer } = section.guide.ng;
    const before = (await usageRows(section.writeUpId)).length;

    const refused = await copyingAs(viewer, section.writeUpId);
    const refusedToRecord = await recordingAs(section, viewer, {
      writeUpId: section.writeUpId,
      version: section.version,
    });
    const admitted = await copyingAs(editor, section.writeUpId);

    expect(refused).toEqual({ ok: false, error: "below-action-threshold" });
    expect(refusedToRecord).toEqual({ ok: false, error: "below-action-threshold" });
    expect(admitted.ok).toBe(true);
    expect((await usageRows(section.writeUpId)).length).toBe(before);
  });

  it("writes no audit event for a recorded copy", async () => {
    const section = await briefedSection(OVERVIEW);
    const { editor } = section.guide.ng;
    const before = await auditEvents(section);

    answered(
      await recordingAs(section, editor, {
        writeUpId: section.writeUpId,
        version: section.version,
      }),
    );

    expect(await auditEvents(section)).toBe(before);
  });

  it("lets a Viewer in the audience copy a verified section", async () => {
    const section = await briefedSection(INSURANCE);
    const inFinance = await viewerIn(section, section.guide.ng.finance);

    const copy = answered(await copyingAs(inFinance, section.writeUpId));

    expect(copy.footnotes).toBe(4);
    expect(copy.text).toMatch(/\n\nSources\n\[1\] .+\n\[2\] .+\n\[3\] .+\n\[4\] [^\n]+$/u);
    expect(copy.html).toContain("<sup>4</sup>");
  });

  it("finds no section to copy for an outside Viewer", async () => {
    const section = await briefedSection(INSURANCE);

    const copying = await copyingAs(section.guide.ng.viewer, section.writeUpId);

    expect(copying).toEqual({ ok: false, error: "not-found" });
  });

  it("refuses to copy a section under a hidden section", async () => {
    const section = await briefedSection(TESTING);
    const { editor, admin } = section.guide.ng;
    const hide = (hidden: boolean) =>
      db().pool.query("UPDATE guide_section SET hidden = $1 WHERE prompt = $2", [hidden, SECURITY]);
    await hide(true);

    const hiddenFromEditor = await copyingAs(editor, section.writeUpId);
    const shownToAdmin = await copyingAs(admin, section.writeUpId);
    await hide(false);

    expect(hiddenFromEditor).toEqual({ ok: false, error: "not-found" });
    expect(shownToAdmin.ok).toBe(true);
  });

  it("finds no Brief to copy when it has no text", async () => {
    const guide = await seededOnce();
    const writeUpId = await writeUpOf(db(), guide, "Data protection");

    const copying = await copyingAs(guide.ng.editor, writeUpId);

    expect(copying).toEqual({ ok: false, error: "not-found" });
  });

  it("records the copied version, not the latest", async () => {
    const section = await briefedSection(OFFER);
    const { editor } = section.guide.ng;
    const copied = answered(await copyingAs(editor, section.writeUpId)).version;
    answered(
      await saveBriefAs(section.guide.ng.scenario, editor, {
        writeUpId: section.writeUpId,
        markdown: `Rewritten.\n\n${briefCiting(await includeIdsOf(db(), section.writeUpId))}`,
        base: copied,
      }),
    );

    answered(await recordingAs(section, editor, { writeUpId: section.writeUpId, version: copied }));

    expect((await usageRows(section.writeUpId)).at(-1)?.write_up_version).toBe(copied);
    expect(copied).toBeLessThan(await latestVersionOf(db(), section.writeUpId));
  });

  it("refuses to record a version the write-up never had", async () => {
    const section = await briefedSection(OVERVIEW);
    const before = (await usageRows(section.writeUpId)).length;

    const refused = await recordingAs(section, section.guide.ng.editor, {
      writeUpId: section.writeUpId,
      version: 99,
    });

    expect(refused).toEqual({ ok: false, error: "not-found" });
    expect((await usageRows(section.writeUpId)).length).toBe(before);
  });

  it("leaves out a concept the reader cannot read", async () => {
    const section = await briefedSection(OFFER);
    const { editor } = section.guide.ng;
    const first = await firstIncluded(section.writeUpId);
    const whole = answered(await copyingAs(editor, section.writeUpId));

    const trimmed = await copiedWhileRestricted(editor, section.writeUpId, first);

    expect(whole.text).toContain(first.title);
    expect(trimmed.footnotes).toBe(whole.footnotes - 1);
    expect(trimmed.text).not.toContain(first.title);
    expect(trimmed.html).not.toContain(first.title);
  });

  it("checks a recorded copy against its own version's concepts", async () => {
    const section = await briefedSection(INSURANCE);
    const { editor } = section.guide.ng;
    const inFinance = await viewerIn(section, section.guide.ng.finance);
    const copied = answered(await copyingAs(inFinance, section.writeUpId)).version;
    await typedBy(editor, section.guide.ng.scenario, EMPLOYERS_LIABILITY);
    answered(
      await includeAvailable(editor, doorsOf(section.guide.ng.scenario), {
        writeUpId: section.writeUpId,
      }),
    );
    const latest = await latestVersionOf(db(), section.writeUpId);

    const recordingTheOlder = await recordingAs(section, inFinance, {
      writeUpId: section.writeUpId,
      version: copied,
    });
    const recordingTheLatest = await recordingAs(section, inFinance, {
      writeUpId: section.writeUpId,
      version: latest,
    });

    expect(latest).toBeGreaterThan(copied);
    expect(recordingTheOlder.ok).toBe(true);
    expect(recordingTheLatest).toEqual({ ok: false, error: "below-action-threshold" });
  });
});
