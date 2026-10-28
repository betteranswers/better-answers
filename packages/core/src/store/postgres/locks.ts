import type pg from "pg";

import { err, ok, type Result } from "../../kernel/index.ts";
import type { PlatformPrincipal, Principal } from "../../kernel/index.ts";
import type { PostgresDoor } from "./door.ts";

const failedUnlocks = new WeakMap<pg.PoolClient, Error>();

const unlocking = async (
  holder: pg.PoolClient,
  query: string,
  values: readonly unknown[],
): Promise<void> => {
  try {
    await holder.query(query, [...values]);
  } catch (cause) {
    const failed = cause instanceof Error ? cause : new Error(String(cause));
    failedUnlocks.set(holder, failed);
    throw failed;
  }
};

/** A session lock outlives the connection's return to the pool, so it holds a connection alone. */
const onOwnConnection = async <T>(
  door: PostgresDoor,
  use: (holder: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const holder = await door.pool.connect();
  try {
    return await use(holder);
  } finally {
    holder.release(failedUnlocks.get(holder));
  }
};

const unlockingAfter = async <T>(
  holder: pg.PoolClient,
  key: number,
  work: () => Promise<T>,
): Promise<T> => {
  try {
    return await work();
  } finally {
    await unlocking(holder, "SELECT pg_advisory_unlock($1)", [key]);
  }
};

export const withSessionLock = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  key: number,
  work: (platform: PlatformPrincipal) => Promise<T>,
): Promise<T> =>
  onOwnConnection(door, async (holder) => {
    await holder.query("SELECT pg_advisory_lock($1)", [key]);
    return unlockingAfter(holder, key, () => work(platform));
  });

export type LockHeld = "held";

export const withSessionTryLock = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  key: number,
  work: (platform: PlatformPrincipal) => Promise<T>,
): Promise<Result<T, LockHeld>> =>
  onOwnConnection(door, async (holder): Promise<Result<T, LockHeld>> => {
    const tried = await holder.query<{ taken: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS taken",
      [key],
    );
    if (tried.rows[0]?.taken !== true) return err("held");
    return ok(await unlockingAfter(holder, key, () => work(platform)));
  });

export type FenceHold = "shared" | "exclusive";

const FENCE_KEY = "hashtext('bundle'), hashtext($1)";

const FENCE_SQL = {
  shared: {
    wait: `SELECT pg_advisory_lock_shared(${FENCE_KEY})`,
    try: `SELECT pg_try_advisory_lock_shared(${FENCE_KEY}) AS taken`,
    free: `SELECT pg_advisory_unlock_shared(${FENCE_KEY})`,
  },
  exclusive: {
    wait: `SELECT pg_advisory_lock(${FENCE_KEY})`,
    try: `SELECT pg_try_advisory_lock(${FENCE_KEY}) AS taken`,
    free: `SELECT pg_advisory_unlock(${FENCE_KEY})`,
  },
} as const satisfies Record<
  FenceHold,
  { readonly wait: string; readonly try: string; readonly free: string }
>;

export const FENCE_HOLDERS_PER_POOL = 3;

type Slots = { free: number; readonly waiting: (() => void)[] };

const slotsByPool = new WeakMap<pg.Pool, Slots>();

const slotsOf = (pool: pg.Pool): Slots => {
  const known = slotsByPool.get(pool);
  if (known !== undefined) return known;
  const slots: Slots = { free: FENCE_HOLDERS_PER_POOL, waiting: [] };
  slotsByPool.set(pool, slots);
  return slots;
};

const freeASlot = (pool: pg.Pool): void => {
  const slots = slotsOf(pool);
  const next = slots.waiting.shift();
  if (next === undefined) slots.free += 1;
  else next();
};

const inAFenceSlot = async <T>(pool: pg.Pool, work: () => Promise<T>): Promise<T> => {
  const slots = slotsOf(pool);
  if (slots.free > 0) slots.free -= 1;
  else await new Promise<void>((resolve) => slots.waiting.push(resolve));
  try {
    return await work();
  } finally {
    freeASlot(pool);
  }
};

const inAFreeFenceSlot = async <T>(
  pool: pg.Pool,
  work: () => Promise<Result<T, LockHeld>>,
): Promise<Result<T, LockHeld>> => {
  const slots = slotsOf(pool);
  if (slots.free === 0) return err("held");
  slots.free -= 1;
  try {
    return await work();
  } finally {
    freeASlot(pool);
  }
};

const fencedOn = async <T>(
  holder: pg.PoolClient,
  workspaceId: string,
  hold: FenceHold,
  work: () => Promise<T>,
): Promise<T> => {
  try {
    return await work();
  } finally {
    await unlocking(holder, FENCE_SQL[hold].free, [workspaceId]);
  }
};

export const withWorkspaceFence = async <T>(
  principal: Principal,
  door: PostgresDoor,
  workspaceId: string,
  hold: FenceHold,
  work: () => Promise<T>,
): Promise<T> =>
  inAFenceSlot(door.pool, () =>
    onOwnConnection(door, async (holder) => {
      await holder.query(FENCE_SQL[hold].wait, [workspaceId]);
      return fencedOn(holder, workspaceId, hold, work);
    }),
  );

export const tryWorkspaceFence = async <T>(
  principal: Principal,
  door: PostgresDoor,
  workspaceId: string,
  hold: FenceHold,
  work: () => Promise<T>,
): Promise<Result<T, LockHeld>> =>
  inAFreeFenceSlot(door.pool, () =>
    onOwnConnection(door, async (holder): Promise<Result<T, LockHeld>> => {
      const tried = await holder.query<{ taken: boolean }>(FENCE_SQL[hold].try, [workspaceId]);
      if (tried.rows[0]?.taken !== true) return err("held");
      return ok(await fencedOn(holder, workspaceId, hold, work));
    }),
  );
