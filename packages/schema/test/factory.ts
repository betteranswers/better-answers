import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import type pg from "pg";
import type { z } from "zod";

import { boundarySchemas, CREATOR_ROLE, EMBEDDING_DIMENSIONS } from "../src/index.ts";

/**
 * The test-data factory (`[TEST4]`): tests state what their scenario needs and get
 * domain objects back; the SQL, the defaults, the column-name mapping and the chunk
 * partition's existence all live behind this interface. Rows go in through the
 * boundary insert schema and come back out through the select schema, so a factory
 * can never seed a row the boundary would not accept. Inserts run as whatever role
 * and scope the client currently holds — seeding as the superuser and then asserting
 * as `app_rt` is the RLS suites' pattern, not this module's concern.
 */

type Registry = typeof boundarySchemas;
type InsertInput<TName extends keyof Registry> = z.input<Registry[TName]["insert"]>;
type Row<TName extends keyof Registry> = z.infer<Registry[TName]["select"]>;

export type TestData = {
  /** A workspace; id, name and slug default. */
  workspace(overrides?: Partial<InsertInput<"workspace">>): Promise<Row<"workspace">>;
  /** A person in the identity set; id, name and email default. */
  user(overrides?: Partial<InsertInput<"user">>): Promise<Row<"user">>;
  /** A membership; creates its own workspace and user unless named; role defaults to the creator role. */
  member(overrides?: Partial<InsertInput<"member">>): Promise<Row<"member">>;
  /** A config row; creates its own workspace unless one is named. */
  workspaceConfig(
    overrides?: Partial<InsertInput<"workspaceConfig">>,
  ): Promise<Row<"workspaceConfig">>;
  /** An llm route; creates its own workspace unless one is named. */
  llmRoute(overrides?: Partial<InsertInput<"llmRoute">>): Promise<Row<"llmRoute">>;
  /** A chunk; creates workspace and partition as needed; embedding defaults to zeros. */
  chunk(overrides?: Partial<InsertInput<"chunk">>): Promise<Row<"chunk">>;
};

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ulid = (): string =>
  Array.from(
    { length: 26 },
    () => ULID_ALPHABET[Math.floor(Math.random() * ULID_ALPHABET.length)],
  ).join("");

/** INSERT the boundary-parsed row and read it back through the select schema. */
const insertRow = async <TName extends keyof Registry>(
  client: pg.PoolClient,
  name: TName,
  values: InsertInput<TName>,
): Promise<Row<TName>> => {
  const { table, insert, select } = boundarySchemas[name];
  const parsed: Readonly<Record<string, unknown>> = insert.parse(values);
  const columns: Readonly<Record<string, { name: string }>> = getTableColumns(table);
  const config = getTableConfig(table as PgTable);
  const qualified = `${config.schema === undefined ? "" : `"${config.schema}".`}"${config.name}"`;

  const keys = Object.keys(parsed);
  const names = keys.map((key) => `"${columns[key]?.name ?? key}"`).join(", ");
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");
  const returned = await client.query(
    `INSERT INTO ${qualified} (${names}) VALUES (${placeholders}) RETURNING *`,
    keys.map((key) => {
      const value = parsed[key];
      return Array.isArray(value) ? JSON.stringify(value) : value;
    }),
  );

  const row: Readonly<Record<string, unknown>> = returned.rows[0] ?? {};
  const domain: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns)) {
    const value = row[column.name];
    // pgvector returns its column as text; the boundary speaks number[].
    domain[key] = typeof value === "string" && value.startsWith("[") ? JSON.parse(value) : value;
  }
  // SAFETY: `select` is `boundarySchemas[name].select`, so its parse output is
  // exactly `Row<TName>`; TypeScript loses the correlation on the generic indexed
  // access, the registry guarantees it.
  return select.parse(domain) as Row<TName>;
};

const partitionExists = async (client: pg.PoolClient, workspaceId: string): Promise<boolean> => {
  const found = await client.query(
    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'index' AND c.relname = $1",
    [`chunk_${workspaceId}`],
  );
  return found.rowCount === 1;
};

export const testData = (client: pg.PoolClient): TestData => {
  const workspace: TestData["workspace"] = (overrides = {}) => {
    const id = overrides.id ?? ulid();
    return insertRow(client, "workspace", {
      id,
      name: "Test workspace",
      slug: `ws-${id.toLowerCase()}`,
      ...overrides,
    });
  };

  const user: TestData["user"] = (overrides = {}) => {
    const id = overrides.id ?? `user-${ulid()}`;
    return insertRow(client, "user", {
      id,
      name: "Test person",
      email: `${id.toLowerCase()}@example.invalid`,
      ...overrides,
    });
  };

  const member: TestData["member"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const userId = overrides.userId ?? (await user()).id;
    return insertRow(client, "member", {
      id: `member-${ulid()}`,
      role: CREATOR_ROLE,
      createdAt: new Date(),
      ...overrides,
      workspaceId,
      userId,
    });
  };

  const workspaceConfig: TestData["workspaceConfig"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "workspaceConfig", {
      key: "probe",
      value: "probe",
      ...overrides,
      workspaceId,
    });
  };

  const llmRoute: TestData["llmRoute"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const purpose = overrides.purpose ?? "embedding";
    return insertRow(client, "llmRoute", {
      id: `route-${ulid()}`,
      provider: "mistral",
      model: "mistral-embed",
      // The dimensions CHECK: only the embedding purpose carries a count.
      dimensions: purpose === "embedding" ? EMBEDDING_DIMENSIONS : null,
      ...overrides,
      purpose,
      workspaceId,
    });
  };

  const chunk: TestData["chunk"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    if (!(await partitionExists(client, workspaceId))) {
      // The lifecycle function refuses a workspace the transaction is not scoped
      // to, so scope to the target for the call and restore the caller's scope.
      const previous = await client.query("SELECT current_workspace_id() AS ws");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      await client.query("SELECT create_workspace_partition($1)", [workspaceId]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [
        previous.rows[0]?.ws ?? "",
      ]);
    }
    return insertRow(client, "chunk", {
      id: `chunk-${ulid()}`,
      content: "test content",
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
      embeddingRouteId: `route-${ulid()}`,
      sensitivity: "Internal",
      audience: "Everyone",
      bindingId: `binding-${ulid()}`,
      ...overrides,
      workspaceId,
    });
  };

  return { workspace, user, member, workspaceConfig, llmRoute, chunk };
};
