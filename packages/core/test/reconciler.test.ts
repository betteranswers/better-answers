import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import {
  acceptSuggestions,
  contentHashOf,
  declineSuggestion,
  parseConceptFile,
  reconcile,
  reconcileEveryWorkspace,
  RECONCILER,
  reconcilerHits,
  renderConceptFile,
  submitSuggestionSet,
  suggestionSetSummary,
  writeConcept,
  type Frontmatter,
  type Reconciled,
  type SuggestionRequest,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import { actorIdOf, type UserPrincipal } from "../src/kernel/index.ts";
import { commit, withRepositoryLock } from "@better-answers/core/store/git";
import {
  bundleHistory,
  commitFacts,
  divergeHistory,
  fileAtCommit,
  removeRepository,
} from "./bundle.ts";
import { readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * The reconciler through the concepts slice's entry point (`[TEST1]`), against real
 * Postgres and a real bare repository: the crash window between a governed write's commit
 * and its rows made **recoverable**, not merely detectable (ADR 0012's 2026-09-06
 * amendment; T-006 spec, *The reconciler*).
 *
 * Every head-ahead state here is provoked **through the live handler**: a trigger the test
 * installs on `bundle_commit` makes the act's own transaction fail after its commit has
 * landed, which is the window's shape exactly — git one commit ahead of what Postgres knows,
 * no partial rows — with no hook inside the act. The claims are that the replay lands what
 * the act would have, oldest first and in order, that it is idempotent on the trailer ids,
 * that it is the platform's act and never a person's, and that both kinds of governed write
 * come back: a person's own commit and an Admin's acceptance.
 */

const { db, arrange } = suiteWithBundles();

let written = 0;

/** A person's write, each one its own concept: a Guideline, titled for the test that made it. */
const guideline = (
  title: string,
  overrides: Partial<WriteConceptInput> = {},
): WriteConceptInput => {
  written += 1;
  return {
    mergeKey: `guideline:${title.toLowerCase()}-${written}`,
    path: `knowledge/guidelines/${title.toLowerCase()}-${written}.md`,
    kind: "Guideline",
    title,
    frontmatter: { title, type: "Guideline", tags: ["finance", "travel"] },
    body: `# ${title}\n\nBook through the platform, and claim within a month.`,
    message: `Record the ${title.toLowerCase()} guideline`,
    author: { name: "Grace Editor", email: "grace@acme.invalid" },
    expects: { head: null },
    status: "stable",
    sensitivity: "Internal",
    ...overrides,
  };
};

const landed = async (scenario: Scenario, principal: UserPrincipal, input: WriteConceptInput) => {
  const result = await writeConcept(principal, doorsOf(scenario), input);
  if (!result.ok) throw new Error(`the write was refused: ${String(result.error)}`);
  return result.value;
};

/**
 * The crash window, opened on purpose: while this stands, every `bundle_commit` insert is
 * refused, so an act commits to the bundle and then loses its whole transaction — the ledger
 * row, the index row, the commit row and the delta together. Removed by the function it
 * hands back, after which the rows can land again.
 */
const openTheWindow = async (): Promise<() => Promise<void>> => {
  await db().pool.query(
    `CREATE FUNCTION crash_in_the_window() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN RAISE EXCEPTION 'the process died between the commit and its rows'; END $$`,
  );
  await db().pool.query(
    "CREATE TRIGGER crash_in_the_window BEFORE INSERT ON bundle_commit FOR EACH ROW EXECUTE FUNCTION crash_in_the_window()",
  );
  return async () => {
    await db().pool.query("DROP TRIGGER crash_in_the_window ON bundle_commit");
    await db().pool.query("DROP FUNCTION crash_in_the_window()");
  };
};

/** An act made inside the window: its commit lands, its rows do not, and the act says so. */
const inTheWindow = async <T extends { readonly ok: boolean }>(
  act: () => Promise<T>,
): Promise<T> => {
  const close = await openTheWindow();
  try {
    return await act();
  } finally {
    await close();
  }
};

/** A person's write made inside the window, and the bundle's history once it has closed. */
const writeInTheWindow = async (
  scenario: Scenario,
  principal: UserPrincipal,
  input: WriteConceptInput,
): Promise<readonly string[]> => {
  const refused = await inTheWindow(() => writeConcept(principal, doorsOf(scenario), input));
  expect(refused.ok).toBe(false);
  return bundleHistory(scenario.git, scenario.workspaceId);
};

const reconciled = async (scenario: Scenario): Promise<Reconciled> => {
  const result = await reconcile(RECONCILER, doorsOf(scenario), {
    workspaceId: scenario.workspaceId,
  });
  if (!result.ok) throw new Error(`the reconciler refused: ${String(result.error)}`);
  return result.value;
};

/** The chain `bundle_commit` records, oldest first: each commit with the parent it names. */
const recordedChain = async (
  workspaceId: string,
): Promise<readonly (readonly [string, string | null])[]> => {
  const rows = await db().pool.query<{ sha: string; parent_sha: string | null }>(
    "SELECT sha, parent_sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha",
    [workspaceId],
  );
  return rows.rows.map((row) => [row.sha, row.parent_sha] as const);
};

/**
 * Everything a replay lands, read as the superuser so no policy hides a row — one list, so
 * "a second run changed nothing" is one comparison over every table the act touches.
 */
const rowsOf = async (workspaceId: string) => {
  const read = await db().pool.query<{ kind: string; key: string; value: string }>(
    `SELECT 'identity' AS kind, iri AS key, merge_key AS value
       FROM concept_identity WHERE workspace_id = $1
     UNION ALL
     SELECT 'concept', iri, concat_ws(' ', content_hash, commit_sha, status, sensitivity, path)
       FROM concept_index WHERE workspace_id = $1
     UNION ALL
     SELECT 'commit', sha, concat_ws(' ', parent_sha, audit_event_id, actor)
       FROM bundle_commit WHERE workspace_id = $1
     UNION ALL
     SELECT 'event', id, concat_ws(' ', act, actor, subject_id, detail::text)
       FROM audit_event WHERE workspace_id = $1
     UNION ALL
     SELECT 'node', uid, concat_ws(' ', kind, gen::text) FROM graph_node WHERE workspace_id = $1
     UNION ALL
     SELECT 'edge', uid, concat_ws(' ', from_uid, to_uid) FROM graph_edge WHERE workspace_id = $1
     UNION ALL
     SELECT 'suggestion', id, concat_ws(' ', status, decider, target_iri)
       FROM suggestion WHERE workspace_id = $1
     ORDER BY 1, 2`,
    [workspaceId],
  );
  return read.rows;
};

/** The ledger rows the reconciler wrote, in the shape a reader of the signal wants. */
const replayedEvents = async (workspaceId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT id, actor, subject_id, subject_kind, batch_id, detail FROM audit_event WHERE workspace_id = $1 AND act = 'platform.reconciler.replayed' ORDER BY id",
    [workspaceId],
  );
  return found.rows;
};

/** The IRI a commit's file carries — the one identity a commit does carry. */
const iriOfFile = async (scenario: Scenario, sha: string, path: string): Promise<string> => {
  const parsed = parseConceptFile(
    await fileAtCommit(scenario.git, scenario.workspaceId, sha, path),
  );
  if (!parsed.ok) throw new Error("the file at the commit is not a concept file");
  const iri = parsed.value.frontmatter["iri"];
  if (typeof iri !== "string") throw new Error("the file carries no IRI");
  return iri;
};

const conceptRow = async (workspaceId: string, iri: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    `SELECT c.path, c.kind, c.title, c.content_hash, c.commit_sha, c.status, c.sensitivity,
            c.audience, i.merge_key
       FROM concept_index c
       JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
      WHERE c.workspace_id = $1 AND c.iri = $2`,
    [workspaceId, iri],
  );
  return found.rows[0];
};

/** What became of one suggestion: its status, who decided it, and what it landed on. */
const decisionOf = async (suggestionId: string) => {
  const found = await db().pool.query<Record<string, unknown>>(
    "SELECT status, decider, reason, target_iri FROM suggestion WHERE id = $1",
    [suggestionId],
  );
  return found.rows[0];
};

describe("a commit whose rows were lost", () => {
  it("is replayed through the live handler, and the rows catch up with the bundle", async () => {
    const scenario = await arrange();
    const input = guideline("Travel");
    const history = await writeInTheWindow(scenario, scenario.editor, input);
    // The window's shape, before anything is recovered: one commit, no rows at all.
    expect(history).toHaveLength(1);
    expect(await recordedChain(scenario.workspaceId)).toEqual([]);
    const sha = history[0] ?? "";
    const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);

    const run = await reconciled(scenario);

    expect(run).toEqual({
      workspaceId: scenario.workspaceId,
      head: sha,
      watermark: null,
      replayed: [sha],
      skipped: [],
      stopped: undefined,
    });
    // What the act would have landed: the identity, the index row at the commit, the commit
    // row joined to the ledger on the trailer's id, and the concept on the map.
    expect(await recordedChain(scenario.workspaceId)).toEqual([[sha, null]]);
    const iri = await iriOfFile(scenario, sha, input.path);
    expect(await conceptRow(scenario.workspaceId, iri)).toEqual({
      path: input.path,
      kind: "Guideline",
      title: "Travel",
      content_hash: contentHashOf(input.frontmatter, input.body, input.path),
      commit_sha: sha,
      // The file carries the status the act named, so the replay reads it back.
      status: "stable",
      // The class is not in the commit, so the replay lands the most restrictive of the
      // three: a widening is an Admin's recorded act, never a recovery's guess.
      sensitivity: "Restricted",
      audience: "everyone",
      // Nor is the merge key: a person's creation carries none, so ADR 0003's derivation
      // — the kind and the normalised title — is what the identity row gets.
      merge_key: "Guideline:travel",
    });
    const commitRow = await db().pool.query<Record<string, unknown>>(
      "SELECT parent_sha, audit_event_id, actor FROM bundle_commit WHERE workspace_id = $1 AND sha = $2",
      [scenario.workspaceId, sha],
    );
    expect(commitRow.rows).toEqual([
      { parent_sha: null, audit_event_id: facts.trailers["Audit"], actor: facts.trailers["Actor"] },
    ]);
    const nodes = await db().pool.query<{ uid: string }>(
      "SELECT uid FROM graph_node WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(nodes.rows).toEqual([{ uid: iri }]);
  });

  it("is the platform's act on the ledger, while the commit and its row stay the person's", async () => {
    const scenario = await arrange();
    const history = await writeInTheWindow(scenario, scenario.editor, guideline("Leave"));
    const sha = history[0] ?? "";

    await reconciled(scenario);

    // The git author and the `Actor:` trailer are the person's, as the act wrote them; the
    // ledger row is the reconciler's own — under the commit's `Audit:` id, so the commit row
    // and the ledger still join on one id (ADR 0014 rule 4) — and no row of the person's
    // act exists, because that act never landed and the replay is not a re-authorization.
    const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);
    expect(facts.author).toBe("Grace Editor <grace@acme.invalid>");
    expect(facts.trailers["Actor"]).toBe(actorIdOf(scenario.editor));
    const iri = await iriOfFile(scenario, sha, "knowledge/guidelines/leave-2.md");
    expect(await replayedEvents(scenario.workspaceId)).toEqual([
      {
        id: facts.trailers["Audit"],
        actor: "process:better-answers-reconciler",
        subject_id: sha,
        subject_kind: "reconciler",
        batch_id: null,
        detail: {
          iri,
          commitSha: sha,
          contentHash: contentHashOf(
            { title: "Leave", type: "Guideline", tags: ["finance", "travel"] },
            "# Leave\n\nBook through the platform, and claim within a month.",
            "knowledge/guidelines/leave-2.md",
          ),
        },
      },
    ]);
    const joined = await db().pool.query<{ act: string; actor: string }>(
      `SELECT e.act, e.actor FROM bundle_commit c
         JOIN audit_event e ON e.workspace_id = c.workspace_id AND e.id = c.audit_event_id
        WHERE c.workspace_id = $1 AND c.sha = $2`,
      [scenario.workspaceId, sha],
    );
    expect(joined.rows).toEqual([
      { act: "platform.reconciler.replayed", actor: "process:better-answers-reconciler" },
    ]);
    const booked = await db().pool.query(
      "SELECT 1 FROM audit_event WHERE workspace_id = $1 AND actor = $2 AND act LIKE 'knowledge.%'",
      [scenario.workspaceId, actorIdOf(scenario.editor)],
    );
    expect(booked.rowCount).toBe(0);
  });

  it("is replayed in order, oldest first, with the writes made on the unrecorded head behind it", async () => {
    const scenario = await arrange();
    const [orphan = null] = await writeInTheWindow(
      scenario,
      scenario.editor,
      guideline("Sickness"),
    );

    // The window has closed and a person writes on. Their commit lands on the orphan and
    // their rows are refused by the parent key — a row may not name a commit the rows do not
    // know — so the write joins the missed suffix rather than landing ahead of it, and the
    // caller hears the store's own failure, never a refusal word.
    const behind = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      guideline("Overtime", { expects: { head: orphan } }),
    );
    expect(behind.ok === false && behind.error instanceof Error).toBe(true);
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(2);
    expect(await recordedChain(scenario.workspaceId)).toEqual([]);

    const run = await reconciled(scenario);

    expect(run).toMatchObject({ watermark: null, replayed: history, skipped: [] });
    expect(await recordedChain(scenario.workspaceId)).toEqual([
      [history[0], null],
      [history[1], history[0]],
    ]);
    // Two commits in one run: one bulk act, N rows sharing one batch id (`[AUDIT1]`).
    const events = await replayedEvents(scenario.workspaceId);
    expect(events.map((event) => event["subject_id"])).toEqual(history);
    expect(new Set(events.map((event) => event["batch_id"])).size).toBe(1);
    expect(events[0]?.["batch_id"]).not.toBeNull();
  });

  it("changes nothing on a second run, and skips a commit whose trailer id already has its rows whatever the watermark says", async () => {
    const scenario = await arrange();
    const first = await landed(scenario, scenario.editor, guideline("Expenses"));
    const history = await writeInTheWindow(
      scenario,
      scenario.editor,
      guideline("Mileage", { expects: { head: first.sha } }),
    );
    const orphan = history[1] ?? "";
    await reconciled(scenario);
    const before = await rowsOf(scenario.workspaceId);

    const again = await reconciled(scenario);

    expect(again).toMatchObject({ watermark: orphan, replayed: [], skipped: [] });
    expect(await rowsOf(scenario.workspaceId)).toEqual(before);

    // The watermark misled: the replayed commit's row made to read as older than the one
    // before it, so the scan starts one commit early and meets a commit that already has
    // its rows. Idempotency is the trailer id's and not the watermark's — skipped, never
    // re-written, never an error.
    await db().pool.query(
      "UPDATE bundle_commit SET committed_at = committed_at - interval '1 day' WHERE workspace_id = $1 AND sha = $2",
      [scenario.workspaceId, orphan],
    );
    const misled = await reconciled(scenario);

    expect(misled).toMatchObject({ watermark: first.sha, replayed: [], skipped: [orphan] });
    expect(await rowsOf(scenario.workspaceId)).toEqual(before);
  });
});

describe("a re-write whose rows were lost", () => {
  it("keeps the concept's identity, class and status, and lands the new content at the commit", async () => {
    const scenario = await arrange();
    const input = guideline("Parking");
    const first = await landed(scenario, scenario.editor, input);
    const body = "# Parking\n\nClaim the station car park, and nothing else.";
    const history = await writeInTheWindow(scenario, scenario.editor, {
      ...input,
      iri: first.iri,
      body,
      expects: { head: first.sha },
    });

    const run = await reconciled(scenario);

    expect(run).toMatchObject({ watermark: first.sha, replayed: [history[1]] });
    // The merge key and the class are the concept's own — read off the row the creation
    // landed, never derived again — and the content is the commit's.
    expect(await conceptRow(scenario.workspaceId, first.iri)).toEqual({
      path: input.path,
      kind: "Guideline",
      title: "Parking",
      content_hash: contentHashOf(input.frontmatter, body, input.path),
      commit_sha: history[1],
      status: "stable",
      sensitivity: "Internal",
      audience: "everyone",
      merge_key: input.mergeKey,
    });
    const counted = await db().pool.query<{ concepts: string; identities: string }>(
      `SELECT (SELECT count(*) FROM concept_index WHERE workspace_id = $1)::text AS concepts,
              (SELECT count(*) FROM concept_identity WHERE workspace_id = $1)::text AS identities`,
      [scenario.workspaceId],
    );
    expect(counted.rows).toEqual([{ concepts: "1", identities: "1" }]);
  });
});

let proposed = 0;

/** One suggestion's payload: a Guideline of its own, titled for the test that raised it. */
const requestFor = (
  title: string,
  overrides: Partial<SuggestionRequest> = {},
): SuggestionRequest => {
  proposed += 1;
  return {
    mergeKey: `guideline:proposed-${proposed}`,
    path: `knowledge/guidelines/proposed-${proposed}.md`,
    conceptKind: "Guideline",
    title,
    frontmatter: { title, type: "Guideline" },
    body: `# ${title}\n\nProposed by a colleague, decided by an Admin.`,
    ...overrides,
  };
};

/** A person's *edit* raised and opened: the one suggestion's id, and what its summary resolved. */
const raised = async (scenario: Scenario, request: SuggestionRequest) => {
  const set = await submitSuggestionSet(
    scenario.editor,
    { postgres: scenario.postgres },
    { kind: "edit", requests: [request] },
  );
  if (!set.ok) throw new Error(`the set was not submitted: ${String(set.error)}`);
  const summary = await readingAs(db().runtimePool, scenario.admin, (principal, tx) =>
    suggestionSetSummary(principal, tx, set.value.setId),
  );
  if (!summary.ok) throw new Error(`the set did not render: ${String(summary.error)}`);
  const item = summary.value[0];
  if (item === undefined) throw new Error("the set rendered no item");
  return { suggestionId: item.suggestionId, target: item.target };
};

/** The Admin's acceptance, made inside the window: its commit lands, its rows do not. */
const acceptInTheWindow = async (
  scenario: Scenario,
  item: { readonly suggestionId: string; readonly target: string | null },
): Promise<string> => {
  const outcomes = await inTheWindow(() =>
    acceptSuggestions(scenario.admin, doorsOf(scenario), {
      decisions: [{ suggestionId: item.suggestionId, expectedTarget: item.target }],
    }),
  );
  expect(outcomes.ok && outcomes.value.map((outcome) => outcome.outcome.ok)).toEqual([false]);
  // The window's shape for an acceptance: a commit carrying the `Suggestion:` trailer, and
  // a suggestion still waiting for the decision the transaction lost.
  const history = await bundleHistory(scenario.git, scenario.workspaceId);
  const sha = history.at(-1) ?? "";
  const facts = await commitFacts(scenario.git, scenario.workspaceId, sha);
  expect(facts.trailers["Suggestion"]).toBe(item.suggestionId);
  expect(await decisionOf(item.suggestionId)).toMatchObject({ status: "waiting" });
  return sha;
};

describe("an acceptance whose rows were lost", () => {
  it("is replayed: the concept lands, and the suggestion is decided by the Admin who accepted it", async () => {
    const scenario = await arrange();
    const request = requestFor("Remote working");
    const item = await raised(scenario, request);
    const sha = await acceptInTheWindow(scenario, item);

    const run = await reconciled(scenario);

    expect(run).toMatchObject({ replayed: [sha], stopped: undefined });
    // The decision lands through the same rows and the same marker as the live act, from
    // the payload the decision was made from: the merge key is the payload's, the decider
    // the Admin the `Actor:` trailer names, and the target the concept the commit minted.
    const iri = await iriOfFile(scenario, sha, request.path);
    expect(await decisionOf(item.suggestionId)).toEqual({
      status: "accepted",
      decider: actorIdOf(scenario.admin),
      reason: null,
      target_iri: iri,
    });
    expect(await conceptRow(scenario.workspaceId, iri)).toMatchObject({
      path: request.path,
      kind: "Guideline",
      title: "Remote working",
      merge_key: request.mergeKey,
      content_hash: contentHashOf(request.frontmatter, request.body, request.path),
    });
    // The ledger row is the reconciler's; the acceptance's own row never existed.
    expect(await replayedEvents(scenario.workspaceId)).toHaveLength(1);
    const accepted = await db().pool.query(
      "SELECT 1 FROM audit_event WHERE workspace_id = $1 AND act = 'knowledge.suggestion.accepted'",
      [scenario.workspaceId],
    );
    expect(accepted.rowCount).toBe(0);
  });

  it("lands one whose suggestion was declined in the meantime as the commit it is, and leaves the decision where it was", async () => {
    const scenario = await arrange();
    const request = requestFor("Hot desking");
    const item = await raised(scenario, request);
    const sha = await acceptInTheWindow(scenario, item);
    // Between the crash and the replay, an Admin declines what the lost transaction would
    // have accepted: the row is still waiting, so the decline lands.
    const declined = await declineSuggestion(scenario.admin, doorsOf(scenario), {
      suggestionId: item.suggestionId,
      reason: "decided again after the outage",
    });
    expect(declined.ok).toBe(true);

    const run = await reconciled(scenario);

    // The bundle holds the file, so the rows hold the concept — a map that disagreed with
    // the bundle would be the one thing derived rows must never be — while the decision is
    // the one somebody made, not re-made: no payload was left to decide from.
    expect(run).toMatchObject({ replayed: [sha], stopped: undefined });
    expect(await decisionOf(item.suggestionId)).toMatchObject({
      status: "declined",
      reason: "decided again after the outage",
      target_iri: null,
    });
    const iri = await iriOfFile(scenario, sha, request.path);
    expect(await conceptRow(scenario.workspaceId, iri)).toMatchObject({
      title: "Hot desking",
      // No payload and no concept to read a key off: ADR 0003's derivation.
      merge_key: "Guideline:hot desking",
    });
  });
});

describe("what the reconciler refuses", () => {
  it("refuses a bundle whose recorded history is not a prefix of its own, and lands nothing", async () => {
    const scenario = await arrange();
    await landed(scenario, scenario.editor, guideline("Uniform"));
    const before = await rowsOf(scenario.workspaceId);
    await divergeHistory(scenario.git, scenario.workspaceId);

    const refused = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    // A repository and a database that disagree about the past: no replay makes that right,
    // and pretending the recorded commit was never there would be a hole scan by another name.
    expect(refused).toEqual({ ok: false, error: "history-diverged" });
    expect(await rowsOf(scenario.workspaceId)).toEqual(before);
  });

  it("refuses a workspace with no repository, which on a restore is a store that was not restored", async () => {
    const scenario = await arrange();
    await removeRepository(scenario.git, scenario.workspaceId);

    const refused = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    expect(refused).toEqual({ ok: false, error: "no-such-repository" });
  });

  it("refuses a workspace id of no known form before it opens anything", async () => {
    const scenario = await arrange();

    const refused = await reconcile(RECONCILER, doorsOf(scenario), { workspaceId: "acme" });

    expect(refused).toEqual({ ok: false, error: "malformed" });
  });

  it("finds nothing to do for a bundle with no commits, and for one whose rows are up to date", async () => {
    const scenario = await arrange();

    const empty = await reconciled(scenario);
    const first = await landed(scenario, scenario.editor, guideline("Bicycles"));
    const current = await reconciled(scenario);

    expect(empty).toMatchObject({ head: null, watermark: null, replayed: [], skipped: [] });
    expect(current).toMatchObject({
      head: first.sha,
      watermark: first.sha,
      replayed: [],
      skipped: [],
    });
  });
});

describe("a commit the rows cannot take", () => {
  it("stops the replay there with its ledger row rolled back, and lands nothing behind it", async () => {
    const scenario = await arrange();
    const first = guideline("Fuel");
    const written = await landed(scenario, scenario.editor, first);
    // T-052's own crash shape: a second concept at a path the index already holds commits,
    // and the path index refuses its row — the one post-commit refusal the live act makes,
    // and a commit no replay can land, because the index refuses the same row again.
    const clash = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      guideline("Fuel again", { path: first.path, expects: { head: written.sha } }),
    );
    expect(clash).toEqual({ ok: false, error: "path-taken" });
    const [, orphan = null] = await bundleHistory(scenario.git, scenario.workspaceId);
    // And a person writes on behind it, refused by the parent key as before.
    const behind = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      guideline("Tolls", { expects: { head: orphan } }),
    );
    expect(behind.ok).toBe(false);
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    expect(history).toHaveLength(3);
    const before = await rowsOf(scenario.workspaceId);

    const run = await reconciled(scenario);

    // Stopped at the commit the index refuses, with the sha and the refusal word a person
    // can act on; nothing after it attempted, because its row would name an unrecorded
    // parent. `[TEST8]`, `[AUDIT1]`: the ledger row was written before the index refused,
    // and rolled back with the act rather than never reached.
    expect(run).toEqual({
      workspaceId: scenario.workspaceId,
      head: history[2],
      watermark: written.sha,
      replayed: [],
      skipped: [],
      stopped: { sha: history[1], reason: "path-taken" },
    });
    expect(await rowsOf(scenario.workspaceId)).toEqual(before);
    expect(await replayedEvents(scenario.workspaceId)).toEqual([]);
  });

  it("stops at a commit the governed write did not make, rather than guessing what it meant", async () => {
    const scenario = await arrange();
    // A commit through the door itself, carrying a file outside the renderer's grammar.
    const made = await commit(scenario.editor, scenario.git, {
      path: "knowledge/manifest.yaml",
      content: "name: acme\n",
      message: "Seed the manifest by hand",
      author: { name: "Grace Editor", email: "grace@acme.invalid" },
      trailers: { actor: actorIdOf(scenario.editor), audit: ulid() },
      expectedHead: null,
    });
    expect(made.ok).toBe(true);

    const run = await reconciled(scenario);

    expect(run.stopped).toEqual({
      sha: made.ok ? made.value.sha : "",
      reason: "unreadable-commit",
    });
    expect(await recordedChain(scenario.workspaceId)).toEqual([]);
  });
});

describe("the fence", () => {
  it("waits behind a live act on the same bundle, so a replay and a write are one after the other", async () => {
    const scenario = await arrange();
    const order: string[] = [];
    const act = withRepositoryLock(scenario.editor, scenario.git, async () => {
      order.push("act in");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("act out");
    });
    const run = reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    }).then(() => order.push("reconciler out"));

    await Promise.all([act, run]);

    // One registry for both entries: the reconciler's lock is the live write's lock, which
    // is what keeps the prefix invariant true through a replay.
    expect(order).toEqual(["act in", "act out", "reconciler out"]);
  });
});

describe("the periodic head check's pass", () => {
  it("reconciles every workspace, each on its own outcome", async () => {
    const behind = await arrange();
    const current = await arrange();
    const missing = await arrange();
    await removeRepository(missing.git, missing.workspaceId);
    const history = await writeInTheWindow(behind, behind.editor, guideline("Lunch"));

    const pass = await reconcileEveryWorkspace(RECONCILER, doorsOf(behind));

    expect(pass.ok).toBe(true);
    if (!pass.ok) return;
    const outcomes = new Map(pass.value.map((outcome) => [outcome.workspaceId, outcome.outcome]));
    expect(outcomes.get(behind.workspaceId)).toMatchObject({
      ok: true,
      value: { replayed: history },
    });
    expect(outcomes.get(current.workspaceId)).toMatchObject({
      ok: true,
      value: { head: null, replayed: [] },
    });
    // One bundle's refusal is that bundle's fact, and the others were not left behind.
    expect(outcomes.get(missing.workspaceId)).toEqual({ ok: false, error: "no-such-repository" });
  });
});

describe("reconciler hits", () => {
  it("are a query over the ledger rows the replay wrote — oldest first, from an instant when one is named — and never a counter", async () => {
    const scenario = await arrange();
    const [first = ""] = await writeInTheWindow(scenario, scenario.editor, guideline("Bikes"));
    const history = await writeInTheWindow(
      scenario,
      scenario.editor,
      guideline("Trains", { expects: { head: first } }),
    );
    // Nothing has been replayed, so there is nothing to count: the signal reads zero rows.
    expect(await reconcilerHits(RECONCILER, scenario.postgres, scenario)).toEqual({
      ok: true,
      value: [],
    });

    await reconciled(scenario);

    const hits = await reconcilerHits(RECONCILER, scenario.postgres, scenario);
    expect(hits.ok).toBe(true);
    if (!hits.ok) return;
    // One hit per commit landed, keyed by the commit's own `Audit:` id, sharing the run's batch.
    expect(hits.value.map((hit) => hit.commitSha)).toEqual(history);
    const facts = await commitFacts(scenario.git, scenario.workspaceId, first);
    expect(hits.value[0]?.auditEventId).toBe(facts.trailers["Audit"]);
    expect(hits.value[0]?.batchId).not.toBeNull();
    expect(hits.value[1]?.batchId).toBe(hits.value[0]?.batchId);
    // From an instant after the run: the rows are all older, so the window holds none.
    const later = new Date(Date.now() + 60_000);
    expect(
      await reconcilerHits(RECONCILER, scenario.postgres, { ...scenario, since: later }),
    ).toEqual({ ok: true, value: [] });
    expect(await reconcilerHits(RECONCILER, scenario.postgres, { workspaceId: "nope" })).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});

describe("a concept file read back", () => {
  it("reads back exactly what the renderer wrote, in every shape the frontmatter takes", () => {
    const frontmatter: Frontmatter = {
      title: 'Say "hello": a title',
      type: "Policy",
      count: 3,
      ratio: 0.5,
      live: true,
      gone: null,
      tags: ["a: b", "  - c"],
      none: [],
      sources: [
        { resource: "/sources/handbook.pdf", title: "Handbook", locator: "p.4" },
        { resource: "https://x.test/y", locator: null, pages: 2, checked: false },
      ],
      "odd: key": "value",
    };
    const body = "# Heading\n\nA line.  \r\nAnother.\n\n\n";

    const read = parseConceptFile(renderConceptFile(frontmatter, body));

    // The body comes back as the renderer normalised it, which is what the hash is over.
    expect(read).toEqual({
      ok: true,
      value: { frontmatter, body: "# Heading\n\nA line.\nAnother.\n" },
    });
    expect(read.ok && contentHashOf(read.value.frontmatter, read.value.body, "k/a.md")).toBe(
      contentHashOf(frontmatter, body, "k/a.md"),
    );
  });

  it.each([
    ["no fences at all", "title: bare\n\nbody\n"],
    ["a bare YAML key", '---\ntitle: bare\n"type": "Policy"\n---\n\nbody\n'],
    ["no blank line after the fence", '---\n"title": "x"\n---\nbody\n'],
    ["a list mixing strings and entries", '---\n"tags":\n  - "a"\n  - "k": 1\n---\n\n'],
    ["an object where a scalar goes", '---\n"title": {"a": 1}\n---\n\n'],
    ["an item outside a list", '---\n  - "a"\n---\n\n'],
  ])("refuses what the renderer never wrote — %s", (_shape, file) => {
    expect(parseConceptFile(file)).toEqual({ ok: false, error: "malformed" });
  });
});
