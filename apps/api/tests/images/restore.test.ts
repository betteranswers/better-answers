import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import pg from "pg";
import { afterAll, assert, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { POSTGRES_IMAGE } from "@better-answers/schema";
import { endPool, testData } from "@better-answers/schema/testing";
import { matching } from "@better-answers/schema/testing/matching";

import { repositoryRoot, workspaceRoot } from "../support/roots/roots.ts";

const fenced = (script: string, step: string): string => {
  const text = readFileSync(path.join(repositoryRoot, script), "utf8");
  const opened = text.split(`# >>> ${step}`)[1];
  const [body, closed] = opened?.slice(opened.indexOf("\n") + 1).split(`# <<< ${step}`) ?? [];
  if (body === undefined || closed === undefined) {
    throw new Error(`${script} no longer fences the lines that ${step}`);
  }
  return body;
};

const PASSWORD = "restore-in-this-suite";

const CHECKOUT = "/repo";

const READY_WITHIN_MS = 60_000;

let container = "";
let port = "";

const docker = (argv: readonly string[]): string =>
  execFileSync("docker", argv, { encoding: "utf8" }).trim();

const uriFor = (database: string): string =>
  `postgresql://postgres:${PASSWORD}@127.0.0.1:${port}/${database}`;

const insideUriFor = (database: string): string =>
  `postgresql://postgres:${PASSWORD}@localhost:5432/${database}`;

type Ran = { readonly code: number | null; readonly said: string };

const inTheContainer = (
  script: string,
  environment: Readonly<Record<string, string>> = {},
): Ran => {
  const ran = spawnSync(
    "docker",
    [
      "exec",
      ...Object.entries(environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
      container,
      "bash",
      "-c",
      script,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return { code: ran.status, said: `${ran.stdout}${ran.stderr}` };
};

const replacing = (database: string): Ran =>
  inTheContainer(
    [
      "set -euo pipefail",
      "WORK=/work",
      "dump=pg-20260924T020000Z.dump.age",
      'say() { printf "%s\\n" "$*"; }',
      'tool() { "$@"; }',
      fenced("deploy/restore-production.sh", "replace the database"),
    ].join("\n"),
    { DATABASE_URL: insideUriFor(database), REPO_DIR: CHECKOUT },
  );

const drilling = (database: string): Ran =>
  inTheContainer(
    [
      "set -euo pipefail",
      "WORK=/work",
      `DEPLOY_DIR=${CHECKOUT}/deploy`,
      fenced("deploy/restore-drill.sh", "empty the database"),
      fenced("deploy/restore-drill.sh", "restore the database"),
    ].join("\n"),
    { STAGING_DATABASE_URL: insideUriFor(database) },
  );

const migrating = (database: string): Ran => {
  const finished = spawnSync(process.execPath, ["src/migrate.ts"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: uriFor(database) },
  });
  return { code: finished.status, said: `${finished.stdout}${finished.stderr}` };
};

const untilItAnswers = async (): Promise<void> => {
  const deadline = Date.now() + READY_WITHIN_MS;
  for (;;) {
    const probe = new pg.Client({ connectionString: uriFor("postgres") });
    try {
      await probe.connect();
      await probe.end();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(250);
    }
  }
};

const OURS = String.raw`nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'`;

const countsSchema = z.array(z.object({ relation: z.string(), rows: z.number() }));

const rowCounts = async (pool: pg.Pool): Promise<Readonly<Record<string, number>>> => {
  const counted = await pool.query(
    `SELECT format('%I.%I', n.nspname, c.relname) AS relation,
            (xpath('/row/n/text()', query_to_xml(
               format('SELECT count(*) AS n FROM ONLY %I.%I', n.nspname, c.relname),
               false, true, '')))[1]::text::int AS rows
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND ${OURS}`,
  );
  return Object.fromEntries(
    countsSchema.parse(counted.rows).map((row) => [row.relation, row.rows]),
  );
};

const GRANTEE = "CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END";

const surfaceSchema = z.array(z.object({ line: z.string() }));

const securitySurface = async (pool: pg.Pool): Promise<readonly string[]> => {
  const read = await pool.query(
    `WITH relation AS (
       SELECT c.relkind, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity,
              CASE WHEN c.relispartition
                   THEN format('<a partition of %s>',
                               (SELECT i.inhparent::regclass FROM pg_inherits i WHERE i.inhrelid = c.oid))
                   ELSE format('%I.%I', n.nspname, c.relname) END AS named
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE ${OURS} AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     )
     SELECT DISTINCT line FROM (
       SELECT format('%s: row security %s, forced %s', named,
                     relrowsecurity::text, relforcerowsecurity::text) AS line
         FROM relation
       UNION ALL
       SELECT format('%s: %s%s to %s, granted by %s', named, a.privilege_type,
                     CASE WHEN a.is_grantable THEN ' with grant option' ELSE '' END,
                     ${GRANTEE}, pg_get_userbyid(a.grantor))
         FROM relation,
              aclexplode(coalesce(relacl, acldefault(
                (CASE relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", relowner))) a
       UNION ALL
       SELECT format('%I.%I: policy %I, %s %s to %s using %s checking %s',
                     schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check)
         FROM pg_policies
       UNION ALL
       SELECT format('schema %I, owned by %s: %s to %s, granted by %s', n.nspname,
                     pg_get_userbyid(n.nspowner), a.privilege_type, ${GRANTEE}, pg_get_userbyid(a.grantor))
         FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
        WHERE ${OURS}
       UNION ALL
       SELECT format('%I.%I.%I: %s to %s', n.nspname, c.relname, att.attname, a.privilege_type, ${GRANTEE})
         FROM pg_attribute att
         JOIN pg_class c ON c.oid = att.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace,
              aclexplode(att.attacl) a
        WHERE ${OURS} AND att.attnum > 0 AND NOT att.attisdropped
       UNION ALL
       SELECT format('%s: %s to %s', p.oid::regprocedure, a.privilege_type, ${GRANTEE})
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
              aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE ${OURS}
          AND NOT EXISTS (SELECT 1 FROM pg_depend d
                           WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
       UNION ALL
       SELECT format('by default, for %s in %s: %s on %s to %s', pg_get_userbyid(d.defaclrole),
                     coalesce(n.nspname, 'every schema'), a.privilege_type, d.defaclobjtype, ${GRANTEE})
         FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
              aclexplode(d.defaclacl) a
     ) lines
     ORDER BY line`,
  );
  return surfaceSchema.parse(read.rows).map((row) => row.line);
};

const seedAWorkspace = async (pool: pg.Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    const data = testData(client);
    const document = await data.sourceDocument();
    await data.member({ workspaceId: document.workspaceId });
    await data.oauthRefreshToken();
    await client.query("BEGIN");
    await data.passage({ workspaceId: document.workspaceId });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
};

const writeAfterTheDump = async (pool: pg.Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    const data = testData(client);
    const later = await data.connectedSource();
    await client.query("BEGIN");
    await data.passage({ workspaceId: later.workspaceId });
    await client.query("COMMIT");
    await client.query("DELETE FROM oauth_refresh_token");
    await client.query("CREATE TABLE written_after_the_dump (id integer)");
  } finally {
    client.release();
  }
};

const mustSucceed = (ran: Ran): void => {
  if (ran.code !== 0) throw new Error(ran.said);
};

let production: pg.Pool;
let fresh: pg.Pool;
let untouched: pg.Pool;
let staging: pg.Pool;
let recorded: pg.Pool;
let atTheDump: Readonly<Record<string, number>>;

beforeAll(async () => {
  container = docker([
    "run",
    "--detach",
    "--rm",
    "--env",
    `POSTGRES_PASSWORD=${PASSWORD}`,
    "--publish",
    "127.0.0.1::5432",
    POSTGRES_IMAGE,
    "postgres",
    "-c",
    "fsync=off",
  ]);
  const published = docker(["port", container, "5432/tcp"]);
  port = /:(\d+)$/.exec(published)?.[1] ?? "";
  if (port === "")
    throw new Error(`docker published the database on no port it names: ${published}`);
  await untilItAnswers();
  docker(["exec", container, "mkdir", "-p", CHECKOUT]);
  docker(["cp", path.join(repositoryRoot, "deploy"), `${container}:${CHECKOUT}/deploy`]);

  const admin = new pg.Pool({ connectionString: uriFor("postgres"), max: 1 });
  try {
    for (const database of ["production", "fresh", "untouched", "staging", "recorded"]) {
      await admin.query(`CREATE DATABASE ${database}`);
      mustSucceed(migrating(database));
    }
  } finally {
    await admin.end();
  }
  production = new pg.Pool({ connectionString: uriFor("production"), max: 2 });
  fresh = new pg.Pool({ connectionString: uriFor("fresh"), max: 2 });
  untouched = new pg.Pool({ connectionString: uriFor("untouched"), max: 2 });
  staging = new pg.Pool({ connectionString: uriFor("staging"), max: 2 });
  recorded = new pg.Pool({ connectionString: uriFor("recorded"), max: 2 });
  for (const pool of [production, fresh, untouched, staging]) await seedAWorkspace(pool);

  // Piped, as the backup pipes it into age: an archive written to a pipe records no offsets, so
  // restores read it whole.
  mustSucceed(
    inTheContainer(
      'mkdir -p /work && pg_dump --format=custom --no-owner "$DATABASE_URL" | cat > /work/whole.dump',
      { DATABASE_URL: insideUriFor("production") },
    ),
  );
  atTheDump = await rowCounts(production);
  await writeAfterTheDump(production);
}, 240_000);

afterAll(async () => {
  await Promise.all([production, fresh, untouched, staging, recorded].map(endPool));
  if (container !== "") docker(["rm", "--force", container]);
});

describe("the production restore, given a dump it cannot read whole", () => {
  let before: Readonly<Record<string, number>>;
  let replaced: Ran;

  beforeAll(async () => {
    before = await rowCounts(untouched);
    mustSucceed(
      inTheContainer(
        'head -c "$(( $(stat -c %s /work/whole.dump) / 2 ))" /work/whole.dump > /work/pg.dump',
      ),
    );
    replaced = replacing("untouched");
  });

  it("refuses before dropping anything, so every table keeps its rows", async () => {
    expect(replaced).toMatchObject({ code: 1, said: matching.stringContaining("REFUSED") });
    const after = await rowCounts(untouched);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ "public.workspace": 1, "public.oauth_refresh_token": 1 });
  });
});

describe("the production restore, given a whole dump that fails part-way", () => {
  const GONE = "gone_before_the_restore";
  let before: Readonly<Record<string, number>>;
  let replaced: Ran;

  beforeAll(async () => {
    await untouched.query(`CREATE ROLE ${GONE}`);
    await untouched.query(`GRANT SELECT ON workspace TO ${GONE}`);
    mustSucceed(
      inTheContainer('pg_dump --format=custom --no-owner "$DATABASE_URL" | cat > /work/pg.dump', {
        DATABASE_URL: insideUriFor("untouched"),
      }),
    );
    await untouched.query(`REVOKE SELECT ON workspace FROM ${GONE}`);
    await untouched.query(`DROP ROLE ${GONE}`);
    await writeAfterTheDump(untouched);
    before = await rowCounts(untouched);
    replaced = replacing("untouched");
  });

  it("rolls the whole replacement back, keeping every table's rows", async () => {
    expect(replaced).toMatchObject({
      code: 3,
      said: matching.stringContaining(`role "${GONE}" does not exist`),
    });
    const after = await rowCounts(untouched);
    expect(after).toEqual(before);
    expect(after).toMatchObject({
      "public.workspace": 2,
      "public.oauth_refresh_token": 0,
      "public.written_after_the_dump": 0,
    });
  });
});

describe("the production restore, over a database holding schema and rows", () => {
  let replaced: Ran;
  let counted: Readonly<Record<string, number>>;
  let migratedAfter: Ran;

  beforeAll(async () => {
    mustSucceed(inTheContainer("cp /work/whole.dump /work/pg.dump"));
    replaced = replacing("production");
    counted = await rowCounts(production);
    migratedAfter = migrating("production");
  }, 120_000);

  it("completes with exactly the dump's tables and rows", () => {
    expect(replaced).toEqual({ code: 0, said: "" });
    expect(counted).toEqual(atTheDump);
    expect(counted).toMatchObject({ "public.workspace": 1, "public.oauth_refresh_token": 1 });
    expect(Object.keys(counted).filter((named) => /^index\."?passage_/.test(named))).toHaveLength(
      1,
    );
    expect(Object.keys(counted)).not.toContain("public.written_after_the_dump");
  });

  it("leaves a journal `migrate` runs over clean", () => {
    expect(migratedAfter).toMatchObject({
      code: 0,
      said: matching.stringContaining('"msg":"migrations applied"'),
    });
  });

  it("leaves row-level security and grants as fresh `migrate` makes them", async () => {
    const restored = await securitySurface(production);

    expect(restored).toEqual(await securitySurface(fresh));
    expect(restored).toContain("public.connected_source: row security true, forced true");
    expect(restored).toContain(
      "schema public, owned by pg_database_owner: USAGE to PUBLIC, granted by pg_database_owner",
    );
  });
});

describe("the drill's restore, over staging left migrated and seeded", () => {
  let drilled: Ran;
  let counted: Readonly<Record<string, number>>;

  beforeAll(async () => {
    mustSucceed(inTheContainer("cp /work/whole.dump /work/pg.dump"));
    drilled = drilling("staging");
    counted = await rowCounts(staging);
  }, 120_000);

  it("completes with the dump's rows and none of staging's own", () => {
    expect(drilled).toEqual({ code: 0, said: "" });
    expect(counted).toEqual(atTheDump);
    expect(counted).toMatchObject({ "public.workspace": 1, "public.oauth_refresh_token": 1 });
  });

  it("leaves row-level security and grants as fresh `migrate` makes them", async () => {
    const restored = await securitySurface(staging);

    expect(restored).toEqual(await securitySurface(fresh));
    expect(restored).toContain("public.connected_source: row security true, forced true");
    expect(restored).toContain(
      "schema public, owned by pg_database_owner: USAGE to PUBLIC, granted by pg_database_owner",
    );
  });
});

const NOTHING_LISTENS = `postgresql://postgres:${PASSWORD}@localhost:9/recorded`;

const UNWRITTEN = "backup row not written";

const rowsStartedAt = async (startedAt: string) =>
  (
    await recorded.query<Record<string, unknown>>(
      `SELECT kind, store, outcome, bytes, location, report_url, contains_personal_data,
              extract(epoch FROM expires_at - finished_at)::int / 3600 AS kept_hours, rto_minutes
         FROM backup WHERE started_at = $1 ORDER BY store`,
      [startedAt],
    )
  ).rows;

const recordingACopy = (calls: string, database: string): Ran =>
  inTheContainer(
    ["set -euo pipefail", fenced("deploy/backup.sh", "record the copy"), calls].join("\n"),
    { DATABASE_URL: database },
  );

describe("backup.sh's record of a copy", () => {
  it("writes the hourly dump's size, location and expiry after finish", async () => {
    const started = "2026-10-21T10:00:00Z";
    mustSucceed(
      recordingACopy(
        `record postgres ${started} ok 52428800 pg/hourly/pg-20261021T100000Z.dump.age "48 hours"`,
        insideUriFor("recorded"),
      ),
    );

    expect(await rowsStartedAt(started)).toEqual([
      {
        kind: "backup",
        store: "postgres",
        outcome: "ok",
        bytes: "52428800",
        location: "pg/hourly/pg-20261021T100000Z.dump.age",
        report_url: null,
        contains_personal_data: true,
        kept_hours: 48,
        rto_minutes: null,
      },
    ]);
  });

  it("writes a failed copy with no location, size or expiry", async () => {
    const started = "2026-10-21T11:00:00Z";
    mustSucceed(recordingACopy(`record postgres ${started} failed`, insideUriFor("recorded")));

    expect(await rowsStartedAt(started)).toMatchObject([
      { outcome: "failed", bytes: null, location: null, kept_hours: null },
    ]);
  });

  it("logs an unwritten row and returns success", () => {
    const ran = recordingACopy(
      'record postgres 2026-10-21T09:00:00Z failed; echo "returned $?"',
      NOTHING_LISTENS,
    );

    expect(ran.code).toBe(0);
    expect(ran.said).toContain(UNWRITTEN);
    expect(ran.said).toMatch(/^returned 0$/m);
  });
});

const recordingADrill = (started: string, prodPsql: string): Ran =>
  inTheContainer(
    [
      "set -euo pipefail",
      `started=${started} rto=70 REPORT=/work/drill-20261001T030000Z.md`,
      'say() { printf "%s\\n" "$*"; }',
      fenced("deploy/restore-drill.sh", "record the drill"),
      "echo carried on",
    ].join("\n"),
    { PROD_PSQL: prodPsql },
  );

describe("the drill's record", () => {
  it("writes one drill row to production through PROD_PSQL", async () => {
    const started = "2026-10-01T03:00:00Z";
    mustSucceed(recordingADrill(started, `psql ${insideUriFor("recorded")}`));

    expect(await rowsStartedAt(started)).toEqual([
      {
        kind: "drill",
        store: "all",
        outcome: "ok",
        bytes: null,
        location: "drills/",
        report_url: "drills/drill-20261001T030000Z.md",
        contains_personal_data: false,
        kept_hours: null,
        rto_minutes: 70,
      },
    ]);
  });

  it("logs an unwritten row and carries on", () => {
    const ran = recordingADrill("2026-10-01T04:00:00Z", `psql ${NOTHING_LISTENS}`);

    expect(ran.code).toBe(0);
    expect(ran.said).toContain(`${UNWRITTEN} to production`);
    expect(ran.said).toMatch(/^carried on$/m);
  });
});

type Restored = { readonly objectstore: "yes" | "no"; readonly git: "yes" | "no" };

const recordingARestore = (started: string, restored: Restored, database: string): Ran =>
  inTheContainer(
    [
      "set -euo pipefail",
      `started=${started} rto=40 tier=daily dump=pg-20261021T020000Z.dump.age`,
      `objectstore=${restored.objectstore} git=${restored.git}`,
      'say() { printf "%s\\n" "$*"; }',
      'stores() { [ "$1 $2 $3 $4" = "run --rm --no-deps backup" ] || return 2; shift 4; "$@"; }',
      fenced("deploy/restore-production.sh", "record the restore"),
    ].join("\n"),
    { DATABASE_URL: database },
  );

const A_RESTORED_STORE = {
  kind: "restore",
  outcome: "ok",
  bytes: null,
  report_url: null,
  contains_personal_data: false,
  kept_hours: null,
  rto_minutes: 40,
};

describe("the production restore's record", () => {
  it("writes one row per store it restored", async () => {
    const everyStore = "2026-10-21T12:00:00Z";
    const theDatabaseAlone = "2026-10-21T13:00:00Z";
    mustSucceed(
      recordingARestore(everyStore, { objectstore: "yes", git: "yes" }, insideUriFor("recorded")),
    );
    mustSucceed(
      recordingARestore(
        theDatabaseAlone,
        { objectstore: "no", git: "no" },
        insideUriFor("recorded"),
      ),
    );

    expect(await rowsStartedAt(everyStore)).toEqual([
      { ...A_RESTORED_STORE, store: "git", location: "git/" },
      { ...A_RESTORED_STORE, store: "objectstore", location: "objectstore/" },
      { ...A_RESTORED_STORE, store: "postgres", location: "pg/daily/pg-20261021T020000Z.dump.age" },
    ]);
    expect(await rowsStartedAt(theDatabaseAlone)).toEqual([
      { ...A_RESTORED_STORE, store: "postgres", location: "pg/daily/pg-20261021T020000Z.dump.age" },
    ]);
  });

  it("logs a statement that, rerun, records the restore once", async () => {
    const started = "2026-10-21T14:00:00Z";
    const ran = recordingARestore(started, { objectstore: "yes", git: "yes" }, NOTHING_LISTENS);
    const logged = new RegExp(`^${UNWRITTEN}; once the database answers, run: (.+)$`, "m").exec(
      ran.said,
    )?.[1];

    expect({ code: ran.code, logged }).toEqual({ code: 0, logged: matching.any(String) });
    assert(logged !== undefined, "the restore logged the statement to run");
    await recorded.query(logged);
    await recorded.query(logged);
    expect((await rowsStartedAt(started)).map((row) => row["store"])).toEqual([
      "git",
      "objectstore",
      "postgres",
    ]);
  });
});
