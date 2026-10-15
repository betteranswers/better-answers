import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { action, declareIdentitySetActions, type EndedSession } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  type PlatformPrincipal,
  type Result,
  type UserId,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityRead,
  withIdentityWrite,
} from "../store/postgres/index.ts";
import { holdThePerson } from "./person-lock.ts";
import { recordingTheirOwn } from "./second-factor.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** A sign-out names what it ended, so the rows it deleted are recorded before they go. */
const SESSION_ACTIONS = declareIdentitySetActions("people", {
  sessionsEnded: action("people.person.sessions_ended", { sessions: "sessions" }),
});

/** An agent the lists cannot name is still a session, so it is named by what no device claims. */
const UNKNOWN_DEVICE = "Unknown device";

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, "Edge"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

/** An iPhone names Mac OS X and Android names Linux, so each is read before those. */
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

const wordIn = (
  userAgent: string,
  words: readonly (readonly [RegExp, string])[],
): string | undefined => words.find(([names]) => names.test(userAgent))?.[1];

/** `Chrome on macOS`, read from the agent alone; never the raw string, and no address beside it. */
const deviceOf = (userAgent: string | null): string => {
  if (userAgent === null) return UNKNOWN_DEVICE;
  const browser = wordIn(userAgent, BROWSERS);
  const system = wordIn(userAgent, SYSTEMS);
  return browser === undefined || system === undefined ? UNKNOWN_DEVICE : `${browser} on ${system}`;
};

/** One of the person's own sessions, as the Sessions section shows it. */
export type SessionShown = {
  readonly id: string;

  /** Read from the session's user agent; an unreadable one reads as no known device. */
  readonly device: string;

  /** An ISO instant, as it crosses the wire. */
  readonly lastActiveAt: string;

  /** The session the read is made from, which alone carries no sign-out. */
  readonly current: boolean;
};

type SessionRow = {
  readonly id: string;
  readonly userAgent: string | null;
  readonly lastActiveAt: Date;
};

/** Each id as the boundary names it, or nothing: a caller's id is never trusted to be well formed. */
const idsOf = (input: { readonly personId: string; readonly sessionId: string }) => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  const sessionId = boundarySchemas.session.select.shape.id.safeParse(input.sessionId);
  return personId.success && sessionId.success
    ? { personId: personId.data, sessionId: sessionId.data }
    : undefined;
};

/** The current session first, then the rest newest first. No address is read; an expired row is the sweep's. */
const SESSIONS_OF_PERSON = `SELECT id, user_agent AS "userAgent", updated_at AS "lastActiveAt"
                       FROM session WHERE user_id = $1 AND expires_at > $3
                      ORDER BY (id = $2) DESC, updated_at DESC, id DESC`;

export type ReadSessionsRefusal = WorkspaceRefusal<"malformed"> | Error;

/**
 * The person's own live sessions alone, in the order the Sessions section shows them. The address
 * a session came from never leaves the store.
 */
export const readSessions = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string; readonly sessionId: string; readonly now: Date },
): Promise<Result<readonly SessionShown[], ReadSessionsRefusal>> => {
  const ids = idsOf(input);
  if (ids === undefined) return err("malformed");

  const read = await attempt(() =>
    withIdentityRead(platform, door, async (tx) =>
      (
        await tx.query<SessionRow>(SESSIONS_OF_PERSON, [ids.personId, ids.sessionId, input.now])
      ).rows.map((row) => ({
        id: row.id,
        device: deviceOf(row.userAgent),
        lastActiveAt: row.lastActiveAt.toISOString(),
        current: row.id === ids.sessionId,
      })),
    ),
  );
  return read;
};

/** What a page sends to sign one of the person's own sessions out. */
export const endOneSessionInput = z.object({ sessionId: z.string() });

type EndedRow = {
  readonly id: string;
  readonly userAgent: string | null;
  readonly lastActiveAt: Date;
};

/** The detail's name for each session an act ended: its id, its device, and when it was last active. */
const endedSessions = (rows: readonly EndedRow[]): readonly EndedSession[] =>
  rows.map((row) => ({
    sessionId: row.id,
    device: deviceOf(row.userAgent),
    lastActiveAt: row.lastActiveAt.toISOString(),
  }));

/** One record of the person's own, naming the sessions their sign-out ended. */
const recording = (
  platform: PlatformPrincipal,
  tx: Tx,
  personId: UserId,
  rows: readonly EndedRow[],
): Promise<void> =>
  rows.length === 0
    ? Promise.resolve()
    : recordingTheirOwn(platform, tx, personId, SESSION_ACTIONS.sessionsEnded, {
        sessions: endedSessions(rows),
      });

const RETURNED_ENDED = `RETURNING id, user_agent AS "userAgent", updated_at AS "lastActiveAt"`;

/** $1 binds the read's own session, $2 the person, $3 the instant: an expired row is the sweep's, never an act's. */
const GONE = `DELETE FROM session WHERE expires_at > $3 AND`;

/** Holds the person's row, ends the live sessions `rest` names, and records the act naming them. */
const ending = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  ids: { readonly personId: UserId; readonly sessionId: string },
  now: Date,
  rest: string,
): Promise<Result<readonly EndedRow[], "person-gone" | Error>> => {
  const ended = await attempt(() =>
    withIdentityWrite(
      platform,
      door,
      async (tx): Promise<Result<readonly EndedRow[], "person-gone">> => {
        if (!(await holdThePerson(tx, ids.personId))) return err("person-gone");
        const gone = await tx.query<EndedRow>(`${GONE} ${rest} ${RETURNED_ENDED}`, [
          ids.sessionId,
          ids.personId,
          now,
        ]);
        await recording(platform, tx, ids.personId, gone.rows);
        return ok(gone.rows);
      },
    ),
  );
  return ended.ok ? ended.value : err(ended.error);
};

export type SessionsEnded = { readonly ended: number };

export type EndOneSessionRefusal =
  | WorkspaceRefusal<"malformed" | "person-gone" | "session-gone">
  | Error;

/** Ends one of the person's own sessions, and nothing else: no token of theirs, no one else's. */
export const endOneSession = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string; readonly now: Date } & z.output<typeof endOneSessionInput>,
): Promise<Result<SessionsEnded, EndOneSessionRefusal>> => {
  const ids = idsOf(input);
  if (ids === undefined) return err("malformed");

  const ended = await ending(platform, door, ids, input.now, `id = $1 AND user_id = $2`);
  if (!ended.ok) return err(ended.error);
  const [row] = ended.value;
  return row === undefined ? err("session-gone") : ok({ ended: 1 });
};

export type EndOtherSessionsRefusal = WorkspaceRefusal<"malformed" | "person-gone"> | Error;

/**
 * Ends every session the person holds but the one the request runs in, and no token of theirs.
 * No record is written when the current session was the only one.
 */
export const endOtherSessions = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly personId: string; readonly sessionId: string; readonly now: Date },
): Promise<Result<SessionsEnded, EndOtherSessionsRefusal>> => {
  const ids = idsOf(input);
  if (ids === undefined) return err("malformed");

  const ended = await ending(platform, door, ids, input.now, `user_id = $2 AND id <> $1`);
  return ended.ok ? ok({ ended: ended.value.length }) : err(ended.error);
};
