import { describe, expect, it } from "vitest";

import { citedSourcesOf, conceptIriOf, ids, ulid, type ConceptIri } from "@better-answers/schema";
import { linksAndMarksOf } from "@better-answers/schema/concept-file";

import {
  readConcept,
  type Frontmatter,
  type FrontmatterValue,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import { err, type UserPrincipal } from "../src/kernel/index.ts";
import { parseLocator, passageAt } from "../src/sources/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import {
  conceptCiting,
  connectedSourceHolding,
  groupNamed,
  overriddenBy,
  passageUnder,
  restrictedAndInternal,
  rewriteCiting,
  seededBy,
  visibilitySuite,
  type Sourced,
  type SourcedConcept,
} from "./sourced-concept.ts";
import { answered } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading } = visibilitySuite();

const now = new Date("2026-09-08T12:00:00.000Z");

const HOLIDAY = "Holiday is twenty-eight days including bank holidays.";

const readingThrough = (reader: UserPrincipal, tx: Tx, iri: ConceptIri) =>
  readConcept(reader, tx, iri, {
    passageAt: (locator) => passageAt(reader, tx, locator),
    namesPassage: (locator) => parseLocator(locator).ok,
    now,
  });

const readFor = async (person: UserPrincipal, iri: ConceptIri) =>
  answered(await reading(person, (reader, tx) => readingThrough(reader, tx, iri)));

const paneFor = async (person: UserPrincipal, iri: ConceptIri) =>
  (await readFor(person, iri))?.pane;

/** A passage covering all of `HOLIDAY` in the document, and the locator that opens it. */
const passageIn = async (scenario: Scenario, document: Sourced): Promise<string> => {
  await passageUnder(db(), scenario.workspaceId, document, {
    content: HOLIDAY,
    ordinal: 0,
    charStart: 0,
    charEnd: HOLIDAY.length,
  });
  return `${document.documentId}/chars:0-${HOLIDAY.length}`;
};

const sourcesAt = (locators: readonly string[]) =>
  locators.map((locator, at) => ({
    title: `Document ${at + 1}`,
    resource: `documents/${at + 1}`,
    locator,
  }));

/** A note citing each document, its frontmatter naming a passage in each as a source. */
const sourcedNote = async (
  scenario: Scenario,
  writer: UserPrincipal,
  documents: readonly Sourced[],
  overrides: Partial<WriteConceptInput> = {},
) => {
  const locators: string[] = [];
  for (const document of documents) locators.push(await passageIn(scenario, document));
  const written = await conceptCiting(
    scenario,
    writer,
    documents.map((document) => document.documentId),
    {
      ...overrides,
      frontmatter: { type: "Note", ...overrides.frontmatter, sources: sourcesAt(locators) },
    },
  );
  return { written, locators };
};

const noteNaming = (
  scenario: Scenario,
  sources: FrontmatterValue,
  overrides: Partial<WriteConceptInput> = {},
) =>
  conceptCiting(scenario, scenario.editor, [], {
    sensitivity: "Internal",
    ...overrides,
    frontmatter: { type: "Note", sources },
  });

const overriddenTo = (scenario: Scenario, iri: string, sensitivity: string) =>
  overriddenBy(db(), scenario, iri, sensitivity);

const rewrittenWith = (
  scenario: Scenario,
  writer: UserPrincipal,
  written: SourcedConcept,
  documents: readonly Sourced[],
  frontmatter: Frontmatter,
) =>
  rewriteCiting(
    scenario,
    writer,
    written,
    documents.map(({ documentId }) => documentId),
    { frontmatter: { title: written.title, ...frontmatter } },
  );

const restrictedPassage = async (scenario: Scenario) => {
  const restricted = await connectedSourceHolding(db(), scenario.workspaceId, {
    sensitivity: "Restricted",
  });
  return { restricted, locator: await passageIn(scenario, restricted) };
};

/** A note citing a Restricted and an Internal document, which an Admin shares with everyone. */
const sharedPastItsEvidence = async (scenario: Scenario) => {
  const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
  const noted = await sourcedNote(scenario, scenario.editor, [restricted, internal]);
  await overriddenTo(scenario, noted.written.iri, "Internal");
  return noted;
};

const readableAndWithheld = async (scenario: Scenario) => {
  const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
  return {
    internal,
    readable: await conceptCiting(scenario, scenario.editor, [internal.documentId]),
    withheld: await conceptCiting(scenario, scenario.editor, [restricted.documentId]),
  };
};

/** A read takes no lock a write could hold, so the read is paused through its `tx` after its first statement. */
const readAcross = async (
  reader: UserPrincipal,
  iri: ConceptIri,
  write: () => Promise<{ readonly ok: boolean }>,
) => {
  let paused = false;
  let wrote: { readonly ok: boolean } | undefined;
  const read = await reading(reader, (principal, tx) =>
    readingThrough(
      principal,
      new Proxy(tx, {
        get: (target, key) =>
          key === "query"
            ? async (statement: string, values?: unknown[]) => {
                const rows = await target.query(statement, values);
                if (!paused) {
                  paused = true;
                  wrote = await write();
                }
                return rows;
              }
            : Reflect.get(target, key),
      }),
      iri,
    ),
  );
  return { read: answered(read), wrote };
};

describe("the evidence pane", () => {
  it("answers a withheld concept exactly as one nobody minted", async () => {
    const scenario = await arrange();
    const restricted = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    const { written } = await sourcedNote(scenario, scenario.editor, [restricted]);

    const withheld = await reading(scenario.viewer, (reader, tx) =>
      readingThrough(reader, tx, written.iri),
    );
    const absent = await reading(scenario.viewer, (reader, tx) =>
      readingThrough(reader, tx, conceptIriOf(ulid())),
    );

    expect(withheld).toEqual({ ok: true, value: undefined });
    expect(absent).toEqual(withheld);
  });

  it("leads with the reader's access and opens every readable source", async () => {
    const scenario = await arrange();
    const { internal, restricted } = await restrictedAndInternal(db(), scenario.workspaceId);
    const { written, locators } = await sourcedNote(scenario, scenario.editor, [
      internal,
      restricted,
    ]);

    const pane = await paneFor(scenario.admin, written.iri);

    expect(pane).toEqual({
      access: "included",
      lead: "Based on your current access, the evidence is included.",
      evidence: [
        { source: "Document 1", locator: locators[0] },
        { source: "Document 2", locator: locators[1] },
      ],
      sharedBeyondEvidence: undefined,
      next: "Open a source to read the passage the concept rests on.",
    });
  });

  it("names the overriding Admin and lists withheld sources by label", async () => {
    const scenario = await arrange();
    const restricted = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    const { written, locators } = await sourcedNote(scenario, scenario.editor, [restricted], {
      kind: "Person",
      frontmatter: { title: "Ada Lovelace", type: "Person" },
    });
    await overriddenTo(scenario, written.iri, "Internal");

    const pane = await paneFor(scenario.viewer, written.iri);

    expect(pane).toMatchObject({
      access: "not-included",
      lead: "Based on your current access, the evidence isn't included. An Admin shared this concept beyond its evidence.",
      evidence: [{ source: "Document 1" }],
      sharedBeyondEvidence: { by: `human:${scenario.admin.userId}` },
      next: "Ask an Admin for access to the sources, or read the concept as it stands.",
    });
    expect(pane?.sharedBeyondEvidence?.at).toBeInstanceOf(Date);
    expect(JSON.stringify(pane)).not.toContain(locators[0]);
    expect(JSON.stringify(pane)).not.toContain(restricted.documentId);
  });

  it("opens only the readable sources when some are withheld", async () => {
    const scenario = await arrange();
    const { written, locators } = await sharedPastItsEvidence(scenario);

    const pane = await paneFor(scenario.viewer, written.iri);

    expect(pane).toMatchObject({
      access: "partly-included",
      lead: "Based on your current access, some of the evidence isn't included. An Admin shared this concept beyond its evidence.",
      evidence: [{ source: "Document 1" }, { source: "Document 2", locator: locators[1] }],
      sharedBeyondEvidence: { by: `human:${scenario.admin.userId}` },
    });
  });

  it("names no Admin when nothing is withheld, sourced or not", async () => {
    const scenario = await arrange();
    const unsourced = await conceptCiting(scenario, scenario.editor, [], {
      sensitivity: "Internal",
    });
    const internal = await connectedSourceHolding(db(), scenario.workspaceId);
    const { written: sourced, locators } = await sourcedNote(scenario, scenario.editor, [internal]);
    await overriddenTo(scenario, sourced.iri, "Public");

    const nothingCited = await paneFor(scenario.viewer, unsourced.iri);
    const allIncluded = await paneFor(scenario.viewer, sourced.iri);

    expect(nothingCited).toEqual({
      access: "included",
      lead: "This concept cites no source, so there is nothing to include.",
      evidence: [],
      sharedBeyondEvidence: undefined,
      next: "Read the concept as it stands.",
    });
    expect(allIncluded).toMatchObject({
      access: "included",
      evidence: [{ source: "Document 1", locator: locators[0] }],
      sharedBeyondEvidence: undefined,
    });
  });

  it("withholds a source under an unpublished connected source, naming nobody", async () => {
    const scenario = await arrange();
    const unpublished = await connectedSourceHolding(db(), scenario.workspaceId, {
      publishedAt: null,
    });
    const { written } = await sourcedNote(scenario, scenario.editor, [unpublished], {
      sensitivity: "Internal",
    });

    const pane = await paneFor(scenario.admin, written.iri);

    expect(pane).toMatchObject({
      access: "not-included",
      lead: "Based on your current access, the evidence isn't included.",
      evidence: [{ source: "Document 1" }],
      sharedBeyondEvidence: undefined,
    });
  });

  it("lists locator-less sources by title, unlinked, and counts them", async () => {
    const scenario = await arrange();
    const written = await noteNaming(scenario, [
      { id: "AUD-047", title: "Audit policy", resource: "https://intranet.example/audit.docx" },
      { id: "AUD-048", resource: "Retention schedule" },
    ]);

    const pane = await paneFor(scenario.viewer, written.iri);

    expect(pane).toEqual({
      access: "included",
      lead: "This concept names its sources, but none of them has a passage to open.",
      evidence: [
        { id: "AUD-047", source: "Audit policy" },
        { id: "AUD-048", source: "Retention schedule" },
      ],
      sharedBeyondEvidence: undefined,
      next: "Read the concept as it stands.",
    });
  });

  it("opens a readable concept; withheld and unwritten ones read alike", async () => {
    const scenario = await arrange();
    const { readable, withheld } = await readableAndWithheld(scenario);
    const written = await noteNaming(scenario, [
      { title: "Readable note", resource: readable.iri },
      { title: "Another note", resource: withheld.iri },
      { title: "Another note", resource: conceptIriOf(ulid()) },
    ]);

    const read = await readFor(scenario.viewer, written.iri);

    expect(read?.pane).toMatchObject({
      access: "partly-included",
      evidence: [
        { source: "Readable note", iri: readable.iri },
        { source: "Another note" },
        { source: "Another note" },
      ],
    });
    expect(read?.frontmatter["sources"]).toStrictEqual([
      { title: "Readable note", resource: readable.iri },
      { title: "Another note", resource: "Another note" },
      { title: "Another note", resource: "Another note" },
    ]);
  });

  it("finds each citation mark's source at the mark's index", async () => {
    const scenario = await arrange();
    const { locator } = await restrictedPassage(scenario);
    const written = await noteNaming(
      scenario,
      [
        { id: "A-1", title: "The handbook", resource: "handbook" },
        { id: "B-2", title: "The minutes", resource: "minutes", locator },
      ],
      { body: "Holiday rests on the minutes.[^b-2]" },
    );

    const read = await readFor(scenario.viewer, written.iri);
    const projected = citedSourcesOf(read?.frontmatter["sources"]);

    expect(linksAndMarksOf(read?.body ?? "", projected).marks).toEqual([
      { at: 29, mark: "[^b-2]", source: 1 },
    ]);
    expect(read?.pane.evidence[1]).toEqual({ id: "B-2", source: "The minutes" });
  });

  it("lists the sources its concept read found, across a re-write", async () => {
    const scenario = await arrange();
    const kept = await connectedSourceHolding(db(), scenario.workspaceId);
    const added = await connectedSourceHolding(db(), scenario.workspaceId);
    const { written, locators } = await sourcedNote(scenario, scenario.editor, [kept]);
    const addedAt = await passageIn(scenario, added);

    const { read, wrote } = await readAcross(scenario.admin, written.iri, () =>
      rewrittenWith(scenario, scenario.editor, written, [kept, added], {
        type: "Note",
        sources: sourcesAt([locators[0] ?? "", addedAt]),
      }),
    );

    expect(wrote).toMatchObject({ ok: true });
    expect(read?.pane.evidence).toEqual([{ source: "Document 1", locator: locators[0] }]);
    expect((await paneFor(scenario.admin, written.iri))?.evidence).toEqual([
      { source: "Document 1", locator: locators[0] },
      { source: "Document 2", locator: addedAt },
    ]);
  });

  it("answers from the read that found the concept readable", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const { written, locators } = await sourcedNote(scenario, scenario.editor, [internal]);

    const { read, wrote } = await readAcross(scenario.viewer, written.iri, () =>
      rewrittenWith(scenario, scenario.admin, written, [internal, restricted], {
        type: "Note",
      }),
    );

    expect(wrote).toMatchObject({ ok: true });
    expect(read?.pane).toMatchObject({
      access: "included",
      evidence: [{ source: "Document 1", locator: locators[0] }],
    });
    expect(await readFor(scenario.viewer, written.iri)).toBeUndefined();
  });

  it("names the override that stood when the concept was read", async () => {
    const scenario = await arrange();
    const { internal, restricted } = await restrictedAndInternal(db(), scenario.workspaceId);
    const { written } = await sourcedNote(scenario, scenario.editor, [internal, restricted]);
    await overriddenTo(scenario, written.iri, "Internal");
    const stood = await db().pool.query<{ recorded_at: Date }>(
      "SELECT recorded_at FROM concept_sensitivity_override WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.iri],
    );

    const { read, wrote } = await readAcross(scenario.viewer, written.iri, () =>
      overriddenTo(scenario, written.iri, "Public"),
    );

    expect(wrote).toMatchObject({ ok: true });
    expect(read?.pane.sharedBeyondEvidence).toEqual({
      by: `human:${scenario.admin.userId}`,
      at: stood.rows[0]?.recorded_at,
    });
  });
});

describe("what a concept read cannot open", () => {
  it.each(["admin", "viewer"] as const)(
    "shows the %s a page locator that opens nothing",
    async (role) => {
      const scenario = await arrange();
      const written = await noteNaming(scenario, [
        { title: "Bid library", resource: "../sources/bid-library.md", locator: "p.4" },
      ]);

      const pane = await paneFor(scenario[role], written.iri);

      expect(pane).toEqual({
        access: "included",
        lead: "This concept names its sources, but none of them has a passage to open.",
        evidence: [{ source: "Bid library", at: "p.4" }],
        sharedBeyondEvidence: undefined,
        next: "Read the concept as it stands.",
      });
    },
  );

  it.each([
    ["a Viewer", "viewer", [{ title: "Minutes", resource: "Minutes" }]],
    ["an Admin", "admin", undefined],
  ] as const)("keeps a page locator in the frontmatter for %s", async (_who, role, withheld) => {
    const scenario = await arrange();
    const { locator } = await restrictedPassage(scenario);
    const minutes = { title: "Minutes", resource: "minutes", locator };
    const written = await noteNaming(scenario, [
      { title: "Bid library", resource: "../sources/bid-library.md", locator: "p.4" },
      minutes,
    ]);

    const read = await readFor(scenario[role], written.iri);

    expect(read?.frontmatter["sources"]).toEqual([
      { title: "Bid library", resource: "Bid library", locator: "p.4" },
      ...(withheld ?? [minutes]),
    ]);
  });

  it.each([
    ["a passage address in lower case", (id: string) => `${id.toLowerCase()}/chars:0-5`],
    ["a passage address spanning backwards", (id: string) => `${id}/chars:5-0`],
    ["a document id beside a page", (id: string) => `p.4 of ${id}`],
    ["spaces alone", () => "   "],
  ])("keeps no place for %s", async (_case, malformed) => {
    const scenario = await arrange();
    const { restricted } = await restrictedPassage(scenario);
    const locator = malformed(restricted.documentId);
    const written = await noteNaming(scenario, [
      { title: "Minutes", resource: "minutes", locator },
    ]);

    const read = await readFor(scenario.viewer, written.iri);

    expect(read?.pane.evidence).toEqual([{ source: "Minutes" }]);
    expect(read?.frontmatter["sources"]).toEqual([{ title: "Minutes", resource: "Minutes" }]);
  });

  it("keeps a page beside a withheld concept, never its iri", async () => {
    const scenario = await arrange();
    const { withheld } = await readableAndWithheld(scenario);
    const cited = { title: "Board note", resource: withheld.iri, locator: "p.4" };
    const written = await noteNaming(scenario, [cited]);

    const viewer = await readFor(scenario.viewer, written.iri);
    const admin = await readFor(scenario.admin, written.iri);

    expect(viewer?.pane.evidence).toEqual([{ source: "Board note", at: "p.4" }]);
    expect(viewer?.frontmatter["sources"]).toEqual([
      { title: "Board note", resource: "Board note", locator: "p.4" },
    ]);
    expect(admin?.pane.evidence).toEqual([{ source: "Board note", at: "p.4", iri: withheld.iri }]);
    expect(admin?.frontmatter["sources"]).toEqual([cited]);
  });

  it("keeps a page locator on a source written as text", async () => {
    const scenario = await arrange();
    const { locator } = await restrictedPassage(scenario);
    const written = await noteNaming(scenario, [
      "Bid library#p.4",
      `minutes#${locator}`,
      "Handbook#",
    ]);

    const read = await readFor(scenario.viewer, written.iri);

    expect(read?.frontmatter["sources"]).toEqual(["Bid library#p.4", "minutes", "Handbook"]);
    expect(read?.pane.evidence).toEqual([
      { source: "Bid library", at: "p.4" },
      { source: "minutes" },
      { source: "Handbook" },
    ]);
  });

  it("labels a source by resource when its title is blank", async () => {
    const scenario = await arrange();
    const { locator } = await restrictedPassage(scenario);
    const written = await noteNaming(scenario, [{ title: "   ", resource: "minutes", locator }]);

    const read = await readFor(scenario.viewer, written.iri);

    expect(read?.pane.evidence).toEqual([{ source: "minutes" }]);
    expect(read?.frontmatter["sources"]).toEqual([{ resource: "minutes" }]);
  });

  it("leaves out a sources value that is no list", async () => {
    const scenario = await arrange();
    const { locator } = await restrictedPassage(scenario);
    const scalar = await seededBy(db(), (seed) =>
      seed.conceptIndex({
        workspaceId: scenario.workspaceId,
        frontmatter: { title: "Scalar", type: "Policy", sources: `minutes#${locator}` },
      }),
    );

    const read = await readFor(scenario.viewer, ids.conceptIri.parse(scalar.iri));

    expect(read?.frontmatter).toEqual({ title: "Scalar", type: "Policy" });
    expect(read?.pane.evidence).toEqual([]);
  });

  it("answers a failed passage read as an error", async () => {
    const scenario = await arrange();
    const { locator } = await restrictedPassage(scenario);
    const written = await noteNaming(scenario, [
      { title: "Minutes", resource: "minutes", locator },
    ]);
    const failure = new Error("the passage read failed");

    const read = await reading(scenario.admin, (reader, tx) =>
      readConcept(reader, tx, written.iri, {
        passageAt: () => Promise.resolve(err(failure)),
        namesPassage: () => true,
        now,
      }),
    );

    expect(read).toEqual({ ok: false, error: failure });
  });
});

describe("a concept's projected frontmatter", () => {
  it("keeps a locator only where the reader may open it", async () => {
    const scenario = await arrange();
    const { written, locators } = await sharedPastItsEvidence(scenario);

    const viewer = await readFor(scenario.viewer, written.iri);
    const admin = await readFor(scenario.admin, written.iri);

    expect(viewer?.frontmatter["sources"]).toEqual([
      { title: "Document 1", resource: "Document 1" },
      { title: "Document 2", resource: "documents/2", locator: locators[1] },
    ]);
    expect(admin?.frontmatter["sources"]).toEqual(sourcesAt(locators));
  });

  it("cuts a string source to its resource, closing any #", async () => {
    const scenario = await arrange();
    const { locator } = await restrictedPassage(scenario);
    const written = await noteNaming(scenario, [`minutes#${locator}`, `a#b#${locator}`, "plain"]);

    const read = await readFor(scenario.viewer, written.iri);

    expect(read?.frontmatter["sources"]).toEqual(["minutes", "a#b#", "plain"]);
    expect(read?.pane.evidence).toEqual([
      { source: "minutes" },
      { source: "a#b" },
      { source: "plain" },
    ]);
  });
});

/** Concepts seeded straight into the index, published and readable by everyone. */
const targetsSeeded = (workspaceId: string, titles: readonly string[]) =>
  seededBy(db(), async (seed) => {
    const iris: ConceptIri[] = [];
    for (const title of titles) {
      const row = await seed.conceptIndex({ workspaceId, title });
      iris.push(ids.conceptIri.parse(row.iri));
    }
    return iris;
  });

const byTarget = (one: { readonly target: string }, other: { readonly target: string }) =>
  one.target.localeCompare(other.target);

describe("a concept's relations", () => {
  it("lists no lineage edge a cited concept leaves", async () => {
    const scenario = await arrange();
    const { readable } = await readableAndWithheld(scenario);
    const written = await noteNaming(scenario, [
      { title: "Readable note", resource: readable.iri },
    ]);

    const read = await readFor(scenario.admin, written.iri);

    expect(read?.relations).toEqual([]);
    expect(read?.pane.evidence).toEqual([{ source: "Readable note", iri: readable.iri }]);
  });

  it("lists a readable linked concept, never a withheld one", async () => {
    const scenario = await arrange();
    const { internal, readable, withheld } = await readableAndWithheld(scenario);
    const body = `See [this](${readable.iri}) and [that](${withheld.iri}).`;
    const entry = await conceptCiting(scenario, scenario.editor, [internal.documentId], { body });

    const viewer = await readFor(scenario.viewer, entry.iri);
    const admin = await readFor(scenario.admin, entry.iri);

    expect(viewer?.relations).toEqual([
      { kind: "LINKS_TO", target: readable.iri, title: readable.title },
    ]);
    expect(viewer?.body).toBe(body);
    expect(admin?.relations.toSorted(byTarget)).toEqual(
      [
        { kind: "LINKS_TO", target: readable.iri, title: readable.title },
        { kind: "LINKS_TO", target: withheld.iri, title: withheld.title },
      ].toSorted(byTarget),
    );
  });

  it("lists the map's named edges, never a SAME_AS one", async () => {
    const scenario = await arrange();
    const { readable, withheld } = await readableAndWithheld(scenario);
    const entry = await noteNaming(scenario, []);
    await seededBy(db(), async (seed) => {
      for (const [label, target] of [
        ["CITES", readable],
        ["SAME_AS", withheld],
      ] as const) {
        await seed.mapEdge({
          workspaceId: scenario.workspaceId,
          label,
          fromUid: entry.iri,
          toUid: target.iri,
        });
      }
    });

    const read = await readFor(scenario.admin, entry.iri);

    expect(read?.relations).toEqual([
      { kind: "CITES", target: readable.iri, title: readable.title },
    ]);
  });

  it("answers a failed relations read as an error", async () => {
    const scenario = await arrange();
    const entry = await noteNaming(scenario, []);
    const failure = new Error("the relations read failed");

    const read = await reading(scenario.admin, (reader, tx) =>
      readingThrough(
        reader,
        new Proxy(tx, {
          get: (target, key) =>
            key === "query"
              ? (statement: string, values?: unknown[]) =>
                  statement.includes("map_edge")
                    ? Promise.reject(failure)
                    : target.query(statement, values)
              : Reflect.get(target, key),
        }),
        entry.iri,
      ),
    );

    expect(read).toEqual({ ok: false, error: failure });
  });

  it("gives an Admin a Restricted concept's pane and relations", async () => {
    const scenario = await arrange();
    const restricted = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    const target = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
    const { written, locators } = await sourcedNote(scenario, scenario.editor, [restricted], {
      body: `Rests on [the target](${target.iri}).`,
    });

    const read = await readFor(scenario.admin, written.iri);

    expect(read?.pane.evidence).toEqual([{ source: "Document 1", locator: locators[0] }]);
    expect(read?.relations).toEqual([
      { kind: "LINKS_TO", target: target.iri, title: target.title },
    ]);
  });

  it("cuts relations past twenty-five, with no count", async () => {
    const scenario = await arrange();
    const titles = Array.from(
      { length: 26 },
      (_, at) => `Target ${String(at + 1).padStart(2, "0")}`,
    );
    const targets = await targetsSeeded(scenario.workspaceId, titles);
    const entry = await conceptCiting(scenario, scenario.editor, [], {
      sensitivity: "Internal",
      body: targets.map((iri, at) => `[${String(at)}](${iri})`).join(" "),
    });

    const read = await readFor(scenario.admin, entry.iri);

    expect(read?.relations.map(({ title }) => title)).toEqual(titles.slice(0, 25));
    expect(Object.keys(read ?? {}).toSorted()).toEqual(
      [
        "body",
        "bodyLinks",
        "frontmatter",
        "iri",
        "pane",
        "relations",
        "trust",
        "trustWords",
      ].toSorted(),
    );
  });
});

const EXPENSES = "knowledge/policies/expenses.md";

const AUDIT_COMMITTEE = "knowledge/roles/audit-committee.md";

const TO_THE_COMMITTEE = "See the [Audit Committee](../roles/audit-committee.md).";

/** A stable Internal note at `path`, everyone's to read. */
const noteAt = (scenario: Scenario, path: string, overrides: Partial<WriteConceptInput> = {}) =>
  conceptCiting(scenario, scenario.editor, [], { sensitivity: "Internal", path, ...overrides });

type SeededConcept = Parameters<Parameters<typeof seededBy>[1]>[0]["conceptIndex"];

/** A concept seeded straight into the index, so no write derives an edge to it. */
const indexedAt = (
  scenario: Scenario,
  path: string,
  overrides: NonNullable<Parameters<SeededConcept>[0]> = {},
) =>
  seededBy(db(), async (seed) => {
    const row = await seed.conceptIndex({
      workspaceId: scenario.workspaceId,
      path,
      ...overrides,
    });
    return ids.conceptIri.parse(row.iri);
  });

type SeededEdge = Parameters<Parameters<typeof seededBy>[1]>[0]["mapEdge"];

const edgeSeeded = (
  scenario: Scenario,
  fromUid: string,
  toUid: string,
  overrides: NonNullable<Parameters<SeededEdge>[0]> = {},
) =>
  seededBy(db(), (seed) =>
    seed.mapEdge({ workspaceId: scenario.workspaceId, fromUid, toUid, ...overrides }),
  );

const linksFor = async (person: UserPrincipal, iri: ConceptIri) =>
  (await readFor(person, iri))?.bodyLinks;

describe("a body's links", () => {
  it("answers a readable relative link at its ordinal", async () => {
    const scenario = await arrange();
    const committee = await noteAt(scenario, AUDIT_COMMITTEE);
    const expenses = await noteAt(scenario, EXPENSES, {
      body: `![A chart](chart.png) from [the site](https://example.test). ${TO_THE_COMMITTEE}`,
    });

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([
      { ordinal: 2, address: "../roles/audit-committee.md", target: committee.iri },
    ]);
  });

  it("answers nothing for a concept the reader may not read", async () => {
    const scenario = await arrange();
    const { restricted } = await restrictedAndInternal(db(), scenario.workspaceId);
    const committee = await conceptCiting(scenario, scenario.editor, [restricted.documentId], {
      path: AUDIT_COMMITTEE,
    });
    const expenses = await noteAt(scenario, EXPENSES, { body: TO_THE_COMMITTEE });

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([]);
    expect(await linksFor(scenario.admin, expenses.iri)).toEqual([
      { ordinal: 0, address: "../roles/audit-committee.md", target: committee.iri },
    ]);
  });

  it("reads alike for a concept withheld and one never written", async () => {
    const scenario = await arrange();
    const { restricted } = await restrictedAndInternal(db(), scenario.workspaceId);
    await conceptCiting(scenario, scenario.editor, [restricted.documentId], {
      path: AUDIT_COMMITTEE,
    });
    const toWithheld = await noteAt(scenario, EXPENSES, { body: TO_THE_COMMITTEE });
    const toNothing = await noteAt(scenario, "knowledge/draft/policies/expenses.md", {
      body: TO_THE_COMMITTEE,
    });

    const withheld = await readFor(scenario.viewer, toWithheld.iri);
    const absent = await readFor(scenario.viewer, toNothing.iri);

    const nothingAnswered = { body: TO_THE_COMMITTEE, bodyLinks: [], relations: [] };
    expect(withheld).toMatchObject(nothingAnswered);
    expect(absent).toMatchObject(nothingAnswered);
  });

  it("answers a group's concept to its members alone", async () => {
    const scenario = await arrange();
    const board = await groupNamed(db(), scenario, "Board", [scenario.editor]);
    const expenses = await noteAt(scenario, "knowledge/expenses.md", {
      body: "See [the board](./board.md).",
    });
    const forTheBoard = await indexedAt(scenario, "knowledge/board.md", {
      audience: "groups",
      audienceGroups: [board],
    });
    await edgeSeeded(scenario, expenses.iri, forTheBoard);

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([]);
    expect(await linksFor(scenario.admin, expenses.iri)).toEqual([]);
    expect(await linksFor(scenario.editor, expenses.iri)).toEqual([
      { ordinal: 0, address: "./board.md", target: forTheBoard },
    ]);
  });

  it("answers an unpublished concept to nobody", async () => {
    const scenario = await arrange();
    const expenses = await noteAt(scenario, "knowledge/expenses.md", {
      body: "See [the draft](./draft.md) and [the board](./board.md).",
    });
    const unpublished = await indexedAt(scenario, "knowledge/draft.md", {
      status: "draft",
      publishedAt: null,
    });
    const board = await indexedAt(scenario, "knowledge/board.md");
    await edgeSeeded(scenario, expenses.iri, unpublished);
    await edgeSeeded(scenario, expenses.iri, board);

    expect(await linksFor(scenario.admin, expenses.iri)).toEqual([
      { ordinal: 1, address: "./board.md", target: board },
    ]);
  });

  it("stops answering a concept once an Admin restricts it", async () => {
    const scenario = await arrange();
    const committee = await noteAt(scenario, AUDIT_COMMITTEE);
    const expenses = await noteAt(scenario, EXPENSES, { body: TO_THE_COMMITTEE });

    const before = await linksFor(scenario.viewer, expenses.iri);
    await overriddenTo(scenario, committee.iri, "Restricted");
    const after = await linksFor(scenario.viewer, expenses.iri);

    expect(before).toEqual([
      { ordinal: 0, address: "../roles/audit-committee.md", target: committee.iri },
    ]);
    expect(after).toEqual([]);
  });

  it("answers a link whose concept was written after it", async () => {
    const scenario = await arrange();
    const expenses = await noteAt(scenario, EXPENSES, { body: TO_THE_COMMITTEE });

    const before = await linksFor(scenario.viewer, expenses.iri);
    const committee = await noteAt(scenario, AUDIT_COMMITTEE);
    const after = await linksFor(scenario.viewer, expenses.iri);

    expect(before).toEqual([]);
    expect(after).toEqual([
      { ordinal: 0, address: "../roles/audit-committee.md", target: committee.iri },
    ]);
  });

  it("answers every link past twenty-five", async () => {
    const scenario = await arrange();
    const files = Array.from(
      { length: 26 },
      (_, at) => `target-${String(at + 1).padStart(2, "0")}.md`,
    );
    const targets: ConceptIri[] = [];
    for (const file of files) {
      targets.push(await indexedAt(scenario, `knowledge/${file}`, { title: file }));
    }
    const entry = await noteAt(scenario, "knowledge/entry.md", {
      body: files.map((file, at) => `[${String(at)}](./${file})`).join(" "),
    });

    const read = await readFor(scenario.admin, entry.iri);

    expect(read?.bodyLinks).toHaveLength(26);
    expect(read?.bodyLinks.at(-1)).toEqual({
      ordinal: 25,
      address: "./target-26.md",
      target: targets[25],
    });
    expect(read?.relations).toHaveLength(25);
  });

  it("answers nothing for an address that names no concept", async () => {
    const scenario = await arrange();
    const committee = await noteAt(scenario, AUDIT_COMMITTEE);
    const expenses = await noteAt(scenario, EXPENSES, {
      body: [
        "[Out of the bundle](../../../outside.md)",
        "[A text file](../notes.txt)",
        "[Another host](//host.example/roles/audit-committee.md)",
        "[Nobody's](https://better-answers.com/c/01J6NNNNNNNNNNNNNNNNNNNNNN)",
        "[The committee](../roles/audit-committee.md)",
      ].join(", "),
    });

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([
      { ordinal: 4, address: "../roles/audit-committee.md", target: committee.iri },
    ]);
  });

  it("answers a repeated address twice, and an IRI as itself", async () => {
    const scenario = await arrange();
    const committee = await noteAt(scenario, AUDIT_COMMITTEE);
    const expenses = await noteAt(scenario, EXPENSES, {
      body: `[One](../roles/audit-committee.md#duties), [two](../roles/audit-committee.md) and [three](${committee.iri}).`,
    });

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([
      { ordinal: 0, address: "../roles/audit-committee.md#duties", target: committee.iri },
      { ordinal: 1, address: "../roles/audit-committee.md", target: committee.iri },
      { ordinal: 2, address: committee.iri, target: committee.iri },
    ]);
  });

  it("counts no citation mark among the links", async () => {
    const scenario = await arrange();
    const committee = await noteAt(scenario, AUDIT_COMMITTEE);
    const expenses = await noteAt(scenario, EXPENSES, {
      frontmatter: {
        type: "Note",
        sources: [{ id: "HB-1", resource: "/sources/handbook.pdf", locator: "p.4" }],
      },
      body: [
        `Claims close in thirty days[^hb-1]. ${TO_THE_COMMITTEE}`,
        "",
        "[^hb-1]: ../roles/audit-committee.md",
      ].join("\n"),
    });

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([
      { ordinal: 0, address: "../roles/audit-committee.md", target: committee.iri },
    ]);
  });

  it("answers nothing for an edge the link does not name", async () => {
    const scenario = await arrange();
    const expenses = await noteAt(scenario, "knowledge/expenses.md", {
      body: "See [travel](./travel.md) and [the board](./board.md).",
    });
    const board = await indexedAt(scenario, "knowledge/board.md");
    const elsewhere = await indexedAt(scenario, "knowledge/elsewhere.md");
    await edgeSeeded(scenario, expenses.iri, board);
    await edgeSeeded(scenario, expenses.iri, elsewhere);

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([
      { ordinal: 1, address: "./board.md", target: board },
    ]);
  });

  it("answers nothing from an edge outside the live generation", async () => {
    const scenario = await arrange();
    const expenses = await noteAt(scenario, "knowledge/expenses.md", {
      body: "See [the board](./board.md), [travel](./travel.md) and [pay](./pay.md).",
    });
    const board = await indexedAt(scenario, "knowledge/board.md");
    const travel = await indexedAt(scenario, "knowledge/travel.md");
    const pay = await indexedAt(scenario, "knowledge/pay.md");
    await edgeSeeded(scenario, expenses.iri, board);
    await edgeSeeded(scenario, expenses.iri, travel, { gen: 2 });
    await edgeSeeded(scenario, expenses.iri, pay, { gen: null });

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([
      { ordinal: 0, address: "./board.md", target: board },
    ]);
  });

  it("answers nothing from an edge the reader may not read", async () => {
    const scenario = await arrange();
    const expenses = await noteAt(scenario, "knowledge/expenses.md", {
      body: "See [the board](./board.md).",
    });
    const board = await indexedAt(scenario, "knowledge/board.md");
    await edgeSeeded(scenario, expenses.iri, board, { sensitivity: "Restricted" });

    expect(await linksFor(scenario.viewer, expenses.iri)).toEqual([]);
    expect(await linksFor(scenario.admin, expenses.iri)).toEqual([
      { ordinal: 0, address: "./board.md", target: board },
    ]);
  });

  it("answers a failed read of the edges as an error", async () => {
    const scenario = await arrange();
    const expenses = await noteAt(scenario, EXPENSES, { body: TO_THE_COMMITTEE });
    const failure = new Error("the links read failed");

    const read = await reading(scenario.admin, (reader, tx) =>
      readingThrough(
        reader,
        new Proxy(tx, {
          get: (target, key) =>
            key === "query"
              ? (statement: string, values?: unknown[]) =>
                  statement.includes("t.path")
                    ? Promise.reject(failure)
                    : target.query(statement, values)
              : Reflect.get(target, key),
        }),
        expenses.iri,
      ),
    );

    expect(read).toEqual({ ok: false, error: failure });
  });
});
