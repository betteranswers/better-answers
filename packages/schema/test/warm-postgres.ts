import { createHash } from "node:crypto";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { expect, inject } from "vitest";
import type { TestProject } from "vitest/node";

import { POSTGRES_IMAGE } from "../src/postgres-image.ts";
import {
  migrateAsDeployed,
  type MigratedPostgres,
  migratedPostgresOver,
  POSTGRES_COMMAND,
  startMigratedPostgres,
} from "./harness.ts";

export type WarmPostgres = {
  readonly connectionUri: string;

  readonly templateDatabase: string;
};

declare module "vitest" {
  interface ProvidedContext {
    warmPostgres?: WarmPostgres;
  }
}

const TEMPLATE_DATABASE = "better_answers_template";

const quoted = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const uriForDatabase = (connectionUri: string, database: string): string => {
  const uri = new URL(connectionUri);
  uri.pathname = `/${database}`;
  return uri.toString();
};

const withAdmin = async <T>(
  connectionUri: string,
  work: (admin: pg.Client) => Promise<T>,
): Promise<T> => {
  const admin = new pg.Client({ connectionString: connectionUri });
  await admin.connect();
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
};

const SESSIONS_GONE_TIMEOUT_MS = 5_000;

const SESSIONS_GONE_POLL_MS = 20;

const sessionsOn = async (admin: pg.Client, database: string): Promise<number> => {
  const counted = await admin.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND backend_type = 'client backend'",
    [database],
  );
  return counted.rows[0]?.n ?? 0;
};

const untilSessionsGone = async (admin: pg.Client, database: string): Promise<void> => {
  const deadline = Date.now() + SESSIONS_GONE_TIMEOUT_MS;
  while ((await sessionsOn(admin, database)) > 0 && Date.now() < deadline) {
    await sleep(SESSIONS_GONE_POLL_MS);
  }
};

const startWarmPostgres = async (project: TestProject): Promise<() => Promise<void>> => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand([...POSTGRES_COMMAND])
    .start();
  const connectionUri = container.getConnectionUri();
  try {
    await withAdmin(connectionUri, async (admin) => {
      await admin.query(`CREATE DATABASE ${quoted(TEMPLATE_DATABASE)}`);
    });
    const migrationPool = new pg.Pool({
      connectionString: uriForDatabase(connectionUri, TEMPLATE_DATABASE),
      max: 1,
    });
    try {
      await migrateAsDeployed(migrationPool);
    } finally {
      await migrationPool.end();
    }
  } catch (error) {
    await container.stop();
    throw error;
  }
  project.provide("warmPostgres", { connectionUri, templateDatabase: TEMPLATE_DATABASE });
  return async () => {
    await container.stop();
  };
};

export default startWarmPostgres;

const providedWarmPostgres = (): WarmPostgres | undefined => {
  try {
    return inject("warmPostgres");
  } catch {
    return undefined;
  }
};

const databaseNameFor = (databaseKey: string): string => {
  const stem = path
    .basename(databaseKey)
    .replaceAll(/[^a-z0-9]+/giu, "_")
    .toLowerCase();
  const digest = createHash("sha256").update(databaseKey).digest("hex").slice(0, 12);
  return `ba_${stem.slice(0, 40)}_${digest}`;
};

const runningTestFile = (): string => {
  const { testPath } = expect.getState();
  if (testPath === undefined) {
    throw new Error(
      "the warm harness was opened with no running test file to name a database after; pass a key",
    );
  }
  return testPath;
};

/**
 * A fresh copy of the warm template, named after `databaseKey` or the running test file; `stop`
 * drops it. Without a warm cluster, starts a container.
 */
export const openMigratedPostgres = async (databaseKey?: string): Promise<MigratedPostgres> => {
  const warm = providedWarmPostgres();
  if (warm === undefined) return startMigratedPostgres();

  const database = databaseNameFor(databaseKey ?? runningTestFile());
  await withAdmin(warm.connectionUri, async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
    await admin.query(
      `CREATE DATABASE ${quoted(database)} TEMPLATE ${quoted(warm.templateDatabase)}`,
    );
  });
  return migratedPostgresOver(uriForDatabase(warm.connectionUri, database), async () => {
    await withAdmin(warm.connectionUri, async (admin) => {
      await untilSessionsGone(admin, database);

      await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
    });
  });
};
