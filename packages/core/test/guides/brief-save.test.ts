import { describe, expect, it } from "vitest";

import type { UserPrincipal } from "@better-answers/core/kernel";
import { head } from "@better-answers/core/store/git";

import { suiteWithBundles } from "../fixtures/workspace-with-bundle.ts";
import { answered } from "../support/suite-postgres.ts";
import {
  briefCiting,
  editorOutsideFinance,
  includeIdsOf,
  latestVersionOf,
  saveBriefAs,
  seededGuide,
  writeUpOf,
  type SeededGuide,
} from "./northgate-guide.ts";

const { db, arrange } = suiteWithBundles();

let shared: Promise<SeededGuide> | undefined;

const seededOnce = (): Promise<SeededGuide> =>
  (shared ??= arrange().then((scenario) => seededGuide(db(), scenario)));

type Section = {
  readonly guide: SeededGuide;
  readonly writeUpId: string;
  readonly ids: readonly string[];
  readonly base: number;
};

const sectionOf = async (prompt: string): Promise<Section> => {
  const guide = await seededOnce();
  const writeUpId = await writeUpOf(db(), guide, prompt);
  return {
    guide,
    writeUpId,
    ids: await includeIdsOf(db(), writeUpId),
    base: await latestVersionOf(db(), writeUpId),
  };
};

const saving = (section: Section, as: UserPrincipal, markdown: string, base = section.base) =>
  saveBriefAs(section.guide.ng.scenario, as, { writeUpId: section.writeUpId, markdown, base });

const briefEvents = async (section: Section): Promise<number> => {
  const found = await db().pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_event
      WHERE workspace_id = $1 AND action = 'knowledge.guide.brief_saved'`,
    [section.guide.ng.scenario.workspaceId],
  );
  return found.rows[0]?.n ?? -1;
};

const versionRows = async (section: Section) => {
  const found = await db().pool.query<{ version: number; markdown: string; actor: string }>(
    `SELECT version, markdown, actor FROM write_up_version
      WHERE write_up_id = $1 ORDER BY version`,
    [section.writeUpId],
  );
  return found.rows;
};

describe("saving a section's Brief", () => {
  it("writes one version and one event for a changed Brief", async () => {
    const section = await sectionOf("Company overview");
    const markdown = briefCiting(section.ids);
    const eventsBefore = await briefEvents(section);

    const saved = answered(await saving(section, section.guide.ng.editor, markdown));

    expect(saved).toEqual({ saved: true, version: section.base + 1 });
    expect((await versionRows(section)).at(-1)).toEqual({
      version: section.base + 1,
      markdown,
      actor: `human:${section.guide.ng.editor.userId}`,
    });
    expect(await briefEvents(section)).toBe(eventsBefore + 1);
    const event = await db().pool.query(
      `SELECT subject_id, detail FROM audit_event
        WHERE workspace_id = $1 AND action = 'knowledge.guide.brief_saved'
        ORDER BY id DESC LIMIT 1`,
      [section.guide.ng.scenario.workspaceId],
    );
    expect(event.rows).toEqual([
      {
        subject_id: section.guide.guideId,
        detail: {
          guideId: section.guide.guideId,
          writeUpId: section.writeUpId,
          version: section.base + 1,
        },
      },
    ]);
    const snapshot = await db().pool.query<{ includes: { id: string }[] }>(
      "SELECT includes FROM write_up_version WHERE write_up_id = $1 AND version = $2",
      [section.writeUpId, section.base + 1],
    );
    expect(snapshot.rows[0]?.includes.map((include) => include.id)).toEqual(section.ids);
  });

  it("writes no version for an unchanged Brief", async () => {
    const first = await sectionOf("What we offer");
    const markdown = briefCiting(first.ids);
    answered(await saving(first, first.guide.ng.editor, markdown));
    const section = await sectionOf("What we offer");
    const versions = await versionRows(section);
    const events = await briefEvents(section);

    const again = answered(await saving(section, section.guide.ng.editor, markdown));

    expect(again).toEqual({ saved: false, version: section.base });
    expect(await versionRows(section)).toEqual(versions);
    expect(await briefEvents(section)).toBe(events);
  });

  it("writes a new version for a whitespace-only change", async () => {
    const first = await sectionOf("Certifications");
    const markdown = briefCiting(first.ids);
    answered(await saving(first, first.guide.ng.editor, markdown));
    const section = await sectionOf("Certifications");

    const saved = answered(await saving(section, section.guide.ng.editor, `${markdown} `));

    expect(saved).toEqual({ saved: true, version: section.base + 1 });
    expect((await versionRows(section)).at(-1)?.markdown).toBe(`${markdown} `);
  });

  it("writes a new version when an include row changes", async () => {
    const first = await sectionOf("Data protection");
    const markdown = briefCiting(first.ids);
    answered(await saving(first, first.guide.ng.editor, markdown));
    const section = await sectionOf("Data protection");
    await db().pool.query(
      `UPDATE write_up_include SET wording_heading = 'Wording', wording_hash = content_hash
        WHERE write_up_id = $1 AND id = $2`,
      [section.writeUpId, section.ids[0]],
    );

    const saved = answered(await saving(section, section.guide.ng.editor, markdown));

    expect(saved).toEqual({ saved: true, version: section.base + 1 });
  });

  it("leaves the bundle head unchanged on a Brief save", async () => {
    const section = await sectionOf("Security testing");
    const { git } = section.guide.ng.scenario;
    const before = await head(section.guide.ng.admin, git);

    answered(await saving(section, section.guide.ng.admin, briefCiting(section.ids)));

    expect(await head(section.guide.ng.admin, git)).toBe(before);
  });

  it("treats a marker placed once or twice alike", async () => {
    const section = await sectionOf("Support and service levels");
    const [first] = section.ids;
    const markdown = `Twice.[^${String(first)}] Again.[^${String(first)}]`;

    const saved = answered(await saving(section, section.guide.ng.editor, markdown));

    expect(saved.saved).toBe(true);
  });

  it("refuses a Brief save by a Viewer", async () => {
    const section = await sectionOf("Company overview");
    const versions = await versionRows(section);
    const events = await briefEvents(section);

    const refused = await saving(section, section.guide.ng.viewer, briefCiting(section.ids));

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await versionRows(section)).toEqual(versions);
    expect(await briefEvents(section)).toBe(events);
  });

  it("refuses a marker that names no include row", async () => {
    const section = await sectionOf("Information security");
    const versions = await versionRows(section);

    const refused = await saving(
      section,
      section.guide.ng.editor,
      `${briefCiting(section.ids)}[^not-an-include]`,
    );

    expect(refused).toEqual({ ok: false, error: "marker-without-include" });
    expect(await versionRows(section)).toEqual(versions);
  });

  it("refuses a save on a stale version", async () => {
    const section = await sectionOf("Company overview");
    answered(await saving(section, section.guide.ng.editor, `${briefCiting(section.ids)} More.`));
    const versions = await versionRows(section);

    const refused = await saving(section, section.guide.ng.editor, "Other words.");

    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
    expect(await versionRows(section)).toEqual(versions);
  });

  it("refuses a save on a withheld section", async () => {
    const section = await sectionOf("Insurance and financial standing");
    const outside = await editorOutsideFinance(db(), section.guide);
    const versions = await versionRows(section);

    const refused = await saving(section, outside, "Words.");

    expect(refused).toEqual({ ok: false, error: "not-found" });
    expect(await versionRows(section)).toEqual(versions);
  });

  it.each([
    ["a hidden section", "Company overview", "Company overview"],
    ["a nested section", "Security testing", "Information security"],
  ])("answers an Editor on %s as on none", async (_, prompt, hiding) => {
    const section = await sectionOf(prompt);
    const { editor } = section.guide.ng;
    const versions = await versionRows(section);
    await hide(section, hiding, true);

    const refused = await saving(section, editor, `${briefCiting(section.ids)} Hidden.`);
    const missing = await saveBriefAs(section.guide.ng.scenario, editor, {
      writeUpId: ABSENT_WRITE_UP,
      markdown: "Words.",
      base: section.base,
    });
    await hide(section, hiding, false);

    expect(refused).toEqual(missing);
    expect(refused).toEqual({ ok: false, error: "not-found" });
    expect(await versionRows(section)).toEqual(versions);
  });

  it("saves for an Admin in a hidden section", async () => {
    const section = await sectionOf("Data protection");
    await hide(section, "Data protection", true);

    const saved = await saving(
      section,
      section.guide.ng.admin,
      `${briefCiting(section.ids)} Admin.`,
    );
    await hide(section, "Data protection", false);

    expect(answered(saved)).toEqual({ saved: true, version: section.base + 1 });
  });
});

const ABSENT_WRITE_UP = "01J6ZZZZZZZZZZZZZZZZZZZZZZ";

const hide = async (section: Section, prompt: string, hidden: boolean) => {
  await db().pool.query(
    "UPDATE guide_section SET hidden = $1 WHERE guide_id = $2 AND prompt = $3",
    [hidden, section.guide.guideId, prompt],
  );
};
