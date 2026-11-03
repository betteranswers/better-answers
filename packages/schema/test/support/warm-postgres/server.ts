import pg from "pg";
import { inject } from "vitest";

import type { MigratedPostgres } from "../harness.ts";
import type { WarmPostgres } from "../warm-postgres.ts";

export const codeOf = (error: Error): string =>
  "code" in error && typeof error.code === "string" ? error.code : error.message;

type Durability = {
  readonly fsync: string;
  readonly synchronous_commit: string;
  readonly full_page_writes: string;
};

export const durabilityOf = async (db: MigratedPostgres): Promise<Durability> => {
  const [fsync, synchronousCommit, fullPageWrites] = await Promise.all([
    db.pool.query<{ fsync: string }>("SHOW fsync"),
    db.pool.query<{ synchronous_commit: string }>("SHOW synchronous_commit"),
    db.pool.query<{ full_page_writes: string }>("SHOW full_page_writes"),
  ]);
  return {
    fsync: fsync.rows[0]?.fsync ?? "",
    synchronous_commit: synchronousCommit.rows[0]?.synchronous_commit ?? "",
    full_page_writes: fullPageWrites.rows[0]?.full_page_writes ?? "",
  };
};

export const DURABILITY_OFF: Durability = {
  fsync: "off",
  synchronous_commit: "off",
  full_page_writes: "off",
};

export const warmOfThisRun = (): WarmPostgres => {
  const warm = inject("warmPostgres");
  if (warm === undefined) throw new Error("this run provided no warm cluster");
  return warm;
};

export const onDatabase = (connectionUri: string, database: string): string => {
  const uri = new URL(connectionUri);
  uri.pathname = `/${database}`;
  return uri.toString();
};

export const adminUri = (): string => onDatabase(warmOfThisRun().connectionUri, "postgres");

export const quoted = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

export const asAdmin = async <T>(work: (admin: pg.Client) => Promise<T>): Promise<T> => {
  const admin = new pg.Client({ connectionString: adminUri() });
  await admin.connect();
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
};

export const oidOf = (database: string): Promise<string | undefined> =>
  asAdmin(async (admin) => {
    const found = await admin.query<{ oid: string }>(
      "SELECT oid::text AS oid FROM pg_database WHERE datname = $1",
      [database],
    );
    return found.rows[0]?.oid;
  });

export const isOnTheServer = async (database: string): Promise<boolean> =>
  (await oidOf(database)) !== undefined;

export const dropEach = (databases: readonly string[]): Promise<void> =>
  asAdmin(async (admin) => {
    const found = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname = ANY($1)",
      [databases],
    );
    for (const { datname } of found.rows) {
      await admin.query(`ALTER DATABASE ${quoted(datname)} WITH IS_TEMPLATE false`);
      await admin.query(`DROP DATABASE ${quoted(datname)} WITH (FORCE)`);
    }
  });
