import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, record, type DetailOf } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  ulid,
  type Clock,
  type PlatformPrincipal,
  type Result,
} from "../kernel/index.ts";
import type { GitDoor } from "../store/git/index.ts";
import type { ObjectDoor } from "../store/objects/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { workspaceIds } from "../workspaces/index.ts";
import { replayCopiesSince, type ReplayCopy } from "./replay.ts";
import { dueDateOf } from "./requests.ts";
import { beyondUseFrom, runErasure, type ErasurePrincipal } from "./routine.ts";

/**
 * **The replay** (ADR 0022; the S0 spec, *The two ops commands*): every erasure that completed
 * after a dump was taken, run again over the estate that dump has just been restored into —
 * `pnpm ops replay-erasures --since <stamp>`, whose core half this is.
 *
 * The failure it exists to prevent is one sentence. A restore puts a person's data back. Every
 * erasure completed after the dump was taken is therefore undone by the restore, and unless
 * something re-runs them before `api` is allowed to turn healthy, the platform is holding data
 * it told a person and a regulator it had erased. So the replay runs **before** the api comes
 * up, and it **stops** rather than letting a restore continue past an erasure it could not
 * re-apply.
 *
 * **Two halves make the set, because a dump cannot carry them both.** A dump taken *after* a
 * request completed carries the `erasure_request` row, and the replay reads it there. A dump
 * taken *before* it carries no row at all — the data is back and the record that it was erased
 * is not — so the *replay copy* in the object store is the only thing in the estate that knows
 * the erasure is owed. The set is the union of the two, de-duplicated by erasure request id,
 * and a request the rows still hold is read from the rows: they are the live record and the
 * copy is what stands in for them when they are gone.
 *
 * **It is the platform's act, not one tenant's.** The union is read across every workspace the
 * restored database holds, because a restore restores the estate; a per-workspace replay would
 * be a restore that silently skipped the tenants nobody named.
 *
 * **The routine it calls is idempotent by construction**, so the replay has no branch for a
 * request that was already replayed, for a dump that overlapped one, or for an operator who
 * ran the command twice: a second run finds no `human:<email>` left to replace, the same
 * pseudonym on the same row and the same completion standing, and writes one ledger row
 * (`routine.ts`, *Idempotent by construction*).
 */

/**
 * The replay's own act. Its subject is the **erasure request replayed**, so a restore that
 * replayed nine erasures is nine rows and never one row hiding nine (`[AUDIT1]`), and the
 * ledger answers "what happened to this erasure" by subject as it does for any other record.
 * The detail carries the two ids again beside the one thing that is this act's own — whether
 * the request had to be re-created from its copy, which is how a reader tells a restore from a
 * dump older than the request from one taken after it. Ids and a flag, and nothing about the
 * person (`[AUDIT5]`): the ledger is the one record an erasure never rewrites.
 *
 * `platform.erasure.rehearsed`, the drill's act, joins this declaration when the rehearsal
 * lands — one slice, one family, and an act is declared once in the tree.
 */
const REPLAY_ACTS = declareActs("platform", {
  replayed: act("platform.erasure.replayed", {
    erasureRequestId: "id",
    subjectRequestId: "id",
    fromReplayCopy: "flag",
  }),
});

type ReplayedDetail = DetailOf<(typeof REPLAY_ACTS)["replayed"]["detail"]>;

/**
 * One erasure the replay must run: where it lives, the pair it is keyed by, and the completion
 * `--since` was read against.
 *
 * `copy` is present only where the **rows no longer hold it** — where they do, the rows are the
 * record and the copy has nothing to add. So the field is also the answer to "does this request
 * have to be re-created before the routine can open it", which is why there is no second flag
 * beside it.
 */
export type ReplayableErasure = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  readonly completedAt: Date;
  /** The copy to re-create the pair from, where the restored database holds neither row. */
  readonly copy?: ReplayCopy;
};

/** What one replayed erasure leaves behind: ids and instants, and nothing about the person. */
export type ReplayedErasure = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  /** The completion that stands on the request — the first run's, which a replay never moves. */
  readonly completedAt: Date;
  /** Whether the restored database held neither row and the copy re-created them. */
  readonly fromReplayCopy: boolean;
  /** This replay's own ledger row, so a caller can name the event it wrote. */
  readonly auditEventId: string;
};

/** The doors a replay needs: the four the routine takes, because it is what the replay runs. */
export type ReplayDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
};

type CompletedRow = {
  readonly id: string;
  readonly subject_request_id: string;
  readonly completed_at: Date;
};

/**
 * **Every completed erasure the restored rows hold, from after `since`, across every workspace.**
 *
 * One scoped transaction per workspace rather than one statement over the table, because
 * `erasure_request` is a tenant table under row-level security and an unscoped read of it
 * answers nothing at all (ADR 0009): the scope is how the platform reaches a tenant's rows, and
 * there is no door that reaches every tenant's at once. The workspace list is the workspaces
 * slice's own read — `erasure` may call it, sitting at the top of the slice graph (ADR 0029
 * rule 4) — so this function holds no SQL over another slice's table.
 *
 * A request with no completion is not here: an erasure that never finished is not one the
 * restore undid, and the operator's answer to it is to run the routine, not the replay.
 */
export const erasureRequestsSince = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  since: Date,
): Promise<Result<readonly ReplayableErasure[], Error>> => {
  const held = await workspaceIds(platform, door);
  if (!held.ok) return err(held.error);

  const found: ReplayableErasure[] = [];
  for (const workspaceId of held.value) {
    const read = await attempt(() =>
      withScope(platform, door, workspaceId, (tx: Tx) =>
        tx.query<CompletedRow>(
          `SELECT id, subject_request_id, completed_at
             FROM erasure_request
            WHERE workspace_id = $1 AND completed_at > $2`,
          [workspaceId, since],
        ),
      ),
    );
    if (!read.ok) return err(read.error);
    for (const row of read.value.rows) {
      found.push({
        workspaceId,
        // Parsed at the boundary rather than asserted (ADR 0028): these two ids are handed
        // straight to the routine, and the one that is not what it claims is the one that
        // erases the wrong request.
        subjectRequestId: boundarySchemas.subjectRequest.select.shape.id.parse(
          row.subject_request_id,
        ),
        erasureRequestId: boundarySchemas.erasureRequest.select.shape.id.parse(row.id),
        completedAt: row.completed_at,
      });
    }
  }
  return ok(found);
};

/**
 * **The set the replay runs**: the restored rows and the store's copies, de-duplicated by
 * erasure request id and ordered by completion and then by id.
 *
 * The order is not decoration. The command prints one line per request and an operator reads
 * those lines against a restore's log, so the same restore run twice must print the same lines
 * in the same order; and an erasure re-applied in the order the erasures happened is the order
 * the estate reached the state the dump does not have. Two requests completed at one instant
 * are ordered by id, which is the minter's own order and therefore still the order they
 * happened in.
 *
 * A request **both** halves name is read from the rows: the copy adds nothing to a row that is
 * still there, and a re-creation over a live row would be a second writer of the same pair.
 */
export const replayableErasures = async (
  platform: PlatformPrincipal,
  doors: Pick<ReplayDoors, "postgres" | "objects">,
  input: { readonly since: Date },
): Promise<Result<readonly ReplayableErasure[], Error>> => {
  const rows = await erasureRequestsSince(platform, doors.postgres, input.since);
  if (!rows.ok) return err(rows.error);
  const copies = await replayCopiesSince(platform, doors.objects, input.since);
  if (!copies.ok) return err(copies.error);

  const byRequest = new Map<string, ReplayableErasure>();
  for (const row of rows.value) byRequest.set(row.erasureRequestId, row);
  for (const copy of copies.value) {
    if (byRequest.has(copy.erasureRequestId)) continue;
    byRequest.set(copy.erasureRequestId, {
      workspaceId: copy.workspaceId,
      subjectRequestId: copy.subjectRequestId,
      erasureRequestId: copy.erasureRequestId,
      completedAt: new Date(copy.completedAt),
      copy,
    });
  }

  return ok(
    [...byRequest.values()].sort(
      (one, other) =>
        one.completedAt.getTime() - other.completedAt.getTime() ||
        one.erasureRequestId.localeCompare(other.erasureRequestId),
    ),
  );
};

/**
 * The identifier set a copy carries, as the column takes it. A copy written from a row the
 * table accepted always names somebody, so the empty set below is unreachable through any
 * copy this platform wrote; it is here because the column's own shape admits the JSON null and
 * a re-creation may not hand the database one. A copy that named nobody would be refused by
 * `subject_request_subject_check` on the insert — the table's own sentence, left to speak for
 * itself as `recordSubjectRequest` leaves the clock's.
 */
const EMPTY_SET = { emails: [], names: [], other: [] };

/**
 * **Re-create the pair a dump older than the request does not carry**, from the copy, in one
 * transaction — the subject request the routine opens and the erasure request it runs on.
 *
 * **The pseudonym is the copy's, and that is the whole point.** `openTheRoutine` inserts the
 * request's row with a freshly minted pseudonym `ON CONFLICT DO NOTHING` and then *reads the
 * row back*, so the id it rewrites this workspace's history to is whatever the row already
 * holds. Writing the row here, with the copy's pseudonym on it, is therefore how the replay
 * re-uses the first run's name for this person: the routine's insert finds a row, does nothing,
 * and reads back the id the history was already rewritten to. A routine that minted a second
 * one would leave one person with two names for one erasure, and a history rewritten twice.
 *
 * **The clock the row carries is a reconstruction, and says so.** The copy holds one instant —
 * the completion — and not the receipt, the clock's start or the deadline, because those are
 * the request's record and not a re-run's input. So the re-created row is dated from the
 * completion: received then, its clock started then, due a month on. The real dates went with
 * the dump, and a restore is not where they come back; what matters to the routine is the
 * identifier set, the person and the pseudonym, all of which are exact. The four beyond-use
 * dates run from the same instant through the routine's own arithmetic, so the replayed
 * report's promises about the backups are the routine's promises and not a second set.
 *
 * **`completed_at` is left null**, so the routine completes the request itself and the ledger
 * carries a completion for the run that actually happened.
 *
 * Both inserts are `ON CONFLICT DO NOTHING`, which makes this safe to run over a dump that
 * carries one row and not the other — a subject request recorded before the dump whose routine
 * ran after it — and safe to run twice.
 */
export const restoreFromReplayCopy = async (
  platform: ErasurePrincipal,
  door: PostgresDoor,
  copy: ReplayCopy,
): Promise<Result<void, Error>> => {
  const receivedAt = new Date(copy.completedAt);
  const beyondUse = beyondUseFrom(receivedAt);
  const restored = await attempt(() =>
    withScope(platform, door, copy.workspaceId, async (tx) => {
      await tx.query(
        `INSERT INTO subject_request
           (workspace_id, id, person_id, identifiers, kind, received_at, clock_started_at, due_at)
         VALUES ($1, $2, $3, $4, 'erasure', $5, $5, $6)
         ON CONFLICT (workspace_id, id) DO NOTHING`,
        [
          copy.workspaceId,
          copy.subjectRequestId,
          // Absent on the copy where the subject holds no login, and null in the column: the
          // one place the copy's absent key becomes the row's NULL.
          copy.personId ?? null,
          copy.identifiers ?? EMPTY_SET,
          receivedAt,
          dueDateOf(receivedAt),
        ],
      );
      await tx.query(
        `INSERT INTO erasure_request
           (workspace_id, id, subject_request_id, pseudonym, locked_at, anchored_at,
            beyond_use_hourly_at, beyond_use_daily_at, beyond_use_weekly_at,
            beyond_use_monthly_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id, subject_request_id) DO NOTHING`,
        [
          copy.workspaceId,
          copy.erasureRequestId,
          copy.subjectRequestId,
          copy.pseudonym,
          receivedAt,
          beyondUse.hourly,
          beyondUse.daily,
          beyondUse.weekly,
          beyondUse.monthly,
        ],
      );
    }),
  );
  return restored.ok ? ok(undefined) : err(restored.error);
};

/** The detail one row of the act carries, from what the replay knows about the request. */
const detailOf = (erasure: ReplayableErasure): ReplayedDetail => ({
  erasureRequestId: erasure.erasureRequestId,
  subjectRequestId: erasure.subjectRequestId,
  fromReplayCopy: erasure.copy !== undefined,
});

/**
 * The replay's own ledger row, in its request's workspace.
 *
 * It is written in a transaction of its own rather than with the rows it describes, which is
 * the one place this slice departs from `[AUDIT1]`'s shape, and deliberately: the rows this act
 * describes are the *routine's*, and the routine commits several transactions behind a session
 * lock it holds itself, each already landing its own event (`people.erasure.completed`). What
 * this row records is a different fact from any of them — that the **estate**, restoring itself,
 * ran that routine again — and it is written only after the routine reported it done, so a row
 * here never claims a replay that did not happen. The door is called bare (ADR 0014 rule 4).
 */
const recordTheReplay = async (
  platform: ErasurePrincipal,
  door: PostgresDoor,
  erasure: ReplayableErasure,
): Promise<string> => {
  const auditEventId = ulid();
  await withScope(platform, door, erasure.workspaceId, (tx) =>
    record(platform, tx, {
      id: auditEventId,
      act: REPLAY_ACTS.replayed,
      subjectId: erasure.erasureRequestId,
      detail: detailOf(erasure),
    }),
  );
  return auditEventId;
};

/**
 * **Run every erasure completed after `since`, oldest first, and stop at the first one that
 * cannot be run.**
 *
 * Stopping is the decision this function exists to make. A replay that carried on past a
 * failure would hand the restore a list with a hole in it, and the next step of every restore
 * script is to start `api` — so the estate would come up serving a workspace whose erasure was
 * undone by the dump and not re-applied, with nothing but a log line to say so. The error names
 * the request it stopped at and how many ran before it, because the operator reading it is
 * halfway through a restore and needs to know where to start again. The routine is idempotent,
 * so starting again means running the same command again.
 *
 * A request read from a copy is re-created before it is run; one the rows still hold is run as
 * it stands. Each is run under the platform's own principal — never a person's session — and
 * leaves one ledger row.
 */
export const replayErasures = async (
  platform: ErasurePrincipal,
  doors: ReplayDoors,
  input: { readonly since: Date },
): Promise<Result<readonly ReplayedErasure[], Error>> => {
  const owed = await replayableErasures(platform, doors, input);
  if (!owed.ok) return err(owed.error);

  const replayed: ReplayedErasure[] = [];
  for (const erasure of owed.value) {
    const stopped = (cause: unknown): Error =>
      new Error(
        `erasure: the replay stopped at ${erasure.erasureRequestId} in workspace ` +
          `${erasure.workspaceId} after replaying ${String(replayed.length)}: ${String(cause)}`,
      );

    if (erasure.copy !== undefined) {
      const restored = await restoreFromReplayCopy(platform, doors.postgres, erasure.copy);
      if (!restored.ok) return err(stopped(restored.error));
    }

    // Sequential, and the subject request's id: the routine takes the *request*, not the
    // erasure the request produced, and both are ULIDs at this boundary.
    const run = await runErasure(platform, doors, {
      workspaceId: erasure.workspaceId,
      subjectRequestId: erasure.subjectRequestId,
    });
    if (!run.ok) return err(stopped(run.error));

    const recorded = await attempt(() => recordTheReplay(platform, doors.postgres, erasure));
    if (!recorded.ok) return err(stopped(recorded.error));

    replayed.push({
      workspaceId: erasure.workspaceId,
      subjectRequestId: erasure.subjectRequestId,
      erasureRequestId: erasure.erasureRequestId,
      completedAt: run.value.completedAt,
      fromReplayCopy: erasure.copy !== undefined,
      auditEventId: recorded.value,
    });
  }
  return ok(replayed);
};
