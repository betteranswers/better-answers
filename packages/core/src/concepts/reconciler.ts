import { boundarySchemas, IRI, resolvedResource, ULID } from "@better-answers/schema";

import { RESTRICTED_TO_ADMINS } from "../access/index.ts";
import { act, declareActs, eventsOfAct, record } from "../audit/index.ts";
import {
  attempt,
  err,
  isActorId,
  ok,
  refusalFor,
  ulid,
  type ActorId,
  type Clock,
  type PlatformPrincipal,
  type Result,
  type WorkspaceId,
} from "../kernel/index.ts";
import {
  commitsAfter,
  readCommit,
  withRepositoryLockAs,
  type CommitRead,
  type GitDoor,
} from "../store/git/index.ts";
import {
  scopeClause,
  scopeParameter,
  withScope,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";
import { workspaceIds } from "../workspaces/index.ts";
import { hashedFileOf, parseConceptFile, type Frontmatter, type HashedSource } from "./file.ts";
import { payloadFor, targetOfMergeKey } from "./inbox.ts";
import type { Acceptance } from "./index.ts";
import { heldByIri, indexRowOf, landRows, WRITE_CONSTRAINTS } from "./landing.ts";

/**
 * **The reconciler** (ADR 0012's 2026-09-06 amendment; T-006 spec, *The reconciler*). The
 * window between a governed write's commit and its rows — step 4 to step 5 above — is the
 * one place the platform can die with the bundle ahead of what Postgres knows, and this is
 * the defined action for it: find the repository head ahead of the last `bundle_commit`,
 * and replay the missed commits **in order, oldest first, through the same handler the live
 * write uses** — `indexRowOf` builds the row and `landRows` lands it, exactly as they do for
 * the live act — idempotent on the ids the trailers carry.
 *
 * It runs under the platform's own principal, `process:better-answers-reconciler`, and its
 * acts are audited under that identity and never a person's. What a replay lands is
 * **recovery, not re-authorization**: the act was authorised when its commit was made — an
 * acceptance's Admin gate and its `{base}` precondition were both read before that commit
 * existed — so the replay carries that context in the commit itself (the `Actor:` trailer
 * names who acted, `Suggestion:` says it was an acceptance) rather than judging a role it
 * does not hold. A revocation that landed inside the window changes nothing about this:
 * authorization is judged at time-of-act, and unwanted content is undone forward.
 */

/** The reconciler's actor id — the platform principal's one form (`CONTEXT.md`, *actor id*). */
const RECONCILER_ACTOR = "process:better-answers-reconciler";

/**
 * The reconciler's principal, narrowed to its own actor: the type is what holds "under
 * `process:better-answers-reconciler`" at compile time, so no other platform act can replay
 * a bundle under its own name. `AdminUserPrincipal` is the same shape for a role.
 */
export type ReconcilerPrincipal = PlatformPrincipal & {
  readonly actorId: typeof RECONCILER_ACTOR;
};

export const RECONCILER: ReconcilerPrincipal = { kind: "platform", actorId: RECONCILER_ACTOR };

/**
 * The reconciler's one act on the ledger. Its row takes the **commit's own `Audit:` id**, so
 * `bundle_commit.audit_event_id` joins the ledger on one id whichever road landed the rows
 * (ADR 0014 rule 4) — the person's act live, the reconciler's replay after a crash — and the
 * subject is the commit replayed. The detail says what the commit put in the bundle — and
 * whether the file's `sources[]` agreed with the standing citations, which is what decided
 * whether the class landed was the citations' or Restricted, so an operator reading the
 * ledger sees why a replayed concept came back Restricted. Who acted is on the commit and
 * on `bundle_commit.actor`, as the `Actor:` trailer wrote it.
 *
 * *Reconciler hits* are a query over these rows (ADR 0025) and never a counter.
 */
const RECONCILER_ACTS = declareActs("platform", {
  replayed: act("platform.reconciler.replayed", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
    evidenceAgrees: "flag",
  }),
});

/**
 * Why one commit could not be replayed. `unreadable-commit` is a commit the governed write
 * did not make — no `Actor:` or `Audit:` trailer, no single concept file, a file outside the
 * renderer's grammar, or a creation whose file names no `type` or `title`. `rename-refused`
 * is a commit that puts a concept's file at a path other than the one its row holds — the
 * move the live handler refuses before it commits, so only a commit the governed write did
 * not make can carry one, and the replay stops at it rather than landing a rename by
 * recovery. The other two are the index refusing the rows the commit would need, which is
 * what a commit the live act could not record either looks like on replay.
 */
export type ReplayRefusal =
  | "unreadable-commit"
  | "rename-refused"
  | "path-taken"
  | "merge-key-taken";

export type Reconciled = {
  readonly workspaceId: string;
  /** The bundle's head as the run found it; `null` for a bundle with no commits. */
  readonly head: string | null;
  /** The last commit the rows knew before the run; `null` when they knew none. */
  readonly watermark: string | null;
  /** The commits this run landed, oldest first. */
  readonly replayed: readonly string[];
  /** The commits whose trailer id already had its rows: already landed, left as they were. */
  readonly skipped: readonly string[];
  /**
   * The commit the run stopped at and why, when the rows did not catch up with the head.
   * Every commit before it landed; nothing after it was attempted, because each commit's
   * row names its parent's and the prefix invariant is what the replay preserves.
   */
  readonly stopped: { readonly sha: string; readonly reason: ReplayRefusal | Error } | undefined;
};

/**
 * Why a run refused as a whole. `history-diverged` is the recorded history not being a
 * prefix of the bundle's — a database and a repository that disagree about the past, which
 * no replay makes right and a person has to look at; `no-such-repository` is a workspace
 * whose bundle is not on disk, which on a restore means the repository store was not.
 */
export type ReconcileRefusal = "malformed" | "no-such-repository" | "history-diverged";

/** What one replayed commit came to: landed, or already there. */
type Replayed = "landed" | "skipped";

/** The facts a replay reads off one commit: who acted, the ledger id, the file, its identity. */
type CommitFacts = {
  readonly sha: string;
  readonly parent: string | null;
  readonly actor: ActorId;
  readonly auditEventId: string;
  readonly suggestionId: string | undefined;
  readonly path: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly iri: string;
};

/**
 * A commit as the governed write made it, or nothing: the two trailers every act carries
 * in the kernel's and the minter's shapes, one concept file, and the IRI the file carries —
 * the one identity a commit does carry (ADR 0002), read off the file rather than minted.
 */
const factsOf = (read: CommitRead): CommitFacts | undefined => {
  const actor = read.trailers["Actor"];
  const audit = read.trailers["Audit"];
  if (actor === undefined || !isActorId(actor) || audit === undefined || !ULID.test(audit)) {
    return undefined;
  }
  if (read.change === undefined) return undefined;
  const parsed = parseConceptFile(read.change.content);
  if (!parsed.ok) return undefined;
  const iri = parsed.value.frontmatter["iri"];
  if (typeof iri !== "string" || !IRI.test(iri)) return undefined;
  return {
    sha: read.sha,
    parent: read.parent,
    actor,
    auditEventId: audit,
    suggestionId: read.trailers["Suggestion"],
    path: read.change.path,
    frontmatter: parsed.value.frontmatter,
    body: parsed.value.body,
    iri,
  };
};

/** A frontmatter key's value when it is a string, as `type`, `title` and `status` are. */
const stringIn = (frontmatter: Frontmatter, key: string): string | undefined => {
  const value = frontmatter[key];
  return typeof value === "string" ? value : undefined;
};

/**
 * The merge key for a replayed creation that carries none. A person's own write names its
 * merge key to the act and nowhere else — it is a row's fact and the commit does not carry
 * it — so a lost creation gets ADR 0003's derivation, the kind and the normalised label:
 * what a producer means by "this concept" when it has no IRI. A derived key another concept
 * already holds falls back to the IRI itself, which is unique by construction: the restore
 * path lands rather than stopping on two concepts sharing a title.
 */
const derivedMergeKey = async (
  platform: PlatformPrincipal,
  tx: Tx,
  iri: string,
  kind: string,
  title: string,
): Promise<string> => {
  const derived = `${kind}:${title.trim().replaceAll(/\s+/g, " ").toLowerCase()}`;
  const holder = await targetOfMergeKey(platform, tx, derived);
  return holder === undefined || holder === iri ? derived : iri;
};

/**
 * Whether a replayed file's `sources[]` is the concept's standing citations — the file's
 * entries and the citations' projection (`concept_evidence` joined to its `evidence` rows)
 * each reduced to the `(resource, locator)` pairs the content hash reduces them to, resolved
 * against the file's path, and compared as sets. The file carries no document id, so this is
 * the one reading of "did this commit change what the concept cites" a replay can make.
 * `cited` is the file's side, as the hash already reduced it — handed in, not reduced again.
 */
const fileCitesTheStandingEvidence = async (
  platform: PlatformPrincipal,
  tx: Tx,
  facts: CommitFacts,
  cited: readonly HashedSource[],
): Promise<boolean> => {
  const standing = await tx.query<{ resource: string; locator: string }>(
    `SELECT e.resource, ce.locator
       FROM concept_evidence ce
       JOIN evidence e ON e.workspace_id = ce.workspace_id
                      AND e.source_document_id = ce.source_document_id AND e.locator = ce.locator
      WHERE ce.workspace_id = ${scopeClause(1)} AND ce.iri = $2`,
    [scopeParameter(platform), facts.iri],
  );
  const pairs = (sources: readonly HashedSource[]) =>
    new Set(sources.map((pair) => JSON.stringify(pair)));
  const filed = pairs(cited);
  const held = pairs(
    standing.rows.map((row) => [resolvedResource(row.resource, facts.path), row.locator]),
  );
  return filed.size === held.size && [...filed].every((pair) => held.has(pair));
};

/** The last commit the rows know about, or nothing — the watermark the scan starts after. */
const lastRecordedCommit = async (platform: PlatformPrincipal, tx: Tx): Promise<string | null> => {
  const found = await tx.query<{ sha: string }>(
    `SELECT sha FROM bundle_commit WHERE workspace_id = ${scopeClause(1)}
      ORDER BY committed_at DESC, sha DESC LIMIT 1`,
    [scopeParameter(platform)],
  );
  return found.rows[0]?.sha ?? null;
};

/**
 * One commit replayed: read back, its rows built as the live act builds them, and landed in
 * one transaction under the platform's scope — the ledger row first, as every act in this
 * slice writes it, so the fail-together proof provokes its failure after the row exists.
 *
 * **Idempotent on the trailer id.** A commit whose `Audit:` id — or whose sha — already has
 * its `bundle_commit` row is already landed: skipped, never re-written and never an error,
 * which is what lets the periodic check and the restore path run as often as they like.
 * The unique index over `(workspace_id, audit_event_id)` holds the same rule for anything
 * that got past this read.
 *
 * What the commit carries is what the replay lands, and what it does not carry it recovers
 * as fail-closed as the live act would: the class is the concept's own where it exists and
 * the most restrictive of the three otherwise (a widening is an Admin's recorded act, never a
 * recovery's guess); the status and kind are the file's, or the concept's; evidence rows
 * are not recovered, because the file's `sources[]` is a projection and the document id is
 * not in it, so the concept's standing citations are left as they are and its class is
 * re-derived from them — **when the file cites them**. A file whose `sources[]` is not the
 * standing citations' projection is a lost commit that changed what the concept cites, and
 * the citations it lost may well be the narrower ones, so the replay lands the concept
 * Restricted (as a creation whose commit carries no evidence lands) and its ledger row says
 * the evidence did not agree. An acceptance — the `Suggestion:` trailer — decides its
 * suggestion through the same rows and the same marker as the live act, from the payload
 * the decision was made from; a suggestion decided in the meantime has no payload left to
 * read, and the commit lands as the commit it is, its decision left with whoever made it.
 */
const replayCommit = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  workspaceId: WorkspaceId,
  sha: string,
  batchId: string | undefined,
): Promise<Result<Replayed, ReplayRefusal | Error>> => {
  const read = await attempt(() => readCommit(platform, doors.git, workspaceId, sha));
  if (!read.ok) return err(read.error);
  const facts = factsOf(read.value);
  if (facts === undefined) return err("unreadable-commit");

  const landed = await attempt(() =>
    withScope(
      platform,
      doors.postgres,
      workspaceId,
      async (tx): Promise<Result<Replayed, ReplayRefusal>> => {
        const known = await tx.query(
          "SELECT 1 FROM bundle_commit WHERE workspace_id = $1 AND (sha = $2 OR audit_event_id = $3)",
          [workspaceId, facts.sha, facts.auditEventId],
        );
        if ((known.rowCount ?? 0) > 0) return ok("skipped");

        const held = await heldByIri(platform, tx, facts.iri);
        // The one refusal the live act reads off the row that a replay has to read again: a
        // file at a path the row does not hold is a rename, which the handler never makes,
        // and the replay stops there as it stops at a path the index refuses (ADR 0012).
        if (held !== undefined && held.path !== facts.path) return err("rename-refused");
        const payload =
          facts.suggestionId === undefined
            ? undefined
            : await payloadFor(platform, tx, facts.suggestionId);
        const acceptance: Acceptance | undefined =
          facts.suggestionId === undefined || payload === undefined
            ? undefined
            : { suggestionId: facts.suggestionId, setId: payload.setId, kind: payload.kind };
        const kind = stringIn(facts.frontmatter, "type") ?? held?.kind;
        const title = stringIn(facts.frontmatter, "title") ?? held?.title;
        if (kind === undefined || title === undefined) return err("unreadable-commit");
        const { contentHash, sources } = hashedFileOf(facts.frontmatter, facts.body, facts.path);
        // Read fresh per replayed commit (ADR 0040) — the ambient read this replaces was
        // one reading per `indexRowOf` invocation too, and a batch replaying several
        // commits recovers each at its own landing instant, not one shared guess.
        const parsed = indexRowOf(
          {
            workspaceId,
            iri: facts.iri,
            path: facts.path,
            kind,
            title,
            frontmatter: facts.frontmatter,
            body: facts.body,
            contentHash,
            status: stringIn(facts.frontmatter, "status"),
            sensitivity: undefined,
          },
          held,
          doors.clock.now(),
        );
        if (!parsed.success) return err("unreadable-commit");
        const row = parsed.data;
        const mergeKey =
          payload?.mergeKey ??
          held?.mergeKey ??
          (await derivedMergeKey(platform, tx, row.iri, row.kind, row.title));
        const evidenceAgrees = await fileCitesTheStandingEvidence(platform, tx, facts, sources);

        // The door is called bare (ADR 0014 rule 4): its rejection aborts this transaction.
        await record(platform, tx, {
          id: facts.auditEventId,
          act: RECONCILER_ACTS.replayed,
          subjectId: facts.sha,
          batchId,
          detail: { iri: row.iri, commitSha: facts.sha, contentHash, evidenceAgrees },
        });
        await landRows(platform, tx, {
          ...row,
          mergeKey,
          commit: { sha: facts.sha, parent: facts.parent },
          actor: facts.actor,
          auditEventId: facts.auditEventId,
          sources,
          // Not recovered — the file's `sources[]` carries no document id — so the
          // citations stand as they are and the class is re-derived from them, never
          // widened by a recovery that cleared them.
          evidence: undefined,
          // And where the file does not cite them, from the most restrictive visibility
          // there is beside them: the citations the commit lost may be the narrower ones.
          restsAlsoOn: evidenceAgrees ? [] : [RESTRICTED_TO_ADMINS],
          acceptance,
        });
        return ok("landed");
      },
    ),
  );
  if (!landed.ok) {
    const named = refusalFor(landed.error, WRITE_CONSTRAINTS);
    return err(typeof named === "string" ? named : landed.error);
  }
  return landed.value;
};

/**
 * Reconcile one workspace's bundle with its rows: the defined action, on demand. The
 * periodic head check in the api process calls this for every workspace, and
 * `pnpm ops reconcile-watermark` calls it for one — the restore path, when a database has
 * been restored from a dump and the repository is ahead of it.
 *
 * **Under the per-repository lock**, held from the watermark read through the last commit's
 * landing: a live write waits behind a replay and a replay behind a live write, so the
 * prefix invariant holds through both, and a second run of this function on the same
 * bundle waits rather than replaying beside the first. A run that finds nothing missed
 * costs one read of `bundle_commit` and one of the ref.
 *
 * A run stops at the first commit it cannot land and says which; everything before it has
 * landed, each in its own transaction, and a later run picks up where this one stopped
 * once whatever stopped it has been put right. A bulk replay's ledger rows share one batch
 * id (ADR 0014 rule 4).
 */
export const reconcile = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  input: { readonly workspaceId: string },
): Promise<Result<Reconciled, ReconcileRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const workspaceId = workspace.data;

  return withRepositoryLockAs(platform, doors.git, workspaceId, async () => {
    const watermark = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, (tx) => lastRecordedCommit(platform, tx)),
    );
    if (!watermark.ok) return err(watermark.error);
    const scanned = await commitsAfter(platform, doors.git, workspaceId, watermark.value);
    if (!scanned.ok) return err(scanned.error);

    const batchId = scanned.value.missed.length > 1 ? ulid() : undefined;
    const replayed: string[] = [];
    const skipped: string[] = [];
    let stopped: Reconciled["stopped"];
    for (const sha of scanned.value.missed) {
      const outcome = await replayCommit(platform, doors, workspaceId, sha, batchId);
      if (!outcome.ok) {
        stopped = { sha, reason: outcome.error };
        break;
      }
      (outcome.value === "landed" ? replayed : skipped).push(sha);
    }
    return ok({
      workspaceId,
      head: scanned.value.head,
      watermark: watermark.value,
      replayed,
      skipped,
      stopped,
    });
  });
};

/** One reconciler hit: a commit the replay landed, as its ledger row records it. */
export type ReconcilerHit = {
  readonly commitSha: string;
  /** The commit's `Audit:` id — the row's id, and `bundle_commit.audit_event_id`. */
  readonly auditEventId: string;
  readonly at: Date;
  /** The batch a bulk replay's rows share; `null` for a run that landed one commit. */
  readonly batchId: string | null;
};

/**
 * *Reconciler hits* — the signal ADR 0012 names, in the sense ADR 0025 gives the word: a
 * query over rows the platform already keeps, never a counter. The rows are the
 * `platform.reconciler.replayed` events the replay writes, one per commit landed, oldest
 * first, from an instant when the caller names one. The api's head check writes nothing
 * else about a hit, so the ledger is the whole record and this read is the whole signal.
 */
export const reconcilerHits = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string; readonly since?: Date | undefined },
): Promise<Result<readonly ReconcilerHit[], "malformed" | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const read = await attempt(() =>
    withScope(platform, door, workspace.data, (tx) =>
      eventsOfAct(platform, tx, RECONCILER_ACTS.replayed, input.since),
    ),
  );
  if (!read.ok) return err(read.error);
  return ok(
    read.value.map((row) => ({
      commitSha: row.subjectId,
      auditEventId: row.id,
      at: row.at,
      batchId: row.batchId,
    })),
  );
};

/** One workspace's outcome of a run over every workspace. */
export type WorkspaceReconciled = {
  readonly workspaceId: string;
  readonly outcome: Result<Reconciled, ReconcileRefusal | Error>;
};

/**
 * The periodic head check's whole pass: every workspace the platform holds, reconciled one
 * after the other. One bundle's refusal is that bundle's fact and never a reason to leave
 * the others behind, so each carries its own `Result`, as a bulk acceptance's items do.
 */
export const reconcileEveryWorkspace = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
): Promise<Result<readonly WorkspaceReconciled[], Error>> => {
  const held = await workspaceIds(platform, doors.postgres);
  if (!held.ok) return err(held.error);
  const outcomes: WorkspaceReconciled[] = [];
  for (const workspaceId of held.value) {
    outcomes.push({ workspaceId, outcome: await reconcile(platform, doors, { workspaceId }) });
  }
  return ok(outcomes);
};
