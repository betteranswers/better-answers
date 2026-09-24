import { readFileSync } from "node:fs";
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { declaredTableNames } from "../scripts/worker-view.ts";
import {
  isRuntimeRole,
  MIGRATOR,
  oneWorkspacePartition,
  PUBLIC_GRANTEE,
  readRolesSurface,
  renderRolesSurface,
  type RolesSurface,
  rolesSurfacePath,
  withOneWorkspacePartition,
} from "../scripts/roles-surface.ts";
import { identityOf, SECURITY_DEFINER_REACH, ulid } from "../src/index.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { A_GRAPH_NODE } from "./rls-probes.ts";
import { postgresForSuite, privilegesHeld, refusesEach } from "./probes.ts";

// Read from the database, not parsed back out of the file: the drift test ties the two, so
// nothing else has to trust the bytes.
let surface: RolesSurface;

const NOTHING_OF_THE_EIGHT = {
  SELECT: false,
  INSERT: false,
  UPDATE: false,
  DELETE: false,
  TRUNCATE: false,
  REFERENCES: false,
  TRIGGER: false,
  MAINTAIN: false,
};

const held = (...privileges: readonly string[]): Record<string, boolean> => ({
  ...NOTHING_OF_THE_EIGHT,
  ...Object.fromEntries(privileges.map((privilege) => [privilege, true])),
});

const THE_FOUR_VERBS = held("SELECT", "INSERT", "UPDATE", "DELETE");

const columnsHeld = async (
  client: pg.PoolClient,
  role: string,
  table: string,
  privilege: string,
): Promise<readonly string[]> => {
  const answered = await client.query<{ column: string }>(
    `SELECT a.attname AS column FROM pg_attribute a
       WHERE a.attrelid = $2::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND has_column_privilege($1, a.attrelid, a.attnum, $3)
       ORDER BY a.attname`,
    [role, table, privilege],
  );
  return answered.rows.map((row) => row.column);
};

const thePartition = async (client: pg.PoolClient): Promise<string> => {
  const found = await client.query<{ relname: string }>(
    // `relispartition` is true of a partitioned index too, and pg_class answers in no order.
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'index' AND c.relispartition AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  const name = found.rows[0]?.relname;
  if (name === undefined) throw new Error("no partition was made before the surface was read");
  return `"index"."${name.replaceAll('"', '""')}"`;
};

const THE_DEFAULTS_REVOKED = [
  "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM worker_rt",
  'ALTER DEFAULT PRIVILEGES IN SCHEMA "index" REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM worker_rt',
];

const db = postgresForSuite();

beforeAll(async () => {
  const client = await db().pool.connect();
  try {
    await withOneWorkspacePartition(client);
  } finally {
    client.release();
  }
  surface = await readRolesSurface(db().pool);
});

describe("the roles' surface", () => {
  it("is byte-identical to a regeneration over a fresh migrated database carrying a partition", async () => {
    const regenerated = renderRolesSurface(await readRolesSurface(db().pool));

    expect(readFileSync(rolesSurfacePath, "utf8")).toBe(regenerated);
  });

  it("names every role the catalogue holds and no other, and every grantee it names is one of them", async () => {
    const catalogued = await db().pool.query<{ rolname: string }>(
      String.raw`SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg\_%'`,
    );
    const migrator = catalogued.rows.map((row) => row.rolname).find((name) => !isRuntimeRole(name));

    expect(
      surface.roles.map((role) => (role.role === MIGRATOR ? migrator : role.role)).toSorted(),
    ).toEqual(catalogued.rows.map((row) => row.rolname).toSorted());

    const named = new Set([...surface.roles.map((role) => role.role), PUBLIC_GRANTEE]);
    const grantees = [
      ...surface.defaults,
      ...surface.schemas,
      ...surface.relations,
      ...surface.columns,
      ...surface.functions,
    ].map((row) => row.role);
    expect([...new Set(grantees)].filter((grantee) => !named.has(grantee))).toEqual([]);
  });

  it("holds PUBLIC's own schema USAGE, which a generator that lost every PUBLIC row could not", () => {
    expect(readFileSync(rolesSurfacePath, "utf8")).toContain(
      '{"role":"PUBLIC","object":"public","privilege":"USAGE","grantable":false,"owner":"pg_database_owner"}',
    );
  });

  it("carries neither rolbypassrls nor rolsuper on either runtime role, so the tenancy proofs are not vacuous", () => {
    expect(
      surface.roles
        .filter((role) => isRuntimeRole(role.role))
        .map(({ role, superuser, bypass_rls }) => ({ role, superuser, bypass_rls })),
    ).toEqual([
      { role: "app_rt", superuser: false, bypass_rls: false },
      { role: "worker_rt", superuser: false, bypass_rls: false },
    ]);
  });

  it("is the same file after a second tenant signs up, so a restore drill's diff is about the restore", async () => {
    await withRollback(db().pool, async (client) => {
      await oneWorkspacePartition(client);

      expect(renderRolesSurface(await readRolesSurface(client))).toBe(
        readFileSync(rolesSurfacePath, "utf8"),
      );
    });
  });

  it("collapses a partition that carries a grant of its own to one token naming its parent", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(`GRANT SELECT ON ${await thePartition(client)} TO worker_rt`);

      const relations = (await readRolesSurface(client)).relations.filter(
        (row) => row.is_partition,
      );
      expect(relations).toEqual([
        {
          role: "worker_rt",
          object: "<partition-of index.chunk>",
          kind: "table",
          is_partition: true,
          privilege: "SELECT",
          grantable: false,
        },
      ]);
    });
  });
});

describe("the two statements that make the flip", () => {
  it("move no existing relation's ACL, because a default privilege lives in pg_default_acl alone", async () => {
    await withRollback(db().pool, async (client) => {
      const before = (await readRolesSurface(client)).relations;

      for (const statement of THE_DEFAULTS_REVOKED) await client.query(statement);

      expect((await readRolesSurface(client)).relations).toEqual(before);
    });
  });
});

describe("a table created after the flip", () => {
  it("gives worker_rt no privilege of the eight and app_rt the four verbs, in either schema", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query("CREATE TABLE public.after_the_flip (id text PRIMARY KEY)");
      await client.query('CREATE TABLE "index".after_the_flip (id text PRIMARY KEY)');

      for (const table of ["public.after_the_flip", '"index".after_the_flip']) {
        expect({ table, worker: await privilegesHeld(client, "worker_rt", table) }).toEqual({
          table,
          worker: NOTHING_OF_THE_EIGHT,
        });
        expect({ table, api: await privilegesHeld(client, "app_rt", table) }).toEqual({
          table,
          api: THE_FOUR_VERBS,
        });
      }
    });
  });

  it("refuses the worker on the statement and serves the api, so a mistake is an error and not a silent zero rows", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query("CREATE TABLE public.after_the_flip (id text PRIMARY KEY)");
      await client.query("SET LOCAL ROLE worker_rt");

      await refusesEach(client, [
        [
          "SELECT id FROM public.after_the_flip",
          "a connector's new table gives the worker nothing until a migration says otherwise",
        ],
        [
          "SELECT id FROM llm_route",
          "the worker could DELETE this table by the default alone, and never read it",
        ],
        [
          "SELECT workspace_id FROM workspace_config",
          "nor this one, so both go with the flip that makes the rest a statement",
        ],
      ]);

      await client.query("SET LOCAL ROLE app_rt");
      expect({
        flipped: (await client.query("SELECT id FROM public.after_the_flip")).rows,
        route: (await client.query("SELECT id FROM llm_route")).rows,
        config: (await client.query("SELECT workspace_id FROM workspace_config")).rows,
      }).toEqual({ flipped: [], route: [], config: [] });
    });
  });
});

describe("what worker_rt reaches after the flip", () => {
  it("is exactly what a GRANT in the journal names, table by table", async () => {
    await withRollback(db().pool, async (client) => {
      expect({
        job: await privilegesHeld(client, "worker_rt", "public.job"),
        workspace: await privilegesHeld(client, "worker_rt", "public.workspace"),
        chunk: await privilegesHeld(client, "worker_rt", '"index".chunk'),
        llmRoute: await privilegesHeld(client, "worker_rt", "public.llm_route"),
        workspaceConfig: await privilegesHeld(client, "worker_rt", "public.workspace_config"),
      }).toEqual({
        job: held("SELECT", "INSERT", "UPDATE"),
        workspace: held("SELECT"),
        chunk: THE_FOUR_VERBS,
        llmRoute: NOTHING_OF_THE_EIGHT,
        workspaceConfig: NOTHING_OF_THE_EIGHT,
      });
    });
  });

  it("is a column set on the finding, where the table-level answer is false and the column-level one is not", async () => {
    await withRollback(db().pool, async (client) => {
      expect({
        table: await privilegesHeld(client, "worker_rt", "public.finding"),
        insert: await columnsHeld(client, "worker_rt", "public.finding", "INSERT"),
        select: await columnsHeld(client, "worker_rt", "public.finding", "SELECT"),
        update: await columnsHeld(client, "worker_rt", "public.finding", "UPDATE"),
      }).toEqual({
        table: NOTHING_OF_THE_EIGHT,
        insert: [
          "category",
          "char_end",
          "char_start",
          "detector_pin",
          "document_id",
          "id",
          "rule_id",
          "rule_version",
          "score",
          "tier",
          "workspace_id",
        ],
        select: [
          "category",
          "char_end",
          "char_start",
          "detector_pin",
          "document_id",
          "restored_at",
          "rule_id",
          "rule_version",
          "score",
          "tier",
          "workspace_id",
        ],
        update: ["category", "detector_pin", "rule_version", "score", "tier"],
      });
    });
  });
});

describe("the functions the journal installs", () => {
  it("refuse the roles the migration did not name, now that PUBLIC no longer holds EXECUTE", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query("SET LOCAL ROLE worker_rt");
      await refusesEach(client, [
        [
          "SELECT id FROM llm_route_for('embedding'::llm_purpose)",
          "the route resolver goes to the roles its callers run as, and the worker is not one",
        ],
      ]);

      await client.query("SET LOCAL ROLE app_rt");
      await refusesEach(client, [
        [
          "SELECT suggestion_decides_once()",
          "a trigger's function fires under the trigger and is called by nobody directly",
        ],
        ["SELECT graph_generation_flip_guard()", "the same for the generation flip's guard"],
        ["SELECT graph_row_generation_guard()", "and for the guard on a map row's generation"],
      ]);

      const resolved = await client.query("SELECT id FROM llm_route_for('embedding'::llm_purpose)");
      expect(resolved.rows).toEqual([]);
    });
  });

  it("carry no PUBLIC EXECUTE row between them", async () => {
    const toPublic = await db().pool.query<{ fn: string }>(
      String.raw`SELECT n.nspname || '.' || p.proname AS fn
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
                        LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
                  WHERE a.grantee = 0 AND n.nspname NOT LIKE 'pg\_%'
                    AND n.nspname <> 'information_schema'
                    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                     WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass
                                       AND d.deptype = 'e')`,
    );

    expect(toPublic.rows).toEqual([]);
    expect(surface.functions.filter((row) => row.role === PUBLIC_GRANTEE)).toEqual([]);
  });

  it("would show a PUBLIC EXECUTE the moment one arrived, because a null proacl is materialised", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(
        "CREATE FUNCTION public.granted_to_nobody() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
      );

      const rows = (await readRolesSurface(client)).functions.filter(
        (row) => row.object === "public.granted_to_nobody",
      );
      expect(rows).toEqual([
        {
          role: PUBLIC_GRANTEE,
          object: "public.granted_to_nobody",
          args: "",
          security_definer: false,
          acl_is_default: true,
          privilege: "EXECUTE",
          grantable: false,
        },
      ]);
    });
  });

  it("are the journal's alone: an extension's own functions are left out, PUBLIC EXECUTE and all", async () => {
    const shipped = await db().pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'vector_dims'",
    );

    expect({
      inTheImage: (shipped.rows[0]?.n ?? 0) > 0,
      inTheFile: surface.functions.some((row) => row.object.endsWith(".vector_dims")),
    }).toEqual({ inTheImage: true, inTheFile: false });
  });

  it("still fire as triggers, though EXECUTE on each of the three went to nobody", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = testData(client);
      const workspace = await seed.workspace();
      const decided = await seed.suggestion({ workspaceId: workspace.id });
      await seed.graphGeneration({ workspaceId: workspace.id, liveGen: 1 });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspace.id]);

      const fired: Record<string, string> = {};
      for (const [guard, statement, parameters] of [
        [
          "suggestion_decides_once",
          "UPDATE suggestion SET status = 'accepted' WHERE workspace_id = $1 AND id = $2",
          [workspace.id, decided.id],
        ],
        [
          "graph_generation_flip_guard",
          "UPDATE graph_generation SET live_gen = 9 WHERE workspace_id = $1",
          [workspace.id],
        ],
        ["graph_row_generation_guard", A_GRAPH_NODE, [workspace.id, 9, ulid(), "a node"]],
      ] as const) {
        await client.query("SAVEPOINT guard");
        fired[guard] = await client
          .query(statement, [...parameters])
          .then(() => "nothing fired")
          .catch((cause: unknown) => (cause instanceof Error ? cause.message : String(cause)));
        await client.query("ROLLBACK TO SAVEPOINT guard");
      }

      expect(fired).toEqual({
        suggestion_decides_once: expect.stringContaining("this transaction is not making it"),
        graph_generation_flip_guard: expect.stringContaining("a generation flips only to the next"),
        graph_row_generation_guard: expect.stringContaining("lands in the live generation"),
      });
    });
  });
});

describe("the declared note over the SECURITY DEFINER functions", () => {
  it("names the set the catalogue holds, and the catalogue holds the set it names", async () => {
    const catalogued = await db().pool.query<{ fn: string; args: string }>(
      String.raw`SELECT n.nspname || '.' || p.proname AS fn,
                        pg_get_function_identity_arguments(p.oid) AS args
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE p.prosecdef AND n.nspname NOT LIKE 'pg\_%'
                    AND n.nspname <> 'information_schema'
                    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                     WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass
                                       AND d.deptype = 'e')`,
    );
    const identities = (rows: readonly { fn: string; args: string }[]): readonly string[] =>
      rows.map(identityOf).toSorted();

    expect(identities(catalogued.rows)).toEqual(identities(SECURITY_DEFINER_REACH));
  });

  it("gives each one a reason and tables the schema package declares, some of which the surface is silent on", () => {
    const declared = declaredTableNames();
    const stated = new Set(surface.relations.map((row) => row.object));

    for (const entry of SECURITY_DEFINER_REACH) {
      expect({
        fn: entry.fn,
        undeclared: entry.reaches.filter((table) => !declared.has(table)),
        reasoned: entry.reason.trim().length > 0,
      }).toEqual({ fn: entry.fn, undeclared: [], reasoned: true });
    }

    const silent = SECURITY_DEFINER_REACH.flatMap((entry) => entry.reaches).filter(
      (table) => !stated.has(table),
    );
    expect([...new Set(silent)]).toEqual(["public.concept_write_request"]);
  });

  it("is carried into the surface itself, so a definer row reads as a reach the file does not state", () => {
    const definers = surface.functions
      .filter((row) => row.security_definer)
      .map((row) => identityOf({ fn: row.object, args: row.args }));

    expect([...new Set(definers)].toSorted()).toEqual(
      SECURITY_DEFINER_REACH.map(identityOf).toSorted(),
    );
  });
});
