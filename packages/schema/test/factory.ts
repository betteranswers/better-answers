import { createHash } from "node:crypto";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import type pg from "pg";
import type { z } from "zod";

import {
  ACCESS_REQUEST_OPEN_STATUS,
  AUDIENCE_EVERYONE,
  boundarySchemas,
  CONCEPT_STABLE_STATUS,
  conceptIriOf,
  CREATOR_ROLE,
  CURATED_ORIGIN,
  EMBEDDING_DIMENSIONS,
  SUGGESTION_EDIT_KIND,
  SUGGESTION_WAITING_STATUS,
  ulid,
  VERIFICATION_PLATFORM_ORIGIN,
} from "../src/index.ts";

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
  /** A group; creates its own workspace unless one is named. Admin-curated, as every group written today is. */
  group(overrides?: Partial<InsertInput<"group">>): Promise<Row<"group">>;
  /**
   * One person in one group. Creates the group unless named, and the membership the
   * composite key needs unless the person is named — a person in a group is a member of
   * the workspace first, and the key is what says so.
   */
  groupMember(overrides?: Partial<InsertInput<"groupMember">>): Promise<Row<"groupMember">>;
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
  /**
   * A ledger row; creates its own workspace unless one is named. The act is a platform
   * probe and the actor the platform's, so a seeded row never reads as a person's act; the
   * family and subject kind come back derived by the database, never written here.
   */
  auditEvent(overrides?: Partial<InsertInput<"auditEvent">>): Promise<Row<"auditEvent">>;
  /**
   * A waiting access request; creates its own workspace and requester unless named. The
   * reason is a sentence of why, as a person would write one — never blank, which the
   * boundary refuses anyway.
   */
  accessRequest(overrides?: Partial<InsertInput<"accessRequest">>): Promise<Row<"accessRequest">>;
  /** A concept's identity; creates its own workspace unless one is named, and mints the IRI. */
  conceptIdentity(
    overrides?: Partial<InsertInput<"conceptIdentity">>,
  ): Promise<Row<"conceptIdentity">>;
  /**
   * A concept index row; creates its own workspace and identity unless the IRI is named —
   * a named IRI is one the caller has already minted an identity for, as a named group is
   * for `groupMember`. Internal and open to everyone, so a seeded concept is one a reader
   * can see; a suite testing what is withheld says `sensitivity: "Restricted"`.
   */
  conceptIndex(overrides?: Partial<InsertInput<"conceptIndex">>): Promise<Row<"conceptIndex">>;
  /** A bundle commit; creates its own workspace unless one is named. The shas are git object names. */
  bundleCommit(overrides?: Partial<InsertInput<"bundleCommit">>): Promise<Row<"bundleCommit">>;
  /** An evidence row; creates its own workspace unless one is named. */
  evidence(overrides?: Partial<InsertInput<"evidence">>): Promise<Row<"evidence">>;
  /** One check of one concept; creates its own workspace and identity unless the IRI is named. */
  conceptVerification(
    overrides?: Partial<InsertInput<"conceptVerification">>,
  ): Promise<Row<"conceptVerification">>;
  /** A workspace's live-generation row; creates its own workspace unless one is named. */
  graphGeneration(
    overrides?: Partial<InsertInput<"graphGeneration">>,
  ): Promise<Row<"graphGeneration">>;
  /**
   * A graph node in the workspace's live generation (created at 1 when absent), published
   * and open to everyone, so a seeded node is one a walk can reach; a suite testing what
   * is withheld names `sensitivity: "Restricted"` or `publishedAt: null`, and one seeding
   * a source entity names `gen: null` with a prefixed label.
   */
  graphNode(overrides?: Partial<InsertInput<"graphNode">>): Promise<Row<"graphNode">>;
  /**
   * A graph edge in the live generation; creates its two endpoint nodes unless the uids
   * are named, and carries the link columns only when it is a `LINKS_TO`.
   */
  graphEdge(overrides?: Partial<InsertInput<"graphEdge">>): Promise<Row<"graphEdge">>;
  /**
   * A waiting suggestion; creates its own workspace unless one is named. A person's *edit*
   * proposed by a process id, so a seeded row never reads as somebody's act, and none of
   * the decision's four columns filled — which is what *waiting* means.
   */
  suggestion(overrides?: Partial<InsertInput<"suggestion">>): Promise<Row<"suggestion">>;
  /**
   * A suggestion's payload; creates the suggestion it belongs to unless one is named. It
   * carries a merge key and no IRI, because identity is the acceptance's to resolve.
   */
  conceptWriteRequest(
    overrides?: Partial<InsertInput<"conceptWriteRequest">>,
  ): Promise<Row<"conceptWriteRequest">>;
};

/** A hash of `length` hex characters, in shape and unique per call: a stand-in, never a real digest. */
const hexOfLength = (length: number): string =>
  createHash("sha256").update(ulid()).digest("hex").repeat(2).slice(0, length);

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

  const group: TestData["group"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const id = overrides.id ?? ulid();
    return insertRow(client, "group", {
      id,
      name: `Group ${id}`,
      origin: CURATED_ORIGIN,
      ...overrides,
      workspaceId,
    });
  };

  const groupMember: TestData["groupMember"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const groupId = overrides.groupId ?? (await group({ workspaceId })).id;
    // The membership the composite key references: a person named without one would fail
    // the foreign key, which is the invariant, not a gap the factory should paper over.
    const userId = overrides.userId ?? (await member({ workspaceId })).userId;
    return insertRow(client, "groupMember", { ...overrides, workspaceId, groupId, userId });
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

  const auditEvent: TestData["auditEvent"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "auditEvent", {
      id: ulid(),
      act: "platform.probe.seeded",
      actor: "process:better-answers-test",
      subjectId: ulid(),
      detail: {},
      batchId: null,
      ...overrides,
      workspaceId,
    });
  };

  const accessRequest: TestData["accessRequest"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const requesterId = overrides.requesterId ?? (await user()).id;
    return insertRow(client, "accessRequest", {
      id: ulid(),
      reason: "I have joined the bids team and need the answer library.",
      // Written out rather than left to the column's default, so a factory-made request
      // reads as what it is: waiting, with none of the decision's three columns filled.
      status: ACCESS_REQUEST_OPEN_STATUS,
      decidedBy: null,
      decidedAt: null,
      invitationId: null,
      ...overrides,
      workspaceId,
      requesterId,
    });
  };

  const conceptIdentity: TestData["conceptIdentity"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const minted = ulid();
    return insertRow(client, "conceptIdentity", {
      iri: conceptIriOf(minted),
      mergeKey: `policy:${minted.toLowerCase()}`,
      ...overrides,
      workspaceId,
    });
  };

  const conceptIndex: TestData["conceptIndex"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const iri = overrides.iri ?? (await conceptIdentity({ workspaceId })).iri;
    // Stable and published, because a seeded concept is one a reader can see — and because
    // the row's own CHECK ties the two: a draft carries no published instant.
    const commit = overrides.commitSha ?? (await bundleCommit({ workspaceId })).sha;
    return insertRow(client, "conceptIndex", {
      path: `knowledge/${ulid().toLowerCase()}.md`,
      kind: "Policy",
      title: "Expenses",
      frontmatter: { title: "Expenses", type: "Policy" },
      body: "Expenses are claimed within thirty days.",
      contentHash: hexOfLength(64),
      status: CONCEPT_STABLE_STATUS,
      publishedAt: new Date(),
      sensitivity: "Internal",
      audience: AUDIENCE_EVERYONE,
      ...overrides,
      workspaceId,
      iri,
      commitSha: commit,
    });
  };

  const bundleCommit: TestData["bundleCommit"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "bundleCommit", {
      sha: hexOfLength(40),
      parentSha: null,
      auditEventId: ulid(),
      actor: "process:better-answers-test",
      ...overrides,
      workspaceId,
    });
  };

  const evidence: TestData["evidence"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "evidence", {
      sourceDocumentId: ulid(),
      locator: "p.4#para-2",
      resource: "Expenses policy (2026 edition)",
      contentVersion: null,
      ...overrides,
      workspaceId,
    });
  };

  const conceptVerification: TestData["conceptVerification"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const iri = overrides.iri ?? (await conceptIdentity({ workspaceId })).iri;
    return insertRow(client, "conceptVerification", {
      id: ulid(),
      actor: "process:better-answers-test",
      contentHash: hexOfLength(64),
      origin: VERIFICATION_PLATFORM_ORIGIN,
      ...overrides,
      workspaceId,
      iri,
    });
  };

  const graphGeneration: TestData["graphGeneration"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "graphGeneration", { liveGen: 1, ...overrides, workspaceId });
  };

  /** The workspace's live generation, read or created — what a seeded row stamps by default. */
  const liveGenFor = async (workspaceId: string): Promise<number> => {
    const found = await client.query<{ live_gen: number }>(
      "SELECT live_gen FROM graph_generation WHERE workspace_id = $1",
      [workspaceId],
    );
    const live = found.rows[0]?.live_gen;
    return live ?? (await graphGeneration({ workspaceId })).liveGen;
  };

  /** `gen` as a seeded row carries it: an explicit value or null stands, else the live one. */
  const genFor = async (
    overrides: { readonly gen?: number | null; readonly workspaceId?: string },
    workspaceId: string,
  ): Promise<number | null> =>
    Object.hasOwn(overrides, "gen") ? (overrides.gen ?? null) : liveGenFor(workspaceId);

  const graphNode: TestData["graphNode"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const gen = await genFor(overrides, workspaceId);
    return insertRow(client, "graphNode", {
      uid: conceptIriOf(ulid()),
      label: "Concept",
      kind: "Policy",
      publishedAt: new Date(),
      sensitivity: "Internal",
      audience: AUDIENCE_EVERYONE,
      ...overrides,
      gen,
      workspaceId,
    });
  };

  const graphEdge: TestData["graphEdge"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const gen = await genFor(overrides, workspaceId);
    const fromUid = overrides.fromUid ?? (await graphNode({ workspaceId, gen })).uid;
    const toUid = overrides.toUid ?? (await graphNode({ workspaceId, gen })).uid;
    const label = overrides.label ?? "LINKS_TO";
    // The link columns are LINKS_TO's alone (graph_edge_links_to_check); a named edge
    // seeded with defaults would otherwise be refused by the row it was meant to arrange.
    const link =
      label === "LINKS_TO"
        ? {
            fromKind: "Policy",
            toKind: "Policy",
            section: "Details",
            sentence: "One policy rests on another.",
          }
        : { fromKind: null, toKind: null, section: null, sentence: null };
    return insertRow(client, "graphEdge", {
      uid: `links_to:${ulid()}`,
      publishedAt: new Date(),
      sensitivity: "Internal",
      audience: AUDIENCE_EVERYONE,
      ...link,
      ...overrides,
      label,
      fromUid,
      toUid,
      gen,
      workspaceId,
    });
  };

  const suggestion: TestData["suggestion"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "suggestion", {
      id: ulid(),
      setId: ulid(),
      kind: SUGGESTION_EDIT_KIND,
      // Written out rather than left to the column's default, so a factory-made suggestion
      // reads as what it is: waiting, with none of the decision's four columns filled.
      status: SUGGESTION_WAITING_STATUS,
      proposer: "process:better-answers-test",
      targetIri: null,
      decider: null,
      reason: null,
      decidedAt: null,
      ...overrides,
      workspaceId,
    });
  };

  const conceptWriteRequest: TestData["conceptWriteRequest"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const suggestionId = overrides.suggestionId ?? (await suggestion({ workspaceId })).id;
    return insertRow(client, "conceptWriteRequest", {
      mergeKey: `policy:${ulid().toLowerCase()}`,
      path: `knowledge/${ulid().toLowerCase()}.md`,
      conceptKind: "Policy",
      title: "Expenses",
      frontmatter: { title: "Expenses", type: "Policy" },
      body: "Expenses are claimed within thirty days.",
      baseContentHash: null,
      ...overrides,
      workspaceId,
      suggestionId,
    });
  };

  return {
    workspace,
    user,
    member,
    invitation,
    group,
    groupMember,
    workspaceConfig,
    llmRoute,
    chunk,
    oauthClient,
    oauthRefreshToken,
    oauthAccessToken,
    auditEvent,
    accessRequest,
    conceptIdentity,
    conceptIndex,
    bundleCommit,
    evidence,
    conceptVerification,
    graphGeneration,
    graphNode,
    graphEdge,
    suggestion,
    conceptWriteRequest,
  };
};
