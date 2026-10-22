import { createHash } from "node:crypto";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type pg from "pg";
import type { z } from "zod";

import {
  ACCESS_REQUEST_OPEN_STATUS,
  AUDIENCE_EVERYONE,
  CONNECTED_SOURCE_RECEIVED_STATE,
  boundarySchemas,
  CONCEPT_STABLE_STATUS,
  conceptIriOf,
  CONNECTOR_UPLOAD,
  CREATOR_ROLE,
  CURATED_ORIGIN,
  DOCUMENT_CONVERTED_OUTCOME,
  EMBEDDING_DIMENSIONS,
  FINDING_UNREVIEWED_STATE,
  JOB_MAX_ATTEMPTS,
  JOB_QUEUED_STATUS,
  NIGHTLY_AUDIT_KIND,
  REDACTION_ALWAYS_TIER,
  RETENTION_CLASS_DEFAULT,
  RULES_IN_FORCE_DEFAULT,
  SUGGESTION_EDIT_KIND,
  SUGGESTION_WAITING_STATUS,
  ulid,
  UPLOAD_DESTINATIONS,
  VERIFICATION_PLATFORM_ORIGIN,
} from "../src/index.ts";

type Registry = typeof boundarySchemas;
type InsertInput<TName extends keyof Registry> = z.input<Registry[TName]["insert"]>;
type Row<TName extends keyof Registry> = z.infer<Registry[TName]["select"]>;

export type TestData = {
  workspace(overrides?: Partial<InsertInput<"workspace">>): Promise<Row<"workspace">>;

  user(overrides?: Partial<InsertInput<"user">>): Promise<Row<"user">>;

  /** As the library writes one. */
  session(overrides?: Partial<InsertInput<"session">>): Promise<Row<"session">>;

  account(overrides?: Partial<InsertInput<"account">>): Promise<Row<"account">>;

  member(overrides?: Partial<InsertInput<"member">>): Promise<Row<"member">>;

  invitation(overrides?: Partial<InsertInput<"invitation">>): Promise<Row<"invitation">>;

  group(overrides?: Partial<InsertInput<"group">>): Promise<Row<"group">>;

  groupMember(overrides?: Partial<InsertInput<"groupMember">>): Promise<Row<"groupMember">>;

  workspaceConfig(
    overrides?: Partial<InsertInput<"workspaceConfig">>,
  ): Promise<Row<"workspaceConfig">>;

  modelChoice(overrides?: Partial<InsertInput<"modelChoice">>): Promise<Row<"modelChoice">>;

  /** Its frame is bytes of a frame's length that seal nothing. */
  modelKey(overrides?: Partial<InsertInput<"modelKey">>): Promise<Row<"modelKey">>;

  passage(overrides?: Partial<InsertInput<"passage">>): Promise<Row<"passage">>;

  oauthClient(overrides?: Partial<InsertInput<"oauthClient">>): Promise<Row<"oauthClient">>;

  oauthRefreshToken(
    overrides?: Partial<InsertInput<"oauthRefreshToken">>,
  ): Promise<Row<"oauthRefreshToken">>;

  oauthAccessToken(
    overrides?: Partial<InsertInput<"oauthAccessToken">>,
  ): Promise<Row<"oauthAccessToken">>;

  verification(overrides?: Partial<InsertInput<"verification">>): Promise<Row<"verification">>;

  confirmedAuthenticatorOfASealedSecret(
    overrides: Partial<InsertInput<"authenticator">> & { readonly secret: string },
  ): Promise<Row<"authenticator">>;

  auditEvent(overrides?: Partial<InsertInput<"auditEvent">>): Promise<Row<"auditEvent">>;

  identityAuditEvent(
    overrides?: Partial<InsertInput<"identityAuditEvent">>,
  ): Promise<Row<"identityAuditEvent">>;

  accessRequest(overrides?: Partial<InsertInput<"accessRequest">>): Promise<Row<"accessRequest">>;

  workspaceLastActive(
    overrides?: Partial<InsertInput<"workspaceLastActive">>,
  ): Promise<Row<"workspaceLastActive">>;

  testWorkspaceMark(
    overrides?: Partial<InsertInput<"testWorkspaceMark">>,
  ): Promise<Row<"testWorkspaceMark">>;

  conceptIdentity(
    overrides?: Partial<InsertInput<"conceptIdentity">>,
  ): Promise<Row<"conceptIdentity">>;

  conceptIndex(overrides?: Partial<InsertInput<"conceptIndex">>): Promise<Row<"conceptIndex">>;

  bundleCommit(overrides?: Partial<InsertInput<"bundleCommit">>): Promise<Row<"bundleCommit">>;

  evidence(overrides?: Partial<InsertInput<"evidence">>): Promise<Row<"evidence">>;

  conceptVerification(
    overrides?: Partial<InsertInput<"conceptVerification">>,
  ): Promise<Row<"conceptVerification">>;

  mapGeneration(overrides?: Partial<InsertInput<"mapGeneration">>): Promise<Row<"mapGeneration">>;

  mapNode(overrides?: Partial<InsertInput<"mapNode">>): Promise<Row<"mapNode">>;

  mapEdge(overrides?: Partial<InsertInput<"mapEdge">>): Promise<Row<"mapEdge">>;

  mapUnresolvedReference(
    overrides?: Partial<InsertInput<"mapUnresolvedReference">>,
  ): Promise<Row<"mapUnresolvedReference">>;

  suggestion(overrides?: Partial<InsertInput<"suggestion">>): Promise<Row<"suggestion">>;

  conceptWriteRequest(
    overrides?: Partial<InsertInput<"conceptWriteRequest">>,
  ): Promise<Row<"conceptWriteRequest">>;

  connectedSource(
    overrides?: Partial<InsertInput<"connectedSource">>,
  ): Promise<Row<"connectedSource">>;

  sourceDocument(
    overrides?: Partial<InsertInput<"sourceDocument">>,
  ): Promise<Row<"sourceDocument">>;

  finding(overrides?: Partial<InsertInput<"finding">>): Promise<Row<"finding">>;

  subjectRequest(
    overrides?: Partial<InsertInput<"subjectRequest">>,
  ): Promise<Row<"subjectRequest">>;

  erasureRequest(
    overrides?: Partial<InsertInput<"erasureRequest">>,
  ): Promise<Row<"erasureRequest">>;

  suppression(overrides?: Partial<InsertInput<"suppression">>): Promise<Row<"suppression">>;

  conceptEvidence(
    overrides?: Partial<InsertInput<"conceptEvidence">>,
  ): Promise<Row<"conceptEvidence">>;

  conceptSensitivityOverride(
    overrides?: Partial<InsertInput<"conceptSensitivityOverride">>,
  ): Promise<Row<"conceptSensitivityOverride">>;

  conceptOwner(overrides?: Partial<InsertInput<"conceptOwner">>): Promise<Row<"conceptOwner">>;

  job(overrides?: Partial<InsertInput<"job">>): Promise<Row<"job">>;

  guideDefinition(
    overrides?: Partial<InsertInput<"guideDefinition">>,
  ): Promise<Row<"guideDefinition">>;

  guideRole(overrides?: Partial<InsertInput<"guideRole">>): Promise<Row<"guideRole">>;

  guideSection(overrides?: Partial<InsertInput<"guideSection">>): Promise<Row<"guideSection">>;

  /** Seeds a section of a guide it seeds when given no `sectionId` with its `guideId`. */
  guideExpectedFact(
    overrides?: Partial<InsertInput<"guideExpectedFact">>,
  ): Promise<Row<"guideExpectedFact">>;

  guideDefinitionVersion(
    overrides?: Partial<InsertInput<"guideDefinitionVersion">>,
  ): Promise<Row<"guideDefinitionVersion">>;

  /** Homed in a section it seeds, unless given one; a response home names a question instead. */
  writeUp(overrides?: Partial<InsertInput<"writeUp">>): Promise<Row<"writeUp">>;

  writeUpInclude(
    overrides?: Partial<InsertInput<"writeUpInclude">>,
  ): Promise<Row<"writeUpInclude">>;

  writeUpVersion(
    overrides?: Partial<InsertInput<"writeUpVersion">>,
  ): Promise<Row<"writeUpVersion">>;

  /** Of a write-up version it seeds, unless given an `iri` or a version with its write-up. */
  usage(overrides?: Partial<InsertInput<"usage">>): Promise<Row<"usage">>;

  questionAsked(overrides?: Partial<InsertInput<"questionAsked">>): Promise<Row<"questionAsked">>;

  /**
   * Seeds its record too when given none, asked now. A `recordId` comes with that record's
   * `askedAt`.
   */
  questionContent(
    overrides?: Partial<Omit<InsertInput<"questionContent">, "recordId" | "askedAt">> &
      (
        | { readonly recordId: string; readonly askedAt: Date }
        | { readonly recordId?: undefined; readonly askedAt?: undefined }
      ),
  ): Promise<Row<"questionContent">>;

  questionFeedback(
    overrides?: Partial<InsertInput<"questionFeedback">>,
  ): Promise<Row<"questionFeedback">>;

  /** Serves a question it seeds, asked now, when given no run and no answer. */
  llmCall(overrides?: Partial<InsertInput<"llmCall">>): Promise<Row<"llmCall">>;

  /** Taken now for ten minutes, serving a question it seeds when given no run and no answer. */
  spendReservation(
    overrides?: Partial<InsertInput<"spendReservation">>,
  ): Promise<Row<"spendReservation">>;

  modelPrice(overrides?: Partial<InsertInput<"modelPrice">>): Promise<Row<"modelPrice">>;

  decisionThreshold(
    overrides?: Partial<InsertInput<"decisionThreshold">>,
  ): Promise<Row<"decisionThreshold">>;
};

const numberOf = (id: string): string =>
  id
    .split("")
    .reduce((value, digit) => value * 36n + BigInt(Number.parseInt(digit, 36)), 0n)
    .toString();

const hexOfLength = (length: number): string =>
  createHash("sha256").update(ulid()).digest("hex").repeat(2).slice(0, length);

const insertRow = async <TName extends keyof Registry>(
  client: pg.PoolClient,
  name: TName,
  values: InsertInput<TName>,
): Promise<Row<TName>> => {
  const { table, insert, select } = boundarySchemas[name];
  const parsed: Readonly<Record<string, unknown>> = insert.parse(values);
  const columns: Readonly<Record<string, { name: string; getSQLType: () => string }>> =
    getTableColumns(table);
  const config = getTableConfig(table);
  const qualified = `${config.schema === undefined ? "" : `"${config.schema}".`}"${config.name}"`;

  const keys = Object.keys(parsed);
  const names = keys.map((key) => `"${columns[key]?.name ?? key}"`).join(", ");
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(", ");
  const returned = await client.query(
    `INSERT INTO ${qualified} (${names}) VALUES (${placeholders}) RETURNING *`,
    keys.map((key) => {
      const value = parsed[key];

      // The driver writes an array as a Postgres array, which neither a vector nor jsonb reads.
      const type = columns[key]?.getSQLType() ?? "";
      const asJson = type.startsWith("vector") || type === "jsonb";
      return Array.isArray(value) && asJson ? JSON.stringify(value) : value;
    }),
  );

  const row: Readonly<Record<string, unknown>> = returned.rows[0] ?? {};
  const fields: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns)) {
    const value = row[column.name];

    fields[key] = typeof value === "string" && value.startsWith("[") ? JSON.parse(value) : value;
  }

  // oxlint-disable-next-line typescript/consistent-type-assertions -- TypeScript cannot correlate `select` with `TName` through a generic indexed access
  return select.parse(fields) as Row<TName>;
};

const partitionExists = async (client: pg.PoolClient, workspaceId: string): Promise<boolean> => {
  const found = await client.query(
    "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'index' AND c.relname = $1",
    [`passage_${workspaceId}`],
  );
  return found.rowCount === 1;
};

const SEEDED_SPAN_LENGTH = 8;

const findingsInTurn = new WeakMap<pg.PoolClient, Promise<unknown>>();

const DAY_MS = 24 * 60 * 60 * 1000;

const monthsOn = (from: Date, months: number): Date => {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();
  const timeOfDayMs = from.getTime() - Date.UTC(year, month, day);
  const daysInTarget = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month + months, 1) + (Math.min(day, daysInTarget) - 1) * DAY_MS + timeOfDayMs,
  );
};

/**
 * Each method writes one row, filling what `overrides` leave out and seeding the parent rows its
 * keys need; `passage` also makes the workspace's partition.
 */
export const testData = (client: pg.PoolClient): TestData => {
  const workspace: TestData["workspace"] = (overrides = {}) => {
    const id = overrides.id ?? ulid();
    return insertRow(client, "workspace", {
      id,
      name: "Test workspace",
      shortName: `ws-${id.toLowerCase()}`,
      ...overrides,
    });
  };

  const user: TestData["user"] = (overrides = {}) => {
    const id = overrides.id ?? ulid();
    return insertRow(client, "user", {
      id,
      name: "Test person",
      email: `${numberOf(id)}@example.invalid`,
      ...overrides,
    });
  };

  const session: TestData["session"] = async (overrides = {}) => {
    const userId = overrides.userId ?? (await user()).id;
    const id = overrides.id ?? ulid();
    const at = overrides.createdAt ?? new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return insertRow(client, "session", {
      token: `token-${id}`,
      createdAt: at,
      updatedAt: at,
      expiresAt: new Date(at.getTime() + thirtyDays),
      ...overrides,
      userId,
      id,
    });
  };

  const account: TestData["account"] = async (overrides = {}) => {
    const userId = overrides.userId ?? (await user()).id;
    const id = overrides.id ?? ulid();
    return insertRow(client, "account", {
      id,
      accountId: userId,
      providerId: "credential",
      ...overrides,
      userId,
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
      name: `Group ${numberOf(id)}`,
      origin: CURATED_ORIGIN,
      ...overrides,
      workspaceId,
    });
  };

  const groupMember: TestData["groupMember"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const groupId = overrides.groupId ?? (await group({ workspaceId })).id;

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

  const modelChoice: TestData["modelChoice"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const purpose = overrides.purpose ?? "embedding";
    return insertRow(client, "modelChoice", {
      id: `model-choice-${ulid()}`,
      provider: "mistral",
      model: "mistral-embed",

      dimensions: purpose === "embedding" ? EMBEDDING_DIMENSIONS : null,

      retentionTail: null,
      ...overrides,
      purpose,
      workspaceId,
    });
  };

  const modelKey: TestData["modelKey"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "modelKey", {
      provider: "anthropic",
      sealed: new Uint8Array(40).fill(7),
      ...overrides,
      workspaceId,
    });
  };

  const passage: TestData["passage"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    if (!(await partitionExists(client, workspaceId))) {
      const previous = await client.query("SELECT current_workspace_id() AS ws");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      await client.query("SELECT create_workspace_partition($1)", [workspaceId]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [
        previous.rows[0]?.ws ?? "",
      ]);
    }
    return insertRow(client, "passage", {
      id: `passage-${ulid()}`,
      content: "test content",
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
      embeddingModelChoiceId: `model-choice-${ulid()}`,
      connectedSourceId: `connected-source-${ulid()}`,

      sourceDocumentId: null,
      locator: null,
      ordinal: null,
      charStart: null,
      charEnd: null,
      ...overrides,
      workspaceId,
    });
  };

  const oauthClient: TestData["oauthClient"] = (overrides = {}) => {
    const id = overrides.id ?? `client-${ulid()}`;
    return insertRow(client, "oauthClient", {
      id,

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

  const verification: TestData["verification"] = (overrides = {}) =>
    insertRow(client, "verification", {
      id: ulid(),
      identifier: `sign-in-otp-${ulid().toLowerCase()}@example.invalid`,
      value: "hashed-code:0",
      expiresAt: new Date(Date.now() + 300_000),
      ...overrides,
    });

  const confirmedAuthenticatorOfASealedSecret: TestData["confirmedAuthenticatorOfASealedSecret"] =
    async (overrides) => {
      const userId = overrides.userId ?? (await user()).id;
      const row = await insertRow(client, "authenticator", {
        id: ulid(),
        backupCodes: "sealed-codes-nothing-reads",
        verified: true,
        ...overrides,
        userId,
      });
      await client.query('UPDATE "user" SET authenticator_enabled = true WHERE id = $1', [userId]);
      return row;
    };

  const auditEvent: TestData["auditEvent"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "auditEvent", {
      id: ulid(),
      action: "platform.probe.seeded",
      actor: "process:better-answers-test",
      subjectId: ulid(),
      detail: {},
      batchId: null,
      ...overrides,
      workspaceId,
    });
  };

  const identityAuditEvent: TestData["identityAuditEvent"] = (overrides = {}) =>
    insertRow(client, "identityAuditEvent", {
      id: ulid(),
      action: "platform.probe.seeded",
      actor: "process:better-answers-test",
      subjectId: ulid(),
      detail: {},
      batchId: null,
      ...overrides,
    });

  const accessRequest: TestData["accessRequest"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const requesterId = overrides.requesterId ?? (await user()).id;
    return insertRow(client, "accessRequest", {
      id: ulid(),
      reason: "I have joined the bids team and need the answer library.",

      status: ACCESS_REQUEST_OPEN_STATUS,
      decidedBy: null,
      decidedAt: null,
      invitationId: null,
      ...overrides,
      workspaceId,
      requesterId,
    });
  };

  const workspaceLastActive: TestData["workspaceLastActive"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const userId = overrides.userId ?? (await member({ workspaceId })).userId;
    return insertRow(client, "workspaceLastActive", {
      at: new Date(),
      ...overrides,
      workspaceId,
      userId,
    });
  };

  const testWorkspaceMark: TestData["testWorkspaceMark"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "testWorkspaceMark", {
      testingDomain: `${ulid().toLowerCase()}.testing.invalid`,
      ...overrides,
      workspaceId,
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
      audienceGroups: null,
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

    const sourceDocumentId =
      overrides.sourceDocumentId ?? (await sourceDocument({ workspaceId })).id;
    return insertRow(client, "evidence", {
      locator: "p.4#para-2",
      resource: "Expenses policy (2026 edition)",
      contentVersion: null,
      ...overrides,
      workspaceId,
      sourceDocumentId,
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

  const mapGeneration: TestData["mapGeneration"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "mapGeneration", { liveGen: 1, ...overrides, workspaceId });
  };

  const liveGenFor = async (workspaceId: string): Promise<number> => {
    const found = await client.query<{ live_gen: number }>(
      "SELECT live_gen FROM map_generation WHERE workspace_id = $1",
      [workspaceId],
    );
    const live = found.rows[0]?.live_gen;
    return live ?? (await mapGeneration({ workspaceId })).liveGen;
  };

  const genFor = async (
    overrides: { readonly gen?: number | null; readonly workspaceId?: string },
    workspaceId: string,
  ): Promise<number | null> =>
    Object.hasOwn(overrides, "gen") ? (overrides.gen ?? null) : liveGenFor(workspaceId);

  const mapNode: TestData["mapNode"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const gen = await genFor(overrides, workspaceId);
    return insertRow(client, "mapNode", {
      uid: conceptIriOf(ulid()),
      label: "Concept",
      kind: "Policy",
      publishedAt: new Date(),
      sensitivity: "Internal",
      audience: AUDIENCE_EVERYONE,
      audienceGroups: null,
      ...overrides,
      gen,
      workspaceId,
    });
  };

  const mapEdge: TestData["mapEdge"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const gen = await genFor(overrides, workspaceId);
    const fromUid = overrides.fromUid ?? (await mapNode({ workspaceId, gen })).uid;
    const toUid = overrides.toUid ?? (await mapNode({ workspaceId, gen })).uid;
    const label = overrides.label ?? "LINKS_TO";

    const link =
      label === "LINKS_TO"
        ? {
            fromKind: "Policy",
            toKind: "Policy",
            section: "Details",
            sentence: "One policy rests on another.",
          }
        : { fromKind: null, toKind: null, section: null, sentence: null };
    return insertRow(client, "mapEdge", {
      uid: `links_to:${ulid()}`,
      publishedAt: new Date(),
      sensitivity: "Internal",
      audience: AUDIENCE_EVERYONE,
      audienceGroups: null,
      ...link,
      ...overrides,
      label,
      fromUid,
      toUid,
      gen,
      workspaceId,
    });
  };

  const mapUnresolvedReference: TestData["mapUnresolvedReference"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "mapUnresolvedReference", {
      gen: await liveGenFor(workspaceId),
      fromUid: conceptIriOf(ulid()),
      relation: "link",
      ordinal: 0,
      targetPath: `knowledge/${ulid().toLowerCase()}.md`,
      ...overrides,
      workspaceId,
    });
  };

  const job: TestData["job"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;

    return insertRow(client, "job", {
      id: ulid(),
      kind: NIGHTLY_AUDIT_KIND,

      subjectId: null,
      reason: null,
      status: JOB_QUEUED_STATUS,
      attempts: 0,
      maxAttempts: JOB_MAX_ATTEMPTS,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      finishedAt: null,
      outcome: null,
      ...overrides,
      workspaceId,
    });
  };

  const suggestion: TestData["suggestion"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "suggestion", {
      id: ulid(),
      setId: ulid(),
      kind: SUGGESTION_EDIT_KIND,

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

  const connectedSource: TestData["connectedSource"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "connectedSource", {
      id: ulid(),
      publishedAt: new Date(),
      sensitivity: "Internal",
      audience: AUDIENCE_EVERYONE,
      audienceGroups: null,

      name: "The handbook",
      connector: CONNECTOR_UPLOAD,
      destination: [...UPLOAD_DESTINATIONS],
      retentionClass: RETENTION_CLASS_DEFAULT,
      state: CONNECTED_SOURCE_RECEIVED_STATE,

      rulesInForce: RULES_IN_FORCE_DEFAULT,
      ...overrides,
      workspaceId,
    });
  };

  const sourceDocument: TestData["sourceDocument"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const connectedSourceId =
      overrides.connectedSourceId ?? (await connectedSource({ workspaceId })).id;
    return insertRow(client, "sourceDocument", {
      id: ulid(),

      sourceSystemId: `handbook-${ulid().toLowerCase()}.md`,
      title: "The handbook",
      mediaType: "text/markdown",
      byteSize: 1_024,
      originalKey: `documents/${ulid().toLowerCase()}/original`,
      normalisedKey: `documents/${ulid().toLowerCase()}/normalised`,
      contentHash: "c".repeat(64),

      redactionVersion: "1:presidio-test",
      lastModified: null,
      goneAt: null,
      outcome: DOCUMENT_CONVERTED_OUTCOME,

      unreadableReason: null,

      sensitivity: null,
      narrowedTo: null,
      ...overrides,
      workspaceId,
      connectedSourceId,
    });
  };

  const findingPastTheLast: TestData["finding"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const documentId = overrides.documentId ?? (await sourceDocument({ workspaceId })).id;

    const furthest = await client.query<{ char_end: number | null }>(
      "SELECT max(char_end) AS char_end FROM finding WHERE workspace_id = $1 AND document_id = $2",
      [workspaceId, documentId],
    );
    const charStart = furthest.rows[0]?.char_end ?? 0;
    return insertRow(client, "finding", {
      id: ulid(),
      category: "bank-details",
      tier: REDACTION_ALWAYS_TIER,
      ruleId: "sort-code-with-account-number",
      charStart,
      charEnd: charStart + SEEDED_SPAN_LENGTH,
      score: 0.85,
      ruleVersion: "1",
      detectorPin: "presidio-test",

      reviewState: FINDING_UNREVIEWED_STATE,
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: null,
      restoredAt: null,
      restoredBy: null,
      restoreReason: null,
      ...overrides,
      workspaceId,
      documentId,
    });
  };

  const finding: TestData["finding"] = (overrides) => {
    const seeded = (findingsInTurn.get(client) ?? Promise.resolve()).then(() =>
      findingPastTheLast(overrides),
    );
    findingsInTurn.set(
      client,
      seeded.catch(() => undefined),
    );
    return seeded;
  };

  const subjectRequest: TestData["subjectRequest"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;

    const personId = overrides.personId === undefined ? (await user()).id : overrides.personId;
    const receivedAt = overrides.receivedAt ?? new Date();
    const clockStartedAt = overrides.clockStartedAt ?? receivedAt;

    return insertRow(client, "subjectRequest", {
      id: ulid(),
      kind: "access",

      identifiers: { emails: ["subject@example.invalid"], names: [], other: [] },
      dueAt: monthsOn(clockStartedAt, 1),

      extendedTo: null,
      answeredAt: null,
      answer: null,
      ...overrides,
      workspaceId,
      personId,
      receivedAt,
      clockStartedAt,
    });
  };

  const erasureRequest: TestData["erasureRequest"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const subjectRequestId =
      overrides.subjectRequestId ?? (await subjectRequest({ workspaceId, kind: "erasure" })).id;
    const anchoredAt = overrides.anchoredAt ?? new Date();

    const outFrom = (milliseconds: number) => new Date(anchoredAt.getTime() + milliseconds);
    const hour = 60 * 60 * 1000;
    return insertRow(client, "erasureRequest", {
      id: ulid(),
      pseudonym: ulid(),
      lockedAt: anchoredAt,
      beyondUseHourlyAt: outFrom(48 * hour),
      beyondUseDailyAt: outFrom(30 * 24 * hour),
      beyondUseWeeklyAt: outFrom(8 * 7 * 24 * hour),
      beyondUseMonthlyAt: monthsOn(anchoredAt, 6),

      actions: {},
      completedAt: null,
      report: null,
      ...overrides,
      workspaceId,
      subjectRequestId,
      anchoredAt,
    });
  };

  const suppression: TestData["suppression"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const erasureRequestId =
      overrides.erasureRequestId ?? (await erasureRequest({ workspaceId })).id;
    return insertRow(client, "suppression", {
      identifiers: { emails: ["subject@example.invalid"], names: [], other: [] },
      ...overrides,
      workspaceId,
      erasureRequestId,
    });
  };

  const conceptEvidence: TestData["conceptEvidence"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const iri = overrides.iri ?? (await conceptIdentity({ workspaceId })).iri;
    const cited =
      overrides.sourceDocumentId !== undefined && overrides.locator !== undefined
        ? { sourceDocumentId: overrides.sourceDocumentId, locator: overrides.locator }
        : await evidence({ workspaceId, sourceDocumentId: overrides.sourceDocumentId ?? ulid() });
    return insertRow(client, "conceptEvidence", {
      ...overrides,
      workspaceId,
      iri,
      sourceDocumentId: cited.sourceDocumentId,
      locator: cited.locator,
    });
  };

  const conceptSensitivityOverride: TestData["conceptSensitivityOverride"] = async (
    overrides = {},
  ) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const iri = overrides.iri ?? (await conceptIdentity({ workspaceId })).iri;
    return insertRow(client, "conceptSensitivityOverride", {
      sensitivity: "Internal",
      audience: AUDIENCE_EVERYONE,
      audienceGroups: null,
      actor: "process:better-answers-test",
      auditEventId: ulid(),
      ...overrides,
      workspaceId,
      iri,
    });
  };

  const conceptOwner: TestData["conceptOwner"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const personId =
      overrides.personId ?? (await member({ workspaceId, userId: (await user()).id })).userId;
    const iri = overrides.iri ?? null;
    return insertRow(client, "conceptOwner", {
      id: ulid(),
      collection: iri === null ? "policy" : null,
      ...overrides,
      workspaceId,
      iri,
      personId,
    });
  };

  const guideDefinition: TestData["guideDefinition"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "guideDefinition", {
      id: ulid(),
      kind: "bid",
      collection: "bids",
      template: "bid-response",
      subjectIri: null,
      ...overrides,
      workspaceId,
    });
  };

  const guideRole: TestData["guideRole"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const guideId = overrides.guideId ?? (await guideDefinition({ workspaceId })).id;
    return insertRow(client, "guideRole", {
      role: "Editor",
      defaultLayer: "assembled",
      actionThreshold: "human-reviewed",
      ...overrides,
      workspaceId,
      guideId,
    });
  };

  const guideSection: TestData["guideSection"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const guideId = overrides.guideId ?? (await guideDefinition({ workspaceId })).id;
    return insertRow(client, "guideSection", {
      id: `s${ulid().toLowerCase()}`,
      parentId: null,
      ordinal: 0,
      prompt: "Describe how you insure the work.",
      roleLabel: "say",
      usageNote: null,
      layers: ["assembled"],
      hidden: false,
      ...overrides,
      workspaceId,
      guideId,
    });
  };

  const sectionOf = async (
    workspaceId: string,
    overrides: { readonly guideId?: string | null; readonly sectionId?: string | null },
  ): Promise<{ readonly guideId: string; readonly sectionId: string }> => {
    if (typeof overrides.guideId === "string" && typeof overrides.sectionId === "string") {
      return { guideId: overrides.guideId, sectionId: overrides.sectionId };
    }
    const section = await guideSection(
      typeof overrides.guideId === "string"
        ? { workspaceId, guideId: overrides.guideId }
        : { workspaceId },
    );
    return { guideId: section.guideId, sectionId: section.id };
  };

  const guideExpectedFact: TestData["guideExpectedFact"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "guideExpectedFact", {
      id: ulid(),
      ordinal: 0,
      name: "Insurance cover",
      kind: "Policy",
      tags: [],
      collection: null,
      atLeast: 1,
      ...overrides,
      workspaceId,
      ...(await sectionOf(workspaceId, overrides)),
    });
  };

  const guideDefinitionVersion: TestData["guideDefinitionVersion"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const guideId = overrides.guideId ?? (await guideDefinition({ workspaceId })).id;
    return insertRow(client, "guideDefinitionVersion", {
      version: 1,
      actor: `human:${ulid()}`,
      note: null,
      content: { sections: [] },
      ...overrides,
      workspaceId,
      guideId,
    });
  };

  const homeOf = async (workspaceId: string, overrides: Partial<InsertInput<"writeUp">>) =>
    overrides.home === "response"
      ? {
          home: overrides.home,
          guideId: overrides.guideId ?? null,
          sectionId: overrides.sectionId ?? null,
          questionId: overrides.questionId ?? ulid(),
        }
      : {
          home: overrides.home ?? "section",
          ...(await sectionOf(workspaceId, overrides)),
          questionId: overrides.questionId ?? null,
        };

  const writeUp: TestData["writeUp"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const placed = await homeOf(workspaceId, overrides);
    return insertRow(client, "writeUp", {
      id: ulid(),
      publishedAt: new Date(),
      sensitivity: "Internal",
      audience: AUDIENCE_EVERYONE,
      audienceGroups: null,
      needsReview: null,
      ...overrides,
      workspaceId,
      ...placed,
    });
  };

  const writeUpInclude: TestData["writeUpInclude"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const writeUpId = overrides.writeUpId ?? (await writeUp({ workspaceId })).id;
    const iri = overrides.iri ?? (await conceptIdentity({ workspaceId })).iri;
    return insertRow(client, "writeUpInclude", {
      id: `i${ulid().toLowerCase()}`,
      ordinal: 0,
      contentHash: hexOfLength(64),
      expectedFactId: null,
      wordingHeading: null,
      wordingHash: null,
      ...overrides,
      workspaceId,
      writeUpId,
      iri,
    });
  };

  const writeUpVersion: TestData["writeUpVersion"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const writeUpId = overrides.writeUpId ?? (await writeUp({ workspaceId })).id;
    return insertRow(client, "writeUpVersion", {
      version: 1,
      actor: `human:${ulid()}`,
      note: null,
      markdown: "We hold public liability cover of five million pounds.",
      includes: [],
      ...overrides,
      workspaceId,
      writeUpId,
    });
  };

  const usageTargetOf = async (
    workspaceId: string,
    overrides: Partial<InsertInput<"usage">>,
  ): Promise<Pick<InsertInput<"usage">, "writeUpId" | "writeUpVersion" | "iri">> => {
    if (typeof overrides.iri === "string") {
      return { writeUpId: null, writeUpVersion: null, iri: overrides.iri };
    }
    if (typeof overrides.writeUpId === "string" && typeof overrides.writeUpVersion === "number") {
      return {
        writeUpId: overrides.writeUpId,
        writeUpVersion: overrides.writeUpVersion,
        iri: null,
      };
    }
    const saved = await writeUpVersion(
      typeof overrides.writeUpId === "string"
        ? { workspaceId, writeUpId: overrides.writeUpId }
        : { workspaceId },
    );
    return { writeUpId: saved.writeUpId, writeUpVersion: saved.version, iri: null };
  };

  const usage: TestData["usage"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "usage", {
      id: ulid(),
      actor: `human:${ulid()}`,
      act: "copied",
      ...overrides,
      workspaceId,
      ...(await usageTargetOf(workspaceId, overrides)),
    });
  };

  const questionAsked: TestData["questionAsked"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "questionAsked", {
      id: ulid(),
      askedAt: new Date(),
      askedBy: `human:${ulid()}`,
      transport: "mcp",
      collections: [],
      predicateRole: "Viewer",
      predicateGroups: [],

      completedAt: null,
      verdict: null,
      judgeState: null,
      concepts: [],
      unmappedPassages: [],
      mapState: null,
      ...overrides,
      workspaceId,
    });
  };

  const questionContent: TestData["questionContent"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const record =
      overrides.recordId === undefined
        ? await questionAsked({ workspaceId })
        : { id: overrides.recordId, askedAt: overrides.askedAt };
    return insertRow(client, "questionContent", {
      question: "How long are audit logs kept?",
      drafted: null,
      ...overrides,
      workspaceId,
      recordId: record.id,
      askedAt: record.askedAt,
    });
  };

  const questionFeedback: TestData["questionFeedback"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const recordId = overrides.recordId ?? (await questionAsked({ workspaceId })).id;
    return insertRow(client, "questionFeedback", {
      id: ulid(),
      givenAt: new Date(),
      givenBy: `human:${ulid()}`,
      verdict: "helpful",
      reason: null,
      note: null,
      disputedSentence: null,
      disputedConcept: null,
      closedAs: null,
      closedAt: null,
      ...overrides,
      workspaceId,
      recordId,
    });
  };

  const served = async (
    workspaceId: string,
    overrides: { readonly runId?: string | null; readonly answerId?: string | null },
  ) =>
    overrides.answerId === undefined && overrides.runId === undefined
      ? { runId: null, answerId: (await questionAsked({ workspaceId })).id }
      : { runId: overrides.runId ?? null, answerId: overrides.answerId ?? null };

  const llmCall: TestData["llmCall"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    return insertRow(client, "llmCall", {
      id: ulid(),
      calledAt: new Date(),
      purpose: "judging",
      modelChoiceId: "model-choice-judge",
      model: "claude-sonnet-5-5",
      tokensIn: 1580,
      tokensOut: 96,
      seconds: 1.118,
      costGbp: "0.00618",
      outcome: "succeeded",
      ...overrides,
      ...(await served(workspaceId, overrides)),
      workspaceId,
    });
  };

  const spendReservation: TestData["spendReservation"] = async (overrides = {}) => {
    const workspaceId = overrides.workspaceId ?? (await workspace()).id;
    const takenAt = overrides.takenAt ?? new Date();
    return insertRow(client, "spendReservation", {
      id: ulid(),
      expiresAt: new Date(takenAt.getTime() + 10 * 60_000),
      purpose: "judging",
      modelChoiceId: "model-choice-judge",
      model: "claude-sonnet-5-5",
      mostTokensIn: 40_000,
      mostTokensOut: 2_000,
      gbpPerMillionIn: "3",
      gbpPerMillionOut: "15",
      reservedGbp: "0.15",
      ...overrides,
      ...(await served(workspaceId, overrides)),
      takenAt,
      workspaceId,
    });
  };

  const modelPrice: TestData["modelPrice"] = async (overrides = {}) =>
    insertRow(client, "modelPrice", {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effectiveFrom: "2026-10-01",
      gbpPerMillionIn: "3",
      gbpPerMillionOut: "15",
      ...overrides,
    });

  const decisionThreshold: TestData["decisionThreshold"] = async (overrides = {}) =>
    insertRow(client, "decisionThreshold", {
      provider: "cloudflare",
      model: "clef-flash",
      threshold: 0.7,
      ...overrides,
    });

  return {
    llmCall,
    spendReservation,
    modelPrice,
    decisionThreshold,
    workspace,
    user,
    session,
    account,
    member,
    invitation,
    group,
    groupMember,
    workspaceConfig,
    modelChoice,
    modelKey,
    passage,
    oauthClient,
    oauthRefreshToken,
    oauthAccessToken,
    verification,
    confirmedAuthenticatorOfASealedSecret,
    auditEvent,
    identityAuditEvent,
    accessRequest,
    workspaceLastActive,
    testWorkspaceMark,
    conceptIdentity,
    conceptIndex,
    bundleCommit,
    evidence,
    conceptVerification,
    mapGeneration,
    mapNode,
    mapEdge,
    mapUnresolvedReference,
    job,
    suggestion,
    conceptWriteRequest,
    connectedSource,
    sourceDocument,
    finding,
    subjectRequest,
    erasureRequest,
    suppression,
    conceptEvidence,
    conceptSensitivityOverride,
    conceptOwner,
    guideDefinition,
    guideRole,
    guideSection,
    guideExpectedFact,
    guideDefinitionVersion,
    writeUp,
    writeUpInclude,
    writeUpVersion,
    usage,
    questionAsked,
    questionContent,
    questionFeedback,
  };
};
