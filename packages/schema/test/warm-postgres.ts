import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { expect, inject } from "vitest";
import type { TestProject } from "vitest/node";

import { MARK_THE_MATCH_LEAKPROOF, migrationsFolder } from "../src/index.ts";
import { POSTGRES_IMAGE } from "../src/postgres-image.ts";
import {
  endPool,
  migrateAsDeployed,
  type MigratedPostgres,
  migratedPostgresOver,
  POSTGRES_COMMAND,
  startMigratedPostgres,
} from "./harness.ts";

export type WarmPostgres = {
  readonly connectionUri: string;

  readonly templateDatabase: string;

  /** The vitest main process's pid, which every per-file database name ends with. */
  readonly runId: number;

  readonly source: "shared" | "container";
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

const migrateInto = async (databaseUri: string): Promise<void> => {
  const migrationPool = new pg.Pool({ connectionString: databaseUri, max: 1 });
  try {
    await migrateAsDeployed(migrationPool);
  } finally {
    await endPool(migrationPool);
  }
};

const HARNESS_SOURCE = fileURLToPath(new URL("./harness.ts", import.meta.url));

const filesUnder = async (folder: string): Promise<readonly string[]> => {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)))
    .toSorted();
};

/** Named for everything the build reads, so a branch with other migrations never clones it. */
export const templateNameOver = async (folder: string): Promise<string> => {
  const files = await filesUnder(folder);
  const contents = await Promise.all(files.map((file) => readFile(path.join(folder, file))));
  const digest = createHash("sha256");
  files.forEach((file, at) => {
    digest
      .update(`${file}\0`)
      .update(contents[at] ?? "")
      .update("\0");
  });
  digest.update(await readFile(HARNESS_SOURCE)).update(MARK_THE_MATCH_LEAKPROOF);
  return `tpl_ts_${digest.digest("hex").slice(0, 12)}`;
};

const databaseExists = async (admin: pg.Client, database: string): Promise<boolean> => {
  const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  return (found.rowCount ?? 0) > 0;
};

const dropLeftover = async (admin: pg.Client, database: string): Promise<void> => {
  if (!(await databaseExists(admin, database))) return;
  // Postgres refuses to drop a database still marked as a template.
  await admin.query(`ALTER DATABASE ${quoted(database)} WITH IS_TEMPLATE false`);
  await admin.query(`DROP DATABASE ${quoted(database)} WITH (FORCE)`);
};

const buildAndPublish = async (
  admin: pg.Client,
  adminUri: string,
  name: string,
  build: (databaseUri: string) => Promise<void>,
): Promise<void> => {
  const building = `${name}_building`;
  await dropLeftover(admin, building);
  await admin.query(`CREATE DATABASE ${quoted(building)}`);
  await build(uriForDatabase(adminUri, building));
  await untilSessionsGone(admin, building);
  await admin.query(`ALTER DATABASE ${quoted(building)} WITH ALLOW_CONNECTIONS false`);
  await admin.query(`ALTER DATABASE ${quoted(building)} WITH IS_TEMPLATE true`);
  // Published last, so a killed build never leaves a database under the name runs clone.
  await admin.query(`ALTER DATABASE ${quoted(building)} RENAME TO ${quoted(name)}`);
};

/** One key for the instance: every build creates the same cluster-wide roles, so builds take turns. */
const BUILD_LOCK = "hashtextextended('better-answers template build', 0)";

/** Builds `name` with `build` unless it is published; one build at a time on the instance. */
export const ensureTemplate = (
  adminUri: string,
  name: string,
  build: (databaseUri: string) => Promise<void>,
): Promise<string> =>
  withAdmin(adminUri, async (admin) => {
    await admin.query(`SELECT pg_advisory_lock(${BUILD_LOCK})`);
    try {
      if (!(await databaseExists(admin, name))) await buildAndPublish(admin, adminUri, name, build);
    } finally {
      await admin.query(`SELECT pg_advisory_unlock(${BUILD_LOCK})`);
    }
    return name;
  });

const LOCATOR_CONNECT_TIMEOUT_MS = 5_000;

const pointTheWayUp = (fault: string): Error =>
  new Error(
    `TEST_POSTGRES_URI ${fault}; run deploy/test-postgres.sh up and export the URI it prints, or unset TEST_POSTGRES_URI`,
  );

const reasonOf = (error: unknown): string => {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  return typeof code === "string" ? code : String(error).replaceAll(/\s+/gu, " ");
};

const isSuperuser = async (adminUri: string): Promise<boolean> => {
  const admin = new pg.Client({
    connectionString: adminUri,
    connectionTimeoutMillis: LOCATOR_CONNECT_TIMEOUT_MS,
  });
  try {
    await admin.connect();
    const role = await admin.query<{ rolsuper: boolean }>(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    return role.rows[0]?.rolsuper === true;
  } catch (error) {
    throw pointTheWayUp(`names a Postgres this run cannot sign in to (${reasonOf(error)})`);
  } finally {
    await admin.end();
  }
};

const RUN_ID_SUFFIX = /_(\d+)$/u;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return reasonOf(error) === "EPERM";
  }
};

const isDeadRun = (database: string): boolean => {
  const pid = RUN_ID_SUFFIX.exec(database)?.[1];
  return pid !== undefined && !isAlive(Number(pid));
};

const sweepDeadRuns = (adminUri: string): Promise<void> =>
  withAdmin(adminUri, async (admin) => {
    const found = await admin.query<{ datname: string }>(
      String.raw`SELECT datname FROM pg_database WHERE datname LIKE 'ba\_%'`,
    );
    for (const database of found.rows.map((row) => row.datname).filter(isDeadRun)) {
      await admin.query(`DROP DATABASE IF EXISTS ${quoted(database)} WITH (FORCE)`);
    }
  });

type Started = { readonly provided: WarmPostgres; readonly teardown: () => Promise<void> };

const startShared = async (locator: string): Promise<Started> => {
  const adminUri = uriForDatabase(locator, "postgres");
  if (!(await isSuperuser(adminUri)))
    throw pointTheWayUp("signs in as a role that is not a superuser");
  await sweepDeadRuns(adminUri);
  const name = await templateNameOver(migrationsFolder);
  const templateDatabase = await ensureTemplate(adminUri, name, migrateInto);
  return {
    provided: { connectionUri: adminUri, templateDatabase, runId: process.pid, source: "shared" },
    // The instance and its template outlive the run; each file's stop drops its own database.
    teardown: () => Promise.resolve(),
  };
};

const startContainer = async (): Promise<Started> => {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand([...POSTGRES_COMMAND])
    .start();
  const connectionUri = container.getConnectionUri();
  try {
    await withAdmin(connectionUri, async (admin) => {
      await admin.query(`CREATE DATABASE ${quoted(TEMPLATE_DATABASE)}`);
    });
    await migrateInto(uriForDatabase(connectionUri, TEMPLATE_DATABASE));
  } catch (error) {
    await container.stop();
    throw error;
  }
  return {
    provided: {
      connectionUri,
      templateDatabase: TEMPLATE_DATABASE,
      runId: process.pid,
      source: "container",
    },
    teardown: async () => {
      await container.stop();
    },
  };
};

const locatorUri = (): string | undefined => {
  const locator = process.env["TEST_POSTGRES_URI"]?.trim();
  return locator === undefined || locator === "" ? undefined : locator;
};

const startWarmPostgres = async (project: TestProject): Promise<() => Promise<void>> => {
  const locator = locatorUri();
  const started = locator === undefined ? await startContainer() : await startShared(locator);
  project.provide("warmPostgres", started.provided);
  return started.teardown;
};

export default startWarmPostgres;

const providedWarmPostgres = (): WarmPostgres | undefined => {
  try {
    return inject("warmPostgres");
  } catch {
    return undefined;
  }
};

const databaseNameFor = (databaseKey: string, runId: number): string => {
  const stem = path
    .basename(databaseKey)
    .replaceAll(/[^a-z0-9]+/giu, "_")
    .toLowerCase();
  const digest = createHash("sha256").update(databaseKey).digest("hex").slice(0, 12);
  return `ba_${stem.slice(0, 32)}_${digest}_${String(runId)}`;
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

/** A fresh copy of `warm`'s template, named after `databaseKey` and the run; `stop` drops it. */
export const clonedFrom = async (
  warm: WarmPostgres,
  databaseKey: string,
): Promise<MigratedPostgres> => {
  const database = databaseNameFor(databaseKey, warm.runId);
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

/**
 * A fresh copy of the warm template, named after `databaseKey` or the running test file; `stop`
 * drops it. Without a warm cluster, starts a container.
 */
export const openMigratedPostgres = async (databaseKey?: string): Promise<MigratedPostgres> => {
  const warm = providedWarmPostgres();
  if (warm === undefined) return startMigratedPostgres();
  return clonedFrom(warm, databaseKey ?? runningTestFile());
};
