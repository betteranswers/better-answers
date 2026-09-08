import {
  boundarySchemas,
  conceptFrontmatter,
  SUGGESTION_DECLINED_STATUS,
  SUGGESTION_KINDS_FROM_THE_APP,
  SUGGESTION_RETURNED_STATUS,
  SUGGESTION_SET_MAX,
  SUGGESTION_WAITING_STATUS,
} from "@better-answers/schema";
import type { z } from "zod";

import { readableClause, readableParameters } from "../access/index.ts";
import { act, declareActs, record, type Act } from "../audit/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  isActorId,
  ok,
  requireAdmin,
  ulid,
  type ActorId,
  type Principal,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { withRepositoryLock, type GitDoor } from "../store/git/index.ts";
import { withMembership, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import type { Frontmatter } from "./index.ts";

/**
 * The **inbox**: the concepts slice's queue of suggestions and their payloads (ADRs 0005,
 * 0011, 0012). Everything here happens *without* a commit — submitting, opening a set,
 * declining, returning — which is exactly why it is not in `index.ts` beside the governed
 * write. The one act that does commit is the acceptance, and it lives with `writeConcept`
 * because it **is** a governed write.
 *
 * Three things this module does not do, each on purpose:
 *
 * - **It never resolves identity.** The summary *renders* what a merge key resolves to
 *   right now, and the acceptance resolves it again inside the act. A resolution stored
 *   anywhere would be a resolution that could be stale when it was acted on, which is the
 *   whole failure `CONTEXT.md`'s *merge key* entry exists to name.
 * - **It never writes a row from a read.** Opening a set re-renders the summary and stamps
 *   nothing — a read writes no row — so what the Admin saw travels back with the
 *   acceptance as a precondition rather than as a column somebody has to keep fresh.
 * - **It writes no ledger row for a submission.** A run's output is the run's own record
 *   and never an audit event (ADR 0035), and a suggestion changes nothing but the queue —
 *   the ledger's entry is the *decision*, which is the act ADR 0012 gates the bundle on.
 *
 * The payload is reached through `concept_write_request_for` and never through the table:
 * neither runtime role holds a privilege on `concept_write_request` at all (migration
 * 0017), so "nothing reads a payload but the acceptance path" is the database's sentence.
 */

/**
 * The two decisions that make no commit. A **decline** is a producer's rejected work
 * recorded as a fact rather than a silence (ADR 0012); a **return** is an acceptance the
 * platform refused — what the payload was written against moved — handed back to whoever
 * prepared it, which is what "fails loudly and returns to the proposer" means as a state.
 */
const INBOX_ACTS = declareActs("knowledge", {
  declined: act("knowledge.suggestion.declined", { setId: "id" }),
  returned: act("knowledge.suggestion.returned", { setId: "id" }),
});

type SuggestionRow = z.infer<typeof boundarySchemas.suggestion.select>;

/** The kinds a suggestion comes in, read off the boundary that narrows to them. */
export type SuggestionKind = SuggestionRow["kind"];
export type SuggestionStatus = SuggestionRow["status"];

/**
 * One item of a set's summary, as the database renders it when the set is opened: the
 * suggestion's own facts, what its payload means, and — re-read every time — the concept
 * its merge key resolves to and whether the content it was written against has moved.
 */
export type SuggestionSummaryItem = {
  readonly suggestionId: string;
  readonly kind: SuggestionKind;
  readonly status: SuggestionStatus;
  readonly proposer: ActorId;
  readonly decider: ActorId | null;
  /** Why it was declined or returned; `null` on one nobody refused. */
  readonly reason: string | null;
  readonly mergeKey: string;
  readonly title: string;
  readonly path: string;
  /** What the merge key resolves to **now**; `null` when it names no concept yet. */
  readonly target: string | null;
  /** Whether what the payload was written against has moved since it was written. */
  readonly baseMoved: boolean;
};

type SummaryRow = {
  readonly suggestion_id: string;
  readonly kind: string;
  readonly status: string;
  readonly proposer: string;
  readonly decider: string | null;
  readonly reason: string | null;
  readonly merge_key: string;
  readonly title: string;
  readonly path: string;
  readonly resolved_iri: string | null;
  readonly base_moved: boolean;
};

/** The boundary's own reading of a row's two actor columns, so neither is asserted. */
const actorOf = (value: string): ActorId => {
  if (!isActorId(value)) throw new Error(`the inbox holds an actor of no known form`);
  return value;
};

const summaryItem = (row: SummaryRow): SuggestionSummaryItem => {
  const parsed = boundarySchemas.suggestion.select
    .pick({ kind: true, status: true })
    .parse({ kind: row.kind, status: row.status });
  return {
    suggestionId: row.suggestion_id,
    kind: parsed.kind,
    status: parsed.status,
    proposer: actorOf(row.proposer),
    decider: row.decider === null ? null : actorOf(row.decider),
    reason: row.reason,
    mergeKey: row.merge_key,
    title: row.title,
    path: row.path,
    target: row.resolved_iri,
    baseMoved: row.base_moved,
  };
};

/**
 * A suggestion set as the person deciding it sees it — **re-rendered against
 * `concept_identity` every time it is asked for** (T-006 spec, *Suggestions, the inbox and
 * identity*), so an Admin decides against the map of today and not the map of the
 * proposal's day.
 *
 * The resolution is the database's join and not a column: `suggestion_set_summary` is the
 * agreement both tiers hold (`contracts/concept-inbox`), and reading through it is what
 * gives the app a payload it holds no privilege on. `target` is what an acceptance carries
 * back as its precondition; `baseMoved` is what says an acceptance would be refused before
 * anybody tries.
 *
 * **An Admin, or the person who proposed the set, and nobody else.** A summary names every
 * item's title, path and merge key, and none of that is filtered by what the reader may
 * see: a Viewer who could open any set would learn that a concept withheld from them
 * exists, which is the one thing `open` by IRI is built never to reveal (user story 13).
 * Deciding is an Admin's; seeing what you yourself offered is your own.
 *
 * **The resolution is filtered, and by the one read predicate** (`readableClause`), checked
 * beside this read rather than inside the definer function — which serves the app's
 * role and knows nothing of the person behind it. A proposer who is a plain member sees
 * their own item with no resolved target and a `baseMoved` that reads exactly as it would
 * for a merge key naming no concept at all, so a withheld concept is indistinguishable from
 * one nobody minted. The **Admin deciding** sees the resolution whatever it is, draft
 * included: the target is what they are being asked to write onto, and a decision surface
 * that hid it would be asking them to decide blind.
 */
export const suggestionSetSummary = async (
  principal: UserPrincipal,
  tx: Tx,
  setId: string,
): Promise<Result<readonly SuggestionSummaryItem[], RoleRefusal | Error>> => {
  const found = await attempt(() =>
    // RLS scopes the function's own WHERE clause by the transaction's workspace, and scopes
    // the join below the same way; naming the Principal here is what says so where a reader
    // of the call can see it.
    tx.query<SummaryRow>(
      `SELECT s.suggestion_id, s.kind, s.status, s.proposer, s.decider, s.reason,
              s.merge_key, s.title, s.path, c.iri AS resolved_iri,
              CASE WHEN c.iri IS NULL THEN s.base_content_hash IS NOT NULL ELSE s.base_moved END
                AS base_moved
         FROM suggestion_set_summary($1) s
         LEFT JOIN concept_index c
                ON c.iri = s.resolved_iri
               AND ($2 = 'Admin' OR (${readableClause("c", 2)}))`,
      [setId, ...readableParameters(principal)],
    ),
  );
  if (!found.ok) return err(found.error);
  // The gate runs on the rows and before they are handed back, so a set this caller may
  // not open answers a refusal rather than its contents. A set nobody minted is empty, and
  // empty passes — an id that resolved to nothing tells a prober nothing either way.
  const mine = actorIdOf(principal);
  if (principal.role !== "Admin" && found.value.rows.some((row) => row.proposer !== mine)) {
    return err("role-forbids");
  }
  // The reading is inside an `attempt` too: a row whose actor is of no known form is a
  // broken database, and the throw becomes this act's own value rather than the caller's.
  return attempt(async () => found.value.rows.map(summaryItem));
};

/** One change a suggestion set proposes: the file it would write, and what it means it for. */
export type SuggestionRequest = {
  /** What this payload means, before any IRI is known (`CONTEXT.md`, *merge key*). */
  readonly mergeKey: string;
  readonly path: string;
  /** The OKF `type` the file carries — never the suggestion's own kind, which is the set's. */
  readonly conceptKind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  /** The content it was written against; absent when it proposes a new concept. */
  readonly baseContentHash?: string;
};

export type SubmitSuggestionSetInput = {
  readonly kind: SuggestionKind;
  readonly requests: readonly SuggestionRequest[];
};

export type SuggestionSetSubmitted = {
  readonly setId: string;
  readonly suggestionIds: readonly string[];
};

export type SubmitSuggestionSetRefusal = PrincipalRefusal | "malformed" | "kind-forbids";

/**
 * Submit one suggestion set — **one function call**, which is the form ADR 0031 fixes for
 * this agreement, so the transition is the database's and not two clients' agreeing
 * interpretation of it. The worker calls the same function for a run's candidates.
 *
 * Any member may submit: a Viewer may *suggest* a change they may not commit (ADR 0019),
 * and the gate ADR 0012 cares about is the decision, not the offer. The proposer is the
 * caller, derived by the kernel's one function and never composed here — and the kinds this
 * road may carry are `SUGGESTION_KINDS_FROM_THE_APP`, because a *candidate* is a run's
 * output and a *repair* is the platform's own citation routine. Accepting a repair re-points
 * every standing check at the content it wrote, so a person raising one could make somebody
 * else's check vouch for content they never saw. `submit_suggestion_set` holds the same list
 * against the calling tier, which is what makes it true of a compromised caller too; this
 * refusal is the word an honest caller hears instead of the store's error.
 *
 * The payload goes through the boundary before the call, so a path, a frontmatter or a body
 * the row would refuse is refused while it is still a proposal — rather than at the moment
 * an Admin accepts it, when the refusal is somebody else's problem.
 */
export const submitSuggestionSet = async (
  principal: UserPrincipal,
  doors: { readonly postgres: PostgresDoor },
  input: SubmitSuggestionSetInput,
): Promise<Result<SuggestionSetSubmitted, SubmitSuggestionSetRefusal | Error>> => {
  // The kind goes through the boundary like everything else a caller supplies, and then
  // through the app's own list: a word off the enum is `malformed`, and a kind no person's
  // session may raise is `kind-forbids` — two different things a caller can act on, where
  // either reaching the database would be the store's failure escaping as this act's answer.
  const kind = boundarySchemas.suggestion.insert.shape.kind.safeParse(input.kind);
  if (!kind.success) return err("malformed");
  if (!SUGGESTION_KINDS_FROM_THE_APP.some((allowed) => allowed === kind.data)) {
    return err("kind-forbids");
  }
  const setId = ulid();
  const payloads = boundarySchemas.conceptWriteRequest.insert
    .omit({ workspaceId: true })
    // **A payload's frontmatter is a mapping, and never JSON's null.** The column would take
    // one — `jsonb` holds JSON null and the boundary mirrors the column, which is the rule
    // ADR 0028's nullability assertion holds every schema to — but a payload is the file an
    // acceptance would commit, and the write path reads its keys: a null would arrive there
    // as a throw rather than as a refusal anybody could act on. Narrowed here, where the
    // shape belongs to the act rather than to the row; `submit_suggestion_set` refuses one
    // too (migration 0018), which is what makes it true of a caller that never came past here.
    .extend({ frontmatter: conceptFrontmatter })
    .array()
    .nonempty()
    .max(SUGGESTION_SET_MAX)
    .safeParse(
      input.requests.map((request) => ({
        suggestionId: ulid(),
        mergeKey: request.mergeKey,
        path: request.path,
        conceptKind: request.conceptKind,
        title: request.title,
        frontmatter: request.frontmatter,
        body: request.body,
        baseContentHash: request.baseContentHash ?? null,
      })),
    );
  if (!payloads.success) return err("malformed");

  const submitted = await attempt(() =>
    withMembership(principal, doors.postgres, async (fresh, tx) => {
      // The function answers a set of ids; naming the column is the caller's, because a
      // `SETOF text` comes back under the function's own name.
      const landed = await tx.query<{ suggestion_id: string }>(
        "SELECT submitted AS suggestion_id FROM submit_suggestion_set($1, $2, $3, $4::jsonb) AS submitted",
        [
          setId,
          kind.data,
          actorIdOf(fresh),
          JSON.stringify(
            payloads.data.map((payload) => ({
              suggestion_id: payload.suggestionId,
              merge_key: payload.mergeKey,
              path: payload.path,
              concept_kind: payload.conceptKind,
              title: payload.title,
              // The frontmatter as **this producer serialized it**, and not as an object the
              // function would have to render back: the bound the boundary just applied is
              // over exactly these characters, and Postgres's rendering of the same value
              // is not within any multiplier of them (migration 0018).
              frontmatter: JSON.stringify(payload.frontmatter),
              body: payload.body,
              base_content_hash: payload.baseContentHash,
            })),
          ),
        ],
      );
      return landed.rows.map((row) => row.suggestion_id);
    }),
  );
  if (!submitted.ok) return err(submitted.error);
  if (!submitted.value.ok) return err(submitted.value.error);
  return ok({ setId, suggestionIds: submitted.value.value });
};

/**
 * Name the suggestion this transaction is deciding — the marker `suggestion`'s trigger
 * demands before it will let a waiting row become a decided one (migration 0018), so the
 * governed paths are the only paths a decision travels and a second road cannot be added by
 * accident. It is set **transaction-locally**, which is what stops it outliving the act or
 * reaching whoever holds the pooled connection next.
 *
 * Exported to `index.ts` and nowhere else: the acceptance is a governed write and lives with
 * `writeConcept`, but the decision it makes is this module's, so both paths set one marker
 * rather than two spellings of one.
 */
export const markDeciding = async (tx: Tx, suggestionId: string): Promise<void> => {
  await tx.query("SELECT set_config('app.deciding_suggestion', $1, true)", [suggestionId]);
};

export type DecideSuggestionInput = {
  readonly suggestionId: string;
  /** Why, in the words the proposer is shown — never blank, which the boundary refuses. */
  readonly reason: string;
};

export type DecideSuggestionRefusal =
  | RoleRefusal
  | PrincipalRefusal
  | "malformed"
  | "no-such-suggestion"
  | "already-decided";

/** What a decision leaves behind: the set it was in, so a caller can re-render it. */
export type SuggestionDecided = {
  readonly suggestionId: string;
  readonly setId: string;
  readonly status: SuggestionStatus;
};

/**
 * The two decisions that make no commit, in one body: a decline and a return differ by the
 * status they write and the act they book, and by nothing else. Written once, because two
 * copies would be two places the ledger row could drift from the row it describes.
 *
 * The ledger row is written **first inside the transaction**, as every act in this slice
 * writes it, so the fail-together test provokes its failure after the row exists and proves
 * it rolled back with the act rather than that it was never reached (ADR 0014 rule 4).
 *
 * The row is read **under two locks**, and they answer two different races.
 *
 * `FOR UPDATE` is the one for two people deciding at once: the second waits behind the first
 * and then reads the status the first wrote. Without it the ledger row would be written
 * against a row a concurrent decision had already taken, and the act would commit an event
 * for a decision that never happened.
 *
 * The **per-repository lock** is the one for a decision racing an *acceptance*, and it is
 * why a decision that makes no commit takes a lock named after a repository. An acceptance
 * spans two stores: it reads the suggestion, commits to git, then writes its rows. A decline
 * landing inside that span would leave a commit whose `Suggestion:` trailer named a declined
 * suggestion — an orphan the reconciler's replay rule would then land (ADR 0012's 2026-09-06
 * amendment). Held here, a decision and an acceptance of one suggestion are one after the
 * other, so that span has nothing to interleave with.
 */
const decide = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: DecideSuggestionInput,
  decision: { readonly status: SuggestionStatus; readonly act: Act },
): Promise<Result<SuggestionDecided, DecideSuggestionRefusal | Error>> => {
  // The decision is an Admin's. ADR 0012's amendment also gives it to the *target's
  // owner* for the *edit* kind; a concept has no owner record yet (T-006 is not where it
  // lands), so that arm waits for the column rather than being guessed at here.
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const reason = boundarySchemas.suggestion.insert.shape.reason.safeParse(input.reason);
  if (!reason.success || reason.data === null) return err("malformed");

  const decided = await withRepositoryLock(principal, doors.git, () =>
    attempt(() =>
      withMembership(principal, doors.postgres, async (fresh, tx) => {
        const waiting = await tx.query<{ set_id: string; status: string }>(
          "SELECT set_id, status FROM suggestion WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [fresh.workspaceId, input.suggestionId],
        );
        const row = waiting.rows[0];
        if (row === undefined) return err("no-such-suggestion" as const);
        if (row.status !== SUGGESTION_WAITING_STATUS) return err("already-decided" as const);

        await record(fresh, tx, {
          id: ulid(),
          act: decision.act,
          subjectId: input.suggestionId,
          detail: { setId: row.set_id },
        });
        // The transaction says which suggestion it is deciding, and the row's trigger
        // refuses a decision that arrives without it (migration 0018). Local, so it dies
        // with this transaction rather than travelling on the pooled connection.
        await markDeciding(tx, input.suggestionId);
        const written = await tx.query<{ id: string }>(
          `UPDATE suggestion
              SET status = $3, decider = $4, decided_at = now(), reason = $5
            WHERE workspace_id = $1 AND id = $2 AND status = $6
          RETURNING id`,
          [
            fresh.workspaceId,
            input.suggestionId,
            decision.status,
            actorIdOf(fresh),
            reason.data,
            SUGGESTION_WAITING_STATUS,
          ],
        );
        // Unreachable while the lock above holds, and a **throw** rather than a refusal if
        // it ever is not: the ledger row is already written, so a value here would commit
        // an event for a decision that did not happen.
        if (written.rows.length === 0) {
          throw new Error("the suggestion moved under the lock that was holding it");
        }
        return ok({ suggestionId: input.suggestionId, setId: row.set_id, status: decision.status });
      }),
    ),
  );
  if (!decided.ok) return err(decided.error);
  if (!decided.value.ok) return err(decided.value.error);
  return decided.value.value;
};

/**
 * Decline a suggestion, with the reason (ADR 0012): a producer's rejected work is a fact
 * and not a silence, which is why the reason is a column the row refuses to be without and
 * not a sentence in a ledger detail — the ledger carries ids and role words, never prose
 * somebody typed (ADR 0014, ADR 0035).
 */
export const declineSuggestion = (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: DecideSuggestionInput,
): Promise<Result<SuggestionDecided, DecideSuggestionRefusal | Error>> =>
  decide(principal, doors, input, {
    status: SUGGESTION_DECLINED_STATUS,
    act: INBOX_ACTS.declined,
  });

/**
 * Hand a suggestion back to whoever prepared it. Not a decision against the change — a
 * refusal of *this* acceptance, because what the payload was written against moved: the
 * concept its merge key resolved to is no longer that concept, or the content it was
 * written against is no longer that content. ADR 0012's amendment gives the outcome in
 * those words — the acceptance "fails loudly and returns to the proposer" — and this is
 * the second half of it, the state that puts the work back in the proposer's hands.
 */
export const returnToProposer = (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: DecideSuggestionInput,
): Promise<Result<SuggestionDecided, DecideSuggestionRefusal | Error>> =>
  decide(principal, doors, input, {
    status: SUGGESTION_RETURNED_STATUS,
    act: INBOX_ACTS.returned,
  });

/**
 * A suggestion's payload, as the acceptance path reads it — and nothing else may.
 *
 * `kind` is the **suggestion's**, everywhere the word appears in this slice; the OKF type
 * the file carries is `conceptKind`. The two were both called *kind* once, in adjacent
 * types, and the bare word flipped meaning between them.
 */
export type SuggestionPayload = {
  readonly setId: string;
  readonly kind: SuggestionKind;
  readonly proposer: ActorId;
  readonly mergeKey: string;
  readonly path: string;
  readonly conceptKind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly baseContentHash: string | null;
};

type PayloadRow = {
  readonly set_id: string;
  readonly kind: string;
  readonly proposer: string;
  readonly merge_key: string;
  readonly path: string;
  readonly concept_kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly base_content_hash: string | null;
};

/**
 * The payload of a suggestion that is still **waiting**, or nothing.
 *
 * The one reader of `concept_write_request_for`, which is itself the one road to the
 * table: a decided suggestion has been committed or refused and its payload has no reader
 * left, and the function answers a suggestion of another workspace exactly as it answers
 * one nobody minted (migration 0018).
 *
 * The Principal is either kind: the deciding Admin's, or the platform's when the reconciler
 * replays an acceptance whose rows were lost and reads the payload the decision was made
 * from. The function scopes itself by the transaction, so both read the same way.
 */
export const payloadFor = async (
  principal: Principal,
  tx: Tx,
  suggestionId: string,
): Promise<SuggestionPayload | undefined> => {
  const found = await tx.query<PayloadRow>(
    `SELECT set_id, kind, proposer, merge_key, path, concept_kind, title, frontmatter, body,
            base_content_hash
       FROM concept_write_request_for($1)`,
    [suggestionId],
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  return {
    setId: row.set_id,
    kind: boundarySchemas.suggestion.select.shape.kind.parse(row.kind),
    proposer: actorOf(row.proposer),
    mergeKey: row.merge_key,
    path: row.path,
    conceptKind: row.concept_kind,
    title: row.title,
    frontmatter: row.frontmatter,
    body: row.body,
    baseContentHash: row.base_content_hash,
  };
};

/**
 * Whether a suggestion is still waiting for its decision — the read an acceptance makes
 * **before it commits**, so an acceptance of a suggestion somebody has already declined
 * costs no commit at all. It is a second reading of what `payloadFor` implies, and it is
 * made inside the act rather than beside it, which is the whole of its point.
 */
export const suggestionIsWaiting = async (
  principal: UserPrincipal,
  tx: Tx,
  suggestionId: string,
): Promise<boolean> => {
  const found = await tx.query<{ status: string }>(
    "SELECT status FROM suggestion WHERE workspace_id = $1 AND id = $2",
    [principal.workspaceId, suggestionId],
  );
  return found.rows[0]?.status === SUGGESTION_WAITING_STATUS;
};

/**
 * What a merge key resolves to **now**, or nothing — `concept_identity` read in the
 * transaction that is about to act on the answer. The one resolution, so the acceptance
 * path and the summary can never mean two different things by "the target".
 *
 * The Principal is either kind. A user principal's workspace is named in the statement, so a
 * disagreement with the transaction's scope is refused by the policy rather than read; the
 * platform principal carries none, so the scope alone says which workspace is read — the
 * audit door's shape, for the reconciler's replay of a commit whose rows were lost.
 */
export const targetOfMergeKey = async (
  principal: Principal,
  tx: Tx,
  mergeKey: string,
): Promise<string | undefined> => {
  const found = await tx.query<{ iri: string }>(
    `SELECT iri FROM concept_identity
      WHERE workspace_id = COALESCE($1::text, (select current_workspace_id())) AND merge_key = $2`,
    [principal.kind === "user" ? principal.workspaceId : null, mergeKey],
  );
  return found.rows[0]?.iri;
};
