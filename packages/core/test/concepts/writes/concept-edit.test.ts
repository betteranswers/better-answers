import { inspect } from "node:util";

import { assert, describe, expect, it } from "vitest";

import { commit, head } from "@better-answers/core/store/git";
import { conceptIriOf, passageLocatorOf, ulid, type ConceptIri } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import {
  acceptSuggestions,
  conceptToEdit,
  importBundle,
  reconcile,
  RECONCILER,
  renderConceptFile,
  saveConcept,
  submitSuggestionSet,
  suggestionSetSummary,
  writeConcept,
  type ConceptToEdit,
  type Frontmatter,
  type SaveConceptInput,
} from "../../../src/concepts/index.ts";
import { actorIdOf, type UserPrincipal } from "../../../src/kernel/index.ts";
import { passageAt } from "../../../src/sources/index.ts";
import type { Tx } from "../../../src/store/postgres/index.ts";
import { bundleHistory, commitFacts, fileAtCommit } from "../../fixtures/bundle.ts";
import {
  auditEventRowsOf,
  connectedSourceHolding,
  overriddenBy,
  publishedOnceIndexed,
  writeUpIncluding,
} from "../../fixtures/sourced-concept.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "../../fixtures/workspace-with-bundle.ts";
import { documentLanded } from "../../support/suite-documents.ts";
import {
  answered,
  holdingTable,
  isBlockedOnTable,
  readingAs,
  statementsWaitingOnALock,
  until,
} from "../../support/suite-postgres.ts";

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
  withheld: seed.withheld.map((source) => source.at),
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

const savedAsOwnershipClears = async (scenario: Scenario, input: SaveConceptInput) => {
  const parked = await holdingTable(db().pool, "write_up_include", async () => {
    const saving = saved(scenario, scenario.editor, input);
    await until(() => isBlockedOnTable(db().pool, "write_up_include"));
    const clearing = db().pool.query(
      "DELETE FROM concept_owner WHERE workspace_id = $1 AND collection = 'policy'",
      [scenario.workspaceId],
    );
    await until(async () =>
      (await statementsWaitingOnALock(db().pool)).some((query) =>
        query.includes("DELETE FROM concept_owner"),
      ),
    );
    return { saving, clearing };
  });
  const [answer, cleared] = await Promise.all([parked.saving, parked.clearing]);
  return { answer, cleared };
};

const withBody =
  (body: string) =>
  (seed: ConceptToEdit): Partial<SaveOver> => ({ parts: { ...seed.parts, body } });

const historyOf = (scenario: Scenario) => bundleHistory(scenario.git, scenario.workspaceId);

const fileAtHead = async (scenario: Scenario, path: string) => {
  const facts = await commitFacts(scenario.git, scenario.workspaceId, "main");
  return { facts, file: await fileAtCommit(scenario.git, scenario.workspaceId, facts.sha, path) };
};

const minutesLanded = (scenario: Scenario) =>
  documentLanded(db().pool, scenario.workspaceId, {
    title: "Board minutes",
    text: "The board reviews pay in March.",
    sensitivity: "Restricted",
  });

const sensitivityMoved = async (connectedSourceId: string, sensitivity: string) => {
  await db().pool.query("UPDATE connected_source SET sensitivity = $2 WHERE id = $1", [
    connectedSourceId,
    sensitivity,
  ]);
  await db().pool.query(
    "UPDATE source_document SET sensitivity = $2 WHERE connected_source_id = $1",
    [connectedSourceId, sensitivity],
  );
};

const mergeKeyOf = async (iri: ConceptIri): Promise<string | undefined> => {
  const found = await db().pool.query<{ merge_key: string }>(
    "SELECT merge_key FROM concept_identity WHERE iri = $1",
    [iri],
  );
  return found.rows[0]?.merge_key;
};

const newPolicy = (title: string, sources: SaveConceptInput["sources"] = []): SaveConceptInput => ({
  collection: "policy",
  parts: { title, kind: "Policy", description: null, tags: [], body: `${title} is paid monthly.` },
  sources,
  base: null,
  withheld: [],
});

const committedIri = (answer: Awaited<ReturnType<typeof saved>>): ConceptIri => {
  if (!answer.ok || answer.value.outcome !== "committed") {
    throw new Error(`the save did not commit: ${JSON.stringify(answer)}`);
  }
  return answer.value.iri;
};

const pathOf = async (iri: ConceptIri): Promise<string> => {
  const found = await db().pool.query<{ path: string }>(
    "SELECT path FROM concept_index WHERE iri = $1",
    [iri],
  );
  return found.rows[0]?.path ?? "";
};

describe("a save that starts from the raw file", () => {
  it("keeps a withheld source's locator through a save", async () => {
    const scenario = await arrange();
    const restricted = await minutesLanded(scenario);
    const minutes = { title: "Board minutes", resource: "minutes", locator: restricted.locator };
    const handbook = { title: "Handbook", resource: "handbook" };
    const concept = await written(scenario, { sources: [minutes, handbook] });
    await overriddenBy(db(), scenario, concept.iri, "Internal");
    const path = await pathOf(concept.iri);

    const { seed, answer } = await editedBy(scenario, scenario.editor, concept.iri, (opened) => ({
      parts: { ...opened.parts, title: "Expenses, retitled" },
    }));

    expect(seed.sources).toEqual([handbook]);
    expect(seed.withheld).toEqual([{ at: 0, label: "Board minutes" }]);
    expect(answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    const { file } = await fileAtHead(scenario, path);
    expect(file).toContain(`"locator": ${JSON.stringify(restricted.locator)}`);
    expect(file).toContain('"resource": "minutes"');
    expect(file).toContain('"title": "Expenses, retitled"');
  });

  it("shows no outsider the document a malformed locator names", async () => {
    const scenario = await arrange();
    const restricted = await minutesLanded(scenario);
    const [documentId = ""] = restricted.locator.split("/");
    const malformed = {
      title: "Board minutes",
      resource: "minutes",
      locator: `${documentId}/chars:9-1`,
    };
    const concept = await written(scenario, { sources: [malformed] });
    await overriddenBy(db(), scenario, concept.iri, "Internal");

    for (const outsider of [scenario.editor, scenario.unowned]) {
      const seed = await toEdit(scenario, outsider, concept.iri);

      expect(inspect(seed, { depth: null }), "the editor's seed names the document").not.toContain(
        documentId,
      );
      expect(seed.withheld).toEqual([{ at: 0, label: "Board minutes" }]);
    }
  });

  it("refuses a save after the withheld sources' positions moved", async () => {
    const scenario = await arrange();
    const restricted = await minutesLanded(scenario);
    const concept = await written(scenario, {
      sources: [{ title: "Board minutes", resource: "minutes", locator: restricted.locator }],
    });
    await overriddenBy(db(), scenario, concept.iri, "Internal");
    const before = await historyOf(scenario);

    const { answer } = await editedBy(scenario, scenario.editor, concept.iri, (seed) => ({
      ...withBody("Claim within a fortnight.")(seed),
      withheld: [],
    }));

    expect(answer).toEqual({ ok: false, error: "stale-precondition" });
    expect(await historyOf(scenario)).toEqual(before);
  });

  it("refuses a save after two access changes that cancel out", async () => {
    const scenario = await arrange();
    const minutes = await minutesLanded(scenario);
    const handbook = await documentLanded(db().pool, scenario.workspaceId, {
      title: "Handbook",
      text: "Claims are made in writing.",
      sensitivity: "Internal",
    });
    const concept = await written(scenario, {
      sources: [
        { title: "Board minutes", resource: "minutes", locator: minutes.locator },
        { title: "Handbook", resource: "handbook", locator: handbook.locator },
      ],
    });
    await overriddenBy(db(), scenario, concept.iri, "Internal");
    const seed = await toEdit(scenario, scenario.editor, concept.iri);
    await sensitivityMoved(minutes.connectedSourceId, "Internal");
    await sensitivityMoved(handbook.connectedSourceId, "Restricted");
    const before = await historyOf(scenario);

    const answer = await saved(scenario, scenario.editor, {
      ...saveOf(concept.iri, seed),
      parts: { ...seed.parts, title: "Expenses, retitled" },
    });

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

  it("commits a change of whitespace only to the body", async () => {
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

  it("writes no commit when an imported file is re-saved unchanged", async () => {
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
    assert(imported.ok, `the import was refused: ${inspect(imported)}`);
    const found = await db().pool.query<{ iri: ConceptIri }>(
      "SELECT iri FROM concept_index WHERE workspace_id = $1 AND path = 'knowledge/policy/hand-written.md'",
      [scenario.workspaceId],
    );
    const iri = found.rows[0]?.iri;
    assert(iri !== undefined, "the import landed no concept");
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

describe("a save of a concept citing a deleted document", () => {
  const replayedCitingAGoneDocument = async (
    scenario: Scenario,
    handbookPublished: Date | null = null,
  ) => {
    const handbook = await documentLanded(db().pool, scenario.workspaceId, {
      title: "Handbook",
      text: "Allowances are paid monthly.",
      sensitivity: "Public",
      publishedAt: handbookPublished,
    });
    const gone = await connectedSourceHolding(db(), scenario.workspaceId);
    await db().pool.query("DELETE FROM source_document WHERE workspace_id = $1 AND id = $2", [
      scenario.workspaceId,
      gone.documentId,
    ]);
    minted += 1;
    const iri = conceptIriOf(ulid());
    const path = `knowledge/policy/allowances-${minted}.md`;
    const goneLocator = passageLocatorOf(gone.documentId, 0, 4);
    const pushed = await commit(scenario.admin, scenario.git, {
      path,
      content: renderConceptFile(
        {
          iri,
          title: `Allowances ${minted}`,
          type: "Policy",
          status: "stable",
          sources: [
            { title: "Board minutes", resource: "minutes", locator: goneLocator },
            { title: "Handbook", resource: "handbook", locator: handbook.locator },
          ],
        },
        "Allowances are paid monthly.",
      ),
      message: "Push the allowances policy from outside the platform",
      author: { name: "Ada Admin", email: "ada@acme.invalid" },
      trailers: { actor: actorIdOf(scenario.admin), audit: ulid() },
      expectedHead: await head(scenario.admin, scenario.git),
      parentRecorded: () => Promise.resolve(true),
      at: new Date(),
    });
    if (!pushed.ok) throw new Error(`the push was refused: ${String(pushed.error)}`);
    const replay = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });
    expect(replay).toMatchObject({ ok: true, value: { replayed: [pushed.value.sha] } });
    return { iri, path, handbook, goneLocator };
  };

  const sensitivityOf = async (iri: ConceptIri): Promise<string | undefined> => {
    const found = await db().pool.query<{ sensitivity: string }>(
      "SELECT sensitivity FROM concept_index WHERE iri = $1",
      [iri],
    );
    return found.rows[0]?.sensitivity;
  };

  const sensitivityOncePublished = async (
    scenario: Scenario,
    iri: ConceptIri,
    connectedSourceId: string,
  ) => {
    const published = await publishedOnceIndexed(db(), scenario.admin, connectedSourceId);
    expect(published.ok).toBe(true);
    return sensitivityOf(iri);
  };

  it("saves an edit that keeps the deleted source in place", async () => {
    const scenario = await arrange();
    const { iri, path, goneLocator } = await replayedCitingAGoneDocument(scenario, new Date());
    expect(await sensitivityOf(iri)).toBe("Restricted");

    const { seed, answer } = await editedBy(
      scenario,
      scenario.admin,
      iri,
      withBody("Allowances are paid on the last working day."),
    );

    expect(seed.withheld).toContainEqual({ at: 0, label: "Board minutes" });
    expect(answer).toEqual({
      ok: true,
      value: { outcome: "committed", iri, sha: matching.any(String) },
    });
    const { file } = await fileAtHead(scenario, path);
    expect(file).toContain(`"locator": ${JSON.stringify(goneLocator)}`);
    expect(file).toContain("Allowances are paid on the last working day.");
    expect(await sensitivityOf(iri)).toBe("Restricted");
  });

  it("keeps the saved concept Restricted through a later cascade", async () => {
    const scenario = await arrange();
    const { iri, handbook } = await replayedCitingAGoneDocument(scenario);
    const { answer } = await editedBy(scenario, scenario.admin, iri, withBody("Paid monthly."));
    expect(answer).toEqual({
      ok: true,
      value: { outcome: "committed", iri, sha: matching.any(String) },
    });

    expect(await sensitivityOncePublished(scenario, iri, handbook.connectedSourceId)).toBe(
      "Restricted",
    );
  });

  const acceptedEdit = async (scenario: Scenario, iri: ConceptIri, path: string, body: string) => {
    const found = await db().pool.query<{
      merge_key: string;
      kind: string;
      title: string;
      frontmatter: Frontmatter;
      content_hash: string;
    }>(
      `SELECT i.merge_key, c.kind, c.title, c.frontmatter, c.content_hash
         FROM concept_index c
         JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
        WHERE c.iri = $1`,
      [iri],
    );
    const held = found.rows[0];
    assert(held !== undefined, "the replayed concept is not indexed");
    const { iri: _iri, ...frontmatter } = held.frontmatter;
    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: scenario.postgres },
      {
        kind: "edit",
        requests: [
          {
            mergeKey: held.merge_key,
            path,
            conceptKind: held.kind,
            title: held.title,
            frontmatter,
            body,
            baseContentHash: held.content_hash,
          },
        ],
      },
    );
    assert(set.ok, `the suggestion was refused: ${inspect(set)}`);
    const summary = answered(
      await readingAs(db().runtimePool, scenario.admin, (principal, tx) =>
        suggestionSetSummary(principal, tx, set.value.setId),
      ),
    );
    return acceptSuggestions(scenario.admin, doorsOf(scenario), {
      decisions: summary.map((item) => ({
        suggestionId: item.suggestionId,
        expectedTarget: item.target,
      })),
    });
  };

  it("keeps an accepted edit Restricted through a later cascade", async () => {
    const scenario = await arrange();
    const { iri, path, handbook } = await replayedCitingAGoneDocument(scenario);

    const accepted = await acceptedEdit(scenario, iri, path, "Allowances are paid on the 25th.");

    expect(accepted).toMatchObject({ ok: true, value: [{ outcome: { ok: true } }] });
    expect(await sensitivityOncePublished(scenario, iri, handbook.connectedSourceId)).toBe(
      "Restricted",
    );
  });
});

describe("what a save refuses", () => {
  it("refuses a save that newly cites an uncatalogued document", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);
    const before = await historyOf(scenario);

    const { answer: refused } = await editedBy(scenario, scenario.admin, concept.iri, () => ({
      sources: [{ title: "Minutes", resource: "minutes", locator: passageLocatorOf(ulid(), 0, 4) }],
    }));

    expect(refused).toEqual({ ok: false, error: "no-such-document" });
    expect(await historyOf(scenario)).toEqual(before);
  });

  it("refuses a bare passage locator as a string source", async () => {
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

  it("refuses an empty body from a committer and an outsider", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);
    const before = await historyOf(scenario);

    const { answer: committer } = await editedBy(
      scenario,
      scenario.admin,
      concept.iri,
      withBody(" \n"),
    );
    const { answer: outsider } = await editedBy(
      scenario,
      scenario.unowned,
      concept.iri,
      withBody(""),
    );

    expect(committer).toEqual({ ok: false, error: "malformed" });
    expect(outsider).toEqual({ ok: false, error: "malformed" });
    expect(await historyOf(scenario)).toEqual(before);
    const filed = await db().pool.query("SELECT 1 FROM suggestion WHERE workspace_id = $1", [
      scenario.workspaceId,
    ]);
    expect(filed.rows).toEqual([]);
  });

  const usedTwice = async (scenario: Scenario) => {
    const concept = await written(scenario);
    await writeUpIncluding(db(), scenario.workspaceId, [concept.iri]);
    await written(scenario, {}, `See [the expenses policy](${concept.iri}).`);
    return concept;
  };

  it("counts write-up includes and inbound links where it is used", async () => {
    const scenario = await arrange();
    const concept = await usedTwice(scenario);
    await writeUpIncluding(db(), scenario.workspaceId, [concept.iri]);

    const seed = await toEdit(scenario, scenario.admin, concept.iri);

    expect(seed.usedIn).toEqual({ writeUps: 2, linkingConcepts: 1 });
  });

  it("refuses saving a reused concept until the editor confirms", async () => {
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

describe("the author a save commits as", () => {
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

  it("files an outsider's retitle under the concept's current key", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);

    const { answer } = await editedBy(scenario, scenario.unowned, concept.iri, (seed) => ({
      parts: { ...seed.parts, title: "Expenses, retitled" },
    }));

    expect(answer).toMatchObject({ ok: true, value: { outcome: "suggested" } });
    const filed = await db().pool.query(
      "SELECT merge_key, title FROM concept_write_request WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(filed.rows).toEqual([
      { merge_key: `policy:expenses-${minted}`, title: "Expenses, retitled" },
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
      withheld: [],
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
  it("publishes a new concept that its author can reopen", async () => {
    const scenario = await arrange();

    const iri = committedIri(await saved(scenario, scenario.editor, newPolicy("Petty Cash")));

    const row = await db().pool.query(
      "SELECT status, sensitivity, published_at IS NOT NULL AS published FROM concept_index WHERE iri = $1",
      [iri],
    );
    expect(row.rows).toEqual([{ status: "stable", sensitivity: "Internal", published: true }]);
    const seed = await toEdit(scenario, scenario.editor, iri);
    expect(seed).toMatchObject({ parts: { title: "Petty Cash" }, standing: "commits" });
    await expect(toEdit(scenario, scenario.admin, iri)).resolves.toMatchObject({
      base: seed.base,
    });
  });

  it("lands a new concept no wider than its cited sources", async () => {
    const scenario = await arrange();
    const minutes = await minutesLanded(scenario);
    const cited = [{ title: "Board minutes", resource: "minutes", locator: minutes.locator }];

    const iri = committedIri(await saved(scenario, scenario.admin, newPolicy("Pay Review", cited)));

    const row = await db().pool.query(
      "SELECT status, sensitivity FROM concept_index WHERE iri = $1",
      [iri],
    );
    expect(row.rows).toEqual([{ status: "stable", sensitivity: "Restricted" }]);
  });

  it("falls back to a suggestion when ownership is cleared mid-save", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);
    const seed = await toEdit(scenario, scenario.editor, concept.iri);
    const before = await historyOf(scenario);
    const input = { ...saveOf(concept.iri, seed), ...withBody("Claim within a fortnight.")(seed) };

    const { answer, cleared } = await savedAsOwnershipClears(scenario, input);

    expect(seed.standing).toBe("commits");
    expect(cleared.rowCount).toBe(1);
    expect(answer).toMatchObject({ ok: true, value: { outcome: "suggested" } });
    expect(await historyOf(scenario)).toEqual(before);
  });
});

describe("a retitle or a rekind", () => {
  const mileage = async (scenario: Scenario) =>
    committedIri(await saved(scenario, scenario.admin, newPolicy("Mileage Allowance")));

  const retitledToRates = async (scenario: Scenario) => {
    const iri = await mileage(scenario);
    await editedBy(scenario, scenario.admin, iri, (seed) => ({
      parts: { ...seed.parts, title: "Mileage Rates" },
    }));
    return iri;
  };

  it("re-keys a concept after a retitle and a rekind", async () => {
    const scenario = await arrange();
    const iri = await mileage(scenario);

    const retitled = await editedBy(scenario, scenario.admin, iri, (seed) => ({
      parts: { ...seed.parts, title: "Mileage Rates" },
    }));
    const keyAfterRetitle = await mergeKeyOf(iri);
    const rekinded = await editedBy(scenario, scenario.admin, iri, (seed) => ({
      parts: { ...seed.parts, kind: "Guideline" },
    }));

    expect(retitled.answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    expect(keyAfterRetitle).toBe("Policy:mileage rates");
    expect(rekinded.answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    expect(await mergeKeyOf(iri)).toBe("Guideline:mileage rates");
  });

  it("frees the old title and refuses a taken one", async () => {
    const scenario = await arrange();
    await retitledToRates(scenario);

    const fuel = committedIri(await saved(scenario, scenario.admin, newPolicy("Fuel")));

    const vacated = await editedBy(scenario, scenario.admin, fuel, (seed) => ({
      parts: { ...seed.parts, title: "Mileage Allowance" },
    }));
    const ontoAnother = await editedBy(scenario, scenario.admin, fuel, (seed) => ({
      parts: { ...seed.parts, title: "Mileage rates" },
    }));
    const taken = await saved(scenario, scenario.admin, newPolicy("Mileage Rates"));

    expect(vacated.answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    expect(ontoAnother.answer).toEqual({ ok: false, error: "merge-key-taken" });
    expect(taken).toEqual({ ok: false, error: "merge-key-taken" });
  });

  it("lands a new concept under a title a retitle vacated", async () => {
    const scenario = await arrange();
    const iri = await retitledToRates(scenario);

    const again = await saved(scenario, scenario.admin, newPolicy("Mileage Allowance"));

    expect(again).toMatchObject({ ok: true, value: { outcome: "committed" } });
    expect(await pathOf(committedIri(again))).not.toBe(await pathOf(iri));
  });

  it("keeps a non-derived key while title and kind are unchanged", async () => {
    const scenario = await arrange();
    const concept = await written(scenario);

    const { answer } = await editedBy(scenario, scenario.admin, concept.iri, withBody("Changed."));

    expect(answer).toMatchObject({ ok: true, value: { outcome: "committed" } });
    expect(await mergeKeyOf(concept.iri)).toBe(`policy:expenses-${minted}`);
  });
});

describe("what an outsider's body may mention", () => {
  const citingMinutes = async (scenario: Scenario, body: string) => {
    const minutes = await minutesLanded(scenario);
    const concept = await written(
      scenario,
      { sources: [{ title: "Board minutes", resource: "minutes", locator: minutes.locator }] },
      body.replace("MINUTES", minutes.locator),
    );
    await overriddenBy(db(), scenario, concept.iri, "Internal");
    return { concept, locator: minutes.locator };
  };

  it("refuses an outsider adding a withheld locator to the body", async () => {
    const scenario = await arrange();
    const { concept, locator } = await citingMinutes(scenario, "Claims close in March.");

    const { answer } = await editedBy(scenario, scenario.unowned, concept.iri, (seed) =>
      withBody(`${seed.parts.body} See ${locator}.`)(seed),
    );

    expect(answer).toEqual({ ok: false, error: "body-locator-refused" });
  });

  it("refuses a new withheld body locator when ownership clears", async () => {
    const scenario = await arrange();
    const { concept, locator } = await citingMinutes(scenario, "Claims close in March.");
    const seed = await toEdit(scenario, scenario.editor, concept.iri);
    const input = {
      ...saveOf(concept.iri, seed),
      ...withBody(`${seed.parts.body} See ${locator}.`)(seed),
    };

    const { answer } = await savedAsOwnershipClears(scenario, input);

    expect(seed.standing).toBe("commits");
    expect(seed.withheld).toEqual([{ at: 0, label: "Board minutes" }]);
    expect(answer).toEqual({ ok: false, error: "body-locator-refused" });
  });

  it("lets an outsider keep a withheld locator already cited", async () => {
    const scenario = await arrange();
    const { concept } = await citingMinutes(scenario, "Claims close in March, see MINUTES.");

    const { answer } = await editedBy(scenario, scenario.unowned, concept.iri, (seed) =>
      withBody(`${seed.parts.body} Keep receipts.`)(seed),
    );

    expect(answer).toMatchObject({ ok: true, value: { outcome: "suggested" } });
  });
});
