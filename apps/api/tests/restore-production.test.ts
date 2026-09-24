import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { POSTGRES_IMAGE } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const apiRoot = path.resolve(import.meta.dirname, "..");

const OPENS = "# >>> replace the database";
const CLOSES = "# <<< replace the database";

const replaceStep = (): string => {
  const script = readFileSync(path.join(repositoryRoot, "deploy/restore-production.sh"), "utf8");
  const opened = script.split(OPENS)[1];
  const [step, closed] = opened?.slice(opened.indexOf("\n") + 1).split(CLOSES) ?? [];
  if (step === undefined || closed === undefined) {
    throw new Error(
      "deploy/restore-production.sh no longer fences the step that replaces the database",
    );
  }
  return step;
};

const PASSWORD = "restore-in-this-suite";

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

// Production's `tool` runs a command in the backup image with the work directory at /work; the
// database's own image carries the same PostgreSQL client.
const replacing = (database: string): Ran =>
  inTheContainer(
    [
      "set -euo pipefail",
      "WORK=/work",
      "dump=pg-20260924T020000Z.dump.age",
      'say() { printf "%s\\n" "$*"; }',
      'tool() { "$@"; }',
      replaceStep(),
    ].join("\n"),
    { DATABASE_URL: insideUriFor(database) },
  );

const migrating = (database: string): Ran => {
  const finished = spawnSync(process.execPath, ["src/migrate.ts"], {
    cwd: apiRoot,
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

// Every partition of one parent reads as one, so databases holding different workspaces compare
// on what a partition is given, not its name.
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
    // The partition's lifecycle function reads a transaction's scope, so it runs in one.
    await client.query("BEGIN");
    await data.chunk({ workspaceId: document.workspaceId });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
};

const writeAfterTheDump = async (pool: pg.Pool): Promise<void> => {
  const client = await pool.connect();
  try {
    const data = testData(client);
    const later = await data.sourceBinding();
    await client.query("BEGIN");
    await data.chunk({ workspaceId: later.workspaceId });
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

  const admin = new pg.Pool({ connectionString: uriFor("postgres"), max: 1 });
  try {
    for (const database of ["production", "fresh", "untouched"]) {
      await admin.query(`CREATE DATABASE ${database}`);
      mustSucceed(migrating(database));
    }
  } finally {
    await admin.end();
  }
  production = new pg.Pool({ connectionString: uriFor("production"), max: 2 });
  fresh = new pg.Pool({ connectionString: uriFor("fresh"), max: 2 });
  untouched = new pg.Pool({ connectionString: uriFor("untouched"), max: 2 });
  for (const pool of [production, fresh, untouched]) await seedAWorkspace(pool);

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
  await Promise.all([production, fresh, untouched].map((pool) => pool.end()));
  if (container !== "") docker(["rm", "--force", container]);
});

describe("the production restore, handed a dump that cannot be read whole", () => {
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

  it("refuses before it drops anything, so every table keeps the rows it held", async () => {
    expect(replaced).toMatchObject({ code: 1, said: expect.stringContaining("REFUSED") });
    const after = await rowCounts(untouched);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ "public.workspace": 1, "public.oauth_refresh_token": 1 });
  });
});

describe("the production restore, handed a dump that reads whole and fails part-way through", () => {
  const GONE = "gone_before_the_restore";
  let before: Readonly<Record<string, number>>;
  let replaced: Ran;

  beforeAll(async () => {
    // A grant to a role the cluster no longer holds is refused, and it sits near the dump's end.
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

  it("rolls the whole replacement back, so every table keeps the rows it held", async () => {
    expect(replaced).toMatchObject({
      code: 3,
      said: expect.stringContaining(`role "${GONE}" does not exist`),
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

describe("the production restore, over a database that already holds the schema and rows", () => {
  let replaced: Ran;
  let counted: Readonly<Record<string, number>>;
  let migratedAfter: Ran;

  beforeAll(async () => {
    mustSucceed(inTheContainer("cp /work/whole.dump /work/pg.dump"));
    replaced = replacing("production");
    counted = await rowCounts(production);
    migratedAfter = migrating("production");
  }, 120_000);

  it("completes, and every table holds the rows the dump holds, with no table the dump lacks", () => {
    expect(replaced).toEqual({ code: 0, said: "" });
    expect(counted).toEqual(atTheDump);
    expect(counted).toMatchObject({ "public.workspace": 1, "public.oauth_refresh_token": 1 });
    expect(Object.keys(counted).filter((named) => /^index\."?chunk_/.test(named))).toHaveLength(1);
    expect(Object.keys(counted)).not.toContain("public.written_after_the_dump");
  });

  it("leaves a journal `migrate` runs over clean", () => {
    expect(migratedAfter).toMatchObject({
      code: 0,
      said: expect.stringContaining('"msg":"migrations applied"'),
    });
  });

  it("leaves row-level security and every grant as a fresh `migrate` makes them", async () => {
    const restored = await securitySurface(production);

    expect(restored).toEqual(await securitySurface(fresh));
    expect(restored).toContain("public.source_binding: row security true, forced true");
    expect(restored).toContain(
      "schema public, owned by pg_database_owner: USAGE to PUBLIC, granted by pg_database_owner",
    );
  });
});
