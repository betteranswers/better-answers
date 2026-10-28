import type pg from "pg";

import type { KernelRefusal, PlatformPrincipal } from "../../kernel/index.ts";
import type { PostgresDoor, Tx } from "./door.ts";
import { answersARefusal } from "./folding.ts";

const rollbackQuietly = async (client: pg.PoolClient): Promise<void> => {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The connection is already gone; releasing it below is all that is left.
  }
};

const commit = async (client: pg.PoolClient): Promise<void> => {
  const answer = await client.query("COMMIT");

  if (answer.command !== "COMMIT") {
    throw new Error(
      `the transaction did not commit: Postgres answered "${answer.command}" — a failed statement was caught inside the work, and nothing landed`,
    );
  }
};

const SETTLED =
  "the transaction has settled: a query kept past its commit or rollback reaches no transaction";

const lent = async <T>(client: pg.PoolClient, work: (tx: Tx) => Promise<T>): Promise<T> => {
  let settled = false;
  const query = new Proxy(client.query.bind(client), {
    apply: (target, thisArg, args) =>
      // oxlint-disable-next-line typescript/no-unsafe-return -- lib types ProxyHandler.apply as any; the Proxy hands the call back as pg's own overloaded query type
      settled
        ? Promise.reject(new Error(SETTLED))
        : Function.prototype.apply.call(target, thisArg, args),
  });
  try {
    return await work({ query });
  } finally {
    settled = true;
  }
};

export type Opening = "BEGIN" | "BEGIN READ ONLY";

export const transaction = async <T>(
  door: PostgresDoor,
  work: (tx: Tx) => Promise<T>,
  refuses: (answer: T) => boolean = answersARefusal,
  opening: Opening = "BEGIN",
): Promise<T> => {
  const client = await door.pool.connect();
  try {
    await client.query(opening);
    const answer = await lent(client, work);
    if (refuses(answer)) await rollbackQuietly(client);
    else await commit(client);
    return answer;
  } catch (cause) {
    await rollbackQuietly(client);
    throw cause;
  } finally {
    client.release();
  }
};

const DEADLOCK_DETECTED = "40P01";

export const refusalOfDeadlock = (error: Error): KernelRefusal<"changed-meanwhile"> | Error =>
  "code" in error && error.code === DEADLOCK_DETECTED ? "changed-meanwhile" : error;

export const scopeTo = async (tx: Tx, workspaceId: string): Promise<void> => {
  await tx.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
};

type ScopedWork<T> = (tx: Tx, platform: PlatformPrincipal) => Promise<T>;

const scopedTo =
  <T>(platform: PlatformPrincipal, workspaceId: string, work: ScopedWork<T>) =>
  async (tx: Tx): Promise<T> => {
    await scopeTo(tx, workspaceId);
    return work(tx, platform);
  };

export const withScope = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: string,
  work: ScopedWork<T>,
): Promise<T> => transaction(door, scopedTo(platform, workspaceId, work));

export const withScopeRead = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  workspaceId: string,
  work: ScopedWork<T>,
): Promise<T> =>
  transaction(door, scopedTo(platform, workspaceId, work), answersARefusal, "BEGIN READ ONLY");

export const withIdentityWrite = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> => transaction(door, (tx) => work(tx, platform));

export const withIdentityRead = async <T>(
  platform: PlatformPrincipal,
  door: PostgresDoor,
  work: (tx: Tx, platform: PlatformPrincipal) => Promise<T>,
): Promise<T> => transaction(door, (tx) => work(tx, platform), answersARefusal, "BEGIN READ ONLY");
