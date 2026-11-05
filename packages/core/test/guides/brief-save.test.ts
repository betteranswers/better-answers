import { describe, expect, it } from "vitest";

import { head } from "@better-answers/core/store/git";

import type { UserPrincipal } from "../../src/kernel/index.ts";
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
  it("a changed Brief save writes one version and event", async () => {
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

  it("an unchanged Brief save writes no version", async () => {
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

  it("a whitespace-only change writes a new version", async () => {
    const first = await sectionOf("Certifications");
    const markdown = briefCiting(first.ids);
    answered(await saving(first, first.guide.ng.editor, markdown));
    const section = await sectionOf("Certifications");

    const saved = answered(await saving(section, section.guide.ng.editor, `${markdown} `));

    expect(saved).toEqual({ saved: true, version: section.base + 1 });
    expect((await versionRows(section)).at(-1)?.markdown).toBe(`${markdown} `);
  });

  it("a changed include row writes a new version", async () => {
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

  it("a Brief save leaves the bundle head unmoved", async () => {
    const section = await sectionOf("Security testing");
    const { git } = section.guide.ng.scenario;
    const before = await head(section.guide.ng.admin, git);

    answered(await saving(section, section.guide.ng.admin, briefCiting(section.ids)));

    expect(await head(section.guide.ng.admin, git)).toBe(before);
  });

  it("places a marker once or twice alike", async () => {
    const section = await sectionOf("Support and service levels");
    const [first] = section.ids;
    const markdown = `Twice.[^${String(first)}] Again.[^${String(first)}]`;

    const saved = answered(await saving(section, section.guide.ng.editor, markdown));

    expect(saved.saved).toBe(true);
  });

  it("a Viewer's Brief save is refused", async () => {
    const section = await sectionOf("Company overview");
    const versions = await versionRows(section);
    const events = await briefEvents(section);

    const refused = await saving(section, section.guide.ng.viewer, briefCiting(section.ids));

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await versionRows(section)).toEqual(versions);
    expect(await briefEvents(section)).toBe(events);
  });

  it("a marker naming no include row is refused", async () => {
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

  it("a save on a stale version is refused", async () => {
    const section = await sectionOf("Company overview");
    answered(await saving(section, section.guide.ng.editor, `${briefCiting(section.ids)} More.`));
    const versions = await versionRows(section);

    const refused = await saving(section, section.guide.ng.editor, "Other words.");

    expect(refused).toEqual({ ok: false, error: "stale-precondition" });
    expect(await versionRows(section)).toEqual(versions);
  });

  it("a save on a withheld section is refused", async () => {
    const section = await sectionOf("Insurance and financial standing");
    const outside = await editorOutsideFinance(db(), section.guide);
    const versions = await versionRows(section);

    const refused = await saving(section, outside, "Words.");

    expect(refused).toEqual({ ok: false, error: "not-found" });
    expect(await versionRows(section)).toEqual(versions);
  });
});
