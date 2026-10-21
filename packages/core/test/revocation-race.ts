import type pg from "pg";

import type { PostgresDoor } from "../src/store/postgres/index.ts";
import { lendingOnceSettled, until } from "./suite-postgres.ts";

export const backendPidOf = async (client: pg.PoolClient): Promise<number> => {
  const found = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = found.rows[0]?.pid;
  if (pid === undefined) throw new Error("the connection did not name its backend");
  return pid;
};

export const isBlockedOnALock = async (pool: pg.Pool, pid: number): Promise<boolean> => {
  const found = await pool.query("SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted", [pid]);
  return (found.rowCount ?? 0) > 0;
};

type Parking = (
  writeThenRevoke: (parked: () => Promise<boolean>) => Promise<void>,
) => Promise<void>;

/** A write, parked by `parking`, with a revocation queued behind it before it resumes. */
export const writeRevokedWhileParked = async <T>(
  pool: pg.Pool,
  door: PostgresDoor,
  race: {
    readonly write: (postgres: PostgresDoor) => Promise<T>;
    readonly revoke: (client: pg.PoolClient) => Promise<unknown>;
  },
  parking: Parking,
): Promise<T> => {
  const revoker = await pool.connect();
  let acting: Promise<T> | undefined;
  let revoking: Promise<unknown> = Promise.resolve();
  const postgres = { ...door, pool: lendingOnceSettled(door.pool, () => revoking) };
  try {
    await parking(async (parked) => {
      acting = race.write(postgres);
      await until(parked);

      const pid = await backendPidOf(revoker);
      revoking = race.revoke(revoker);
      await until(() => isBlockedOnALock(pool, pid));
    });
    await revoking;
  } finally {
    revoker.release();
  }
  if (acting === undefined) throw new Error("the write was never started");
  return acting;
};
