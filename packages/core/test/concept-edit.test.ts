import { describe, expect, it } from "vitest";

import { head } from "@better-answers/core/store/git";
import { passageLocatorOf, type ConceptIri } from "@better-answers/schema";

import {
  conceptToEdit,
  importBundle,
  saveConcept,
  writeConcept,
  type ConceptToEdit,
  type Frontmatter,
  type SaveConceptInput,
} from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { passageAt } from "../src/sources/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { bundleHistory, commitFacts, fileAtCommit } from "./bundle.ts";
import {
  auditEventRowsOf,
  connectedSourceHolding,
  overriddenBy,
  writeUpIncluding,
} from "./sourced-concept.ts";
import { documentLanded } from "./suite-documents.ts";
import { answered, readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const passages = (principal: UserPrincipal, tx: Tx) => (locator: string) =>
  passageAt(principal, tx, locator);

const saveDoors = (scenario: Scenario) => ({ ...doorsOf(scenario), passages });

let minted = 0;

const written = async (
  scenario: Scenario,
  frontmatter: Frontmatter = {},
  body = "Expenses are claimed within thirty days.",
) => {
  minted += 1;
  const title = `Expenses ${minted}`;
  const landed = await writeConcept(scenario.admin, doorsOf(scenario), {
    mergeKey: `policy:expenses-${minted}`,
    path: `knowledge/policy/expenses-${minted}.md`,
    kind: "Policy",
    title,
    frontmatter: { title, type: "Policy", ...frontmatter },
    body,
    message: `Record expenses ${minted}`,
    author: { name: "Ada Admin", email: "ada@acme.invalid" },
    expects: { head: await head(scenario.admin, scenario.git) },
    status: "stable",
    sensitivity: "Internal",
  });
  if (!landed.ok) throw new Error(`the write was refused: ${String(landed.error)}`);
  return landed.value;
};

const toEdit = async (scenario: Scenario, principal: UserPrincipal, iri: ConceptIri) =>
  answered(
    await readingAs(db().runtimePool, principal, (reader, tx) =>
      conceptToEdit(reader, tx, { iri }, passages(reader, tx)),
    ),
  );

type SaveOver = Extract<SaveConceptInput, { readonly iri: string }>;

const saveOf = (iri: ConceptIri, seed: ConceptToEdit): SaveOver => ({
  iri,
  parts: seed.parts,
  sources: seed.sources,
  base: seed.base,
  withheld: seed.withheld.count,
});

const saved = (scenario: Scenario, principal: UserPrincipal, input: SaveConceptInput) =>
  saveConcept(principal, saveDoors(scenario), input);

const editedBy = async (
  scenario: Scenario,
  principal: UserPrincipal,
  iri: ConceptIri,
  change: (seed: ConceptToEdit) => Partial<SaveOver> = () => ({}),
) => {
  const seed = await toEdit(scenario, principal, iri);
  const answer = await saved(scenario, principal, { ...saveOf(iri, seed), ...change(seed) });
  return { seed, answer };
};

const withBody =
  (body: string) =>
  (seed: ConceptToEdit): Partial<SaveOver> => ({ parts: { ...seed.parts, body } });

const historyOf = (scenario: Scenario) => bundleHistory(scenario.git, scenario.workspaceId);

const fileAtHead = async (scenario: Scenario, path: string) => {
  const facts = await commitFacts(scenario.git, scenario.workspaceId, "main");
  return { facts, file: await fileAtCommit(scenario.git, scenario.workspaceId, facts.sha, path) };
};

const pathOf = async (iri: ConceptIri): Promise<string> => {
  const found = await db().pool.query<{ path: string }>(
    "SELECT path FROM concept_index WHERE iri = $1",
    [iri],
  );
  return found.rows[0]?.path ?? "";
};

describe("a save seeded from the raw file", () => {
  it("keeps a withheld source's locator through a save", async () => {
    const scenario = await arrange();
    const restricted = await documentLanded(db().pool, scenario.workspaceId, {
      title: "Board minutes",
      text: "The board reviews pay in March.",
      sensitivity: "Restricted",
    });
    const minutes = { title: "Board minutes", resource: "minutes", locator: restricted.locator };
    const handbook = { title: "Handbook", resource: "handbook" };
    const concept = await written(scenario, { sources: [minutes, handbook] });
    await overriddenBy(db(), scenario, concept.iri, "Internal");
    const path = await pathOf(concept.iri);

    const { seed, answer } = await editedBy(scenario, scenario.editor, concept.iri, (opened) => ({
      parts: { ...opened.parts, title: "Expenses, retitled" },
    }));

    expect(seed.sources).toEqual([handbook]);
    expect(seed.withheld).toEqual({ count: 1, labels: ["Board minutes"] });
    expect(answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    const { file } = await fileAtHead(scenario, path);
    expect(file).toContain(`"locator": ${JSON.stringify(restricted.locator)}`);
    expect(file).toContain('"resource": "minutes"');
    expect(file).toContain('"title": "Expenses, retitled"');
  });

  it("refuses a save whose withheld count has moved", async () => {
    const scenario = await arrange();
    const restricted = await documentLanded(db().pool, scenario.workspaceId, {
      title: "Board minutes",
      text: "The board reviews pay in March.",
      sensitivity: "Restricted",
    });
    const concept = await written(scenario, {
      sources: [{ title: "Board minutes", resource: "minutes", locator: restricted.locator }],
    });
    await overriddenBy(db(), scenario, concept.iri, "Internal");
    const before = await historyOf(scenario);

    const { answer } = await editedBy(scenario, scenario.editor, concept.iri, (seed) => ({
      ...withBody("Claim within a fortnight.")(seed),
      withheld: 0,
    }));

    expect(answer).toEqual({ ok: false, error: "stale-precondition" });
    expect(await historyOf(scenario)).toEqual(before);
  });

  it("writes no commit and no audit for an unchanged save", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);
    const before = await historyOf(scenario);
    const events = await auditEventRowsOf(
      db().pool,
      scenario.workspaceId,
      "knowledge.concept.committed",
    );

    const { answer } = await editedBy(scenario, scenario.admin, concept.iri);

    expect(answer).toEqual({ ok: true, value: { outcome: "unchanged", iri: concept.iri } });
    expect(await historyOf(scenario)).toEqual(before);
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "knowledge.concept.committed"),
    ).toEqual(events);
  });

  it("a body whitespace-only change still commits", async () => {
    const scenario = await arrange();
    const concept = await written(scenario, {}, "Claim within thirty days.\n\nKeep receipts.");
    const before = await historyOf(scenario);

    const { answer } = await editedBy(
      scenario,
      scenario.admin,
      concept.iri,
      withBody("Claim within thirty days.\n\n\nKeep receipts."),
    );

    expect(answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    expect(await historyOf(scenario)).toHaveLength(before.length + 1);
  });

  it("commits a change to a source's title alone", async () => {
    const scenario = await arrange();
    const concept = await written(scenario, {
      sources: [{ title: "Handbook", resource: "handbook" }],
    });
    const before = await historyOf(scenario);

    const { answer } = await editedBy(scenario, scenario.admin, concept.iri, () => ({
      sources: [{ title: "The staff handbook", resource: "handbook" }],
    }));

    expect(answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    expect(await historyOf(scenario)).toHaveLength(before.length + 1);
  });

  it("writes no commit re-saving an imported file unchanged", async () => {
    const scenario = await arrange();
    const imported = await importBundle(
      scenario.admin,
      { ...doorsOf(scenario), log: { warn: () => undefined } },
      {
        tree: new Map([
          [
            "manifest.yaml",
            "id: 01J6DDDDDDDDDDDDDDDDDDDDDD\norigin: company\nref: Hand written\nowner: Acme\ncontent_version: 2026-10-22\n",
          ],
          [
            "policy/hand-written.md",
            "---\ntitle: Hand written\ntype: Policy\ntags: [finance, travel]\n---\n\nWritten by hand.\n",
          ],
        ]),
      },
    );
    if (!imported.ok) throw new Error(`the import was refused: ${JSON.stringify(imported.error)}`);
    const found = await db().pool.query<{ iri: ConceptIri }>(
      "SELECT iri FROM concept_index WHERE workspace_id = $1 AND path = 'knowledge/policy/hand-written.md'",
      [scenario.workspaceId],
    );
    const iri = found.rows[0]?.iri;
    if (iri === undefined) throw new Error("the import landed no concept");
    const before = await historyOf(scenario);

    const { answer } = await editedBy(scenario, scenario.admin, iri);

    expect(answer).toEqual({ ok: true, value: { outcome: "unchanged", iri } });
    expect(await historyOf(scenario)).toEqual(before);
  });

  it("derives evidence rows from the file's sources alone", async () => {
    const scenario = await arrange();
    const handbook = await connectedSourceHolding(db(), scenario.workspaceId);
    const concept = await written(scenario);
    const locator = passageLocatorOf(handbook.documentId, 0, 4);

    const { answer } = await editedBy(scenario, scenario.admin, concept.iri, () => ({
      sources: [
        { title: "Handbook", resource: "handbook", locator },
        {
          title: "Another policy",
          resource: concept.iri,
          locator: passageLocatorOf(handbook.documentId, 5, 9),
        },
      ],
    }));

    expect(answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    const cited = await db().pool.query(
      "SELECT source_document_id, locator FROM concept_evidence WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, concept.iri],
    );
    expect(cited.rows).toEqual([{ source_document_id: handbook.documentId, locator }]);
  });
});

describe("what a save refuses", () => {
  it("refuses a bare wire locator as a string source", async () => {
    const scenario = await arrange();
    const handbook = await connectedSourceHolding(db(), scenario.workspaceId);
    const concept = await written(scenario, { sources: ["Handbook"] });
    const before = await historyOf(scenario);

    const { answer: refused } = await editedBy(scenario, scenario.admin, concept.iri, () => ({
      sources: [passageLocatorOf(handbook.documentId, 0, 4)],
    }));

    expect(refused).toEqual({ ok: false, error: "source-label-refused" });
    expect(await historyOf(scenario)).toEqual(before);
  });

  it("refuses a passage locator in the body outside sources", async () => {
    const scenario = await arrange();
    const handbook = await connectedSourceHolding(db(), scenario.workspaceId);
    const concept = await written(scenario);
    const before = await historyOf(scenario);

    const { answer: refused } = await editedBy(scenario, scenario.admin, concept.iri, (seed) =>
      withBody(`${seed.parts.body} See ${passageLocatorOf(handbook.documentId, 0, 4)}.`)(seed),
    );

    expect(refused).toEqual({ ok: false, error: "body-locator-refused" });
    expect(await historyOf(scenario)).toEqual(before);
  });

  const usedTwice = async (scenario: Scenario) => {
    const concept = await written(scenario);
    await writeUpIncluding(db(), scenario.workspaceId, [concept.iri]);
    await written(scenario, {}, `See [the expenses policy](${concept.iri}).`);
    return concept;
  };

  it("counts write-up includes and inbound links as places", async () => {
    const scenario = await arrange();
    const concept = await usedTwice(scenario);

    const seed = await toEdit(scenario, scenario.admin, concept.iri);

    expect(seed.usedIn).toBe(2);
  });

  it("refuses a reused concept's save until confirmed", async () => {
    const scenario = await arrange();
    const concept = await usedTwice(scenario);
    const seed = await toEdit(scenario, scenario.admin, concept.iri);
    const edit = {
      ...saveOf(concept.iri, seed),
      parts: { ...seed.parts, body: "Expenses are claimed within a fortnight." },
    };
    const before = await historyOf(scenario);

    const refused = await saved(scenario, scenario.admin, edit);
    const afterRefusal = await historyOf(scenario);
    const confirmed = await saved(scenario, scenario.admin, { ...edit, reuse: "confirmed" });

    expect(refused).toEqual({ ok: false, error: "reuse-unconfirmed" });
    expect(afterRefusal).toEqual(before);
    expect(confirmed).toMatchObject({ ok: true, value: { outcome: "committed" } });
  });
});

describe("who a save commits for", () => {
  it("commits an owner's save with the owner as author", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);
    const { seed, answer } = await editedBy(
      scenario,
      scenario.editor,
      concept.iri,
      withBody("Claim within a fortnight."),
    );

    expect(seed.standing).toBe("commits");
    expect(answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    const editor = await db().pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM "user" WHERE id = $1',
      [scenario.editor.userId],
    );
    const { facts } = await fileAtHead(scenario, await pathOf(concept.iri));
    expect(facts.author).toBe(`${editor.rows[0]?.name} <${editor.rows[0]?.email}>`);
  });

  it("turns an outsider's save into an edit suggestion", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);
    const before = await historyOf(scenario);

    const { seed, answer } = await editedBy(
      scenario,
      scenario.unowned,
      concept.iri,
      withBody("Claim within a fortnight."),
    );

    expect(seed.standing).toBe("suggests");
    expect(answer).toMatchObject({ ok: true, value: { outcome: "suggested" } });
    expect(await historyOf(scenario)).toEqual(before);
    const waiting = await db().pool.query(
      `SELECT s.kind, s.status, r.base_content_hash FROM suggestion s
         JOIN concept_write_request r ON r.workspace_id = s.workspace_id AND r.suggestion_id = s.id
        WHERE s.workspace_id = $1`,
      [scenario.workspaceId],
    );
    expect(waiting.rows).toEqual([
      { kind: "edit", status: "waiting", base_content_hash: concept.contentHash },
    ]);
  });

  it("files no suggestion for an outsider's unchanged save", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);

    const { answer } = await editedBy(scenario, scenario.unowned, concept.iri);

    expect(answer).toEqual({ ok: true, value: { outcome: "unchanged", iri: concept.iri } });
    const filed = await db().pool.query("SELECT 1 FROM suggestion WHERE workspace_id = $1", [
      scenario.workspaceId,
    ]);
    expect(filed.rows).toEqual([]);
  });

  it("lands a new concept at its collection's path", async () => {
    const scenario = await arrange();

    const answer = await saved(scenario, scenario.editor, {
      collection: "policy",
      parts: {
        title: "Mileage Allowance (UK)",
        kind: "Policy",
        description: null,
        tags: [],
        body: "Mileage is paid at the HMRC rate.",
      },
      sources: [],
      base: null,
      withheld: 0,
    });

    expect(answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    const landed = await db().pool.query(
      "SELECT path, collection, kind, title FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(landed.rows).toEqual([
      {
        path: "knowledge/policy/mileage-allowance-uk.md",
        collection: "policy",
        kind: "Policy",
        title: "Mileage Allowance (UK)",
      },
    ]);
  });
});
