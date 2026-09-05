import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import type pg from "pg";
import type { z } from "zod";

import { boundarySchemas, CREATOR_ROLE, EMBEDDING_DIMENSIONS, ulid } from "../src/index.ts";

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
  /**
   * A pending invitation; creates its own workspace and inviter unless named. The role
   * defaults to the creator role and the invitation expires a week out, which is what a
   * People screen would write.
   */
  invitation(overrides?: Partial<InsertInput<"invitation">>): Promise<Row<"invitation">>;
  /** A config row; creates its own workspace unless one is named. */
  workspaceConfig(
    overrides?: Partial<InsertInput<"workspaceConfig">>,
  ): Promise<Row<"workspaceConfig">>;
  /** An llm route; creates its own workspace unless one is named. */
  llmRoute(overrides?: Partial<InsertInput<"llmRoute">>): Promise<Row<"llmRoute">>;
  /** A chunk; creates workspace and partition as needed; embedding defaults to zeros. */
  chunk(overrides?: Partial<InsertInput<"chunk">>): Promise<Row<"chunk">>;
  /** An OAuth client; id, client id and redirect uris default. */
  oauthClient(overrides?: Partial<InsertInput<"oauthClient">>): Promise<Row<"oauthClient">>;
  /**
   * A refresh token; creates its own client and person unless named. `referenceId` is
   * the workspace the grant was consented to — null means a grant that named none.
   */
  oauthRefreshToken(
    overrides?: Partial<InsertInput<"oauthRefreshToken">>,
  ): Promise<Row<"oauthRefreshToken">>;
  /** An access token; creates its own client and person unless named; `referenceId` as above. */
  oauthAccessToken(
    overrides?: Partial<InsertInput<"oauthAccessToken">>,
  ): Promise<Row<"oauthAccessToken">>;
};

/** INSERT the boundary-parsed row and read it back through the select schema. */
const insertRow = async <TName extends keyof Registry>(
  client: pg.PoolClient,
  name: TName,
  values: InsertInput<TName>,
): Promise<Row<TName>> => {
  const { table, insert, select } = boundarySchemas[name];
  const parsed: Readonly<Record<string, unknown>> = insert.parse(values);
  const columns: Readonly<Record<string, { name: string; getSQLType: () => string }>> =
    getTableColumns(table);
  const config = getTableConfig(table as PgTable);
  const qualified = `${config.schema === undefined ? "" : `"${config.schema}".`}"${config.name}"`;

  const keys = Object.keys(parsed);
  const names = keys.map((key) => `"${columns[key]?.name ?? key}"`).join(", ");
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");
  const returned = await client.query(
    `INSERT INTO ${qualified} (${names}) VALUES (${placeholders}) RETURNING *`,
    keys.map((key) => {
      const value = parsed[key];
      // node-postgres renders a JS array as a Postgres array literal, which is right for
      // every `text[]` column; pgvector wants the bracketed text form instead, so only
      // the vector column is stringified.
      const isVector = columns[key]?.getSQLType().startsWith("vector") ?? false;
      return Array.isArray(value) && isVector ? JSON.stringify(value) : value;
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
    const id = overrides.id ?? ulid();
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
      id: ulid(),
      role: CREATOR_ROLE,
      createdAt: new Date(),
      ...overrides,
      workspaceId,
      userId,
    });
  };

  const invitation: TestData["invitation"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const inviterId = overrides.inviterId ?? (await user()).id;
    const week = 7 * 24 * 60 * 60 * 1000;
    return insertRow(client, "invitation", {
      id: ulid(),
      email: `invitee-${ulid().toLowerCase()}@example.invalid`,
      role: CREATOR_ROLE,
      status: "pending",
      expiresAt: new Date(Date.now() + week),
      createdAt: new Date(),
      ...overrides,
      workspaceId,
      inviterId,
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

  const oauthClient: TestData["oauthClient"] = (overrides = {}) => {
    const id = overrides.id ?? `client-${ulid()}`;
    return insertRow(client, "oauthClient", {
      id,
      // Better Auth keys the token tables on the client id, not the row's id.
      clientId: `https://${id.toLowerCase()}.example.invalid/metadata`,
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
      ...overrides,
    });
  };

  const oauthRefreshToken: TestData["oauthRefreshToken"] = async (overrides = {}) => {
    const clientId = overrides.clientId ?? (await oauthClient()).clientId;
    const userId = overrides.userId ?? (await user()).id;
    const id = overrides.id ?? `refresh-${ulid()}`;
    return insertRow(client, "oauthRefreshToken", {
      id,
      token: `refresh-token-${id}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      scopes: ["knowledge:read"],
      ...overrides,
      clientId,
      userId,
    });
  };

  const oauthAccessToken: TestData["oauthAccessToken"] = async (overrides = {}) => {
    const clientId = overrides.clientId ?? (await oauthClient()).clientId;
    const userId = overrides.userId ?? (await user()).id;
    const id = overrides.id ?? `access-${ulid()}`;
    return insertRow(client, "oauthAccessToken", {
      id,
      token: `access-token-${id}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      scopes: ["knowledge:read"],
      ...overrides,
      clientId,
      userId,
    });
  };

  return {
    workspace,
    user,
    member,
    invitation,
    workspaceConfig,
    llmRoute,
    chunk,
    oauthClient,
    oauthRefreshToken,
    oauthAccessToken,
  };
};
