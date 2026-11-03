import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import pg from "pg";
import { afterAll, assert, describe, expect, it } from "vitest";

import { matching } from "../matching.ts";
import { BUILD_LOCK, ensureTemplate, templateNameOver } from "../warm-postgres.ts";
import { startInChild } from "./child.ts";
import {
  adminUri,
  asAdmin,
  codeOf,
  dropEach,
  isOnTheServer,
  oidOf,
  onDatabase,
  quoted,
  warmOfThisRun,
} from "./server.ts";

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

const A_PREFIX_NO_TIER_SWEEPS = "tpl_t_";

const scratchTemplates: string[] = [];

const scratchTemplateOfThisWorker = (label: string): string => {
  const name = `${A_PREFIX_NO_TIER_SWEEPS}${label}_${String(process.pid)}`;
  scratchTemplates.push(name, `${name}_building`);
  return name;
};

afterAll(async () => {
  await dropEach(scratchTemplates);
});

const LONG_AGO = "2020-01-01T00:00:00.000Z";

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

const until = async (met: () => Promise<boolean>, signal: AbortSignal): Promise<void> => {
  while (!(await met())) {
    signal.throwIfAborted();
    await sleep(BUILD_PAUSE_MS / 10, undefined, { signal });
  }
};

const aBuildWaitsForTheLock = (): Promise<boolean> =>
  asAdmin(async (admin) => {
    const waiting = await admin.query(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
         AND ((classid::bigint << 32) | objid::bigint) = ${BUILD_LOCK}`,
    );
    return (waiting.rowCount ?? 0) > 0;
  });

const publishOverALeftover = async (label: string, marked: boolean) => {
  const name = scratchTemplateOfThisWorker(label);
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

const hostOf = (connectionUri: string | undefined): string => new URL(connectionUri ?? "").host;

const anExitedPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ["--eval", ""]);
  await once(child, "exit");
  if (child.pid === undefined) throw new Error("the short-lived child was given no pid");
  return child.pid;
};

describe("the warm harness under TEST_POSTGRES_URI", () => {
  it("provides the shared server's template, starting no container", async () => {
    const started = await startInChild(adminUri());
    const template = started.templateDatabase;
    assert(template !== undefined, "the shared harness names its template");

    expect({
      source: started.source,
      server: hostOf(started.connectionUri),
      template: started.templateDatabase,
      runId: started.runId,
      published: await isOnTheServer(template),
    }).toEqual({
      source: "shared",
      server: hostOf(warmOfThisRun().connectionUri),
      template: matching.stringMatching(/^tpl_ts_[0-9a-f]{12}$/u),
      runId: matching.any(Number),
      published: true,
    });
  }, 300_000);

  it("reuses the published template on a second start", async () => {
    const first = await startInChild(adminUri());
    assert(first.templateDatabase !== undefined, "the first start names its template");
    const builtOnce = await oidOf(first.templateDatabase);
    const second = await startInChild(adminUri());
    assert(second.templateDatabase !== undefined, "the second start names its template");

    expect({
      published: builtOnce !== undefined,
      template: second.templateDatabase,
      oid: await oidOf(second.templateDatabase),
    }).toEqual({ published: true, template: first.templateDatabase, oid: builtOnce });
  }, 300_000);

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
});

describe("a shared template", () => {
  it("builds once when two callers race on one name", async () => {
    const name = scratchTemplateOfThisWorker("raced");
    const log = buildLog();

    const returned = await Promise.all([
      ensureTemplate(adminUri(), name, log.building("raced")),
      ensureTemplate(adminUri(), name, log.building("raced")),
    ]);

    expect({ returned, built: log.built() }).toEqual({ returned: [name, name], built: ["raced"] });
  });

  it("holds only its own build under another name", async () => {
    const first = scratchTemplateOfThisWorker("first");
    const second = scratchTemplateOfThisWorker("second");
    await ensureTemplate(adminUri(), first, buildLog().building("first_table"));
    await ensureTemplate(adminUri(), second, buildLog().building("second_table"));

    expect({ first: await tablesIn(first), second: await tablesIn(second) }).toEqual({
      first: ["first_table"],
      second: ["second_table"],
    });
  });

  it("builds two different templates one at a time", async () => {
    const log = buildLog();
    const names = [scratchTemplateOfThisWorker("one"), scratchTemplateOfThisWorker("other")];

    await Promise.all(names.map((name) => ensureTemplate(adminUri(), name, log.building(name))));

    expect({
      mostAtOnce: log.mostAtOnce(),
      built: log.built().toSorted(),
      published: await Promise.all(names.map(isOnTheServer)),
    }).toEqual({ mostAtOnce: 1, built: names.toSorted(), published: [true, true] });
  });

  it("leaves a running build alone while another waits its turn", async ({ signal }) => {
    const running = `tpl_ts_age_running_${String(process.pid)}`;
    scratchTemplates.push(running, `${running}_building`);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = ensureTemplate(adminUri(), running, async (databaseUri) => {
      await gate;
      await createTable(databaseUri, "running");
    });
    let queued: Promise<string> | undefined;
    try {
      await until(() => isOnTheServer(`${running}_building`), signal);
      queued = ensureTemplate(
        adminUri(),
        scratchTemplateOfThisWorker("queued"),
        buildLog().building("queued"),
      );
      await until(aBuildWaitsForTheLock, signal);
      release();
      await Promise.all([held, queued]);
    } finally {
      release();
      await Promise.allSettled([held, queued]);
    }

    expect(await tablesIn(running)).toEqual(["running"]);
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
    const name = scratchTemplateOfThisWorker("sealed");
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

  it("drops day-unused templates to bound the tmpfs, keeping fresh ones", async () => {
    const stale = await plantedTemplate("stale", LONG_AGO);
    const fresh = await plantedTemplate("fresh", new Date().toISOString());

    await ensureTemplate(
      adminUri(),
      scratchTemplateOfThisWorker("aged"),
      buildLog().building("aged"),
    );

    expect({ stale: await isOnTheServer(stale), fresh: await isOnTheServer(fresh) }).toEqual({
      stale: false,
      fresh: true,
    });
  });

  it("stamps an unstamped template rather than dropping it", async () => {
    const before = Date.now();
    const unstamped = await plantedTemplate("unstamped", null);

    await ensureTemplate(
      adminUri(),
      scratchTemplateOfThisWorker("stamper"),
      buildLog().building("stamper"),
    );

    expect({
      kept: await isOnTheServer(unstamped),
      stamped: await stampedSince(unstamped, before),
    }).toEqual({
      kept: true,
      stamped: true,
    });
  });

  it("leaves stale templates outside its prefix alone", async () => {
    const theirs = await plantedTemplate("theirs", LONG_AGO, A_PREFIX_NO_TIER_SWEEPS);

    await ensureTemplate(
      adminUri(),
      scratchTemplateOfThisWorker("ours"),
      buildLog().building("ours"),
    );

    expect(await isOnTheServer(theirs)).toBe(true);
  });

  it("drops a killed builder's leftover under another name", async () => {
    const orphan = `tpl_ts_age_orphan_${String(process.pid)}_building`;
    scratchTemplates.push(orphan);
    await asAdmin((admin) => admin.query(`CREATE DATABASE ${quoted(orphan)}`));

    await ensureTemplate(
      adminUri(),
      scratchTemplateOfThisWorker("sweeper"),
      buildLog().building("sweeper"),
    );

    expect(await isOnTheServer(orphan)).toBe(false);
  });

  it("stamps the ensured template with the time of use", async () => {
    const before = Date.now();
    const name = scratchTemplateOfThisWorker("used");
    await ensureTemplate(adminUri(), name, buildLog().building("used"));

    await ensureTemplate(adminUri(), name, buildLog().building("used"));

    expect(await stampedSince(name, before)).toBe(true);
  });

  it("publishes nothing under the name when its build fails", async () => {
    const name = scratchTemplateOfThisWorker("failed");
    const failing = async (databaseUri: string): Promise<void> => {
      await createTable(databaseUri, "half");
      throw new Error("the build died");
    };

    await expect(ensureTemplate(adminUri(), name, failing)).rejects.toThrow("the build died");
    expect(await isOnTheServer(name)).toBe(false);
  });

  it("changes its name when a migration file is renamed", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "warm-template-"));
    try {
      await writeFile(path.join(folder, "0000_first.sql"), "CREATE TABLE one ();");
      const named = await templateNameOver(folder, "2026-10");
      await rename(path.join(folder, "0000_first.sql"), path.join(folder, "0000_renamed.sql"));

      expect(await templateNameOver(folder, "2026-10")).not.toBe(named);
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  it("changes its name when the server's month turns", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "warm-template-"));
    try {
      await writeFile(path.join(folder, "0000_first.sql"), "CREATE TABLE one ();");

      expect(await templateNameOver(folder, "2026-11")).not.toBe(
        await templateNameOver(folder, "2026-10"),
      );
    } finally {
      await rm(folder, { recursive: true });
    }
  });

  it("is named for its migrations' content", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "warm-template-"));
    try {
      await mkdir(path.join(folder, "meta"));
      await writeFile(path.join(folder, "0000_first.sql"), "CREATE TABLE one ();");
      await writeFile(path.join(folder, "meta", "_journal.json"), "{}");
      const named = await templateNameOver(folder, "2026-10");
      const again = await templateNameOver(folder, "2026-10");
      await writeFile(path.join(folder, "0000_first.sql"), "CREATE TABLE two ();");

      expect({
        named,
        again,
        changed: (await templateNameOver(folder, "2026-10")) !== named,
      }).toEqual({
        named: matching.stringMatching(/^tpl_ts_[0-9a-f]{12}$/u),
        again: named,
        changed: true,
      });
    } finally {
      await rm(folder, { recursive: true });
    }
  });
});
