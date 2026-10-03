import {
  attempt,
  err,
  ok,
  pendingClockOf,
  type PendingClock,
  type PlatformPrincipal,
  type Result,
  type SecondFactorFacts,
  type SecondFactorStanding,
  standingOf,
} from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withIdentityWrite } from "../store/postgres/index.ts";
import { ADMIN, mustHoldOneOf } from "./second-factor.ts";

/** The session the transport holds: by id once the library has read it, by token from its cookie. */
export type SessionNamed = { readonly id: string } | { readonly token: string };

export type SessionStanding = {
  readonly sessionId: string;
  readonly personId: string;
  readonly standing: SecondFactorStanding;
};

type StandingRow = SecondFactorFacts & {
  readonly sessionId: string;
  readonly personId: string;
  readonly pendingSince: Date | null;
  readonly promoted: boolean;
};

const facts = (keyedBy: "id" | "token") => `
  SELECT s.id AS "sessionId", s.user_id AS "personId", ${mustHoldOneOf("u")} AS "mustHoldOne",
         EXISTS (SELECT 1 FROM passkey p WHERE p.user_id = u.id)
           OR EXISTS (SELECT 1 FROM authenticator a WHERE a.user_id = u.id AND a.verified)
           AS "holdsAFactor",
         s.second_factor_confirmed_at IS NOT NULL AS confirmed,
         s.setup_granted_at IS NOT NULL
           AND s.setup_granted_at >= COALESCE(u.restore_required_at, '-infinity') AS "setupGranted",
         s.pending_since AS "pendingSince",
         u.promoted_at IS NOT NULL AS promoted
    FROM session s JOIN "user" u ON u.id = s.user_id
   WHERE s.${keyedBy} = $1`;

const FACTS_BY_ID = facts("id");

const FACTS_BY_TOKEN = facts("token");

const keyOf = (session: SessionNamed): readonly [string, string] =>
  "id" in session ? [FACTS_BY_ID, session.id] : [FACTS_BY_TOKEN, session.token];

/** A row another transaction holds is skipped, never waited on: the next read writes it. */
const UNHELD_SESSION = "(SELECT id FROM session WHERE id = $1 FOR UPDATE SKIP LOCKED)";

const STARTED = `UPDATE session SET pending_since = $2
                  WHERE id = ${UNHELD_SESSION} AND pending_since IS NULL`;

const STOPPED = `UPDATE session SET pending_since = NULL WHERE id = ${UNHELD_SESSION}`;

const ENDED = `DELETE FROM session WHERE id = ${UNHELD_SESSION}`;

const NO_LONGER_PROMOTED = `
  UPDATE "user" SET promoted_at = NULL
   WHERE id = (SELECT id FROM "user" WHERE id = $1 AND promoted_at IS NOT NULL
                FOR UPDATE SKIP LOCKED)`;

type Due = { readonly clock: PendingClock; readonly unpromoted: boolean };

const dueOf = (row: StandingRow, now: Date): Due => ({
  clock: pendingClockOf(standingOf(row), row.pendingSince, now),
  // A promotion cleared every stamp, so any stamp now is a confirmation made since.
  unpromoted: row.promoted && standingOf(row) === "confirmed",
});

const writesNothing = (due: Due): boolean =>
  (due.clock === "none" || due.clock === "run") && !due.unpromoted;

const writing = async (tx: Tx, row: StandingRow, due: Due, now: Date): Promise<void> => {
  if (due.clock === "start") await tx.query(STARTED, [row.sessionId, now]);
  if (due.clock === "stop") await tx.query(STOPPED, [row.sessionId]);
  if (due.clock === "end") await tx.query(ENDED, [row.sessionId]);
  if (due.unpromoted) await tx.query(NO_LONGER_PROMOTED, [row.personId]);
};

/** Read outside a transaction, which opens only when a write is due: most reads write nothing. */
const judging = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly session: SessionNamed; readonly now: Date },
): Promise<SessionStanding | undefined> => {
  const [statement, key] = keyOf(input.session);
  const row = (await door.pool.query<StandingRow>(statement, [key, ADMIN])).rows[0];
  if (row === undefined) return undefined;
  const due = dueOf(row, input.now);
  if (!writesNothing(due)) {
    await withIdentityWrite(platform, door, (tx) => writing(tx, row, due, input.now));
  }
  // Past its hour, a session reads as gone whether or not this read could end it.
  if (due.clock === "end") return undefined;
  return { sessionId: row.sessionId, personId: row.personId, standing: standingOf(row) };
};

/**
 * The gate's one read of a session: its second-factor standing, derived afresh. It starts a
 * pending session's hour on the first pending read, stops it once the session is no longer
 * pending, and ends a session pending past its hour, answering `session-gone`.
 */
export const judgeTheSession = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly session: SessionNamed; readonly now: Date },
): Promise<Result<SessionStanding, "session-gone" | Error>> => {
  const judged = await attempt(() => judging(platform, door, input));
  if (!judged.ok) return err(judged.error);
  return judged.value === undefined ? err("session-gone") : ok(judged.value);
};
