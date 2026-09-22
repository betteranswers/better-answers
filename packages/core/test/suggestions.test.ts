import { testData } from "@better-answers/schema/testing";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { open } from "../src/answering/index.ts";
import {
  acceptSuggestions,
  contentHashOf,
  declineSuggestion,
  submitSuggestionSet,
  suggestionSetSummary,
  writeConcept,
  type AcceptanceDecision,
  type AcceptanceOutcome,
  type ConceptWritten,
  type SuggestionKind,
  type SuggestionRequest,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { Result, UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { bundleHistory, commitFacts } from "./bundle.ts";
import {
  abortTheTransaction,
  holdingTable,
  isBlockedOnTable,
  readingAs,
  until,
} from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

let proposed = 0;

const requestFor = (overrides: Partial<SuggestionRequest> = {}): SuggestionRequest => {
  proposed += 1;
  return {
    mergeKey: `policy:expenses-${proposed}`,
    path: `knowledge/expenses-${proposed}.md`,
    conceptKind: "Policy",
    title: "Expenses",
    frontmatter: { title: "Expenses", type: "Policy" },
    body: "Expenses are claimed within sixty days.",
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

const acceptedOne = async (scenario: Scenario, setId: string): Promise<ConceptWritten> => {
  const [outcome] = await acceptAll(scenario, setId);
  if (outcome === undefined) throw new Error("the acceptance returned no outcome");
  const accepted = acceptedOf(outcome);
  if (accepted === undefined) {
    throw new Error(`the acceptance was refused: ${String(refusalOf(outcome))}`);
  }
  return accepted;
};

const countOf = async (
  table: "concept_index" | "graph_node",
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

const ledgerFor = async (workspaceId: string, act: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT act, subject_id, subject_kind, batch_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY id",
    [workspaceId, act],
  );
  return found.rows;
};

const editorWrote = async (scenario: Scenario, overrides: Partial<WriteConceptInput> = {}) => {
  proposed += 1;
  const input: WriteConceptInput = {
    mergeKey: `policy:expenses-${proposed}`,
    path: `knowledge/expenses-${proposed}.md`,
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

const platformRepair = (scenario: Scenario, request: SuggestionRequest) =>
  seededSuggestion(scenario, request, {
    kind: "repair",
    proposer: "process:better-answers-citation-repair",
  });

const checkedBy = async (
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

const trustOf = async (scenario: Scenario, iri: string) => {
  const read = await readingAs(db().runtimePool, scenario.viewer, (principal, tx) =>
    open(principal, tx, { iri }, now),
  );
  return read.ok && read.value.found ? read.value.concept?.trust : undefined;
};

describe("a suggestion set", () => {
  it("waits with no target at all, because identity is the acceptance's to resolve", async () => {
    const scenario = await arrange();

    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
    const row = await suggestionRow(set.suggestionIds[0] ?? "");
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

  it("renders an item's kind, its status and who decided it, as the rows hold them", async () => {
    const scenario = await arrange();
    const request = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [request]);
    const suggestionId = set.suggestionIds[0] ?? "";
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

  it("shows a member a set nobody minted as an empty one rather than a refusal", async () => {
    const scenario = await arrange();

    const read = await readingAs(db().runtimePool, scenario.editor, (principal, tx) =>
      suggestionSetSummary(principal, tx, ulid()),
    );

    expect(read).toEqual({ ok: true, value: [] });
  });

  it("hands a caller the store's own failure rather than a set with no items in it", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    let read: Result<unknown, unknown> | undefined;

    await expect(
      readingAs(db().runtimePool, scenario.editor, async (principal, tx) => {
        await abortTheTransaction(tx);
        read = await suggestionSetSummary(principal, tx, set.setId);
      }),
    ).rejects.toThrow(/did not commit/);

    expect(read).toEqual({ ok: false, error: expect.any(Error) });
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
  it("mints the concept, lands its rows and its commit, and decides the suggestion together", async () => {
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

    const row = await suggestionRow(set.suggestionIds[0] ?? "");
    expect(row).toMatchObject({
      status: "accepted",
      target_iri: accepted.iri,
      decider: `human:${scenario.admin.userId}`,
      reason: null,
    });
    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.accepted")).toEqual([
      {
        act: "knowledge.suggestion.accepted",
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

  it("lands the graph delta in the acceptance's own transaction, so the map is never behind for one", async () => {
    const scenario = await arrange();

    const { input: cited, written } = await editorWrote(scenario);
    const filename = cited.path.split("/").at(-1) ?? "";
    const set = await submitted(scenario, scenario.editor, "edit", [
      requestFor({ body: `See [the policy](./${filename}) for the rule.` }),
    ]);

    const accepted = await acceptedOne(scenario, set.setId);

    const nodes = await db().pool.query<{ uid: string; gen: number }>(
      "SELECT uid, gen FROM graph_node WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(nodes.rows.map((row) => row.uid).toSorted()).toEqual(
      [written.iri, accepted.iri].toSorted(),
    );
    expect(nodes.rows.map((row) => row.gen)).toEqual([1, 1]);
    const edges = await db().pool.query(
      "SELECT from_uid, to_uid FROM graph_edge WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(edges.rows).toEqual([{ from_uid: accepted.iri, to_uid: written.iri }]);
  });

  it("commits an *edit* with the proposer as git author and the platform bot as committer", async () => {
    const scenario = await arrange();
    const proposer = await db().pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM "user" WHERE id = $1',
      [scenario.editor.userId],
    );
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    const [outcome] = await acceptAll(scenario, set.setId);

    const facts = await commitFacts(
      scenario.git,
      scenario.workspaceId,
      acceptedOf(outcome)?.sha ?? "",
    );
    const person = proposer.rows[0];
    expect(facts.author).toBe(`${person?.name} <${person?.email}>`);
    expect(facts.committer).toContain("Better Answers");
  });

  it("commits a run's candidate with the accepting Admin as git author, who has an author line", async () => {
    const scenario = await arrange();
    const admin = await db().pool.query<{ name: string }>('SELECT name FROM "user" WHERE id = $1', [
      scenario.admin.userId,
    ]);

    const set = await seededSuggestion(scenario, requestFor(), {
      kind: "candidate",
      proposer: "better-answers-extraction/1.2",
    });

    const [outcome] = await acceptAll(scenario, set.setId);

    const facts = await commitFacts(
      scenario.git,
      scenario.workspaceId,
      acceptedOf(outcome)?.sha ?? "",
    );
    expect(facts.author).toContain(admin.rows[0]?.name ?? "");
  });

  it("never names a person of another workspace as author, whatever a proposer claims", async () => {
    const here = await arrange();
    const elsewhere = await arrange();
    const stranger = await db().pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM "user" WHERE id = $1',
      [elsewhere.editor.userId],
    );
    const decider = await db().pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM "user" WHERE id = $1',
      [here.admin.userId],
    );

    const spoofed = await seededSuggestion(here, requestFor(), {
      kind: "edit",
      proposer: `human:${elsewhere.editor.userId}`,
    });

    const [outcome] = await acceptAll(here, spoofed.setId);

    const facts = await commitFacts(here.git, here.workspaceId, acceptedOf(outcome)?.sha ?? "");
    const person = decider.rows[0];
    expect(facts.author).toBe(`${person?.name} <${person?.email}>`);

    expect(facts.author).not.toContain(stranger.rows[0]?.email ?? "no address");
  });

  it("makes one commit per item in bulk, and shares one batch id across the ledger rows", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [
      requestFor(),
      requestFor(),
      requestFor(),
    ]);

    const outcomes = await acceptAll(scenario, set.setId);

    expect(outcomes.map(refusalOf)).toEqual([undefined, undefined, undefined]);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(3);
    const rows = await ledgerFor(scenario.workspaceId, "knowledge.suggestion.accepted");
    expect(rows).toHaveLength(3);
    const batches = new Set(rows.map((row) => row["batch_id"]));
    expect(batches.size).toBe(1);
    expect([...batches][0]).not.toBeNull();
  });

  it("re-writes the concept its merge key resolves to, rather than minting a second one", async () => {
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

  it("refuses a Viewer and an Editor, and leaves the set waiting", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    for (const principal of [scenario.viewer, scenario.editor]) {
      const refused = await acceptSuggestions(principal, doorsOf(scenario), {
        decisions: [{ suggestionId: set.suggestionIds[0] ?? "", expectedTarget: null }],
      });
      expect(refused).toEqual({ ok: false, error: "role-forbids" });
    }

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({ status: "waiting" });
  });

  it("answers a suggestion of another workspace exactly as it answers one nobody minted", async () => {
    const here = await arrange();
    const there = await arrange();
    const theirs = await submitted(there, there.editor, "edit", [requestFor()]);

    const reached = await acceptSuggestions(here.admin, doorsOf(here), {
      decisions: [
        { suggestionId: theirs.suggestionIds[0] ?? "", expectedTarget: null },
        { suggestionId: ulid(), expectedTarget: null },
      ],
    });

    expect(reached.ok && reached.value.map(refusalOf)).toEqual([
      "no-such-suggestion",
      "no-such-suggestion",
    ]);
    expect(await bundleHistory(here.git, here.workspaceId)).toEqual([]);
  });
});

describe("an acceptance whose ground moved", () => {
  it("is refused and returned to the proposer when the resolution moved since the summary", async () => {
    const scenario = await arrange();
    const request = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [request]);

    const opened = await summaryOf(scenario, set.setId);
    expect(opened.map((item) => item.target)).toEqual([null]);

    await editorWrote(scenario, { mergeKey: request.mergeKey, path: request.path });

    const accepted = await acceptSuggestions(scenario.admin, doorsOf(scenario), {
      decisions: [{ suggestionId: set.suggestionIds[0] ?? "", expectedTarget: null }],
    });

    expect(accepted.ok && accepted.value.map(refusalOf)).toEqual(["resolution-moved"]);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    const row = await suggestionRow(set.suggestionIds[0] ?? "");
    expect(row).toMatchObject({
      status: "returned",
      decider: `human:${scenario.admin.userId}`,
      target_iri: null,
    });
    expect(String(row?.["reason"])).toContain("moved");
    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.returned")).toHaveLength(1);
  });

  it("is refused and returned when the content the payload was written against moved", async () => {
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
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({ status: "returned" });
  });

  it("refuses a second decision on a suggestion somebody has already decided", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    await acceptAll(scenario, set.setId);

    const again = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId: set.suggestionIds[0] ?? "",
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
      suggestionId: set.suggestionIds[0] ?? "",
      reason: "not the company's word on this",
    });

    expect(declined.ok && declined.value.status).toBe("declined");

    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({
      status: "declined",
      reason: "not the company's word on this",
      decider: `human:${scenario.admin.userId}`,
      target_iri: null,
    });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);

    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.declined")).toEqual([
      {
        act: "knowledge.suggestion.declined",
        subject_id: set.suggestionIds[0],
        subject_kind: "suggestion",
        batch_id: null,
        detail: { setId: set.setId },
      },
    ]);
  });

  it("refuses an Editor, and a reason nobody wrote", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = set.suggestionIds[0] ?? "";

    const byEditor = await declineSuggestion(scenario.editor, doorsOf(scenario), {
      suggestionId,
      reason: "no",
    });
    const blank = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId,
      reason: "   ",
    });

    expect([byEditor, blank]).toEqual([
      { ok: false, error: "role-forbids" },
      { ok: false, error: "malformed" },
    ]);
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
  });

  it("refuses a reason the column would hold as nothing, which is not a reason at all", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = set.suggestionIds[0] ?? "";

    const nothing = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId,
      // @ts-expect-error — the column is nullable, so JSON's null parses; the runtime half of what the type says.
      reason: null,
    });

    expect(nothing).toEqual({ ok: false, error: "malformed" });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
  });

  it("refuses a suggestion nobody minted, rather than deciding a row that is not there", async () => {
    const scenario = await arrange();

    const declined = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId: ulid(),
      reason: "not the company's word on this",
    });

    expect(declined).toEqual({ ok: false, error: "no-such-suggestion" });
    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.declined")).toEqual([]);
  });

  const anError: unknown = expect.any(Error);
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
  ])("answers %s as itself, and decides nothing", async (_why, decide, expected) => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = set.suggestionIds[0] ?? "";

    const refused = await decide(scenario, suggestionId);

    expect(refused).toEqual({ ok: false, error: expected });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
  });

  it("refuses a reason longer than the row will carry, before it opens a transaction at all", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = set.suggestionIds[0] ?? "";

    const refused = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId,
      reason: "x".repeat(5000),
    });

    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.declined")).toEqual([]);
  });
});

describe("an acceptance at a path another concept holds", () => {
  it("is refused before a commit, and leaves neither the concept, nor its ledger row, nor the suggestion decided", async () => {
    const scenario = await arrange();

    const first = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [
      first,
      requestFor({ path: first.path }),
    ]);

    const outcomes = await acceptAll(scenario, set.setId);

    expect(await countOf("concept_index", scenario.workspaceId)).toBe("1");

    expect(await countOf("graph_node", scenario.workspaceId)).toBe("1");
    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.accepted")).toHaveLength(1);
    expect(await suggestionRow(set.suggestionIds[1] ?? "")).toMatchObject({
      status: "waiting",
      decider: null,
      target_iri: null,
    });
    expect(outcomes.map(refusalOf)).toEqual([undefined, "path-taken"]);

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });
});

describe("the platform's citation repair", () => {
  it("re-hashes the checks it moved, so a repair never turns Checked into Changed since checked", async () => {
    const scenario = await arrange();

    const cite = (locator: string) => ({
      title: "Expenses",
      type: "Policy",
      sources: [{ resource: "/sources/handbook.pdf", title: "Handbook", locator }],
    });
    const { input, written } = await editorWrote(scenario, { frontmatter: cite("p.4") });
    await checkedBy(scenario, scenario.editor, written);
    expect(await trustOf(scenario, written.iri)).toMatchObject({
      tier: "human-reviewed",
      status: "current",
    });

    const set = await platformRepair(
      scenario,
      requestFor({
        mergeKey: input.mergeKey,
        path: input.path,
        frontmatter: cite("p.7"),
        body: input.body,
        baseContentHash: written.contentHash,
      }),
    );

    const [outcome] = await acceptAll(scenario, set.setId);

    const repaired = acceptedOf(outcome);
    expect(outcome === undefined ? undefined : refusalOf(outcome)).toBeUndefined();
    if (repaired === undefined) return;
    expect(repaired.contentHash).not.toBe(written.contentHash);
    expect(repaired.contentHash).toBe(contentHashOf(cite("p.7"), input.body, input.path));

    expect(await trustOf(scenario, written.iri)).toMatchObject({
      tier: "human-reviewed",
      status: "current",
      checkedBy: "Test person",
    });

    const verification = await db().pool.query<{ origin: string; content_hash: string }>(
      "SELECT origin, content_hash FROM concept_verification WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.iri],
    );
    expect(verification.rows).toEqual([{ origin: "repair", content_hash: repaired.contentHash }]);
  });

  it("leaves every other kind's checks exactly where they were", async () => {
    const scenario = await arrange();
    const { written, set } = await proposedAgainst(
      scenario,
      "edit",
      {},
      { body: "Expenses are claimed within ninety days." },
    );
    await checkedBy(scenario, scenario.editor, written);

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
          { kind: "repair", requests: [requestFor()] },
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

describe("two acts over one suggestion", () => {
  it("lets one of an acceptance and a decline through, and leaves no commit for the other", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = set.suggestionIds[0] ?? "";

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
    const landed = accepted.ok && acceptedOf(accepted.value[0]) !== undefined;
    expect({
      status: row?.["status"],
      commits: (await bundleHistory(scenario.git, scenario.workspaceId)).length,
      loser: landed
        ? declined.ok
          ? undefined
          : declined.error
        : accepted.ok
          ? accepted.value.map(refusalOf)
          : accepted.error,
    }).toEqual(
      landed
        ? { status: "accepted", commits: 1, loser: "already-decided" }
        : { status: "declined", commits: 0, loser: ["already-decided"] },
    );
  });

  it("lets one of two Admins accept the same new concept, and refuses the other with no commit", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const decisions = [{ suggestionId: set.suggestionIds[0] ?? "", expectedTarget: null }];

    const [first, second] = await Promise.all([
      acceptSuggestions(scenario.admin, doorsOf(scenario), { decisions }),
      acceptSuggestions(scenario.admin, doorsOf(scenario), { decisions }),
    ]);

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await countOf("concept_index", scenario.workspaceId)).toBe("1");
    const refusals = [first, second].flatMap((result) =>
      result.ok ? result.value.map(refusalOf) : [result.error],
    );
    expect(refusals.filter((refusal) => refusal === undefined)).toHaveLength(1);
    expect(refusals.filter((refusal) => refusal === "already-decided")).toHaveLength(1);
  });

  it("refuses a write onto a merge key another concept already holds, before it commits", async () => {
    const scenario = await arrange();
    const { input } = await editorWrote(scenario);

    const clash = await writeConcept(scenario.editor, doorsOf(scenario), {
      ...input,
      path: "knowledge/second.md",
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
      throw new Error(`the acceptance act itself was refused: ${String(accepted?.error)}`);
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

  it("returns the item to its proposer when the merge key is taken while it commits", async () => {
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

    await expectReturned(outcomes, set.suggestionIds[0] ?? "");

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
    expect(await countOf("concept_index", scenario.workspaceId)).toBe("0");
  });

  it("returns the item to its proposer when its target leaves the merge key first", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");
    const decisions = await decisionsFor(scenario, set.setId);

    const outcomes = await acceptingParkedOn(scenario, "concept_index", decisions, async () => {
      await db().pool.query(
        "UPDATE concept_identity SET merge_key = $3 WHERE workspace_id = $1 AND iri = $2",
        [scenario.workspaceId, written.iri, `${input.mergeKey}-renamed`],
      );
    });

    await expectReturned(outcomes, set.suggestionIds[0] ?? "");
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
  });

  it("throws rather than commits a decision that a second act had already made", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = set.suggestionIds[0] ?? "";
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
    expect(outcome).toEqual({ ok: false, error: expect.any(Error) });
    expect(outcome?.ok === false && String(outcome.error)).toContain(
      "decided by somebody else while this act was in flight",
    );
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "declined" });
    expect(await countOf("concept_index", scenario.workspaceId)).toBe("0");
    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.accepted")).toEqual([]);
  });
});

describe("what an acceptance answers when it cannot be prepared", () => {
  it("hands the item the store's own failure rather than a suggestion nobody minted", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const gone = new pg.Pool(db().runtimePool.options);
    await gone.end();

    const accepted = await acceptSuggestions(
      scenario.admin,
      { ...doorsOf(scenario), postgres: openPostgres(gone) },
      { decisions: [{ suggestionId: set.suggestionIds[0] ?? "", expectedTarget: null }] },
    );

    expect(accepted.ok === true && accepted.value.map(refusalOf)).toEqual([expect.any(Error)]);
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({ status: "waiting" });
  });

  it("refuses an Admin whose credentials ended, rather than reading the queue as empty", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    await db().pool.query(
      "UPDATE member SET credentials_revoked_at = $3 WHERE workspace_id = $1 AND user_id = $2",
      [scenario.workspaceId, scenario.admin.userId, new Date()],
    );

    const accepted = await acceptSuggestions(scenario.admin, doorsOf(scenario), {
      decisions: [{ suggestionId: set.suggestionIds[0] ?? "", expectedTarget: null }],
    });

    expect(accepted.ok === true && accepted.value.map(refusalOf)).toEqual(["credentials-revoked"]);
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({ status: "waiting" });
  });

  it("commits the accepting Admin as author for a candidate a person proposed", async () => {
    const scenario = await arrange();
    const admin = await db().pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM "user" WHERE id = $1',
      [scenario.admin.userId],
    );
    const editor = await db().pool.query<{ email: string }>(
      'SELECT email FROM "user" WHERE id = $1',
      [scenario.editor.userId],
    );

    const raised = await seededSuggestion(scenario, requestFor(), {
      kind: "candidate",
      proposer: `human:${scenario.editor.userId}`,
    });

    const [outcome] = await acceptAll(scenario, raised.setId);

    const facts = await commitFacts(
      scenario.git,
      scenario.workspaceId,
      acceptedOf(outcome)?.sha ?? "",
    );
    expect(facts.author).toBe(`${admin.rows[0]?.name} <${admin.rows[0]?.email}>`);
    expect(facts.author).not.toContain(editor.rows[0]?.email ?? "no address");
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
  it("shows an Admin any set, shows a proposer their own, and refuses everyone else", async () => {
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

    expect(byAdmin.ok && byAdmin.value).toHaveLength(1);
    expect(byProposer.ok && byProposer.value).toHaveLength(1);
    expect(byStranger).toEqual({ ok: false, error: "role-forbids" });
  });

  it("shows a proposer no resolution they may not read, and the deciding Admin the one they must", async () => {
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

    expect(byProposer.ok && byProposer.value.map((item) => [item.target, item.baseMoved])).toEqual([
      [null, true],
    ]);

    expect(byAdmin.ok && byAdmin.value.map((item) => [item.target, item.baseMoved])).toEqual([
      [written.iri, false],
    ]);
  });
});

describe("what a write may not do with an IRI", () => {
  it("refuses a write naming an IRI this workspace never minted, and makes no commit", async () => {
    const scenario = await arrange();

    const refused = await writeConcept(scenario.editor, doorsOf(scenario), {
      iri: conceptIriOf(ulid()),
      mergeKey: "policy:invented",
      path: "knowledge/invented.md",
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
  ): WriteConceptInput => ({
    ...input,
    iri: written.iri,
    expects: { base: written.contentHash },
    acceptance: { suggestionId: set.suggestionIds[0] ?? "", setId: set.setId, kind: "edit" },
    ...overrides,
  });

  const leftWaiting = async (
    scenario: Scenario,
    set: { readonly suggestionIds: readonly string[] },
    commits: number,
  ): Promise<void> => {
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(commits);
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({ status: "waiting" });
  };

  it("refuses an Editor, because a decision is an Admin's whichever road reached the act", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    const refused = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      acceptanceOf(input, written, set),
    );

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    await leftWaiting(scenario, set, 1);
  });

  it("refuses one made against the ref's head rather than the payload's base", async () => {
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

  it("refuses one naming a suggestion nobody minted, and makes no commit", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    const refused = await writeConcept(scenario.admin, doorsOf(scenario), {
      ...acceptanceOf(input, written, set),
      acceptance: { suggestionId: ulid(), setId: set.setId, kind: "edit" },
    });

    expect(refused).toEqual({ ok: false, error: "already-decided" });
    await leftWaiting(scenario, set, 1);
  });

  it("refuses one whose named target no longer answers to the merge key it was proposed under", async () => {
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

describe("what the inbox refuses before it does any work", () => {
  it("refuses a kind nobody declared, in the word a caller can act on", async () => {
    const scenario = await arrange();

    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: scenario.postgres },
      // @ts-expect-error — a fifth kind is not one; the runtime half of what the type says.
      { kind: "merge", requests: [requestFor()] },
    );

    expect(set).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses a payload whose frontmatter is not a mapping, and queues nothing", async () => {
    const scenario = await arrange();

    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: scenario.postgres },
      {
        kind: "edit",
        // @ts-expect-error — null is not a frontmatter mapping; the runtime half of what the type says.
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
      raise("candidate"),
      raise("repair"),
      raise("candidate", scenario.editor),
    ]);

    expect(refused).toEqual([
      { ok: false, error: "kind-forbids" },
      { ok: false, error: "kind-forbids" },
      { ok: false, error: "kind-forbids" },
    ]);
  });

  it("hands a submitter the store's own failure rather than a set with no ids in it", async () => {
    const scenario = await arrange();
    const gone = new pg.Pool(db().runtimePool.options);
    await gone.end();

    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: openPostgres(gone) },
      { kind: "edit", requests: [requestFor()] },
    );

    expect(set).toEqual({ ok: false, error: expect.any(Error) });
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

  it("refuses an acceptance asked for in ids of no known form, and decides nothing", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    const asked = await Promise.all([
      acceptSuggestions(scenario.admin, doorsOf(scenario), {
        decisions: [{ suggestionId: "suggestion-1", expectedTarget: null }],
      }),
      acceptSuggestions(scenario.admin, doorsOf(scenario), {
        decisions: [
          { suggestionId: set.suggestionIds[0] ?? "", expectedTarget: "knowledge/expenses.md" },
        ],
      }),
      acceptSuggestions(scenario.admin, doorsOf(scenario), { decisions: [] }),
    ]);

    expect(asked).toEqual([
      { ok: false, error: "malformed" },
      { ok: false, error: "malformed" },
      { ok: false, error: "malformed" },
    ]);
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({ status: "waiting" });
  });
});
