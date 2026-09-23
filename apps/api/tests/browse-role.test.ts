import { readFileSync } from "node:fs";
import path from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type MigratedPostgres,
  startMigratedPostgres,
  testData,
} from "@better-answers/schema/testing";
import {
  configProbeWritten,
  privilegesHeld,
  refusesEach,
} from "@better-answers/schema/testing/probes";

const roleFile = readFileSync(
  path.resolve(import.meta.dirname, "../../../deploy/browse-role.sql"),
  "utf8",
);

const WITHHELD = {
  "public.session": ["token"],
  "public.account": ["access_token", "refresh_token", "id_token", "password"],
  "public.verification": ["value"],
  "public.jwks": ["private_key"],
  "public.oauth_client": ["client_secret"],
  "public.oauth_access_token": ["token"],
  "public.oauth_refresh_token": ["token", "rotation_replay_response"],
} as const satisfies Record<string, readonly string[]>;

const withheldTables: readonly string[] = Object.keys(WITHHELD);

const withheldIn = (table: string): readonly string[] =>
  Object.entries(WITHHELD).find(([named]) => named === table)?.[1] ?? [];

const TABLE_KINDS = ["r", "p", "v", "m"];

const NOTHING_BUT_SELECT = {
  SELECT: true,
  INSERT: false,
  UPDATE: false,
  DELETE: false,
  TRUNCATE: false,
  REFERENCES: false,
  TRIGGER: false,
  MAINTAIN: false,
};

type Grants = readonly { readonly object: string; readonly privilege: string }[];

// A role is the cluster's, not a database's: on the shared warm cluster it would reach every
// suite that reads the roles.
let db: MigratedPostgres;
let browse: pg.Pool;
let workspaces: readonly string[];
let partition: string;

// psql runs a file one statement at a time, each committing alone unless the file opens a
// transaction; one query would hide that.
const statementsOf = (file: string): readonly string[] => {
  const statements: string[] = [];
  let pending: string[] = [];
  let quoted = false;
  for (const line of file.split("\n")) {
    pending.push(line);
    quoted = line.split("$$").length % 2 === 0 ? !quoted : quoted;
    if (!quoted && line.trimEnd().endsWith(";")) {
      statements.push(pending.join("\n"));
      pending = [];
    }
  }
  return statements;
};

const grantsOf = async (): Promise<Grants> => {
  const held = await db.pool.query<{ object: string; privilege: string }>(
    `SELECT table_schema || '.' || table_name || coalesce('.' || column_name, '') AS object,
            privilege_type AS privilege
       FROM (SELECT table_schema, table_name, NULL AS column_name, privilege_type, grantee
               FROM information_schema.role_table_grants
             UNION ALL
             SELECT table_schema, table_name, column_name, privilege_type, grantee
               FROM information_schema.column_privileges) AS granted
      WHERE grantee = 'browse_ro'
      ORDER BY 1, 2`,
  );
  return held.rows;
};

beforeAll(async () => {
  db = await startMigratedPostgres();
  const client = await db.pool.connect();
  try {
    const data = testData(client);
    const first = await data.sourceBinding();
    const second = await data.sourceBinding();
    await data.oauthRefreshToken();
    // The partition's lifecycle function reads a transaction's scope, so it runs in one.
    await client.query("BEGIN");
    await data.chunk({ workspaceId: first.workspaceId });
    await client.query("COMMIT");
    workspaces = [first.workspaceId, second.workspaceId].toSorted();
    const children = await client.query<{ relation: string }>(
      `SELECT format('%I.%I', n.nspname, c.relname) AS relation
         FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE i.inhparent = '"index".chunk'::regclass`,
    );
    partition = children.rows[0]?.relation ?? "";
  } finally {
    client.release();
  }
  await db.pool.query(roleFile);
  await db.pool.query("ALTER ROLE browse_ro PASSWORD 'browse-in-this-suite'");
  const uri = new URL(db.connectionUri);
  uri.username = "browse_ro";
  uri.password = "browse-in-this-suite";
  browse = new pg.Pool({ connectionString: uri.toString(), max: 2 });
});

afterAll(async () => {
  await browse.end();
  await db.stop();
});

describe("the read-only browsing role, applied over the whole journal", () => {
  it("signs in as a login that is no superuser, makes no role, database or replica, and bypasses row-level security", async () => {
    const role = await db.pool.query(
      `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
         FROM pg_roles WHERE rolname = 'browse_ro'`,
    );
    expect(role.rows).toEqual([
      {
        rolcanlogin: true,
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolbypassrls: true,
      },
    ]);
  });

  it("reads every workspace's rows with no workspace scope set", async () => {
    const read = await browse.query<{ workspace_id: string; scope: string | null }>(
      `SELECT workspace_id, nullif(current_setting('app.workspace_id', true), '') AS scope
         FROM source_binding ORDER BY workspace_id`,
    );
    expect(read.rows).toEqual(
      workspaces.map((workspace) => ({ workspace_id: workspace, scope: null })),
    );
  });

  it("holds SELECT and nothing else on every table, view and partition in public and index", async () => {
    const relations = await db.pool.query<{ relation: string }>(
      `SELECT format('%I.%I', n.nspname, c.relname) AS relation
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'index') AND c.relkind = ANY($1)
        ORDER BY 1`,
      [TABLE_KINDS],
    );
    expect(relations.rows.length).toBeGreaterThan(40);
    expect(relations.rows.map((row) => row.relation)).toContain(partition);
    const client = await db.pool.connect();
    try {
      const wrong: { relation: string; held: Record<string, boolean> }[] = [];
      for (const { relation } of relations.rows) {
        const held = await privilegesHeld(client, "browse_ro", relation);
        const owed = { ...NOTHING_BUT_SELECT, SELECT: !withheldTables.includes(relation) };
        if (JSON.stringify(held) !== JSON.stringify(owed)) wrong.push({ relation, held });
      }
      expect(wrong).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("answers a read of every view, so no view in a GUI's list is a dead end", async () => {
    const views = await db.pool.query<{ relation: string }>(
      `SELECT format('%I.%I', n.nspname, c.relname) AS relation
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('public', 'index') AND c.relkind IN ('v', 'm')`,
    );
    expect(views.rows.length).toBeGreaterThan(0);
    const refused: string[] = [];
    for (const { relation } of views.rows) {
      await browse.query(`SELECT * FROM ${relation} LIMIT 1`).catch((cause: unknown) => {
        refused.push(`${relation}: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
    }
    expect(refused).toEqual([]);
  });

  it("withholds the identity set's credential columns and serves every other column of those tables", async () => {
    const columns = await db.pool.query<{ relation: string; column: string; readable: boolean }>(
      `SELECT format('%s.%s', n.nspname, c.relname) AS relation, a.attname AS column,
              has_column_privilege('browse_ro', c.oid, a.attname, 'SELECT') AS readable
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE format('%s.%s', n.nspname, c.relname) = ANY($1)
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY 1, 2`,
      [withheldTables],
    );
    const misread = columns.rows.filter(
      (row) => row.readable === withheldIn(row.relation).includes(row.column),
    );
    expect(misread).toEqual([]);
    expect(new Set(columns.rows.map((row) => row.relation)).size).toEqual(withheldTables.length);

    await expect(browse.query("SELECT token FROM oauth_refresh_token")).rejects.toThrow(
      /permission denied for table oauth_refresh_token/,
    );
    const served = await browse.query("SELECT client_id, scopes FROM oauth_refresh_token");
    expect(served.rowCount).toEqual(1);
  });

  it("opens every session read-only, so a slip in a GUI is refused before any grant is asked", async () => {
    const shown = await browse.query<{ default_transaction_read_only: string }>(
      "SHOW default_transaction_read_only",
    );
    expect(shown.rows).toEqual([{ default_transaction_read_only: "on" }]);
    await expect(browse.query("UPDATE source_binding SET name = 'renamed'")).rejects.toThrow(
      /cannot execute UPDATE in a read-only transaction/,
    );
  });

  it("refuses a write to any platform table, DDL in either schema and every definer function, in a read-write transaction it asks for", async () => {
    const client = await browse.connect();
    try {
      await client.query("BEGIN READ WRITE");
      await refusesEach(client, [
        ["UPDATE source_binding SET name = 'renamed'", "an update to a tenant table"],
        ["DELETE FROM source_binding", "a delete from a tenant table"],
        ["TRUNCATE source_binding", "a truncate of a tenant table"],
        ["UPDATE member SET role = 'Admin'", "an update to the identity set"],
        ['DELETE FROM "index".chunk', "a delete from the chunk index"],
        [
          `DELETE FROM ${partition}`,
          "a delete from a workspace's chunk partition, reached directly",
        ],
        [`UPDATE ${partition} SET content = 'rewritten'`, "an update to that partition, directly"],
        ["CREATE TABLE public.browse_probe (id int)", "a table made in public"],
        ['CREATE TABLE "index".browse_probe (id int)', "a table made in index"],
        [
          "ALTER TABLE source_binding ADD COLUMN probe int",
          "a column added to a tenant table",
          [],
          /must be owner/,
        ],
        [
          "SELECT create_workspace_partition($1)",
          "the workspace-lifecycle definer function",
          [workspaces[0]],
        ],
      ]);
      await client.query("ROLLBACK");

      await client.query("BEGIN READ WRITE");
      await expect(configProbeWritten(client, workspaces[0] ?? "", "probe")).rejects.toThrow(
        /permission denied for table workspace_config/,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("can execute no definer function in either schema", async () => {
    const definers = await db.pool.query<{ fn: string; executable: boolean }>(
      `SELECT p.oid::regprocedure::text AS fn,
              has_function_privilege('browse_ro', p.oid, 'EXECUTE') AS executable
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname IN ('public', 'index')`,
    );
    expect(definers.rows.length).toBeGreaterThan(3);
    expect(definers.rows.filter((row) => row.executable)).toEqual([]);
  });

  it("leaves no credential column readable when it fails partway, run statement by statement as psql runs it", async () => {
    const client = await db.pool.connect();
    try {
      await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA public, "index" FROM browse_ro');
      await client.query("ALTER TABLE jwks RENAME TO jwks_set_aside");
      let refusal = "";
      for (const statement of statementsOf(roleFile)) {
        refusal = await client.query(statement).then(
          () => "",
          (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
        );
        if (refusal !== "") break;
      }
      // psql stops at the error and its session ends, taking an open transaction with it.
      await client.query("ROLLBACK");
      expect(refusal).toMatch(/relation "public.jwks" does not exist/);
      const readable = await client.query(
        `SELECT has_column_privilege('browse_ro', 'public.session', 'token', 'SELECT') AS token,
                has_table_privilege('browse_ro', 'public.source_binding', 'SELECT') AS binding`,
      );
      expect(readable.rows).toEqual([{ token: false, binding: false }]);
    } finally {
      await client.query("ALTER TABLE jwks_set_aside RENAME TO jwks");
      await client.query(roleFile);
      client.release();
    }
  });

  it("is applied again as it was applied first", async () => {
    const before = await grantsOf();
    expect(before.length).toBeGreaterThan(40);
    await db.pool.query(roleFile);
    expect(await grantsOf()).toEqual(before);
  });
});
