import { testData } from "@better-answers/schema/testing";
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
  type AcceptanceOutcome,
  type ConceptWritten,
  type SuggestionKind,
  type SuggestionRequest,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { bundleHistory, bundlesForSuite, commitFacts } from "./bundle.ts";
import { postgresForSuite, readingAs } from "./suite-postgres.ts";
import { arrangeWorkspace, type Scenario } from "./workspace-with-bundle.ts";

/**
 * Suggestions, the inbox and identity, through the concepts slice's entry point
 * (`[TEST1]`), against real Postgres and a real bare repository.
 *
 * The claims: an acceptance is **one governed write** — its rows, its commit and the
 * suggestion's decision land together or not at all; identity is resolved **at acceptance**
 * and an acceptance whose resolution moved is refused and returned to the proposer; a
 * decline is recorded with its reason; and the platform's citation repair re-hashes what it
 * repaired, so a repair never turns *Checked* into *Changed since checked*.
 */

const db = postgresForSuite();
const bundles = bundlesForSuite();

const arrange = (): Promise<Scenario> => arrangeWorkspace(db(), bundles());

/** Both doors, as every act in this slice takes them — a decision holds the bundle's lock. */
const doorsOf = (scenario: Scenario) => ({ git: scenario.git, postgres: scenario.postgres });

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

/** Submit a set as this person, and hand back the ids the inbox minted. */
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

/** The set as its decider sees it when they open it — the summary, re-rendered. */
const summaryOf = async (scenario: Scenario, setId: string) => {
  const read = await readingAs(db().runtimePool, scenario.admin, (principal, tx) =>
    suggestionSetSummary(principal, tx, setId),
  );
  if (!read.ok) throw new Error(`the set did not render: ${String(read.error)}`);
  return read.value;
};

/** Accept every item of a set at the targets its summary rendered. */
const acceptAll = async (
  scenario: Scenario,
  setId: string,
  principal: UserPrincipal = scenario.admin,
): Promise<readonly AcceptanceOutcome[]> => {
  const summary = await summaryOf(scenario, setId);
  const accepted = await acceptSuggestions(
    principal,
    { git: scenario.git, postgres: scenario.postgres },
    {
      decisions: summary.map((item) => ({
        suggestionId: item.suggestionId,
        expectedTarget: item.target,
      })),
    },
  );
  if (!accepted.ok) throw new Error(`the acceptance was refused: ${String(accepted.error)}`);
  return accepted.value;
};

/** Why one item was refused, or `undefined` when it landed — what most assertions read. */
const refusalOf = (outcome: AcceptanceOutcome): unknown =>
  outcome.outcome.ok ? undefined : outcome.outcome.error;

/** What one item landed, or `undefined` when it was refused. */
const acceptedOf = (outcome: AcceptanceOutcome | undefined): ConceptWritten | undefined =>
  outcome?.outcome.ok === true ? outcome.outcome.value : undefined;

/**
 * Accept a one-item set and hand back what it landed. A test about what an acceptance
 * *does* has no business restating "and it was not refused" in four lines; a test about a
 * refusal calls `acceptAll` above and reads the outcome itself.
 */
const acceptedOne = async (scenario: Scenario, setId: string): Promise<ConceptWritten> => {
  const [outcome] = await acceptAll(scenario, setId);
  if (outcome === undefined) throw new Error("the acceptance returned no outcome");
  const accepted = acceptedOf(outcome);
  if (accepted === undefined) {
    throw new Error(`the acceptance was refused: ${String(refusalOf(outcome))}`);
  }
  return accepted;
};

/**
 * How many rows of one of the act's tables this workspace holds, counted as the superuser
 * so no policy can hide a survivor — the shape every "what did the transaction leave"
 * assertion here reads, written once so two of them cannot ask it differently.
 */
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

/** The whole of one suggestion row, read as the superuser so no policy can hide it. */
const suggestionRow = async (suggestionId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT status, decider, reason, target_iri FROM suggestion WHERE id = $1",
    [suggestionId],
  );
  return found.rows[0];
};

/** The ledger rows one act wrote, in the shape a reader of the queue's history wants. */
const ledgerFor = async (workspaceId: string, act: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT act, subject_id, subject_kind, batch_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY id",
    [workspaceId, act],
  );
  return found.rows;
};

/** A person's own edit committed directly — what a suggestion is later proposed against. */
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
  const written = await writeConcept(
    scenario.editor,
    { git: scenario.git, postgres: scenario.postgres },
    input,
  );
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return { input, written: written.value };
};

/**
 * A concept an Editor committed, and a suggestion proposed against exactly that content —
 * the arrange block every test about an acceptance over an existing concept opens with.
 */
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

/**
 * A waiting suggestion seeded as the row that raised it would be written, kind and proposer
 * named — the arrangement for the two things `submitSuggestionSet` will not do: raise a
 * *repair*, which is the platform's alone, and name a proposer a producer chose. Both reach
 * the row through a definer function both tiers call, so seeding as the superuser is
 * faithful to what a compromised producer could actually write.
 */
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

/** The platform's own citation repair, raised as only the platform may raise one. */
const platformRepair = (scenario: Scenario, request: SuggestionRequest) =>
  seededSuggestion(scenario, request, {
    kind: "repair",
    proposer: "process:better-answers-citation-repair",
  });

/** A person's check of exactly what an act wrote — the check a repair must not un-check. */
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

/** The trust a reader is shown for one concept, through the read the surface will make. */
const trustOf = async (scenario: Scenario, iri: string) => {
  const read = await readingAs(db().runtimePool, scenario.viewer, (principal, tx) =>
    open(principal, tx, { iri }),
  );
  return read.ok && read.value.found ? read.value.concept?.trust : undefined;
};

describe("a suggestion set", () => {
  it("waits with no target at all, because identity is the acceptance's to resolve", async () => {
    const scenario = await arrange();

    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);

    // Nothing platform-prepared reaches the bundle without acceptance (ADR 0012): the set
    // is rows in the inbox and no commit anywhere.
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
    const row = await suggestionRow(set.suggestionIds[0] ?? "");
    expect(row).toMatchObject({ status: "waiting", target_iri: null, decider: null });
  });

  it("re-renders its summary against concept_identity every time it is opened", async () => {
    const scenario = await arrange();
    const request = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [request]);

    // Opened before the concept exists: the merge key names nothing, so an acceptance
    // would mint the IRI.
    const before = await summaryOf(scenario, set.setId);
    expect(before.map((item) => item.target)).toEqual([null]);

    // The same merge key, now held by a concept somebody wrote in between.
    const { written } = await editorWrote(scenario, {
      mergeKey: request.mergeKey,
      path: request.path,
    });

    const after = await summaryOf(scenario, set.setId);
    expect(after.map((item) => item.target)).toEqual([written.iri]);
    // And the payload's own precondition, read the same way: this one was written against
    // no concept at all, so it has not moved — it has been overtaken.
    expect(after.map((item) => item.baseMoved)).toEqual([false]);
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

    // One act, one commit — carrying the `Suggestion:` trailer ADR 0012 fixes, so the
    // bundle's history says which changes came through the gate.
    const facts = await commitFacts(scenario.git, scenario.workspaceId, accepted.sha);
    expect(facts.trailers).toEqual({
      Actor: `human:${scenario.admin.userId}`,
      Audit: accepted.auditEventId,
      Suggestion: set.suggestionIds[0],
    });
    // The rows and the decision, in one transaction: the concept is in the index, the
    // suggestion names the concept it landed on, and the ledger names the suggestion.
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
    // A concept for the suggestion's body to link to, so the delta has both a node and an
    // edge to write and the crossing shows in both tables.
    const { input: cited, written } = await editorWrote(scenario);
    const filename = cited.path.split("/").at(-1) ?? "";
    const set = await submitted(scenario, scenario.editor, "edit", [
      requestFor({ body: `See [the policy](./${filename}) for the rule.` }),
    ]);

    const accepted = await acceptedOne(scenario, set.setId);

    // An acceptance is a governed write like any other, so the bundle-and-record delta is
    // written by the transaction that wrote the rows and decided the suggestion (ADR 0023,
    // ADR 0032) — the accepted concept is in the live generation and its link is an edge,
    // with no second act between the decision and the map.
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

    // ADR 0012's 2026-08-27 amendment: a person's own change is still theirs when somebody
    // else decides it. The accepter is on the audit event, which the trailer above carries.
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
    // A run's candidate, seeded as a run raises one: its proposer is an agent, which is
    // exactly what has no name and address to write on an author line — and a *candidate*
    // has no road through a person's session at all, so this is the only way it arrives.
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
    // A proposer is a string a producer wrote, and the identity set is global by design
    // (ADR 0009): a compromised producer could name any person on the platform. Seeded as
    // one would write it — an *edit* claiming a person of another workspace.
    const spoofed = await seededSuggestion(here, requestFor(), {
      kind: "edit",
      proposer: `human:${elsewhere.editor.userId}`,
    });

    const [outcome] = await acceptAll(here, spoofed.setId);

    // The author is read through this workspace's membership, so a stranger's name and
    // address never reach another tenant's history: the person who let it in is named.
    const facts = await commitFacts(here.git, here.workspaceId, acceptedOf(outcome)?.sha ?? "");
    const person = decider.rows[0];
    expect(facts.author).toBe(`${person?.name} <${person?.email}>`);
    // The address is the identifying half — the factory gives every seeded person the same
    // display name, and an address is what a leak would actually leak.
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

    // Each acceptance act is one governed write and one commit (ADR 0012, user story 3) —
    // never one commit hiding three, and never one ledger row hiding three (`[AUDIT1]`).
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

    // The same IRI, because the merge key resolved to it at the moment of the acceptance.
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
      const refused = await acceptSuggestions(
        principal,
        { git: scenario.git, postgres: scenario.postgres },
        { decisions: [{ suggestionId: set.suggestionIds[0] ?? "", expectedTarget: null }] },
      );
      expect(refused).toEqual({ ok: false, error: "role-forbids" });
    }

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({ status: "waiting" });
  });

  it("answers a suggestion of another workspace exactly as it answers one nobody minted", async () => {
    const here = await arrange();
    const there = await arrange();
    const theirs = await submitted(there, there.editor, "edit", [requestFor()]);

    const reached = await acceptSuggestions(
      here.admin,
      { git: here.git, postgres: here.postgres },
      {
        decisions: [
          { suggestionId: theirs.suggestionIds[0] ?? "", expectedTarget: null },
          { suggestionId: ulid(), expectedTarget: null },
        ],
      },
    );

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
    // Rendered while the merge key named nothing: the summary said *this would mint*.
    const opened = await summaryOf(scenario, set.setId);
    expect(opened.map((item) => item.target)).toEqual([null]);
    // And then somebody wrote the concept that merge key names.
    await editorWrote(scenario, { mergeKey: request.mergeKey, path: request.path });

    const accepted = await acceptSuggestions(
      scenario.admin,
      { git: scenario.git, postgres: scenario.postgres },
      { decisions: [{ suggestionId: set.suggestionIds[0] ?? "", expectedTarget: null }] },
    );

    // Refused, with no commit of its own — and back with whoever prepared it, which is
    // what ADR 0012's "fails loudly and returns to the proposer" means as a state.
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
    // The concept moves under the payload: the base hash it was written against is no
    // longer what the concept says.
    const moved = await writeConcept(
      scenario.editor,
      { git: scenario.git, postgres: scenario.postgres },
      {
        ...input,
        iri: written.iri,
        body: "Expenses are claimed within ninety days.",
        expects: { head: written.sha },
      },
    );
    expect(moved.ok).toBe(true);
    const opened = await summaryOf(scenario, set.setId);
    expect(opened.map((item) => item.baseMoved)).toEqual([true]);

    const accepted = await acceptAll(scenario, set.setId);

    expect(accepted.map(refusalOf)).toEqual(["stale-precondition"]);
    // No commit for it: the base is read before the act reaches git.
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
    // A producer's rejected work is a fact, not a silence (ADR 0012).
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({
      status: "declined",
      reason: "not the company's word on this",
      decider: `human:${scenario.admin.userId}`,
      target_iri: null,
    });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
    // The ledger names the suggestion and the set, and carries no prose (`[AUDIT5]`).
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

  it("refuses a reason longer than the row will carry, before it opens a transaction at all", async () => {
    const scenario = await arrange();
    const set = await submitted(scenario, scenario.editor, "edit", [requestFor()]);
    const suggestionId = set.suggestionIds[0] ?? "";

    const refused = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId,
      reason: "x".repeat(5000),
    });

    // The boundary refuses it where the caller can be told, so nothing is opened and
    // nothing is written. This is **not** the slice's fail-together proof — that one
    // provokes a failure after rows have landed, and it is the acceptance's, below.
    expect(refused).toEqual({ ok: false, error: "malformed" });
    expect(await suggestionRow(suggestionId)).toMatchObject({ status: "waiting" });
    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.declined")).toEqual([]);
  });
});

describe("an acceptance whose transaction fails after it", () => {
  // `[AUDIT1]` and `[TEST8]`: the act's rows, its ledger row and the suggestion's decision
  // land or fail together, so the proof is a failure provoked *after* all three would have
  // landed — and the assertion is on what the transaction left, before the returned value,
  // because Postgres aborts whatever the work does with the caught rejection.
  it("leaves neither the concept, nor its ledger row, nor the suggestion decided", async () => {
    const scenario = await arrange();
    // Two items of one set proposing the same path. The first lands; the second commits —
    // the path is not a pre-commit refusal, because two concepts at one path is a fact only
    // the index knows — and the unique index then refuses the row it landed for.
    const first = requestFor();
    const set = await submitted(scenario, scenario.editor, "edit", [
      first,
      requestFor({ path: first.path }),
    ]);

    const outcomes = await acceptAll(scenario, set.setId);

    // The rows first (`[TEST8]`): one concept, one accepted ledger row, one decision — and
    // the second suggestion untouched, still waiting for somebody to decide it.
    expect(await countOf("concept_index", scenario.workspaceId)).toBe("1");
    // The graph delta is written by that same transaction, so a rolled-back acceptance
    // leaves no node behind either — the map cannot be ahead of the rows it derives from.
    expect(await countOf("graph_node", scenario.workspaceId)).toBe("1");
    expect(await ledgerFor(scenario.workspaceId, "knowledge.suggestion.accepted")).toHaveLength(1);
    expect(await suggestionRow(set.suggestionIds[1] ?? "")).toMatchObject({
      status: "waiting",
      decider: null,
      target_iri: null,
    });
    expect(outcomes.map(refusalOf)).toEqual([undefined, "path-taken"]);
    // And the shape the reconciler is defined to find: a commit ahead of the rows, which is
    // the booked window and not a refusal the platform meant to make.
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(2);
  });
});

describe("the platform's citation repair", () => {
  it("re-hashes the checks it moved, so a repair never turns Checked into Changed since checked", async () => {
    const scenario = await arrange();
    // A concept citing a source by a locator, checked by a person against that content.
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
    // The repair: the locator the source moved to, raised by the platform and decided by an
    // Admin like anything else. It moves the content hash, because a locator is part of
    // what the hash is over.
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

    // The whole point: the check still reads as the person's, and still reads *current*.
    expect(await trustOf(scenario, written.iri)).toMatchObject({
      tier: "human-reviewed",
      status: "current",
      checkedBy: `human:${scenario.editor.userId}`,
    });
    // And the row says a routine moved its hash, rather than pretending the person checked
    // the repaired content (ADR 0019's *erasure-rewrite* twin).
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

    // An ordinary edit moves the content and the check says so: *Changed since checked* is
    // the honest word for a fact somebody rewrote, and only a repair is exempt.
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

    // A repair's acceptance re-points every standing check at the content it wrote, so a
    // person who could raise one could make somebody else's check vouch for content they
    // never saw — an Admin's click being the only thing between. Even the Admin is refused.
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

/**
 * **The two ways a suggestion's ground moves under an acceptance**, driven as they actually
 * interleave. Both acts take the bundle's lock, so the concurrent case runs one after the
 * other whichever way the runner schedules it — and the claim is that the loser is refused
 * *before it commits*, because a commit whose `Suggestion:` trailer named a decided
 * suggestion is an orphan the reconciler would land.
 */
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

    // Exactly one of them decided it; the bundle carries a commit if and only if the
    // acceptance was the one — never a commit for a suggestion that was declined; and the
    // loser hears `already-decided`, because the act it lost to had already committed its
    // decision before the loser read it.
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

    // One concept, one commit, one ledger row — and the loser refused rather than left with
    // a commit nothing records. Both minted an IRI of their own, so nothing but the read
    // inside the lock could have stopped the second.
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

    // A *new* concept claiming a merge key that already belongs to one. The unique index
    // would refuse it either way; the point of reading it before the commit is that there
    // is no commit left over — an acceptance that reached git and then failed would leave
    // the reconciler an orphan to replay.
    const clash = await writeConcept(scenario.editor, doorsOf(scenario), {
      ...input,
      path: "knowledge/second.md",
      expects: { head: null },
    });

    expect(clash).toEqual({ ok: false, error: "merge-key-taken" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(1);
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

    // A summary names every item's title, path and merge key, none of it filtered by what
    // the reader may see — so a Viewer who could open any set would learn that a concept
    // withheld from them exists, which `open` by IRI is built never to say.
    expect(byAdmin.ok && byAdmin.value).toHaveLength(1);
    expect(byProposer.ok && byProposer.value).toHaveLength(1);
    expect(byStranger).toEqual({ ok: false, error: "role-forbids" });
  });

  it("shows a proposer no resolution they may not read, and the deciding Admin the one they must", async () => {
    const scenario = await arrange();
    // A concept its proposer cannot read: *Restricted* reaches Admins and named members,
    // and the Editor here is neither.
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

    // The proposer sees their own item, and it reads exactly as one whose merge key names
    // no concept at all: no target, and a base that has "moved" because there is nothing
    // there to have written it against. So a withheld concept's existence is not a fact
    // the inbox hands out (user story 13).
    expect(byProposer.ok && byProposer.value.map((item) => [item.target, item.baseMoved])).toEqual([
      [null, true],
    ]);
    // The Admin is the one deciding, and the target is what they would be writing onto.
    expect(byAdmin.ok && byAdmin.value.map((item) => [item.target, item.baseMoved])).toEqual([
      [written.iri, false],
    ]);
  });
});

describe("what a write may not do with an IRI", () => {
  it("refuses a write naming an IRI this workspace never minted, and makes no commit", async () => {
    const scenario = await arrange();

    const refused = await writeConcept(
      scenario.editor,
      { git: scenario.git, postgres: scenario.postgres },
      {
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
      },
    );

    // ADR 0002: the key is never caller-settable, and the refusal costs no commit.
    expect(refused).toEqual({ ok: false, error: "no-such-concept" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual([]);
  });
});

/**
 * The act's own gates, read at the act and not at the road that reached it.
 * `acceptSuggestions` is one caller of `writeConcept` and the reconciler's replay will be
 * another, so what makes a write an acceptance — an Admin's authority, the payload's base
 * as its precondition, and a merge key that still resolves to the target it names — is
 * checked inside the act, where every road passes.
 */
describe("an acceptance reached straight through the write path", () => {
  /** The acceptance `acceptSuggestions` would hand the act, with one thing about it moved. */
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

  /**
   * What a refused acceptance leaves behind: the commits the arrange block made and no
   * more, and a suggestion still waiting for somebody to decide it. Every refusal here
   * asserts the same two facts, and asserting them two ways would be two claims.
   */
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

    // An Editor may commit their own change all day; what they may not do is decide
    // somebody else's, which is the gate ADR 0012 puts in front of the bundle.
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

    // The two preconditions are not interchangeable: a suggestion is decided against the
    // content its payload was written against (ADR 0012's 2026-08-27 amendment), and an
    // acceptance holding the ref instead would land a payload over content that moved.
    expect(refused).toEqual({ ok: false, error: "malformed" });
    await leftWaiting(scenario, set, 1);
  });

  it("refuses one whose named target no longer answers to the merge key it was proposed under", async () => {
    const scenario = await arrange();
    const { input, written, set } = await proposedAgainst(scenario, "edit");

    // The concept moves onto another merge key, carrying exactly the content the payload
    // was written against — so the base precondition still holds and the *only* thing that
    // moved is the resolution. Accepting here would put the old key back on the concept and
    // undo a move nobody asked to undo.
    const moved = await writeConcept(scenario.editor, doorsOf(scenario), {
      ...input,
      iri: written.iri,
      mergeKey: `${input.mergeKey}-renamed`,
      expects: { head: written.sha },
    });
    expect(moved.ok).toBe(true);

    const refused = await writeConcept(
      scenario.admin,
      doorsOf(scenario),
      acceptanceOf(input, written, set),
    );

    expect(refused).toEqual({ ok: false, error: "resolution-moved" });
    // The write and the move, and nothing from the acceptance: the resolution is read
    // under this act's own lock, before there is a commit to leave behind.
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

    // Not the row's CHECK escaping as this act's answer: a caller told `malformed` knows
    // what they sent was wrong, where a raw constraint error is the store's failure.
    expect(set).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses a payload whose frontmatter is not a mapping, and queues nothing", async () => {
    const scenario = await arrange();

    const set = await submitSuggestionSet(
      scenario.editor,
      { postgres: scenario.postgres },
      {
        kind: "edit",
        // @ts-expect-error — a payload is the file an acceptance would commit, and JSON's
        // null is not one; the runtime half of what the type says.
        requests: [requestFor({ frontmatter: null })],
      },
    );

    // The column would take it — `jsonb` holds JSON null — and the write path would then
    // read its keys and throw, which is a refusal nobody can act on arriving where an
    // acceptance was expected. Refused while it is still a proposal, and nothing queued.
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
      // A *candidate* is what a run found, and a *repair* is the platform running its own
      // citation repair — accepting one re-points every standing check at the content it
      // wrote, so a person raising one could make somebody else's check vouch for content
      // they never saw. Neither has a road through a session, an Admin's included.
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

    // The request's own shape, through the boundary before any work: an id the minter never
    // made, a target that is a path rather than an IRI, and a call that meant to say
    // something. None of them reaches a store to be refused in the store's words.
    expect(asked).toEqual([
      { ok: false, error: "malformed" },
      { ok: false, error: "malformed" },
      { ok: false, error: "malformed" },
    ]);
    expect(await suggestionRow(set.suggestionIds[0] ?? "")).toMatchObject({ status: "waiting" });
  });
});
