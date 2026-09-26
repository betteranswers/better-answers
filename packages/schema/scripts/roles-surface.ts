import path from "node:path";

import type pg from "pg";

import { byCodeUnit } from "../src/code-unit.ts";
import { listed } from "../src/column-helpers.ts";
import { DEFINER_REACH_NOTE } from "../src/definer-reach.ts";
import { testData } from "../test/factory.ts";

export const rolesSurfacePath = path.resolve(import.meta.dirname, "../roles-surface.json");

export const MIGRATOR = "<migrator>";

export const PUBLIC_GRANTEE = "PUBLIC";

const RUNTIME_ROLES = ["app_rt", "worker_rt"] as const;

export const isRuntimeRole = (name: string): boolean => RUNTIME_ROLES.some((role) => role === name);

const KIND_WORDS = new Map([
  ["r", "table"],
  ["p", "partitioned table"],
  ["v", "view"],
  ["m", "materialized view"],
  ["S", "sequence"],
  ["f", "foreign table"],
]);

const RELATION_KINDS_LISTED = listed([...KIND_WORDS.keys()]);

const NOTE = [
  "Generated from pg_catalog, never edited: pnpm --filter @better-answers/schema run generate:roles-surface.",
  "The whole journal applied to the pinned image, with one workspace partition made, then read back.",
  "Owner names are normalised to <migrator> and a run-time partition collapses to <partition-of PARENT>, so the file is the same whatever tenants a database holds.",
  "An extension's own functions are excluded by their pg_depend extension dependency, so bumping the image does not churn this file.",
  "An owner's rights over its own object are implicit, so they are left out of the privilege blocks and the ownership block says who owns what instead; that is also why a run-time partition, whose ACL is its owner's alone, adds no row here. A schema carries its owner on the row because the ownership block counts relations alone.",
  "The collapse reaches the ownership counts too: every partition of one parent is one row counting one relation, so a tenant signing up moves no line of this file.",
  "What it cannot say: which migration granted a column, because pg_attribute.attacl holds a set and two migrations' grants merge into one; whether a grant was meant, which is what deny-by-default on worker_rt makes legible in the diff rather than here; and what an owner may do with what it owns.",
  DEFINER_REACH_NOTE,
] as const;

type RoleRow = {
  readonly role: string;
  readonly can_login: boolean;
  readonly superuser: boolean;
  readonly bypass_rls: boolean;
  readonly member_of: readonly string[];
};

type DefaultRow = {
  readonly role: string;
  readonly schema: string;
  readonly object_type: string;
  readonly for_role: string;
  readonly privilege: string;
  readonly grantable: boolean;
};

type SchemaRow = {
  readonly role: string;
  readonly object: string;
  readonly privilege: string;
  readonly grantable: boolean;
  readonly owner: string;
};

type RelationRow = {
  readonly role: string;
  readonly object: string;
  readonly kind: string;
  readonly is_partition: boolean;
  readonly privilege: string;
  readonly grantable: boolean;
};

type ColumnRow = {
  readonly role: string;
  readonly object: string;
  readonly column: string;
  readonly privilege: string;
  readonly grantable: boolean;
};

type FunctionRow = {
  readonly role: string;
  readonly object: string;
  readonly args: string;
  readonly security_definer: boolean;
  readonly acl_is_default: boolean;
  readonly privilege: string;
  readonly grantable: boolean;
};

type OwnershipRow = {
  readonly owner: string;
  readonly kind: string;
  readonly relations: number;
};

export type RolesSurface = {
  readonly note: readonly string[];
  readonly roles: readonly RoleRow[];
  readonly defaults: readonly DefaultRow[];
  readonly schemas: readonly SchemaRow[];
  readonly relations: readonly RelationRow[];
  readonly relations_with_no_acl: readonly string[];
  readonly columns: readonly ColumnRow[];
  readonly functions: readonly FunctionRow[];
  readonly ownership: readonly OwnershipRow[];
};

type Client = pg.Pool | pg.PoolClient;

const OURS = String.raw`n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'`;

const GRANTEE = `CASE WHEN a.grantee = 0 THEN '${PUBLIC_GRANTEE}' ELSE pg_get_userbyid(a.grantee) END`;

const kindWord = (relkind: string): string => KIND_WORDS.get(relkind) ?? relkind;

/**
 * The superuser's name differs between a container and a restore drill, so it is
 * normalised; two candidates and there is no one name to use.
 */
const migratorIn = (roles: readonly { readonly rolname: string }[]): string => {
  const others = roles.map((role) => role.rolname).filter((name) => !isRuntimeRole(name));
  const only = others[0];
  if (others.length !== 1 || only === undefined) {
    throw new Error(
      `the roles' surface is generated from a database with one role beside ${RUNTIME_ROLES.join(" and ")}, the migrator; this one has ${String(others.length)}: ${others.join(", ")}`,
    );
  }
  return only;
};

/**
 * Without one the file is silent on the relation the estate makes at run time, and a
 * partition inheriting no ACL is the fact stated.
 */
export const oneWorkspacePartition = async (client: pg.PoolClient): Promise<void> => {
  const workspace = await testData(client).workspace();
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspace.id]);
  await client.query("SELECT create_workspace_partition($1)", [workspace.id]);
};

/**
 * The scope the lifecycle function guards is set for a transaction, so there must be one;
 * a caller inside one takes the function above.
 */
export const withOneWorkspacePartition = async (client: pg.PoolClient): Promise<void> => {
  await client.query("BEGIN");
  try {
    await oneWorkspacePartition(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
};

export const readRolesSurface = async (client: Client): Promise<RolesSurface> => {
  const roleRows = await client.query<{
    rolname: string;
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolbypassrls: boolean;
    member_of: string[];
  }>(
    String.raw`SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
              ARRAY(SELECT pg_get_userbyid(m.roleid) FROM pg_auth_members m WHERE m.member = r.oid)::text[] AS member_of
         FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\_%'`,
  );
  const migrator = migratorIn(roleRows.rows);
  const named = (role: string): string => (role === migrator ? MIGRATOR : role);

  const defaults = await client.query<{
    role: string;
    schema: string;
    object_type: string;
    for_role: string;
    privilege: string;
    grantable: boolean;
  }>(
    `SELECT ${GRANTEE} AS role, COALESCE(n.nspname, '<all schemas>') AS schema,
            d.defaclobjtype::text AS object_type, pg_get_userbyid(d.defaclrole) AS for_role,
            a.privilege_type AS privilege, a.is_grantable AS grantable
       FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace,
            LATERAL aclexplode(d.defaclacl) AS a`,
  );

  const schemas = await client.query<{
    role: string;
    object: string;
    privilege: string;
    grantable: boolean;
    owner: string;
  }>(
    `SELECT ${GRANTEE} AS role, n.nspname AS object, a.privilege_type AS privilege,
            a.is_grantable AS grantable, pg_get_userbyid(n.nspowner) AS owner
       FROM pg_namespace n, LATERAL aclexplode(n.nspacl) AS a
      WHERE ${OURS} AND a.grantee <> n.nspowner`,
  );

  const relations = await client.query<{
    role: string;
    object: string;
    relkind: string;
    is_partition: boolean;
    parent: string | null;
    privilege: string;
    grantable: boolean;
    owner: string;
  }>(
    `SELECT ${GRANTEE} AS role, n.nspname || '.' || c.relname AS object, c.relkind::text AS relkind,
            c.relispartition AS is_partition, pn.nspname || '.' || p.relname AS parent,
            a.privilege_type AS privilege, a.is_grantable AS grantable,
            pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
       LEFT JOIN pg_class p ON p.oid = i.inhparent
       LEFT JOIN pg_namespace pn ON pn.oid = p.relnamespace,
            LATERAL aclexplode(c.relacl) AS a
      WHERE ${OURS} AND a.grantee <> c.relowner
        AND c.relkind IN (${RELATION_KINDS_LISTED})`,
  );

  const withoutAcl = await client.query<{
    object: string;
    is_partition: boolean;
    parent: string | null;
  }>(
    `SELECT n.nspname || '.' || c.relname AS object, c.relispartition AS is_partition,
            pn.nspname || '.' || p.relname AS parent
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
       LEFT JOIN pg_class p ON p.oid = i.inhparent
       LEFT JOIN pg_namespace pn ON pn.oid = p.relnamespace
      WHERE c.relacl IS NULL AND ${OURS}
        AND c.relkind IN (${RELATION_KINDS_LISTED})`,
  );

  const columns = await client.query<{
    role: string;
    object: string;
    column: string;
    privilege: string;
    grantable: boolean;
  }>(
    `SELECT ${GRANTEE} AS role, n.nspname || '.' || c.relname AS object, att.attname AS column,
            a.privilege_type AS privilege, a.is_grantable AS grantable
       FROM pg_attribute att
       JOIN pg_class c ON c.oid = att.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace,
            LATERAL aclexplode(att.attacl) AS a
      WHERE att.attnum > 0 AND NOT att.attisdropped AND ${OURS}`,
  );

  const functions = await client.query<{
    role: string;
    object: string;
    args: string;
    security_definer: boolean;
    acl_is_default: boolean;
    owner: string;
    privilege: string;
    grantable: boolean;
  }>(
    `SELECT ${GRANTEE} AS role, n.nspname || '.' || p.proname AS object,
            pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer,
            (p.proacl IS NULL) AS acl_is_default, pg_get_userbyid(p.proowner) AS owner,
            a.privilege_type AS privilege, a.is_grantable AS grantable
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
            LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
      WHERE ${OURS} AND a.grantee <> p.proowner AND p.prokind IN ('f', 'p', 'a', 'w')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass
                           AND d.deptype = 'e')`,
  );

  const ownership = await client.query<{
    owner: string;
    relkind: string;
    is_partition: boolean;
    parent: string | null;
    relations: number;
  }>(
    `SELECT pg_get_userbyid(c.relowner) AS owner, c.relkind::text AS relkind,
            c.relispartition AS is_partition, pn.nspname || '.' || p.relname AS parent,
            count(*)::int AS relations
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
       LEFT JOIN pg_class p ON p.oid = i.inhparent
       LEFT JOIN pg_namespace pn ON pn.oid = p.relnamespace
      WHERE ${OURS} AND c.relkind IN (${RELATION_KINDS_LISTED})
      GROUP BY 1, 2, 3, 4`,
  );

  const objectNamed = (row: {
    object: string;
    is_partition: boolean;
    parent: string | null;
  }): string =>
    row.is_partition && row.parent !== null ? `<partition-of ${row.parent}>` : row.object;

  const collapsed = new Map<string, string>();
  for (const row of [...withoutAcl.rows, ...relations.rows])
    collapsed.set(row.object, objectNamed(row));

  return {
    note: NOTE,
    roles: roleRows.rows.map((row) => ({
      role: named(row.rolname),
      can_login: row.rolcanlogin,
      superuser: row.rolsuper,
      bypass_rls: row.rolbypassrls,
      member_of: row.member_of.map(named),
    })),
    defaults: defaults.rows.map((row) => ({
      role: named(row.role),
      schema: row.schema,
      object_type: row.object_type,
      for_role: named(row.for_role),
      privilege: row.privilege,
      grantable: row.grantable,
    })),
    schemas: schemas.rows.map((row) => ({
      role: named(row.role),
      object: row.object,
      privilege: row.privilege,
      grantable: row.grantable,
      owner: named(row.owner),
    })),
    relations: relations.rows.map((row) => ({
      role: named(row.role),
      object: collapsed.get(row.object) ?? row.object,
      kind: kindWord(row.relkind),
      is_partition: row.is_partition,
      privilege: row.privilege,
      grantable: row.grantable,
    })),
    relations_with_no_acl: [...new Set(withoutAcl.rows.map(objectNamed))].toSorted(byCodeUnit),
    columns: columns.rows.map((row) => ({
      role: named(row.role),
      object: row.object,
      column: row.column,
      privilege: row.privilege,
      grantable: row.grantable,
    })),
    functions: functions.rows.map((row) => ({
      role: named(row.role),
      object: row.object,
      args: row.args,
      security_definer: row.security_definer,
      acl_is_default: row.acl_is_default,
      privilege: row.privilege,
      grantable: row.grantable,
    })),
    ownership: ownership.rows.map((row) => ({
      owner: named(row.owner),
      kind:
        row.is_partition && row.parent !== null
          ? `<partition-of ${row.parent}>`
          : kindWord(row.relkind),
      relations: row.is_partition && row.parent !== null ? 1 : row.relations,
    })),
  };
};

const block = (
  name: string,
  rows: readonly unknown[],
  { last = false, ordered = false } = {},
): readonly string[] => {
  const drawn = rows.map((row) => JSON.stringify(row));
  const rendered = ordered ? drawn : [...new Set(drawn)].toSorted(byCodeUnit);
  if (rendered.length === 0) return [`  "${name}": []${last ? "" : ","}`];
  return [
    `  "${name}": [`,
    ...rendered.map(
      (line, position) => `    ${line}${position === rendered.length - 1 ? "" : ","}`,
    ),
    `  ]${last ? "" : ","}`,
  ];
};

/**
 * One object per line: pretty-printing spreads a privilege over five lines, so one
 * privilege gained would read as a brace count rather than a line.
 */
export const renderRolesSurface = (surface: RolesSurface): string => {
  const rendered = [
    "{",
    ...block("note", surface.note, { ordered: true }),
    ...block("roles", surface.roles),
    ...block("defaults", surface.defaults),
    ...block("schemas", surface.schemas),
    ...block("relations", surface.relations),
    ...block("relations_with_no_acl", surface.relations_with_no_acl, { ordered: true }),
    ...block("columns", surface.columns),
    ...block("functions", surface.functions),
    ...block("ownership", surface.ownership, { last: true }),
    "}",
    "",
  ].join("\n");

  JSON.parse(rendered);
  return rendered;
};
