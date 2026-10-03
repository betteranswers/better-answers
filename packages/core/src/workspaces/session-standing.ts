import {
  attempt,
  err,
  ok,
  pendingClockOf,
  type PlatformPrincipal,
  type Result,
  type Role,
  type SecondFactorFacts,
  type SecondFactorStanding,
  standingOf,
} from "../kernel/index.ts";
import { type PostgresDoor, type Tx, withIdentityWrite } from "../store/postgres/index.ts";

const ADMIN: Role = "Admin";

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
  SELECT s.id AS "sessionId", s.user_id AS "personId",
         u.operator OR EXISTS (SELECT 1 FROM member m WHERE m.user_id = u.id AND m.role = $2)
           AS "mustHoldOne",
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

/** False when the session's pending hour is past: ended here, or refused as if it were. */
const clocked = async (tx: Tx, row: StandingRow, now: Date): Promise<boolean> => {
  const clock = pendingClockOf(standingOf(row), row.pendingSince, now);
  if (clock === "start") await tx.query(STARTED, [row.sessionId, now]);
  if (clock === "stop") await tx.query(STOPPED, [row.sessionId]);
  if (clock !== "end") return true;
  await tx.query(ENDED, [row.sessionId]);
  return false;
};

/** A promotion cleared every stamp, so any stamp now is a confirmation made since. */
const confirmedSincePromotion = async (tx: Tx, row: StandingRow): Promise<void> => {
  if (row.promoted && standingOf(row) === "confirmed") {
    await tx.query(NO_LONGER_PROMOTED, [row.personId]);
  }
};

/** Undefined, not a refusal, for an ended session: a refusal would roll its deletion back. */
const judging = async (
  tx: Tx,
  session: SessionNamed,
  now: Date,
): Promise<SessionStanding | undefined> => {
  const [statement, key] = keyOf(session);
  const row = (await tx.query<StandingRow>(statement, [key, ADMIN])).rows[0];
  if (row === undefined || !(await clocked(tx, row, now))) return undefined;
  await confirmedSincePromotion(tx, row);
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
  const judged = await attempt(() =>
    withIdentityWrite(platform, door, (tx) => judging(tx, input.session, input.now)),
  );
  if (!judged.ok) return err(judged.error);
  return judged.value === undefined ? err("session-gone") : ok(judged.value);
};
