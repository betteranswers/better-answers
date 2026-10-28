import { inspect } from "node:util";

import pg from "pg";
import { assert, describe, expect, it } from "vitest";

import { conceptIriOf, ulid, type ConceptIri } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { matching } from "@better-answers/schema/testing/matching";

import { open } from "../../../src/answering/index.ts";
import {
  acceptSuggestions,
  conceptByIri,
  contentHashOf,
  declineSuggestion,
  foldKind,
  mergeKeyOf,
  parseConceptFile,
  submitSuggestionSet,
  suggestionSetSummary,
  writeConcept,
  type AcceptanceDecision,
  type AcceptanceOutcome,
  type ConceptWritten,
  type SuggestionKind,
  type SuggestionRequest,
  type SuggestionSetSubmitted,
  type WriteConceptInput,
} from "../../../src/concepts/index.ts";
import type { Result, UserPrincipal } from "../../../src/kernel/index.ts";
import { openPostgres } from "../../../src/store/postgres/index.ts";
import { bundleHistory, commitFacts, fileAtCommit } from "../../fixtures/bundle.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "../../fixtures/workspace-with-bundle.ts";
import { documentLanded } from "../../support/suite-documents.ts";
import {
  abortTheTransaction,
  holdingTable,
  isBlockedOnTable,
  readingAs,
  until,
} from "../../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

let proposed = 0;

const SUGGESTED_BODY = "Expenses are claimed within sixty days.";

const requestFor = (overrides: Partial<SuggestionRequest> = {}): SuggestionRequest => {
  proposed += 1;
  return {
    mergeKey: `policy:expenses-${proposed}`,
    path: `knowledge/policy/expenses-${proposed}.md`,
    conceptKind: "Policy",
    title: "Expenses",
    frontmatter: { title: "Expenses", type: "Policy" },
    body: SUGGESTED_BODY,
    ...overrides,
  };
};

const submitted = async (
  scenario: Scenario,
  principal: UserPrincipal,
  kind: SuggestionKind,
  requests: readonly SuggestionRequest[],
) => {
  const set = await submitSuggestionSet(
    principal,
    { postgres: scenario.postgres },
    { kind, requests },
  );
  if (!set.ok) throw new Error(`the set was not submitted: ${String(set.error)}`);
  return set.value;
};

const suggestionIdOf = (set: { readonly suggestionIds: readonly string[] }, at = 0): string => {
  const suggestionId = set.suggestionIds[at];
  if (suggestionId === undefined) throw new Error(`the set holds no suggestion at ${at}`);
  return suggestionId;
};

const refusalsToAcceptingAsAdmin = async (
  scenario: Scenario,
  set: { readonly suggestionIds: readonly string[] },
) => {
  const accepted = await acceptSuggestions(scenario.admin, doorsOf(scenario), {
    decisions: [{ suggestionId: suggestionIdOf(set), expectedTarget: null }],
  });
  assert(accepted.ok, inspect(accepted));
  return accepted.value.map(refusalOf);
};

const summaryOf = async (scenario: Scenario, setId: string) => {
  const read = await readingAs(db().runtimePool, scenario.admin, (principal, tx) =>
    suggestionSetSummary(principal, tx, setId),
  );
  if (!read.ok) throw new Error(`the set did not render: ${String(read.error)}`);
  return read.value;
};

const acceptAll = async (
  scenario: Scenario,
  setId: string,
  principal: UserPrincipal = scenario.admin,
): Promise<readonly AcceptanceOutcome[]> => {
  const summary = await summaryOf(scenario, setId);
  const accepted = await acceptSuggestions(principal, doorsOf(scenario), {
    decisions: summary.map((item) => ({
      suggestionId: item.suggestionId,
      expectedTarget: item.target,
    })),
  });
  if (!accepted.ok) throw new Error(`the acceptance was refused: ${String(accepted.error)}`);
  return accepted.value;
};

const refusalOf = (outcome: AcceptanceOutcome): unknown =>
  outcome.outcome.ok ? undefined : outcome.outcome.error;

const acceptedOf = (outcome: AcceptanceOutcome | undefined): ConceptWritten | undefined =>
  outcome?.outcome.ok === true ? outcome.outcome.value : undefined;

const acceptedOne = async (
  scenario: Scenario,
  setId: string,
  principal: UserPrincipal = scenario.admin,
): Promise<ConceptWritten> => {
  const [outcome] = await acceptAll(scenario, setId, principal);
  if (outcome === undefined) throw new Error("the acceptance returned no outcome");
  const accepted = acceptedOf(outcome);
  if (accepted === undefined) {
    throw new Error(`the acceptance was refused: ${String(refusalOf(outcome))}`);
  }
  return accepted;
};

const countOf = async (
  table: "concept_index" | "map_node",
  workspaceId: string,
): Promise<string | undefined> => {
  const counted = await db().pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE workspace_id = $1`,
    [workspaceId],
  );
  return counted.rows[0]?.count;
};

const suggestionRow = async (suggestionId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT status, decider, reason, target_iri FROM suggestion WHERE id = $1",
    [suggestionId],
  );
  return found.rows[0];
};

const personOf = async (userId: string): Promise<{ name: string; email: string }> => {
  const found = await db().pool.query<{ name: string; email: string }>(
    'SELECT name, email FROM "user" WHERE id = $1',
    [userId],
  );
  const [person] = found.rows;
  if (person === undefined) throw new Error(`no user ${userId}`);
  return person;
};

const auditEventsFor = async (workspaceId: string, action: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT action, subject_id, subject_kind, batch_id, detail FROM audit_event WHERE workspace_id = $1 AND action = $2 ORDER BY id",
    [workspaceId, action],
  );
  return found.rows;
};

const editorWrote = async (scenario: Scenario, overrides: Partial<WriteConceptInput> = {}) => {
  proposed += 1;
  const input: WriteConceptInput = {
    mergeKey: `policy:expenses-${proposed}`,
    path: `knowledge/policy/expenses-${proposed}.md`,
    kind: "Policy",
    title: "Expenses",
    frontmatter: { title: "Expenses", type: "Policy" },
    body: "Expenses are claimed within thirty days.",
    message: "Record the expenses policy",
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: null },
    status: "stable",
    sensitivity: "Internal",
    ...overrides,
  };
  const written = await writeConcept(scenario.editor, doorsOf(scenario), input);
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return { input, written: written.value };
};

const proposedAgainst = async (
  scenario: Scenario,
  kind: SuggestionKind,
  wrote: Partial<WriteConceptInput> = {},
  proposes: Partial<SuggestionRequest> = {},
) => {
  const { input, written } = await editorWrote(scenario, wrote);
  const set = await submitted(scenario, scenario.editor, kind, [
    requestFor({
      mergeKey: input.mergeKey,
      path: input.path,
      baseContentHash: written.contentHash,
      ...proposes,
    }),
  ]);
  return { input, written, set };
};

const rewrittenAgainst = (
  scenario: Scenario,
  input: WriteConceptInput,
  written: ConceptWritten,
  overrides: Partial<WriteConceptInput>,
) =>
  writeConcept(scenario.editor, doorsOf(scenario), {
    ...input,
    iri: written.iri,
    expects: { head: written.sha },
    ...overrides,
  });

const seededSuggestion = async (
  scenario: Scenario,
  request: SuggestionRequest,
  named: { readonly kind: SuggestionKind; readonly proposer: string },
) => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const raised = await seed.suggestion({ workspaceId: scenario.workspaceId, ...named });
    await seed.conceptWriteRequest({
      workspaceId: scenario.workspaceId,
      suggestionId: raised.id,
      mergeKey: request.mergeKey,
      path: request.path,
      conceptKind: request.conceptKind,
      title: request.title,
      frontmatter: request.frontmatter,
      body: request.body,
      baseContentHash: request.baseContentHash ?? null,
    });
    return { setId: raised.setId, suggestionIds: [raised.id] };
  } finally {
    client.release();
  }
};

const platformCitationFix = (scenario: Scenario, request: SuggestionRequest) =>
  seededSuggestion(scenario, request, {
    kind: "citation-fix",
    proposer: "process:better-answers-citation-fix",
  });

const verifiedBy = async (
  scenario: Scenario,
  principal: UserPrincipal,
  written: { readonly iri: string; readonly contentHash: string },
): Promise<void> => {
  const client = await db().pool.connect();
  try {
    await testData(client).conceptVerification({
      workspaceId: scenario.workspaceId,
      iri: written.iri,
      actor: `human:${principal.userId}`,
      contentHash: written.contentHash,
    });
  } finally {
    client.release();
  }
};

const now = new Date("2026-09-08T12:00:00.000Z");

const trustOf = async (scenario: Scenario, iri: ConceptIri) => {
  const read = await readingAs(db().runtimePool, scenario.viewer, (principal, tx) =>
    open(principal, tx, { iri }, now),
  );
  return read.ok && read.value.found ? read.value.concept?.trust : undefined;
};

describe("a suggestion set", () => {
  it("waits with no target, leaving identity to the acceptance", async () => {
    const scenario = await arrange();

    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
    const row = await suggestionRow(suggestionIdOf(set));
    expect(row).toMatchObject({ status: "waiting", target_iri: null, decider: null });
  });

  it("re-renders its summary against concept_identity every time it is opened", async () => {
    const scenario = await arrange();
    const request = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [request]);

    const before = await summaryOf(scenario, set.setId);
    expect(before.map((item) => item.target)).toEqual([null]);

    const { written } = await editorWrote(scenario, {
      mergeKey: request.mergeKey,
      path: request.path,
    });

    const after = await summaryOf(scenario, set.setId);
    expect(after.map((item) => item.target)).toEqual([written.iri]);

    expect(after.map((item) => item.baseMoved)).toEqual([false]);
  });

  it("renders each item's kind, status and decider from its rows", async () => {
    const scenario = await arrange();
    const request = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [request]);
    const suggestionId = suggestionIdOf(set);
    const item = {
      suggestionId,
      kind: "edit",
      mergeKey: request.mergeKey,
      title: request.title,
      path: request.path,
      proposer: `human:${scenario.editor.userId}`,
      target: null,
      baseMoved: false,
    };

    expect(await summaryOf(scenario, set.setId)).toEqual([
      { ...item, status: "waiting", decider: null, reason: null },
    ]);

    const declined = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId,
      reason: "not the company's word on this",
    });

    expect(declined.ok).toBe(true);
    expect(await summaryOf(scenario, set.setId)).toEqual([
      {
        ...item,
        status: "declined",
        decider: `human:${scenario.admin.userId}`,
        reason: "not the company's word on this",
      },
    ]);
  });

  it("shows a member an unminted set as empty, not refused", async () => {
    const scenario = await arrange();

    const read = await readingAs(db().runtimePool, scenario.editor, (principal, tx) =>
      suggestionSetSummary(principal, tx, ulid()),
    );

    expect(read).toEqual({ ok: true, value: [] });
  });

  it("hands a caller the store's failure, not an empty set", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    let read: Result<unknown, unknown> | undefined;

    await expect(
      readingAs(db().runtimePool, scenario.editor, async (principal, tx) => {
        await abortTheTransaction(tx);
        read = await suggestionSetSummary(principal, tx, set.setId);
      }),
    ).rejects.toThrow(/did not commit/);

    expect(read).toEqual({ ok: false, error: matching.any(Error) });
  });

  it("is invisible to another workspace, whoever asks for it", async () => {
    const here = await arrange();
    const there = await arrange();
    const set = await submitted(there, there.editor, "edit", [requestFor()]);

    const reached = await readingAs(db().runtimePool, here.admin, (principal, tx) =>
      suggestionSetSummary(principal, tx, set.setId),
    );

    expect(reached).toEqual({ ok: true, value: [] });
  });
});

describe("accepting a suggestion", () => {
  it("mints the concept, lands rows and commit, and decides together", async () => {
    const scenario = await arrange();
    const request = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [request]);

    const accepted = await acceptedOne(scenario, set.setId);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, accepted.sha);
    expect(facts.trailers).toEqual({
      Actor: `human:${scenario.admin.userId}`,
      Audit: accepted.auditEventId,
      Suggestion: set.suggestionIds[0],
    });

    const row = await suggestionRow(suggestionIdOf(set));
    expect(row).toMatchObject({
      status: "accepted",
      target_iri: accepted.iri,
      decider: `human:${scenario.admin.userId}`,
      reason: null,
    });
    expect(await auditEventsFor(scenario.workspaceId, "knowledge.suggestion.accepted")).toEqual([
      {
        action: "knowledge.suggestion.accepted",
        subject_id: set.suggestionIds[0],
        subject_kind: "suggestion",
        batch_id: null,
        detail: {
          iri: accepted.iri,
          commitSha: accepted.sha,
          contentHash: accepted.contentHash,
          setId: set.setId,
        },
      },
    ]);
    const concept = await db().pool.query<{ iri: string; body: string }>(
      "SELECT iri, body FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(concept.rows).toEqual([{ iri: accepted.iri, body: request.body }]);
  });

  it("lands the map delta in the acceptance's own transaction", async () => {
    const scenario = await arrange();

    const { input: cited, written } = await editorWrote(scenario);
    const filename = cited.path.split("/").at(-1);
    assert(filename !== undefined, "the cited path names a file");
    const set = await submitted(scenario, scenario.editor, "edit", [
      requestFor({ body: `See [the policy](./${filename}) for the rule.` }),
    ]);

    const accepted = await acceptedOne(scenario, set.setId);

    const nodes = await db().pool.query<{ uid: string; gen: number }>(
      "SELECT uid, gen FROM map_node WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(nodes.rows.map((row) => row.uid).toSorted()).toEqual(
      [written.iri, accepted.iri].toSorted(),
    );
    expect(nodes.rows.map((row) => row.gen)).toEqual([1, 1]);
    const edges = await db().pool.query(
      "SELECT from_uid, to_uid FROM map_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([{ from_uid: accepted.iri, to_uid: written.iri }]);
  });

  it("commits an *edit* as the proposer, with the bot committing", async () => {
    const scenario = await arrange();
    const person = await personOf(scenario.editor.userId);
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    const { sha } = await acceptedOne(scenario, set.setId);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);
    expect(facts.author).toBe(`${person.name} <${person.email}>`);
    expect(facts.committer).toContain("Better Answers");
  });

  it("commits an accepted Viewer edit with the Viewer as author", async () => {
    const scenario = await arrange();
    const person = await personOf(scenario.viewer.userId);
    const set = await submitted(scenario, scenario.viewer, "edit", [requestFor()]);

    const { sha } = await acceptedOne(scenario, set.setId, scenario.editor);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);
    expect({ author: facts.author, actor: facts.trailers["Actor"] }).toEqual({
      author: `${person.name} <${person.email}>`,
      actor: `human:${scenario.editor.userId}`,
    });
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({
      status: "accepted",
      decider: `human:${scenario.editor.userId}`,
    });
  });

  it("refuses acceptance by an Editor who does not own it", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.viewer, "edit", [requestFor()]);

    const outcomes = await acceptAll(scenario, set.setId, scenario.unowned);

    expect(outcomes.map(refusalOf)).toEqual(["owner-forbids"]);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({
      status: "waiting",
      decider: null,
    });
  });

  it("decides each batched decision by its own target's owner", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.viewer, "edit", [
      requestFor(),
      requestFor({ path: `knowledge/unowned/expenses-${proposed}.md` }),
    ]);

    const outcomes = await acceptAll(scenario, set.setId, scenario.editor);

    expect(outcomes.map(refusalOf)).toEqual([undefined, "owner-forbids"]);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });

  it("leaves a citation fix to an Admin, not the owner", async () => {
    const scenario = await arrange();
    const { input, written } = await editorWrote(scenario);
    const set = await platformCitationFix(
      scenario,
      requestFor({
        mergeKey: input.mergeKey,
        path: input.path,
        body: `${input.body} Receipts are kept for six years.`,
        baseContentHash: written.contentHash,
      }),
    );

    const byTheOwner = await acceptAll(scenario, set.setId, scenario.editor);
    const byAnAdmin = await acceptAll(scenario, set.setId, scenario.admin);

    expect(byTheOwner.map(refusalOf)).toEqual(["role-forbids"]);
    expect(byAnAdmin.map(refusalOf)).toEqual([undefined]);
  });

  it("commits a run's suggested concept, authored by the accepting Admin", async () => {
    const scenario = await arrange();
    const admin = await personOf(scenario.admin.userId);

    const set = await seededSuggestion(scenario, requestFor(), {
      kind: "suggested-concept",
      proposer: "better-answers-extraction/1.2",
    });

    const { sha } = await acceptedOne(scenario, set.setId);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);
    expect(facts.author).toContain(admin.name);
  });

  it("never names another workspace's person as author, whatever is claimed", async () => {
    const here = await arrange();
    const elsewhere = await arrange();
    const stranger = await personOf(elsewhere.editor.userId);
    const person = await personOf(here.admin.userId);

    const spoofed = await seededSuggestion(here, requestFor(), {
      kind: "edit",
      proposer: `human:${elsewhere.editor.userId}`,
    });

    const { sha } = await acceptedOne(here, spoofed.setId);

    const facts = await commitFacts(here.git, here.workspaceId, sha);
    expect(facts.author).toBe(`${person.name} <${person.email}>`);

    expect(facts.author).not.toContain(stranger.email);
  });

  it("commits each item in bulk under one shared batch id", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [
      requestFor(),
      requestFor(),
      requestFor(),
    ]);

    const outcomes = await acceptAll(scenario, set.setId);

    expect(outcomes.map(refusalOf)).toEqual([undefined, undefined, undefined]);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(3);
    const rows = await auditEventsFor(scenario.workspaceId, "knowledge.suggestion.accepted");
    expect(rows).toHaveLength(3);
    const batches = new Set(rows.map((row) => row["batch_id"]));
    expect(batches.size).toBe(1);
    expect([...batches][0]).not.toBeNull();
  });

  it("re-writes the concept its merge key resolves to, minting none", async () => {
    const scenario = await arrange();
    const { written, set } = await proposedAgainst(scenario, "edit");

    const [outcome] = await acceptAll(scenario, set.setId);

    expect(acceptedOf(outcome)?.iri).toBe(written.iri);
    const concepts = await db().pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(concepts.rows).toEqual([{ count: "1" }]);
  });

  it("refuses a Viewer and a non-owning Editor, leaving it waiting", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = suggestionIdOf(set);

    for (const principal of [scenario.viewer, scenario.unowned]) {
      const refused = await acceptSuggestions(principal, doorsOf(scenario), {
        decisions: [{ suggestionId, expectedTarget: null }],
      });
      expect(refused).toEqual({
        ok: true,
        value: [{ suggestionId, outcome: { ok: false, error: "owner-forbids" } }],
      });
    }

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({ status: "waiting" });
  });

  it("answers another workspace's suggestion as one nobody minted", async () => {
    const here = await arrange();
    const there = await arrange();
    const theirs = await submitted(there, there.editor, "edit", [requestFor()]);

    const reached = await acceptSuggestions(here.admin, doorsOf(here), {
      decisions: [
        { suggestionId: suggestionIdOf(theirs), expectedTarget: null },
        { suggestionId: ulid(), expectedTarget: null },
      ],
    });

    assert(reached.ok, inspect(reached));
    expect(reached.value.map(refusalOf)).toEqual(["no-such-suggestion", "no-such-suggestion"]);
    expect(await bundleHistory(here.git, here.workspaceId)).toEqual([]);
  });
});

describe("an acceptance of a suggestion that changes nothing", () => {
  it("still decides an acceptance whose payload equals the file", async () => {
    const scenario = await arrange();
    const { input, written } = await editorWrote(scenario, {
      frontmatter: { iri: "", type: "Policy", title: "Expenses", status: "stable" },
    });
    const stored = parseConceptFile(
      await fileAtCommit(scenario.git, scenario.workspaceId, written.sha, input.path),
    );
    assert(stored.ok, `the stored file does not parse: ${inspect(stored)}`);
    const set = await submitted(scenario, scenario.viewer, "edit", [
      {
        mergeKey: input.mergeKey,
        path: input.path,
        conceptKind: input.kind,
        title: input.title,
        frontmatter: stored.value.frontmatter,
        body: stored.value.body,
        baseContentHash: written.contentHash,
      },
    ]);

    const [outcome] = await acceptAll(scenario, set.setId, scenario.editor);

    expect(outcome?.outcome).toMatchObject({ ok: true });
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({ status: "accepted" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(2);
  });
});

describe("an acceptance whose ground moved", () => {
  it("is returned to the proposer when its resolution has moved", async () => {
    const scenario = await arrange();
    const request = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [request]);

    const opened = await summaryOf(scenario, set.setId);
    expect(opened.map((item) => item.target)).toEqual([null]);

    await editorWrote(scenario, { mergeKey: request.mergeKey, path: request.path });

    expect(await refusalsToAcceptingAsAdmin(scenario, set)).toEqual(["resolution-moved"]);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    const row = await suggestionRow(suggestionIdOf(set));
    expect(row).toMatchObject({
      status: "returned",
      decider: `human:${scenario.admin.userId}`,
      target_iri: null,
    });
    expect(String(row?.["reason"])).toContain("moved");
    expect(
      await auditEventsFor(scenario.workspaceId, "knowledge.suggestion.returned"),
    ).toHaveLength(1);
  });

  it("is refused and returned when the payload's base content moved", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    const moved = await rewrittenAgainst(scenario, input, written, {
      body: "Expenses are claimed within ninety days.",
    });
    expect(moved.ok).toBe(true);
    const opened = await summaryOf(scenario, set.setId);
    expect(opened.map((item) => item.baseMoved)).toEqual([true]);

    const accepted = await acceptAll(scenario, set.setId);

    expect(accepted.map(refusalOf)).toEqual(["stale-precondition"]);

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(2);
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({ status: "returned" });
  });

  it("refuses a second decision on an already decided suggestion", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    await acceptAll(scenario, set.setId);

    const again = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId: suggestionIdOf(set),
      reason: "on reflection, no",
    });

    expect(again).toEqual({ ok: false, error: "already-decided" });
  });
});

describe("declining a suggestion", () => {
  it("records the decline with its reason, and commits nothing", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    const declined = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId: suggestionIdOf(set),
      reason: "not the company's word on this",
    });

    assert(declined.ok, inspect(declined));
    expect(declined.value.status).toBe("declined");

    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({
      status: "declined",
      reason: "not the company's word on this",
      decider: `human:${scenario.admin.userId}`,
      target_iri: null,
    });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);

    expect(await auditEventsFor(scenario.workspaceId, "knowledge.suggestion.declined")).toEqual([
      {
        action: "knowledge.suggestion.declined",
        subject_id: set.suggestionIds[0],
        subject_kind: "suggestion",
        batch_id: null,
        detail: { setId: set.setId },
      },
    ]);
  });

  it("declines as owner, recording the owner as decider", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.viewer, "edit", [requestFor()]);
    const suggestionId = suggestionIdOf(set);

    const declined = await declineSuggestion(scenario.editor, doorsOf(scenario), {
      suggestionId,
      reason: "not the company's word on this",
    });

    expect(declined).toMatchObject({ ok: true, value: { status: "declined" } });
    expect(await suggestionRow(suggestionId)).toMatchObject({
      status: "declined",
      decider: `human:${scenario.editor.userId}`,
    });
  });

  it("judges a decline by the concept's own path", async () => {
    const scenario = await arrange();
    const { input, written } = await editorWrote(scenario);
    const set = await submitted(scenario, scenario.viewer, "edit", [
      requestFor({
        mergeKey: input.mergeKey,
        path: `knowledge/unowned/expenses-${proposed}.md`,
        baseContentHash: written.contentHash,
      }),
    ]);

    const declined = await declineSuggestion(scenario.editor, doorsOf(scenario), {
      suggestionId: suggestionIdOf(set),
      reason: "not the company's word on this",
    });

    expect(declined).toMatchObject({ ok: true, value: { status: "declined" } });
  });

  it("refuses a non-owning Editor, and a blank reason", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = suggestionIdOf(set);

    const byEditor = await declineSuggestion(scenario.unowned, doorsOf(scenario), {
      suggestionId,
      reason: "not the company's word on this",
    });
    const blank = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId,
      reason: "   ",
    });

    expect([byEditor, blank]).toEqual([
      { ok: false, error: "owner-forbids" },
      { ok: false, error: "malformed" },
    ]);
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
  });

  it("refuses a reason the column would hold as nothing", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = suggestionIdOf(set);

    const nothing = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId,
      // @ts-expect-error — the column is nullable, so JSON's null parses.
      reason: null,
    });

    expect(nothing).toEqual({ ok: false, error: "malformed" });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
  });

  it("refuses a suggestion nobody minted", async () => {
    const scenario = await arrange();

    const declined = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId: ulid(),
      reason: "not the company's word on this",
    });

    expect(declined).toEqual({ ok: false, error: "no-such-suggestion" });
    expect(await auditEventsFor(scenario.workspaceId, "knowledge.suggestion.declined")).toEqual([]);
  });

  const anError: unknown = matching.any(Error);
  it.each([
    [
      "the store failing under it",
      async (scenario: Scenario, suggestionId: string) => {
        const gone = new pg.Pool(db().runtimePool.options);
        await gone.end();
        return declineSuggestion(
          scenario.admin,
          { git: scenario.git, postgres: openPostgres(gone) },
          { suggestionId, reason: "not the company's word on this" },
        );
      },
      anError,
    ],
    [
      "the decider's credentials ending first",
      async (scenario: Scenario, suggestionId: string) => {
        await db().pool.query(
          "UPDATE member SET credentials_revoked_at = $3 WHERE workspace_id = $1 AND user_id = $2",
          [scenario.workspaceId, scenario.admin.userId, new Date()],
        );
        return declineSuggestion(scenario.admin, doorsOf(scenario), {
          suggestionId,
          reason: "not the company's word on this",
        });
      },
      "credentials-revoked",
    ],
  ])("answers %s as itself, deciding nothing", async (_why, decide, expected) => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = suggestionIdOf(set);

    const refused = await decide(scenario, suggestionId);

    expect(refused).toEqual({ ok: false, error: expected });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
  });

  it("refuses an overlong reason before opening a transaction", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = suggestionIdOf(set);

    const refused = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId,
      reason: "x".repeat(5000),
    });

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
    expect(await auditEventsFor(scenario.workspaceId, "knowledge.suggestion.declined")).toEqual([]);
  });
});

describe("an acceptance at a path another concept holds", () => {
  it("is refused before a commit, leaving nothing written or decided", async () => {
    const scenario = await arrange();

    const first = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [
      first,
      requestFor({ path: first.path }),
    ]);

    const outcomes = await acceptAll(scenario, set.setId);

    expect(await countOf("concept_index", scenario.workspaceId)).toBe("1");

    expect(await countOf("map_node", scenario.workspaceId)).toBe("1");
    expect(
      await auditEventsFor(scenario.workspaceId, "knowledge.suggestion.accepted"),
    ).toHaveLength(1);
    expect(await suggestionRow(suggestionIdOf(set, 1))).toMatchObject({
      status: "waiting",
      decider: null,
      target_iri: null,
    });
    expect(outcomes.map(refusalOf)).toEqual([undefined, "path-taken"]);

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });
});

describe("the platform's citation fix", () => {
  it("re-hashes moved verifications, so Verified never becomes Changed since verified", async () => {
    const scenario = await arrange();

    const cite = (locator: string) => ({
      title: "Expenses",
      type: "Policy",
      sources: [{ resource: "/sources/handbook.pdf", title: "Handbook", locator }],
    });
    const { input, written } = await editorWrote(scenario, { frontmatter: cite("p.4") });
    await verifiedBy(scenario, scenario.editor, written);
    expect(await trustOf(scenario, written.iri)).toMatchObject({
      tier: "human-reviewed",
      status: "current",
    });

    const set = await platformCitationFix(
      scenario,
      requestFor({
        mergeKey: input.mergeKey,
        path: input.path,
        frontmatter: cite("p.7"),
        body: input.body,
        baseContentHash: written.contentHash,
      }),
    );

    const fixed = await acceptedOne(scenario, set.setId);
    expect(fixed.contentHash).not.toBe(written.contentHash);
    expect(fixed.contentHash).toBe(contentHashOf(cite("p.7"), input.body, input.path));

    expect(await trustOf(scenario, written.iri)).toMatchObject({
      tier: "human-reviewed",
      status: "current",
      verifiedBy: "Test person",
    });

    const verification = await db().pool.query<{ origin: string; content_hash: string }>(
      "SELECT origin, content_hash FROM concept_verification WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.iri],
    );
    expect(verification.rows).toEqual([
      { origin: "citation-fix", content_hash: fixed.contentHash },
    ]);
  });

  it("leaves every other kind's verifications exactly where they were", async () => {
    const scenario = await arrange();
    const { written, set } = await proposedAgainst(
      scenario,
      "edit",
      {},
      { body: "Expenses are claimed within ninety days." },
    );
    await verifiedBy(scenario, scenario.editor, written);

    await acceptAll(scenario, set.setId);

    expect(await trustOf(scenario, written.iri)).toMatchObject({
      status: "changed-since-checked",
    });
  });

  it("is nobody's to raise but the platform's, whatever role asks", async () => {
    const scenario = await arrange();

    const asked = await Promise.all(
      [scenario.viewer, scenario.editor, scenario.admin].map((principal) =>
        submitSuggestionSet(
          principal,
          { postgres: scenario.postgres },
          { kind: "citation-fix", requests: [requestFor()] },
        ),
      ),
    );

    expect(asked).toEqual([
      { ok: false, error: "kind-forbids" },
      { ok: false, error: "kind-forbids" },
      { ok: false, error: "kind-forbids" },
    ]);
    const raised = await db().pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM suggestion WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(raised.rows).toEqual([{ count: "0" }]);
  });
});

describe("two actions over one suggestion", () => {
  it("lets one of an acceptance and a decline through", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = suggestionIdOf(set);

    const [accepted, declined] = await Promise.all([
      acceptSuggestions(scenario.admin, doorsOf(scenario), {
        decisions: [{ suggestionId, expectedTarget: null }],
      }),
      declineSuggestion(scenario.admin, doorsOf(scenario), {
        suggestionId,
        reason: "not the company's word on this",
      }),
    ]);

    const row = await suggestionRow(suggestionId);
    assert(accepted.ok, inspect(accepted));
    expect([
      {
        status: "accepted",
        commits: 1,
        accepted: [undefined],
        declined: { ok: false, error: "already-decided" },
      },
      {
        status: "declined",
        commits: 0,
        accepted: ["already-decided"],
        declined: matching.objectContaining({ ok: true }),
      },
    ]).toContainEqual({
      status: row?.["status"],
      commits: (await bundleHistory(scenario.git, scenario.workspaceId)).length,
      accepted: accepted.value.map(refusalOf),
      declined,
    });
  });

  it("lets one of two Admins accept a new concept", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const decisions = [{ suggestionId: suggestionIdOf(set), expectedTarget: null }];

    const [first, second] = await Promise.all([
      acceptSuggestions(scenario.admin, doorsOf(scenario), { decisions }),
      acceptSuggestions(scenario.admin, doorsOf(scenario), { decisions }),
    ]);

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await countOf("concept_index", scenario.workspaceId)).toBe("1");
    assert(first.ok, inspect(first));
    assert(second.ok, inspect(second));
    const refusals = [...first.value, ...second.value].map(refusalOf);
    expect(refusals.filter((refusal) => refusal === undefined)).toHaveLength(1);
    expect(refusals.filter((refusal) => refusal === "already-decided")).toHaveLength(1);
  });

  it("refuses a write onto a held merge key before committing", async () => {
    const scenario = await arrange();
    const { input } = await editorWrote(scenario);

    const clash = await writeConcept(scenario.editor, doorsOf(scenario), {
      ...input,
      path: "knowledge/policy/second.md",
      expects: { head: null },
    });

    expect(clash).toEqual({ ok: false, error: "merge-key-taken" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });
});

describe("an acceptance whose ground moved under its own lock", () => {
  const MOVED = "the concept this suggestion resolves to moved after the set was opened";

  const decisionsFor = async (scenario: Scenario, setId: string) =>
    (await summaryOf(scenario, setId)).map((item) => ({
      suggestionId: item.suggestionId,
      expectedTarget: item.target,
    }));

  const acceptingParkedOn = async (
    scenario: Scenario,
    table: string,
    decisions: readonly AcceptanceDecision[],
    moves: () => Promise<void>,
  ): Promise<readonly AcceptanceOutcome[]> => {
    let accepting: ReturnType<typeof acceptSuggestions> | undefined;
    await holdingTable(db().pool, table, async () => {
      accepting = acceptSuggestions(scenario.admin, doorsOf(scenario), { decisions });
      await until(() => isBlockedOnTable(db().pool, table));
      await moves();
    });
    const accepted = await accepting;
    if (accepted?.ok !== true) {
      throw new Error(`the acceptance action itself was refused: ${String(accepted?.error)}`);
    }
    return accepted.value;
  };

  const expectReturned = async (
    outcomes: readonly AcceptanceOutcome[],
    suggestionId: string,
  ): Promise<void> => {
    expect(outcomes.map(refusalOf)).toEqual(["resolution-moved"]);
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "returned", reason: MOVED });
  };

  it("returns the item when its merge key is taken mid-commit", async () => {
    const scenario = await arrange();
    const request = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [request]);
    const decisions = await decisionsFor(scenario, set.setId);

    const outcomes = await acceptingParkedOn(scenario, "audit_event", decisions, async () => {
      const client = await db().pool.connect();
      try {
        await testData(client).conceptIdentity({
          workspaceId: scenario.workspaceId,
          mergeKey: request.mergeKey,
        });
      } finally {
        client.release();
      }
    });

    await expectReturned(outcomes, suggestionIdOf(set));

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await countOf("concept_index", scenario.workspaceId)).toBe("0");
  });

  it("returns the item when its target leaves the merge key", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");
    const decisions = await decisionsFor(scenario, set.setId);

    const outcomes = await acceptingParkedOn(scenario, "concept_index", decisions, async () => {
      await db().pool.query(
        "UPDATE concept_identity SET merge_key = $3 WHERE workspace_id = $1 AND iri = $2",
        [scenario.workspaceId, written.iri, `${input.mergeKey}-renamed`],
      );
    });

    await expectReturned(outcomes, suggestionIdOf(set));
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });

  it("throws rather than commits a decision another action made", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = suggestionIdOf(set);
    const decisions = await decisionsFor(scenario, set.setId);

    const outcomes = await acceptingParkedOn(scenario, "audit_event", decisions, async () => {
      const elsewhere = await db().pool.connect();
      try {
        await elsewhere.query("BEGIN");
        await elsewhere.query("SELECT set_config('app.deciding_suggestion', $1, true)", [
          suggestionId,
        ]);
        await elsewhere.query(
          `UPDATE suggestion SET status = 'declined', decider = $2, decided_at = now(),
                                 reason = 'decided by another process'
            WHERE id = $1`,
          [suggestionId, `human:${scenario.admin.userId}`],
        );
        await elsewhere.query("COMMIT");
      } finally {
        elsewhere.release();
      }
    });

    const outcome = outcomes[0]?.outcome;
    expect(outcome).toEqual({ ok: false, error: matching.any(Error) });
    expect(outcome).toMatchObject({
      error: {
        message: matching.stringContaining(
          "decided by somebody else while this action was in flight",
        ),
      },
    });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "declined" });
    expect(await countOf("concept_index", scenario.workspaceId)).toBe("0");
    expect(await auditEventsFor(scenario.workspaceId, "knowledge.suggestion.accepted")).toEqual([]);
  });
});

describe("what an acceptance answers when it cannot be prepared", () => {
  it("hands the item the store's failure, not an unminted suggestion", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const gone = new pg.Pool(db().runtimePool.options);
    await gone.end();

    const accepted = await acceptSuggestions(
      scenario.admin,
      { ...doorsOf(scenario), postgres: openPostgres(gone) },
      { decisions: [{ suggestionId: suggestionIdOf(set), expectedTarget: null }] },
    );

    assert(accepted.ok, inspect(accepted));
    expect(accepted.value.map(refusalOf)).toEqual([matching.any(Error)]);
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({ status: "waiting" });
  });

  it("refuses an Admin whose credentials were revoked, leaving it waiting", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    await db().pool.query(
      "UPDATE member SET credentials_revoked_at = $3 WHERE workspace_id = $1 AND user_id = $2",
      [scenario.workspaceId, scenario.admin.userId, new Date()],
    );

    expect(await refusalsToAcceptingAsAdmin(scenario, set)).toEqual(["credentials-revoked"]);
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({ status: "waiting" });
  });

  it("commits a person's suggested concept, authored by the accepting Admin", async () => {
    const scenario = await arrange();
    const admin = await personOf(scenario.admin.userId);
    const editor = await personOf(scenario.editor.userId);

    const raised = await seededSuggestion(scenario, requestFor(), {
      kind: "suggested-concept",
      proposer: `human:${scenario.editor.userId}`,
    });

    const { sha } = await acceptedOne(scenario, raised.setId);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);
    expect(facts.author).toBe(`${admin.name} <${admin.email}>`);
    expect(facts.author).not.toContain(editor.email);
  });

  it("writes one subject line however the payload's title was spaced", async () => {
    const scenario = await arrange();

    const set = await submitted(scenario, scenario.editor, "edit", [
      requestFor({ title: "  Expenses \n\t policy  " }),
    ]);

    const accepted = await acceptedOne(scenario, set.setId);

    const facts = await commitFacts(scenario.git, scenario.workspaceId, accepted.sha);
    expect(facts.subject).toBe("Accept the suggested change to Expenses policy");
  });
});

describe("who may open a suggestion set", () => {
  it("shows Admins any set, proposers their own, refusing everyone else", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const opened = (principal: UserPrincipal) =>
      readingAs(db().runtimePool, principal, (resolved, tx) =>
        suggestionSetSummary(resolved, tx, set.setId),
      );

    const [byAdmin, byProposer, byStranger] = await Promise.all([
      opened(scenario.admin),
      opened(scenario.editor),
      opened(scenario.viewer),
    ]);

    assert(byAdmin.ok, inspect(byAdmin));
    expect(byAdmin.value).toHaveLength(1);
    assert(byProposer.ok, inspect(byProposer));
    expect(byProposer.value).toHaveLength(1);
    expect(byStranger).toEqual({ ok: false, error: "role-forbids" });
  });

  it("shows a Viewer the set they raised", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.viewer, "edit", [requestFor()]);

    const opened = await readingAs(db().runtimePool, scenario.viewer, (resolved, tx) =>
      suggestionSetSummary(resolved, tx, set.setId),
    );

    assert(opened.ok, inspect(opened));
    expect(opened.value.map((item) => item.proposer)).toEqual([`human:${scenario.viewer.userId}`]);
  });

  it("hides unreadable resolutions from a proposer, not the deciding Admin", async () => {
    const scenario = await arrange();

    const { input, written } = await editorWrote(scenario, { sensitivity: "Restricted" });
    const set = await submitted(scenario, scenario.editor, "edit", [
      requestFor({
        mergeKey: input.mergeKey,
        path: input.path,
        baseContentHash: written.contentHash,
      }),
    ]);
    const opened = (principal: UserPrincipal) =>
      readingAs(db().runtimePool, principal, (resolved, tx) =>
        suggestionSetSummary(resolved, tx, set.setId),
      );

    const [byProposer, byAdmin] = await Promise.all([
      opened(scenario.editor),
      opened(scenario.admin),
    ]);

    assert(byProposer.ok, inspect(byProposer));
    expect(byProposer.value.map((item) => [item.target, item.baseMoved])).toEqual([[null, true]]);

    assert(byAdmin.ok, inspect(byAdmin));
    expect(byAdmin.value.map((item) => [item.target, item.baseMoved])).toEqual([
      [written.iri, false],
    ]);
  });
});

describe("what a write may not do with an IRI", () => {
  it("refuses a write naming an IRI this workspace never minted", async () => {
    const scenario = await arrange();

    const refused = await writeConcept(scenario.editor, doorsOf(scenario), {
      iri: conceptIriOf(ulid()),
      mergeKey: "policy:invented",
      path: "knowledge/policy/invented.md",
      kind: "Policy",
      title: "Invented",
      frontmatter: { title: "Invented" },
      body: "A concept whose key its author chose.",
      message: "Record a concept nobody minted",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      expects: { head: null },
    });

    expect(refused).toEqual({ ok: false, error: "no-such-concept" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
  });
});

describe("an acceptance reached straight through the write path", () => {
  const acceptanceOf = (
    input: WriteConceptInput,
    written: ConceptWritten,
    set: { readonly setId: string; readonly suggestionIds: readonly string[] },
    overrides: Partial<WriteConceptInput> = {},
  ): WriteConceptInput => {
    const { status: _status, sensitivity: _sensitivity, ...proposal } = input;
    return {
      ...proposal,
      iri: written.iri,
      body: SUGGESTED_BODY,
      expects: { base: written.contentHash },
      acceptance: { suggestionId: suggestionIdOf(set), setId: set.setId, kind: "edit" },
      ...overrides,
    };
  };

  const leftWaiting = async (
    scenario: Scenario,
    set: { readonly suggestionIds: readonly string[] },
    commits: number,
  ): Promise<void> => {
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(commits);
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({ status: "waiting" });
  };

  it("refuses an acceptance written onto another concept", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");
    const other = await editorWrote(scenario, { expects: { head: written.sha } });

    const elsewhere = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      acceptanceOf(other.input, other.written, set),
    );
    const onItsOwn = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      acceptanceOf(input, written, set),
    );

    expect(elsewhere).toEqual({ ok: false, error: "malformed" });
    expect(onItsOwn).toMatchObject({ ok: true });
  });

  type Moved = (set: SuggestionSetSubmitted) => Partial<WriteConceptInput>;
  it.each([
    ["body", () => ({ body: "Expenses are claimed whenever." })],
    ["merge key", () => ({ mergeKey: "policy:another" })],
    ["kind", () => ({ kind: "Guideline" })],
    ["title", () => ({ title: "Expenses and receipts" })],
    ["frontmatter", () => ({ frontmatter: { title: "Expenses", type: "Policy", owner: "Ada" } })],
    ["status", () => ({ status: "draft" })],
    ["sensitivity", () => ({ sensitivity: "Internal" })],
    [
      "suggestion kind",
      (set) => ({
        acceptance: {
          suggestionId: suggestionIdOf(set),
          setId: set.setId,
          kind: "citation-fix",
        },
      }),
    ],
  ] satisfies readonly (readonly [string, Moved])[])(
    "refuses an acceptance whose %s is not the suggestion's",
    async (_field, moved) => {
      const scenario = await arrange();
      const { input, written, set } = await proposedAgainst(scenario, "edit");

      const refused = await writeConcept(
        scenario.editor,
        doorsOf(scenario),
        acceptanceOf(input, written, set, moved(set)),
      );

      expect(refused).toEqual({ ok: false, error: "malformed" });
      await leftWaiting(scenario, set, 1);
    },
  );

  it("refuses a suggestion landed at another collection's path", async () => {
    const scenario = await arrange();
    const proposal = requestFor();
    const set = await submitted(scenario, scenario.viewer, "edit", [proposal]);
    const elsewhere = proposal.path.replace("knowledge/policy/", "knowledge/unowned/");

    const refused = await writeConcept(scenario.editor, doorsOf(scenario), {
      mergeKey: proposal.mergeKey,
      path: elsewhere,
      kind: proposal.conceptKind,
      title: proposal.title,
      frontmatter: proposal.frontmatter,
      body: proposal.body,
      message: "Accept the suggested change to Expenses",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      expects: { base: null },
      acceptance: { suggestionId: suggestionIdOf(set), setId: set.setId, kind: "edit" },
    });

    expect(refused).toEqual({ ok: false, error: "malformed" });
    const indexed = await db().pool.query(
      "SELECT path FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(indexed.rows).toEqual([]);
    await leftWaiting(scenario, set, 0);
  });

  it("refuses one whose base is not the suggestion's", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");
    const moved = await rewrittenAgainst(scenario, input, written, {
      body: "Expenses are claimed within ten days.",
    });
    assert(moved.ok, `the re-write was refused: ${inspect(moved)}`);

    const refused = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      acceptanceOf(input, written, set, { expects: { base: moved.value.contentHash } }),
    );

    expect(refused).toEqual({ ok: false, error: "malformed" });
    await leftWaiting(scenario, set, 2);
  });

  it("refuses a non-owner the same, whatever body they send", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    const rightBody = await writeConcept(
      scenario.unowned,
      doorsOf(scenario),
      acceptanceOf(input, written, set),
    );
    const wrongBody = await writeConcept(
      scenario.unowned,
      doorsOf(scenario),
      acceptanceOf(input, written, set, { body: "Expenses are claimed whenever." }),
    );

    expect([rightBody, wrongBody]).toEqual([
      { ok: false, error: "owner-forbids" },
      { ok: false, error: "owner-forbids" },
    ]);
    await leftWaiting(scenario, set, 1);
  });

  it("refuses one made against the ref's head, not the base", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    const refused = await writeConcept(
      scenario.admin,
      doorsOf(scenario),
      acceptanceOf(input, written, set, { expects: { head: written.sha } }),
    );

    expect(refused).toEqual({ ok: false, error: "malformed" });
    await leftWaiting(scenario, set, 1);
  });

  it("refuses one naming an unminted suggestion, making no commit", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    const refused = await writeConcept(scenario.admin, doorsOf(scenario), {
      ...acceptanceOf(input, written, set),
      acceptance: { suggestionId: ulid(), setId: set.setId, kind: "edit" },
    });

    expect(refused).toEqual({ ok: false, error: "already-decided" });
    await leftWaiting(scenario, set, 1);
  });

  it("refuses one whose target no longer holds its merge key", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    const moved = await rewrittenAgainst(scenario, input, written, {
      mergeKey: `${input.mergeKey}-renamed`,
    });
    expect(moved.ok).toBe(true);

    const refused = await writeConcept(
      scenario.admin,
      doorsOf(scenario),
      acceptanceOf(input, written, set),
    );

    expect(refused).toEqual({ ok: false, error: "resolution-moved" });

    await leftWaiting(scenario, set, 2);
  });
});

describe("what a suggestion set refuses before it does any work", () => {
  it("refuses an undeclared kind as malformed", async () => {
    const scenario = await arrange();

    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: scenario.postgres },
      // @ts-expect-error — an undeclared kind, which only runtime input can send.
      { kind: "merge", requests: [requestFor()] },
    );

    expect(set).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses a payload whose frontmatter is no mapping, queuing nothing", async () => {
    const scenario = await arrange();

    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: scenario.postgres },
      {
        kind: "edit",
        // @ts-expect-error — null is not a frontmatter mapping.
        requests: [requestFor({ frontmatter: null })],
      },
    );

    expect(set).toEqual({ ok: false, error: "malformed" });
    const queued = await db().pool.query("SELECT 1 FROM suggestion WHERE workspace_id = $1", [
      scenario.workspaceId,
    ]);
    expect(queued.rowCount).toBe(0);
  });

  it("refuses the kinds no person's session may raise, whoever asks", async () => {
    const scenario = await arrange();
    const raise = (kind: SuggestionKind, principal = scenario.admin) =>
      submitSuggestionSet(
        principal,
        { postgres: scenario.postgres },
        { kind, requests: [requestFor()] },
      );

    const refused = await Promise.all([
      raise("suggested-concept"),
      raise("citation-fix"),
      raise("suggested-concept", scenario.editor),
    ]);

    expect(refused).toEqual([
      { ok: false, error: "kind-forbids" },
      { ok: false, error: "kind-forbids" },
      { ok: false, error: "kind-forbids" },
    ]);
  });

  it("hands a submitter the store's failure, not an empty set", async () => {
    const scenario = await arrange();
    const gone = new pg.Pool(db().runtimePool.options);
    await gone.end();

    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: openPostgres(gone) },
      { kind: "edit", requests: [requestFor()] },
    );

    expect(set).toEqual({ ok: false, error: matching.any(Error) });
  });

  it("refuses a submitter whose credentials ended, and queues nothing", async () => {
    const scenario = await arrange();
    await db().pool.query(
      "UPDATE member SET credentials_revoked_at = $3 WHERE workspace_id = $1 AND user_id = $2",
      [scenario.workspaceId, scenario.editor.userId, new Date()],
    );

    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: scenario.postgres },
      { kind: "edit", requests: [requestFor()] },
    );

    expect(set).toEqual({ ok: false, error: "credentials-revoked" });
    const queued = await db().pool.query("SELECT 1 FROM suggestion WHERE workspace_id = $1", [
      scenario.workspaceId,
    ]);
    expect(queued.rowCount).toBe(0);
  });

  it("refuses an acceptance in ids of no known form", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    const asked = await Promise.all([
      acceptSuggestions(scenario.admin, doorsOf(scenario), {
        decisions: [{ suggestionId: "suggestion-1", expectedTarget: null }],
      }),
      acceptSuggestions(scenario.admin, doorsOf(scenario), {
        decisions: [{ suggestionId: suggestionIdOf(set), expectedTarget: "knowledge/expenses.md" }],
      }),
      acceptSuggestions(scenario.admin, doorsOf(scenario), { decisions: [] }),
    ]);

    expect(asked).toEqual([
      { ok: false, error: "malformed" },
      { ok: false, error: "malformed" },
      { ok: false, error: "malformed" },
    ]);
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({ status: "waiting" });
  });
});

const RETITLED = "Travel Expenses";

const retitled = { title: RETITLED, frontmatter: { title: RETITLED, type: "Policy" } };

const mergeKeyHeldBy = async (iri: string): Promise<string | undefined> => {
  const found = await db().pool.query<{ merge_key: string }>(
    "SELECT merge_key FROM concept_identity WHERE iri = $1",
    [iri],
  );
  return found.rows[0]?.merge_key;
};

describe("an accepted edit's identity and state", () => {
  it("re-keys an accepted retitle to its new title", async () => {
    const scenario = await arrange();
    const { written, set } = await proposedAgainst(scenario, "edit", {}, retitled);

    await acceptedOne(scenario, set.setId);

    expect(await mergeKeyHeldBy(written.iri)).toBe(mergeKeyOf(foldKind("Policy"), RETITLED));
  });

  it("keeps the key of an accepted edit keeping its title", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    await acceptedOne(scenario, set.setId);

    expect(await mergeKeyHeldBy(written.iri)).toBe(input.mergeKey);
  });

  it("returns an accepted retitle onto a title already taken", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit", {}, retitled);
    await editorWrote(scenario, {
      ...retitled,
      mergeKey: mergeKeyOf(foldKind("Policy"), RETITLED),
      expects: { head: written.sha },
    });
    const before = await bundleHistory(scenario.git, scenario.workspaceId);

    const [outcome] = await acceptAll(scenario, set.setId);

    expect(outcome?.outcome).toEqual({ ok: false, error: "resolution-moved" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(before);
    expect(await suggestionRow(suggestionIdOf(set))).toMatchObject({ status: "returned" });
    expect(await mergeKeyHeldBy(written.iri)).toBe(input.mergeKey);
  });

  it("publishes an accepted new concept its proposer can open", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.viewer, "edit", [requestFor()]);

    const accepted = await acceptedOne(scenario, set.setId, scenario.editor);
    const row = await db().pool.query<Record<string, unknown>>(
      "SELECT status, sensitivity, published_at IS NOT NULL AS published FROM concept_index WHERE iri = $1",
      [accepted.iri],
    );
    const reopened = await readingAs(db().runtimePool, scenario.viewer, (principal, tx) =>
      conceptByIri(principal, tx, accepted.iri),
    );

    expect(row.rows[0]).toEqual({ status: "stable", sensitivity: "Internal", published: true });
    expect(reopened).toMatchObject({ ok: true, value: { iri: accepted.iri } });
  });

  it("lands an accepted new concept no wider than its sources", async () => {
    const scenario = await arrange();
    const minutes = await documentLanded(db().pool, scenario.workspaceId, {
      title: "Board minutes",
      text: "The board reviews pay in March.",
      sensitivity: "Restricted",
    });
    const cited = { title: "Board minutes", resource: "minutes", locator: minutes.locator };
    const request = requestFor();
    const set = await submitted(scenario, scenario.admin, "edit", [
      { ...request, frontmatter: { ...request.frontmatter, sources: [cited] } },
    ]);

    const accepted = await acceptedOne(scenario, set.setId);
    const row = await db().pool.query(
      "SELECT status, sensitivity FROM concept_index WHERE iri = $1",
      [accepted.iri],
    );

    expect(row.rows).toEqual([{ status: "stable", sensitivity: "Restricted" }]);
  });
});
