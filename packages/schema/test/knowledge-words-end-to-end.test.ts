import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  MARK_THE_MATCH_LEAKPROOF,
  migrationsFolder,
  SUGGESTION_KINDS,
  SUGGESTION_KINDS_FROM_A_RUN,
  SUGGESTION_KINDS_FROM_THE_APP,
  ulid,
} from "../src/index.ts";
import { journalMigrationFiles } from "../src/journal.ts";
import { POSTGRES_IMAGE } from "../src/postgres-image.ts";
import {
  migrationsFolderBefore0072,
  oldWordsStoredIn,
  type SeededBefore0072,
} from "./before-the-knowledge-words.ts";
import { endPool, POSTGRES_COMMAND, withRollback } from "./harness.ts";
import { ADMITTED, refusalOf, sqlstateOf } from "./probes.ts";

/** A non-superuser that owns every object, so the forced policies hold it as they hold `migrate`. */
const THE_OWNER = "the_knowledge_words_owner";

const OWNED_BY_THE_OWNER = `DO $$
DECLARE target text;
BEGIN
  FOR target IN
    SELECT format('ALTER %s %s OWNER TO ${THE_OWNER}',
                  CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
                  c.oid::regclass)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public', 'index', 'drizzle') AND c.relkind IN ('r', 'p', 'v', 'm')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE target; END LOOP;
  FOR target IN
    SELECT format('ALTER ROUTINE %s OWNER TO ${THE_OWNER}', p.oid::regprocedure)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'index')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP EXECUTE target; END LOOP;
END $$`;

const RENAMED: Readonly<Record<string, string>> = {
  composition: "write_up",
  composition_include: "write_up_include",
  concept_class_override: "concept_sensitivity_override",
};

const MOVED_VALUES: Readonly<Record<string, string>> = {
  "suggestion.kind=candidate": "suggestion.kind=suggested-concept",
  "suggestion.kind=repair": "suggestion.kind=citation-fix",
  "concept_verification.origin=repair": "concept_verification.origin=citation-fix",
  "source_document.outcome=quarantined": "source_document.outcome=unreadable",
  "map_node.label=Composition": "map_node.label=WriteUp",
};

const VALUED = [
  ["suggestion", "kind"],
  ["concept_verification", "origin"],
  ["source_document", "outcome"],
  ["map_node", "label"],
] as const;

type Standing = Readonly<Record<string, number>>;

/** Every row of the seven tables, counted per workspace and per stored value, as the superuser. */
const standing = async (
  client: pg.ClientBase,
  tables: readonly string[],
  workspaceName: (id: string) => string,
): Promise<Standing> => {
  const counted: Record<string, number> = {};
  const add = (key: string, n: number) => {
    counted[key] = (counted[key] ?? 0) + n;
  };
  for (const [table, column] of VALUED) {
    const rows = await client.query<{ workspace_id: string; value: string; n: number }>(
      `SELECT workspace_id, ${column} AS value, count(*)::int AS n FROM ${table} GROUP BY 1, 2`,
    );
    for (const row of rows.rows)
      add(`${workspaceName(row.workspace_id)} ${table}.${column}=${row.value}`, row.n);
  }
  for (const table of tables) {
    const rows = await client.query<{ workspace_id: string; n: number }>(
      `SELECT workspace_id, count(*)::int AS n FROM ${table} GROUP BY 1`,
    );
    for (const row of rows.rows) add(`${workspaceName(row.workspace_id)} ${table}`, row.n);
  }
  return counted;
};

/** What `before` should read as after 0072: each old value and table under its new name. */
const renamed = (before: Standing): Standing =>
  Object.fromEntries(
    Object.entries(before).map(([key, n]) => {
      const [workspace = "", what = ""] = key.split(" ");
      return [`${workspace} ${MOVED_VALUES[what] ?? RENAMED[what] ?? what}`, n];
    }),
  );

/** Grants, row security and policy text on a table, with its own name taken out. */
const securityOf = async (client: pg.ClientBase, table: string): Promise<unknown> => {
  const relation = await client.query<{ acl: string; rls: boolean; forced: boolean }>(
    `SELECT relacl::text AS acl, relrowsecurity AS rls, relforcerowsecurity AS forced
       FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  const policies = await client.query<{ name: string; roles: string; qual: string; check: string }>(
    `SELECT replace(polname, $2, '') AS name, polroles::regrole[]::text AS roles,
            pg_get_expr(polqual, polrelid) AS qual, pg_get_expr(polwithcheck, polrelid) AS check
       FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname`,
    [table, table],
  );
  return { ...relation.rows[0], policies: policies.rows };
};

const functionAcl = async (client: pg.ClientBase, signature: string): Promise<unknown> =>
  (
    await client.query<{ acl: string; definer: boolean; config: string[] | null }>(
      `SELECT proacl::text AS acl, prosecdef AS definer, proconfig AS config
         FROM pg_proc WHERE oid = $1::regprocedure`,
      [signature],
    )
  ).rows[0];

const columnAcl = async (client: pg.ClientBase, column: string): Promise<string | undefined> =>
  (
    await client.query<{ acl: string }>(
      "SELECT attacl::text AS acl FROM pg_attribute WHERE attrelid = 'source_document'::regclass AND attname = $1",
      [column],
    )
  ).rows[0]?.acl;

type Security = {
  readonly tables: Readonly<Record<string, unknown>>;
  readonly narrowest: unknown;
  readonly submit: unknown;
  readonly reasonColumn: string | undefined;
};

const security = async (
  client: pg.ClientBase,
  tables: readonly string[],
  narrowest: string,
  reasonColumn: string,
): Promise<Security> => {
  const held: Record<string, unknown> = {};
  for (const [position, table] of tables.entries())
    held[String(position)] = await securityOf(client, table);
  return {
    tables: held,
    narrowest: await functionAcl(client, `public.${narrowest}(text, text)`),
    submit: await functionAcl(client, "public.submit_suggestion_set(text, text, text, jsonb)"),
    reasonColumn: await columnAcl(client, reasonColumn),
  };
};

const uriAs = (container: StartedPostgreSqlContainer, user: string): string => {
  const uri = new URL(container.getConnectionUri());
  uri.username = user;
  uri.password = user;
  return uri.toString();
};

let container: StartedPostgreSqlContainer;
let superuser: pg.Pool;
const here = ulid();
const there = ulid();
const nameOf = (id: string): string => (id === here ? "A" : id === there ? "B" : id);
let seeded: { readonly A: SeededBefore0072; readonly B: SeededBefore0072 };
let before: Standing;
let after: Standing;
let securityBefore: Security;
let securityAfter: Security;
let appliedBefore: number;

const migrationRows = async (): Promise<readonly { created_at: string }[]> =>
  (
    await superuser.query<{ created_at: string }>(
      "SELECT created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at",
    )
  ).rows;

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withCommand([...POSTGRES_COMMAND])
    .start();
  superuser = new pg.Pool({ connectionString: container.getConnectionUri(), max: 2 });
  await migrate(drizzle(superuser), { migrationsFolder: migrationsFolderBefore0072() });
  await superuser.query(MARK_THE_MATCH_LEAKPROOF);

  const client = await superuser.connect();
  try {
    await client.query("BEGIN");
    seeded = {
      A: await oldWordsStoredIn(client, here),
      B: await oldWordsStoredIn(client, there),
    };
    await client.query("COMMIT");
    await client.query(
      `CREATE ROLE ${THE_OWNER} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${THE_OWNER}'`,
    );
    await client.query(`GRANT CREATE ON DATABASE "${container.getDatabase()}" TO ${THE_OWNER}`);
    await client.query(`GRANT CREATE ON SCHEMA public TO ${THE_OWNER}`);
    await client.query(`ALTER SCHEMA "index" OWNER TO ${THE_OWNER}`);
    await client.query(`ALTER SCHEMA drizzle OWNER TO ${THE_OWNER}`);
    await client.query(OWNED_BY_THE_OWNER);
    before = await standing(client, Object.keys(RENAMED), nameOf);
    securityBefore = await security(
      client,
      Object.keys(RENAMED),
      "narrower_class",
      "quarantine_error",
    );
  } finally {
    client.release();
  }
  appliedBefore = (await migrationRows()).length;

  const owner = new pg.Pool({ connectionString: uriAs(container, THE_OWNER), max: 1 });
  try {
    await migrate(drizzle(owner), { migrationsFolder });
  } finally {
    await endPool(owner);
  }
  await superuser.query(MARK_THE_MATCH_LEAKPROOF);
  after = await withRollback(superuser, (client) =>
    standing(client, Object.values(RENAMED), nameOf),
  );
  securityAfter = await withRollback(superuser, (client) =>
    security(client, Object.values(RENAMED), "narrower_sensitivity", "unreadable_reason"),
  );
}, 240_000);

afterAll(async () => {
  await endPool(superuser);
  await container.stop();
});

const SEEDED_IN_EACH: Standing = {
  "suggestion.kind=candidate": 2,
  "suggestion.kind=repair": 2,
  "suggestion.kind=edit": 1,
  "concept_verification.origin=repair": 1,
  "concept_verification.origin=platform": 1,
  "source_document.outcome=quarantined": 1,
  "source_document.outcome=converted": 1,
  "map_node.label=Composition": 1,
  "map_node.label=Concept": 1,
  composition: 1,
  composition_include: 2,
  concept_class_override: 1,
};

describe("migration 0072 over a populated 0071 database, as its owner", () => {
  it("applies 0072 and each later migration through the real journal", async () => {
    const journal = journalMigrationFiles();
    const the0072 = journal.findIndex((file) => file.endsWith("0072_the-knowledge-words.sql"));

    expect([appliedBefore, (await migrationRows()).length]).toEqual([the0072, journal.length]);
  });

  it("finds every old word seeded, in both workspaces", () => {
    const inBoth = Object.fromEntries(
      ["A", "B"].flatMap((workspace) =>
        Object.entries(SEEDED_IN_EACH).map(([what, n]) => [`${workspace} ${what}`, n]),
      ),
    );

    expect(before).toEqual(inBoth);
  });

  it("keeps every row, each under its new name", () => {
    expect(after).toEqual(renamed(before));
  });

  it("keeps the grants, row security, policies and definer settings", () => {
    expect(securityAfter).toEqual(securityBefore);
    expect(Object.values(securityAfter.tables)).toEqual(
      Object.values(RENAMED).map(() => expect.objectContaining({ rls: true, forced: true })),
    );
  });

  it("keeps an unreadable document's reason", async () => {
    const reasons = await superuser.query<{ outcome: string; reason: string }>(
      "SELECT outcome, unreadable_reason AS reason FROM source_document WHERE unreadable_reason IS NOT NULL",
    );

    expect(reasons.rows).toEqual([
      { outcome: "unreadable", reason: "NeedsOcrError" },
      { outcome: "unreadable", reason: "NeedsOcrError" },
    ]);
  });

  it("leaves both guards on, a decision still final", async () => {
    const guards = await superuser.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger
        WHERE tgname IN ('suggestion_decides_once_trigger', 'map_node_generation_guard')
        ORDER BY tgname`,
    );
    expect(guards.rows).toEqual([
      { tgname: "map_node_generation_guard", tgenabled: "O" },
      { tgname: "suggestion_decides_once_trigger", tgenabled: "O" },
    ]);

    await withRollback(superuser, async (client) => {
      for (const id of seeded.A.decidedSuggestions) {
        expect(
          await refusalOf(client, () =>
            client.query("UPDATE suggestion SET kind = 'edit' WHERE id = $1", [id]),
          ),
        ).not.toBe(ADMITTED);
      }
    });
  });

  it("shows app_rt one workspace's renamed rows, and none unscoped", async () => {
    const seen = (workspaceId: string): Promise<readonly number[]> =>
      withRollback(superuser, async (client) => {
        await client.query("SET LOCAL ROLE app_rt");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
        const counts: number[] = [];
        for (const table of Object.values(RENAMED)) {
          const rows = await client.query<{ workspace_id: string }>(
            `SELECT workspace_id FROM ${table}`,
          );
          counts.push(
            rows.rows.filter((row) => row.workspace_id === workspaceId).length,
            rows.rowCount ?? 0,
          );
        }
        return counts;
      });

    expect(await seen(here)).toEqual([1, 1, 2, 2, 1, 1]);
    expect(await seen("")).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("lets each tier raise its own kinds, no old one", async () => {
    const answered: Record<string, string> = {};
    const expected: Record<string, string> = {};
    const tiers = [
      { role: "app_rt", mayRaise: SUGGESTION_KINDS_FROM_THE_APP },
      { role: "worker_rt", mayRaise: SUGGESTION_KINDS_FROM_A_RUN },
    ];
    await withRollback(superuser, async (client) => {
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [here]);
      for (const { role, mayRaise } of tiers) {
        await client.query(`SET LOCAL ROLE ${role}`);
        for (const kind of [...SUGGESTION_KINDS, "candidate", "repair"]) {
          const key = `${role} raising ${kind}`;
          expected[key] = mayRaise.some((named) => named === kind) ? ADMITTED : "42501";
          answered[key] = await raisingOne(client, kind);
        }
      }
    });

    expect(answered).toEqual(expected);
  });
});

const raisingOne = async (client: pg.PoolClient, kind: string): Promise<string> => {
  await client.query("SAVEPOINT raising");
  try {
    const suggestionId = ulid();
    await client.query("SELECT * FROM submit_suggestion_set($1, $2, $3, $4::jsonb)", [
      ulid(),
      kind,
      "process:better-answers-test",
      JSON.stringify([
        {
          suggestion_id: suggestionId,
          merge_key: `policy:${ulid().toLowerCase()}`,
          path: `knowledge/${ulid().toLowerCase()}.md`,
          concept_kind: "Policy",
          title: "Expenses",
          frontmatter: '{"title":"Expenses"}',
          body: "Expenses are claimed within thirty days.",
          base_content_hash: null,
        },
      ]),
    ]);
    return ADMITTED;
  } catch (error) {
    return sqlstateOf(error);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT raising");
  }
};
