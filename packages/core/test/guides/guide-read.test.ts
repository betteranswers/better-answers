import { describe, expect, it } from "vitest";

import { readSectionTrusts, trustWords } from "../../src/concepts/index.ts";
import { coverageOf, readGuide, readGuides, type GuideRead } from "../../src/guides/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { EMPLOYERS_LIABILITY } from "../fixtures/northgate-concepts.ts";
import { typedBy } from "../fixtures/northgate.ts";
import { suiteWithBundles } from "../fixtures/workspace-with-bundle.ts";
import { answered, readingAs } from "../support/suite-postgres.ts";
import {
  briefCiting,
  includeIdsOf,
  latestVersionOf,
  saveBriefAs,
  seededGuide,
  writeUpOf,
  type SeededGuide,
} from "./northgate-guide.ts";

const { db, arrange } = suiteWithBundles();

const freshGuide = async (): Promise<SeededGuide> => seededGuide(db(), await arrange());

let shared: Promise<SeededGuide> | undefined;

const seededOnce = (): Promise<SeededGuide> => (shared ??= freshGuide());

const guideAs = async (guide: SeededGuide, reader: UserPrincipal): Promise<GuideRead> => {
  const read = answered(
    await readingAs(db().runtimePool, reader, (principal, tx) =>
      readGuide(principal, tx, { guideId: guide.guideId }),
    ),
  );
  if (read === undefined) throw new Error("the guide was not found");
  return read;
};

const sectionOf = (guide: GuideRead, prompt: string) => {
  const section = guide.sections.find((each) => each.prompt === prompt);
  if (section === undefined) throw new Error(`the guide shows no section ${prompt}`);
  return section;
};

const factStatesOf = (guide: GuideRead, prompt: string) =>
  sectionOf(guide, prompt).coverage.facts.map((fact) => `${fact.name}: ${fact.state}`);

const INSURANCE = "Insurance and financial standing";

const withABrief = async () => {
  const seeded = await freshGuide();
  const writeUpId = await writeUpOf(db(), seeded, "Company overview");
  const ids = await includeIdsOf(db(), writeUpId);
  answered(
    await saveBriefAs(seeded.ng.scenario, seeded.ng.editor, {
      writeUpId,
      markdown: briefCiting(ids),
      base: await latestVersionOf(db(), writeUpId),
    }),
  );
  return { seeded, ids };
};

describe("reading a guide", () => {
  it("numbers the sections in tree order", async () => {
    const guide = await guideAs(await seededOnce(), (await seededOnce()).ng.editor);

    expect(guide.sections.map((section) => [section.number, section.prompt])).toEqual([
      ["1", "Company overview"],
      ["2", "What we offer"],
      ["3", INSURANCE],
      ["4", "Certifications"],
      ["5", "Data protection"],
      ["6", "Information security"],
      ["6.1", "Security testing"],
      ["7", "Support and service levels"],
    ]);
    expect(guide).toMatchObject({ kind: "Bid library", collection: "company", subject: null });
  });

  it("lists each expected fact not yet included in coverage", async () => {
    const seeded = await freshGuide();
    const before = await guideAs(seeded, seeded.ng.editor);
    expect(sectionOf(before, INSURANCE).coverage).toMatchObject({
      met: 3,
      of: 4,
      facts: [
        {},
        {},
        {
          name: "Employers' liability insurance",
          state: "missing",
          kind: "Insurance Policy",
          tags: ["employers-liability"],
          available: [],
        },
        {},
      ],
    });
    expect(before.coverage).toEqual({ met: 20, of: 21 });

    const typed = await typedBy(seeded.ng.editor, seeded.ng.scenario, EMPLOYERS_LIABILITY);
    const after = await guideAs(seeded, seeded.ng.editor);

    expect(sectionOf(after, INSURANCE).coverage.facts[2]).toMatchObject({
      name: "Employers' liability insurance",
      state: "available",
      available: [{ iri: typed.iri, title: "Employers' liability policy" }],
    });
  });

  it("reads coverage from coverageOf in all three states", async () => {
    const seeded = await freshGuide();
    await typedBy(seeded.ng.editor, seeded.ng.scenario, EMPLOYERS_LIABILITY);

    const read = await guideAs(seeded, seeded.ng.viewer);
    const direct = answered(
      await readingAs(db().runtimePool, seeded.ng.viewer, (principal, tx) =>
        coverageOf(principal, tx, seeded.guideId),
      ),
    );

    expect(factStatesOf(read, INSURANCE)).toEqual([
      "Public liability insurance: met",
      "Professional indemnity insurance: missing",
      "Employers' liability insurance: available",
      "Filed accounts: met",
    ]);
    expect(
      read.sections.map((section) =>
        section.coverage.facts.map(({ factId, name, state, available }) => ({
          factId,
          name,
          state,
          available,
        })),
      ),
    ).toEqual(direct?.sections.map((section) => section.facts));
  });

  it("counts a hidden section toward coverage", async () => {
    const seeded = await freshGuide();
    await db().pool.query(
      "UPDATE guide_section SET hidden = true WHERE guide_id = $1 AND prompt = 'Security testing'",
      [seeded.guideId],
    );

    const editor = await guideAs(seeded, seeded.ng.editor);
    const admin = await guideAs(seeded, seeded.ng.admin);

    expect(editor.coverage).toEqual({ met: 20, of: 21 });
    expect(admin.coverage).toEqual({ met: 20, of: 21 });
    expect(editor.sections).toHaveLength(7);
    expect(admin.sections).toHaveLength(8);
  });

  it("never shows a hidden section to a reader", async () => {
    const seeded = await freshGuide();
    await db().pool.query(
      "UPDATE guide_section SET hidden = true WHERE guide_id = $1 AND prompt = 'Information security'",
      [seeded.guideId],
    );

    const viewer = await guideAs(seeded, seeded.ng.viewer);
    const editor = await guideAs(seeded, seeded.ng.editor);
    const admin = await guideAs(seeded, seeded.ng.admin);

    for (const reader of [viewer, editor]) {
      expect(reader.sections.map((section) => section.number)).toEqual([
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
      ]);
      expect(reader.sections.map((section) => section.prompt)).not.toContain("Security testing");
    }
    expect(admin.sections.map((section) => [section.prompt, section.hidden])).toContainEqual([
      "Information security",
      true,
    ]);
    expect(admin.sections.map((section) => section.number)).toContain("6.1");
  });

  it("gives no Brief to a reader outside the write-up's audience", async () => {
    const seeded = await freshGuide();

    const viewer = await guideAs(seeded, seeded.ng.viewer);
    const editor = await guideAs(seeded, seeded.ng.editor);

    const withheld = sectionOf(viewer, INSURANCE);
    expect(withheld.brief).toBeUndefined();
    expect(withheld.needsReview).toBeNull();
    expect(withheld.coverage).toMatchObject({ met: 2, of: 4 });
    expect(sectionOf(editor, INSURANCE).brief).toBeDefined();
    expect(sectionOf(editor, INSURANCE).needsReview).toBe("expectation-unmet");
    expect(sectionOf(viewer, "Company overview").brief).toBeDefined();
    const said = JSON.stringify(viewer);
    expect(said).not.toContain("Professional indemnity policy");
    expect(said).not.toContain(seeded.ng.iri("professionalIndemnity"));
  });

  it("names a withheld section's readable cited concepts", async () => {
    const seeded = await seededOnce();

    const viewer = await guideAs(seeded, seeded.ng.viewer);

    expect(sectionOf(viewer, INSURANCE).citedIris.toSorted()).toEqual(
      [
        seeded.ng.iri("publicLiability"),
        seeded.ng.iri("accounts2024"),
        seeded.ng.iri("accounts2025"),
      ].toSorted(),
    );
  });

  it("gives an Editor the raw Brief and its detail", async () => {
    const { seeded, ids } = await withABrief();

    const brief = sectionOf(await guideAs(seeded, seeded.ng.editor), "Company overview").brief;

    expect(brief?.version).toBe(2);
    expect(brief?.editable?.markdown).toBe(briefCiting(ids));
    expect(brief?.editable?.footnotes.map((each) => each.label)).toEqual(ids);
    expect(brief?.rendered.footnotes.map((each) => each.number)).toEqual([1, 2, 3, 4]);
    expect(brief?.detail.map((each) => each.title)).toEqual([
      "Registered company number",
      "Staff headcount",
      "Founded in 2009",
      "Registered office address",
    ]);
  });

  it("gives a Viewer the rendered Brief alone", async () => {
    const { seeded } = await withABrief();
    const editor = sectionOf(await guideAs(seeded, seeded.ng.editor), "Company overview");

    const viewer = sectionOf(await guideAs(seeded, seeded.ng.viewer), "Company overview");

    expect(viewer.brief?.rendered).toEqual(editor.brief?.rendered);
    expect(viewer.brief?.editable).toBeUndefined();
  });

  it("lists the guide with the sections that need review", async () => {
    const seeded = await seededOnce();
    const listed = (reader: UserPrincipal) =>
      readingAs(db().runtimePool, reader, (principal, tx) => readGuides(principal, tx));

    expect(answered(await listed(seeded.ng.editor))).toEqual([
      {
        guideId: seeded.guideId,
        kind: "Bid library",
        collection: "company",
        subject: null,
        sections: 8,
        needsReview: 1,
      },
    ]);
    expect(answered(await listed(seeded.ng.viewer))).toMatchObject([{ needsReview: 0 }]);
  });

  it("lists as many sections as the page shows", async () => {
    const seeded = await freshGuide();
    await db().pool.query(
      "UPDATE guide_section SET hidden = true WHERE guide_id = $1 AND prompt = 'Information security'",
      [seeded.guideId],
    );

    const listed = answered(
      await readingAs(db().runtimePool, seeded.ng.editor, (principal, tx) =>
        readGuides(principal, tx),
      ),
    );
    const page = await guideAs(seeded, seeded.ng.editor);
    const asAdmin = answered(
      await readingAs(db().runtimePool, seeded.ng.admin, (principal, tx) =>
        readGuides(principal, tx),
      ),
    );

    expect(listed[0]?.sections).toBe(page.sections.length);
    expect(listed[0]?.sections).toBe(6);
    expect(asAdmin[0]?.sections).toBe(8);
  });
});

describe("the trust a section shows", () => {
  it("names the weakest of the concepts a section cites", async () => {
    const seeded = await seededOnce();
    const guide = await guideAs(seeded, seeded.ng.editor);

    const trusts = answered(
      await readingAs(db().runtimePool, seeded.ng.editor, (principal, tx) =>
        readSectionTrusts(
          principal,
          tx,
          [
            sectionOf(guide, INSURANCE).citedIris,
            sectionOf(guide, "Company overview").citedIris,
            [],
          ],
          new Date("2026-06-01T00:00:00Z"),
        ),
      ),
    );
    const words = trusts.map(trustWords);

    expect(words[0]).toMatch(/^Verified by .+ · 12 May 2026 · imported$/u);
    expect(words[1]).toBe("Unverified");
    expect(words[2]).toBe("Unverified");
  });
});
