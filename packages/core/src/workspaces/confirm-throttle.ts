import { boundarySchemas } from "@better-answers/schema";
import type { THROTTLED_KINDS } from "@better-answers/schema/second-factor";

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
import type { WorkspaceRefusal } from "./vocabulary.ts";

export type ThrottledKind = (typeof THROTTLED_KINDS)[number];

export type Waits = Readonly<Record<ThrottledKind, number>>;

const FREE_FAILURES = 5;

const NOTICE_AT_FAILURE = 5;

const FIRST_WAIT_SECONDS = 30;

const LONGEST_WAIT_SECONDS = 15 * 60;

/** Capped rather than a lock: whoever holds only the mailbox can slow an Admin's confirms, never shut the Admin out. */
const waitSecondsAfter = (failures: number): number =>
  failures <= FREE_FAILURES
    ? 0
    : Math.min(FIRST_WAIT_SECONDS * 2 ** (failures - FREE_FAILURES - 1), LONGEST_WAIT_SECONDS);

const secondsUntil = (until: Date | null, now: Date): number =>
  until === null ? 0 : Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 1000));

type ThrottleRow = {
  readonly kind: string;
  readonly failures: number;
  readonly waitUntil: Date | null;
  readonly noticedAt: Date | null;
};

const ROWS = `
  SELECT kind, failures, wait_until AS "waitUntil", noticed_at AS "noticedAt"
    FROM second_factor_throttle WHERE user_id = $1`;

const rowsOf = async (tx: Tx, personId: UserId): Promise<readonly ThrottleRow[]> =>
  (await tx.query<ThrottleRow>(ROWS, [personId])).rows;

/** Each kind's wait left, in seconds: none for a kind with no failures counted. */
export const waitsOf = async (tx: Tx, personId: UserId, now: Date): Promise<Waits> => {
  const rows = await rowsOf(tx, personId);
  const waitOf = (kind: ThrottledKind) =>
    secondsUntil(rows.find((row) => row.kind === kind)?.waitUntil ?? null, now);
  return {
    authenticator: waitOf("authenticator"),
    "recovery-code": waitOf("recovery-code"),
    "restore-code": waitOf("restore-code"),
  };
};

export type Counted = {
  readonly waitSeconds: number;

  /** True at the failure that makes the run long enough to warn the person, and never again before a success. */
  readonly noticeDue: boolean;
};

const COUNTING = `
  INSERT INTO second_factor_throttle (user_id, kind, failures, wait_until, noticed_at)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (user_id, kind) DO UPDATE
    SET failures = EXCLUDED.failures, wait_until = EXCLUDED.wait_until,
        noticed_at = EXCLUDED.noticed_at`;

const NOTHING_COUNTED = { failures: 0, noticedAt: null } as const;

const afterOneMore = (earlier: Pick<ThrottleRow, "failures" | "noticedAt">, now: Date) => {
  const failures = earlier.failures + 1;
  const waitSeconds = waitSecondsAfter(failures);
  const noticeDue = failures >= NOTICE_AT_FAILURE && earlier.noticedAt === null;
  return {
    failures,
    waitUntil: waitSeconds === 0 ? null : new Date(now.getTime() + waitSeconds * 1000),
    noticedAt: noticeDue ? now : earlier.noticedAt,
    counted: { waitSeconds, noticeDue },
  };
};

/** Run under the person's lock, so two failures at once each count. */
export const countingAFailure = async (
  tx: Tx,
  personId: UserId,
  kind: ThrottledKind,
  now: Date,
): Promise<Counted> => {
  const earlier = (await rowsOf(tx, personId)).find((row) => row.kind === kind);
  const next = afterOneMore(earlier ?? NOTHING_COUNTED, now);
  await tx.query(COUNTING, [personId, kind, next.failures, next.waitUntil, next.noticedAt]);
  return next.counted;
};

/** A success forgets the kind's failures, its wait and its notice. */
export const resettingTheThrottle = async (
  tx: Tx,
  personId: UserId,
  kinds: readonly ThrottledKind[],
): Promise<void> => {
  await tx.query("DELETE FROM second_factor_throttle WHERE user_id = $1 AND kind = ANY($2)", [
    personId,
    [...kinds],
  ]);
};

type ThrottleInput = {
  readonly personId: string;
  readonly kind: ThrottledKind;
  readonly now: Date;
};

export type ReadConfirmWaitRefusal = WorkspaceRefusal<"malformed">;

/** Asked before a code is checked, so a kind still waiting is refused without a guess spent. */
export const readConfirmWait = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ThrottleInput,
): Promise<Result<{ readonly waitSeconds: number }, ReadConfirmWaitRefusal | Error>> => {
  const asked = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!asked.success) return err("malformed");

  const waits = await attempt(() =>
    withIdentityRead(platform, door, (tx) => waitsOf(tx, asked.data, input.now)),
  );
  return waits.ok ? ok({ waitSeconds: waits.value[input.kind] }) : err(waits.error);
};

export type CountFailedConfirmRefusal = WorkspaceRefusal<"malformed" | "person-gone">;

/**
 * Counts one failed code for the person, whichever session sent it, so many sessions never
 * multiply the guesses. Answers the wait it now costs and whether to send the one notice.
 */
export const countFailedConfirm = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ThrottleInput,
): Promise<Result<Counted, CountFailedConfirmRefusal | Error>> => {
  const personId = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!personId.success) return err("malformed");

  const counted = await attempt(() =>
    withIdentityWrite(platform, door, async (tx): Promise<Result<Counted, "person-gone">> => {
      if (!(await holdThePerson(tx, personId.data))) return err("person-gone");
      return ok(await countingAFailure(tx, personId.data, input.kind, input.now));
    }),
  );
  if (!counted.ok) return err(counted.error);
  return counted.value;
};
