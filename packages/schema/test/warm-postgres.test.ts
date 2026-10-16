import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";

import { testData } from "./factory.ts";
import type { MigratedPostgres } from "./harness.ts";
import {
  clonedFrom,
  ensureTemplate,
  openMigratedPostgres,
  templateNameOver,
  type WarmPostgres,
} from "./warm-postgres.ts";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const warmPostgresModule = fileURLToPath(new URL("./warm-postgres.ts", import.meta.url));

const writeModelChoice = async (db: MigratedPostgres): Promise<void> => {
  const client = await db.pool.connect();
  try {
    await testData(client).modelChoice();
  } finally {
    client.release();
  }
};

const modelChoicesIn = async (db: MigratedPostgres): Promise<number> => {
  const counted = await db.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM "model_choice"',
  );
  return counted.rows[0]?.n ?? -1;
};

const databaseNameOf = async (db: MigratedPostgres): Promise<string> => {
  const named = await db.pool.query<{ name: string }>("SELECT current_database() AS name");
  return named.rows[0]?.name ?? "";
};

const isLeftBehind = async (db: MigratedPostgres, name: string): Promise<boolean> => {
  const found = await db.pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  return (found.rowCount ?? 0) > 0;
};

const codeOf = (error: Error): string =>
  "code" in error && typeof error.code === "string" ? error.code : error.message;

type Durability = {
  readonly fsync: string;
  readonly synchronous_commit: string;
  readonly full_page_writes: string;
};

const durabilityOf = async (db: MigratedPostgres): Promise<Durability> => {
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

const warmOfThisRun = (): WarmPostgres => {
  const warm = inject("warmPostgres");
  if (warm === undefined) throw new Error("this run provided no warm cluster");
  return warm;
};

const onDatabase = (connectionUri: string, database: string): string => {
  const uri = new URL(connectionUri);
  uri.pathname = `/${database}`;
  return uri.toString();
};

const DURABILITY_OFF: Durability = {
  fsync: "off",
  synchronous_commit: "off",
  full_page_writes: "off",
};

describe("the warm harness", () => {
  it("hands back a cluster with its three durability costs off", async () => {
    const db = await openMigratedPostgres("durability");
    try {
      expect(await durabilityOf(db)).toEqual(DURABILITY_OFF);
    } finally {
      await db.stop();
    }
  });

  it("gives each file a database of its own", async () => {
    const one = await openMigratedPostgres("one-file");
    const another = await openMigratedPostgres("another-file");
    try {
      await writeModelChoice(one);

      expect({ one: await modelChoicesIn(one), another: await modelChoicesIn(another) }).toEqual({
        one: 1,
        another: 0,
      });
    } finally {
      await Promise.all([one.stop(), another.stop()]);
    }
  });

  it("hands the copy back as app_rt, the unscoped read refused", async () => {
    const db = await openMigratedPostgres();
    try {
      await writeModelChoice(db);

      const asRuntime = await db.runtimePool.query<{ role: string; modelChoices: number }>(
        'SELECT current_user AS role, (SELECT count(*)::int FROM "model_choice") AS "modelChoices"',
      );
      expect({ ...asRuntime.rows[0], asSuperuser: await modelChoicesIn(db) }).toEqual({
        role: "app_rt",
        modelChoices: 0,
        asSuperuser: 1,
      });
    } finally {
      await db.stop();
    }
  });

  it("carries the policies and runtime grants onto the copy", async () => {
    const db = await openMigratedPostgres("grants");
    try {
      const catalogue = await db.pool.query(
        `SELECT (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_choice') AS "isolationPolicy",
                EXISTS (SELECT 1 FROM pg_default_acl) AS "defaultPrivileges",
                has_schema_privilege('app_rt', 'public', 'USAGE') AS "schemaUsage",
                has_table_privilege('app_rt', 'public.model_choice', 'SELECT') AS "tableSelect"`,
      );
      expect(catalogue.rows[0]).toEqual({
        isolationPolicy: "model_choice_workspace_isolation",
        defaultPrivileges: true,
        schemaUsage: true,
        tableSelect: true,
      });
    } finally {
      await db.stop();
    }
  });

  it("drops a file's database on stop, leaving the cluster up", async () => {
    const stopped = await openMigratedPostgres("stopped");
    const name = await databaseNameOf(stopped);
    await stopped.stop();

    const next = await openMigratedPostgres("after-the-stop");
    try {
      expect({
        leftBehind: await isLeftBehind(next, name),
        served: await modelChoicesIn(next),
      }).toEqual({
        leftBehind: false,
        served: 0,
      });
    } finally {
      await next.stop();
    }
  });

  it("drops a file's database despite a stray session on it", async () => {
    const held = await openMigratedPostgres("held-open");
    const name = await databaseNameOf(held);
    const stray = new pg.Client({
      connectionString: onDatabase(warmOfThisRun().connectionUri, name),
    });
    await stray.connect();
    const terminated = new Promise<string>((resolve) => {
      stray.on("error", (error) => resolve(codeOf(error)));
    });

    await held.stop();

    const next = await openMigratedPostgres("after-held-open");
    try {
      expect({ leftBehind: await isLeftBehind(next, name), stray: await terminated }).toEqual({
        leftBehind: false,
        stray: "57P01",
      });
    } finally {
      await Promise.all([next.stop(), stray.end()]);
    }
  });

  it("re-opens a key onto a fresh database", async () => {
    const bailed = await openMigratedPostgres("re-run");
    await writeModelChoice(bailed);
    const name = await databaseNameOf(bailed);

    await bailed.pool.end();
    await bailed.runtimePool.end();

    const reopened = await openMigratedPostgres("re-run");
    try {
      expect({
        database: await databaseNameOf(reopened),
        modelChoices: await modelChoicesIn(reopened),
      }).toEqual({ database: name, modelChoices: 0 });
    } finally {
      await reopened.stop();
    }
  });

  it("starts a database of its own without a warm cluster", async () => {
    const script = [
      `import { openMigratedPostgres } from ${JSON.stringify(warmPostgresModule)};`,
      "const db = await openMigratedPostgres();",
      "const footing = await db.runtimePool.query('SELECT current_user AS role');",
      "const policies = await db.pool.query('SELECT policyname FROM pg_policies WHERE tablename = $1', ['model_choice']);",
      "const fsync = await db.pool.query('SHOW fsync');",
      "const synchronousCommit = await db.pool.query('SHOW synchronous_commit');",
      "const fullPageWrites = await db.pool.query('SHOW full_page_writes');",
      "const answer = { role: footing.rows[0].role, isolationPolicy: policies.rows[0].policyname, durability: { fsync: fsync.rows[0].fsync, synchronous_commit: synchronousCommit.rows[0].synchronous_commit, full_page_writes: fullPageWrites.rows[0].full_page_writes } };",
      "process.stdout.write(JSON.stringify(answer));",
      "await db.stop();",
    ].join("\n");

    const cold = await run(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: packageRoot,
    });

    expect(JSON.parse(cold.stdout)).toEqual({
      role: "app_rt",
      isolationPolicy: "model_choice_workspace_isolation",
      durability: DURABILITY_OFF,
    });
  }, 300_000);
});

const adminUri = (): string => onDatabase(warmOfThisRun().connectionUri, "postgres");

const quoted = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const asAdmin = async <T>(work: (admin: pg.Client) => Promise<T>): Promise<T> => {
  const admin = new pg.Client({ connectionString: adminUri() });
  await admin.connect();
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
};

const oidOf = (database: string): Promise<string | undefined> =>
  asAdmin(async (admin) => {
    const found = await admin.query<{ oid: string }>(
      "SELECT oid::text AS oid FROM pg_database WHERE datname = $1",
      [database],
    );
    return found.rows[0]?.oid;
  });

const isOnTheServer = async (database: string): Promise<boolean> =>
  (await oidOf(database)) !== undefined;

const dropEach = (databases: readonly string[]): Promise<void> =>
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

const createTable = async (databaseUri: string, table: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUri });
  await client.connect();
  try {
    await client.query(`CREATE TABLE ${quoted(table)} ()`);
  } finally {
    await client.end();
  }
};

const BUILD_PAUSE_MS = 200;

/** Records each build, and the most that ran at once, so a test can see the lock hold. */
const buildLog = () => {
  const built: string[] = [];
  let running = 0;
  let mostAtOnce = 0;
  const building =
    (table: string) =>
    async (databaseUri: string): Promise<void> => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      try {
        await sleep(BUILD_PAUSE_MS);
        await createTable(databaseUri, table);
        built.push(table);
      } finally {
        running -= 1;
      }
    };
  return { building, built: () => [...built], mostAtOnce: () => mostAtOnce };
};

/** The worker's pid keeps a concurrent run of this file on a shared server off these names. */
const scratchTemplates: string[] = [];

const scratchTemplate = (label: string): string => {
  const name = `tpl_t_${label}_${String(process.pid)}`;
  scratchTemplates.push(name, `${name}_building`);
  return name;
};

afterAll(async () => {
  await dropEach(scratchTemplates);
});

const LONG_AGO = "2020-01-01T00:00:00.000Z";

/** A published template under a tier's prefix, stamped `stamp` or left unstamped. */
const plantedTemplate = async (
  label: string,
  stamp: string | null,
  prefix = "tpl_ts_",
): Promise<string> => {
  const name = `${prefix}age_${label}_${String(process.pid)}`;
  scratchTemplates.push(name, `${name}_building`);
  await asAdmin(async (admin) => {
    await admin.query(
      `CREATE DATABASE ${quoted(name)} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`,
    );
    if (stamp !== null) await admin.query(`COMMENT ON DATABASE ${quoted(name)} IS '${stamp}'`);
  });
  return name;
};

const stampedSince = (database: string, since: number): Promise<boolean> =>
  asAdmin(async (admin) => {
    const found = await admin.query<{ stamp: string | null }>(
      "SELECT shobj_description(oid, 'pg_database') AS stamp FROM pg_database WHERE datname = $1",
      [database],
    );
    const stamp = found.rows[0]?.stamp;
    return stamp !== null && stamp !== undefined && Date.parse(stamp) >= since - 1_000;
  });

const tablesIn = async (template: string): Promise<readonly string[]> => {
  const peek = `${template}_peek`;
  await asAdmin((admin) =>
    admin.query(`CREATE DATABASE ${quoted(peek)} TEMPLATE ${quoted(template)}`),
  );
  const client = new pg.Client({ connectionString: onDatabase(adminUri(), peek) });
  await client.connect();
  try {
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    return tables.rows.map((row) => row.tablename);
  } finally {
    await client.end();
    await dropEach([peek]);
  }
};

const publishOverALeftover = async (label: string, marked: boolean) => {
  const name = scratchTemplate(label);
  const leftover = `${name}_building`;
  await asAdmin((admin) => admin.query(`CREATE DATABASE ${quoted(leftover)}`));
  await createTable(onDatabase(adminUri(), leftover), "stray");
  if (marked) {
    await asAdmin((admin) =>
      admin.query(
        `ALTER DATABASE ${quoted(leftover)} WITH ALLOW_CONNECTIONS false IS_TEMPLATE true`,
      ),
    );
  }
  await ensureTemplate(adminUri(), name, buildLog().building("fresh"));
  return { tables: await tablesIn(name), leftover: await isOnTheServer(leftover) };
};

const refusalOf = async (databaseUri: string): Promise<string> => {
  const client = new pg.Client({ connectionString: databaseUri });
  try {
    await client.connect();
    await client.end();
    return "connected";
  } catch (error) {
    return error instanceof Error ? codeOf(error) : String(error);
  }
};

type StartedInChild = Partial<WarmPostgres> & { readonly failure?: string };

const START_IN_CHILD = [
  `import startWarmPostgres from ${JSON.stringify(warmPostgresModule)};`,
  "const provided = {};",
  "try {",
  "  const teardown = await startWarmPostgres({ provide: (key, value) => { provided[key] = value; } });",
  "  await teardown();",
  "  process.stdout.write(JSON.stringify(provided.warmPostgres));",
  "} catch (error) {",
  "  process.stdout.write(JSON.stringify({ failure: error.message }));",
  "}",
].join("\n");

const startInChild = async (locator: string): Promise<StartedInChild> => {
  const child = await run(process.execPath, ["--input-type=module", "--eval", START_IN_CHILD], {
    cwd: packageRoot,
    env: { ...process.env, TEST_POSTGRES_URI: locator },
  });
  const started: StartedInChild = JSON.parse(child.stdout);
  return started;
};

const hostOf = (connectionUri: string | undefined): string => new URL(connectionUri ?? "").host;

const pointsTheWayUp = (started: StartedInChild) => ({
  oneLine: started.failure !== undefined && !started.failure.includes("\n"),
  namesTheLocator: started.failure?.includes("TEST_POSTGRES_URI"),
  namesTheUpCommand: started.failure?.includes("deploy/test-postgres.sh up"),
});

const POINTS_THE_WAY_UP = { oneLine: true, namesTheLocator: true, namesTheUpCommand: true };

const anExitedPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ["--eval", ""]);
  await once(child, "exit");
  if (child.pid === undefined) throw new Error("the short-lived child was given no pid");
  return child.pid;
};

describe("the warm harness under TEST_POSTGRES_URI", () => {
  it("provides the shared server's template, starting no container", async () => {
    const started = await startInChild(adminUri());

    expect({
      source: started.source,
      server: hostOf(started.connectionUri),
      template: started.templateDatabase,
      runId: started.runId,
      published: await isOnTheServer(started.templateDatabase ?? ""),
    }).toEqual({
      source: "shared",
      server: hostOf(warmOfThisRun().connectionUri),
      template: expect.stringMatching(/^tpl_ts_[0-9a-f]{12}$/u),
      runId: expect.any(Number),
      published: true,
    });
  }, 300_000);

  it("starts a container of its own under a blank locator", async () => {
    const started = await startInChild(" ");

    expect(started.source).toBe("container");
  }, 300_000);

  it("reuses the published template on a second start", async () => {
    const first = await startInChild(adminUri());
    const builtOnce = await oidOf(first.templateDatabase ?? "");
    const second = await startInChild(adminUri());

    expect({
      published: builtOnce !== undefined,
      template: second.templateDatabase,
      oid: await oidOf(second.templateDatabase ?? ""),
    }).toEqual({ published: true, template: first.templateDatabase, oid: builtOnce });
  }, 300_000);

  it("names the locator and the up command when unreachable", async () => {
    const started = await startInChild("postgres://nobody:nothing@127.0.0.1:1/postgres");

    expect(pointsTheWayUp(started)).toEqual(POINTS_THE_WAY_UP);
  });

  it("refuses a locator that signs in without superuser", async () => {
    const role = `not_super_${String(process.pid)}`;
    await asAdmin((admin) => admin.query(`CREATE ROLE ${quoted(role)} LOGIN PASSWORD 'not-super'`));
    try {
      const locator = new URL(adminUri());
      locator.username = role;
      locator.password = "not-super";

      expect(pointsTheWayUp(await startInChild(locator.toString()))).toEqual(POINTS_THE_WAY_UP);
    } finally {
      await asAdmin((admin) => admin.query(`DROP ROLE ${quoted(role)}`));
    }
  });

  it("sweeps a dead run's database and keeps a live one's", async () => {
    const dead = `ba_swept_${String(process.pid)}_${String(await anExitedPid())}`;
    const live = `ba_kept_${String(process.pid)}_${String(process.pid)}`;
    await asAdmin(async (admin) => {
      await admin.query(`CREATE DATABASE ${quoted(dead)}`);
      await admin.query(`CREATE DATABASE ${quoted(live)}`);
    });
    try {
      await startInChild(adminUri());

      expect({ dead: await isOnTheServer(dead), live: await isOnTheServer(live) }).toEqual({
        dead: false,
        live: true,
      });
    } finally {
      await dropEach([dead, live]);
    }
  }, 300_000);

  it("gives two runs' opens of one key separate databases", async () => {
    const warm = warmOfThisRun();
    const ours = await clonedFrom(warm, "one-key");
    const theirs = await clonedFrom({ ...warm, runId: process.pid }, "one-key");
    try {
      const theirName = await databaseNameOf(theirs);
      await writeModelChoice(ours);
      await theirs.stop();

      expect({
        separate: theirName !== (await databaseNameOf(ours)),
        theirsLeft: await isLeftBehind(ours, theirName),
        ours: await modelChoicesIn(ours),
      }).toEqual({ separate: true, theirsLeft: false, ours: 1 });
    } finally {
      await ours.stop();
    }
  });
});

describe("a shared template", () => {
  it("builds once when two callers race on one name", async () => {
    const name = scratchTemplate("raced");
    const log = buildLog();

    const returned = await Promise.all([
      ensureTemplate(adminUri(), name, log.building("raced")),
      ensureTemplate(adminUri(), name, log.building("raced")),
    ]);

    expect({ returned, built: log.built() }).toEqual({ returned: [name, name], built: ["raced"] });
  });

  it("holds only its own build under another name", async () => {
    const first = scratchTemplate("first");
    const second = scratchTemplate("second");
    await ensureTemplate(adminUri(), first, buildLog().building("first_table"));
    await ensureTemplate(adminUri(), second, buildLog().building("second_table"));

    expect({ first: await tablesIn(first), second: await tablesIn(second) }).toEqual({
      first: ["first_table"],
      second: ["second_table"],
    });
  });

  it("builds two different templates one at a time", async () => {
    const log = buildLog();
    const names = [scratchTemplate("one"), scratchTemplate("other")];

    await Promise.all(names.map((name) => ensureTemplate(adminUri(), name, log.building(name))));

    expect({
      mostAtOnce: log.mostAtOnce(),
      built: log.built().toSorted(),
      published: await Promise.all(names.map(isOnTheServer)),
    }).toEqual({ mostAtOnce: 1, built: names.toSorted(), published: [true, true] });
  });

  it("drops a leftover build, then publishes", async () => {
    expect(await publishOverALeftover("left", false)).toEqual({
      tables: ["fresh"],
      leftover: false,
    });
  });

  it("unmarks and drops a leftover already marked as a template", async () => {
    expect(await publishOverALeftover("marked", true)).toEqual({
      tables: ["fresh"],
      leftover: false,
    });
  });

  it("seals a published template against every connection", async () => {
    const name = scratchTemplate("sealed");
    await ensureTemplate(adminUri(), name, buildLog().building("sealed"));
    const flags = await asAdmin((admin) =>
      admin.query("SELECT datallowconn, datistemplate FROM pg_database WHERE datname = $1", [name]),
    );

    expect({ ...flags.rows[0], refused: await refusalOf(onDatabase(adminUri(), name)) }).toEqual({
      datallowconn: false,
      datistemplate: true,
      refused: "55000",
    });
  });

  it("drops a template unused for a day, keeping fresh ones", async () => {
    const stale = await plantedTemplate("stale", LONG_AGO);
    const fresh = await plantedTemplate("fresh", new Date().toISOString());

    await ensureTemplate(adminUri(), scratchTemplate("aged"), buildLog().building("aged"));

    expect({ stale: await isOnTheServer(stale), fresh: await isOnTheServer(fresh) }).toEqual({
      stale: false,
      fresh: true,
    });
  });

  it("stamps an unstamped template rather than dropping it", async () => {
    const before = Date.now();
    const unstamped = await plantedTemplate("unstamped", null);

    await ensureTemplate(adminUri(), scratchTemplate("stamper"), buildLog().building("stamper"));

    expect({
      kept: await isOnTheServer(unstamped),
      stamped: await stampedSince(unstamped, before),
    }).toEqual({
      kept: true,
      stamped: true,
    });
  });

  // The worker tier's real sweep would drop a tpl_py_ plant, so a prefix no tier sweeps stands in.
  it("leaves stale templates outside its prefix alone", async () => {
    const theirs = await plantedTemplate("theirs", LONG_AGO, "tpl_t_");

    await ensureTemplate(adminUri(), scratchTemplate("ours"), buildLog().building("ours"));

    expect(await isOnTheServer(theirs)).toBe(true);
  });

  it("drops a killed builder's leftover under another name", async () => {
    const orphan = `tpl_ts_age_orphan_${String(process.pid)}_building`;
    scratchTemplates.push(orphan);
    await asAdmin((admin) => admin.query(`CREATE DATABASE ${quoted(orphan)}`));

    await ensureTemplate(adminUri(), scratchTemplate("sweeper"), buildLog().building("sweeper"));

    expect(await isOnTheServer(orphan)).toBe(false);
  });

  it("stamps the ensured template with the time of use", async () => {
    const before = Date.now();
    const name = scratchTemplate("used");
    await ensureTemplate(adminUri(), name, buildLog().building("used"));

    await ensureTemplate(adminUri(), name, buildLog().building("used"));

    expect(await stampedSince(name, before)).toBe(true);
  });

  it("is named for its migrations' content", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "warm-template-"));
    try {
      await mkdir(path.join(folder, "meta"));
      await writeFile(path.join(folder, "0000_first.sql"), "CREATE TABLE one ();");
      await writeFile(path.join(folder, "meta", "_journal.json"), "{}");
      const named = await templateNameOver(folder);
      const again = await templateNameOver(folder);
      await writeFile(path.join(folder, "0000_first.sql"), "CREATE TABLE two ();");

      expect({ named, again, changed: (await templateNameOver(folder)) !== named }).toEqual({
        named: expect.stringMatching(/^tpl_ts_[0-9a-f]{12}$/u),
        again: named,
        changed: true,
      });
    } finally {
      await rm(folder, { recursive: true });
    }
  });
});
