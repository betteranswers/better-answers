import { getTableColumns, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACCESS_REQUEST_REASON_MAX,
  boundarySchemas,
  CONCEPT_FRONTMATTER_MAX,
  conceptFrontmatter,
  EMBEDDING_DIMENSIONS,
  FINDING_REASON_MAX,
  REDACTION_ALWAYS_TIER,
  REDACTION_TIERS,
  RULES_IN_FORCE_DEFAULT,
  RULES_IN_FORCE_KEYS,
  SUBJECT_IDENTIFIER_MAX,
  SUBJECT_IDENTIFIERS_MAX,
  SUGGESTION_BODY_MAX,
  SUGGESTION_REASON_MAX,
} from "../src/index.ts";
import * as publicEntry from "../src/index.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "../src/drizzle-zod.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

const WS_ID = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const USER_ID = "01J6CCCCCCCCCCCCCCCCCCCCCC";
const MEMBER_ID = "01J6DDDDDDDDDDDDDDDDDDDDDD";
const SESSION_ID = "01J6EEEEEEEEEEEEEEEEEEEEEE";
const INVITATION_ID = "01J6FFFFFFFFFFFFFFFFFFFFFF";
const GROUP_ID = "01J6JJJJJJJJJJJJJJJJJJJJJJ";
const AUDIT_EVENT_ID = "01J6GGGGGGGGGGGGGGGGGGGGGG";
const BATCH_ID = "01J6HHHHHHHHHHHHHHHHHHHHHH";
const ACCESS_REQUEST_ID = "01J6KKKKKKKKKKKKKKKKKKKKKK";
const NOW = new Date("2026-09-01T00:00:00Z");

const CONCEPT_IRI = "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM";
const CONTENT_SHA256 = "a".repeat(64);
const COMMIT_SHA = "b".repeat(40);
const SUGGESTION_SET_ID = "01J6RRRRRRRRRRRRRRRRRRRRRR";
const SUGGESTION_ID = "01J6SSSSSSSSSSSSSSSSSSSSSS";
const BINDING_ID = "01J6VVVVVVVVVVVVVVVVVVVVVV";

const DOCUMENT_ID = "01J6NNNNNNNNNNNNNNNNNNNNNN";
const COMPOSITION_ID = "01J6WWWWWWWWWWWWWWWWWWWWWW";

const FINDING_ID = "01J6XXXXXXXXXXXXXXXXXXXXXX";

const SUBJECT_REQUEST_ID = "01J6YYYYYYYYYYYYYYYYYYYYYY";
const STRANGER_REQUEST_ID = "01J6YYYYYYYYYYYYYYYYYYYYY2";

const MEMBER_ERASURE_ID = "01J6YYYYYYYYYYYYYYYYYYYYY3";

const DUE = new Date("2026-10-01T00:00:00Z");
const EXTENDED = new Date("2026-12-01T00:00:00Z");

const ERASURE_REQUEST_ID = "01J6ZZZZZZZZZZZZZZZZZZZZZZ";
const ERASURE_PSEUDONYM = "01J6ZZZZZZZZZZZZZZZZZZZZZ2";

const BEYOND_USE = {
  hourly: new Date("2026-09-03T00:00:00Z"),
  daily: new Date("2026-10-01T00:00:00Z"),
  weekly: new Date("2026-10-27T00:00:00Z"),
  monthly: new Date("2027-03-01T00:00:00Z"),
};

const acceptedRows = {
  workspace: [{ id: WS_ID, name: "Workspace A", slug: "workspace-a" }],
  user: [{ id: USER_ID, name: "A person", email: "person@example.invalid" }],
  llmRoute: [
    {
      id: "route-embed",
      workspaceId: WS_ID,
      purpose: "embedding",
      provider: "mistral",
      model: "mistral-embed",
      dimensions: EMBEDDING_DIMENSIONS,
    },
  ],
  workspaceConfig: [{ workspaceId: WS_ID, key: "mcp.tools_list_ttl_ms", value: "300000" }],

  member: [
    {
      id: MEMBER_ID,
      workspaceId: WS_ID,
      userId: USER_ID,
      role: "Admin",
      createdAt: NOW,
      credentialsRevokedAt: NOW,
    },
  ],

  group: [{ id: GROUP_ID, workspaceId: WS_ID, name: "HR team", origin: "admin-curated" }],

  groupMember: [{ workspaceId: WS_ID, groupId: GROUP_ID, userId: USER_ID }],
  session: [
    { id: SESSION_ID, expiresAt: NOW, token: "session-token", updatedAt: NOW, userId: USER_ID },
  ],
  account: [
    {
      id: "account-1",
      issuer: "issuer",
      accountId: USER_ID,
      providerId: "credential",
      userId: USER_ID,
      updatedAt: NOW,
    },
  ],
  verification: [{ id: "verification-1", identifier: "sign-in-otp-x", value: "v", expiresAt: NOW }],
  jwks: [{ id: "jwk-1", publicKey: "pk", privateKey: "sk", createdAt: NOW }],
  invitation: [
    {
      id: INVITATION_ID,
      workspaceId: WS_ID,
      email: "invitee@example.invalid",
      expiresAt: NOW,
      inviterId: USER_ID,
    },
  ],
  oauthClient: [
    {
      id: "client-1",
      clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    },
  ],
  oauthResource: [{ id: "resource-1", identifier: "https://app.example.test/mcp", name: "mcp" }],
  oauthClientResource: [
    {
      id: "client-resource-1",
      clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      resourceId: "https://app.example.test/mcp",
    },
  ],
  oauthRefreshToken: [
    {
      id: "refresh-1",
      token: "refresh-token-hash",
      clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      userId: USER_ID,
      expiresAt: NOW,
      createdAt: NOW,
      scopes: ["knowledge:read"],
    },
  ],
  oauthAccessToken: [
    {
      id: "access-1",
      token: "access-token-hash",
      clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      expiresAt: NOW,
      createdAt: NOW,
      scopes: ["knowledge:read"],
    },
  ],
  oauthConsent: [
    {
      id: "consent-1",
      clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      scopes: ["knowledge:read"],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  oauthClientAssertion: [{ id: "assertion-1", expiresAt: NOW }],
  rateLimit: [{ id: "limit-1", key: "ip:203.0.113.1", count: 1, lastRequest: 1 }],
  mcpCallCounter: [{ workspaceId: WS_ID, tokenId: "jti-1", windowStart: NOW, count: 1 }],
  ingressCounter: [{ scope: "ip", key: "203.0.113.1", windowStart: NOW, count: 1 }],

  auditEvent: [
    {
      id: AUDIT_EVENT_ID,
      workspaceId: WS_ID,
      act: "people.member.role_changed",
      actor: `human:${USER_ID}`,
      subjectId: USER_ID,
      detail: { role: "Editor", previousRole: "Viewer" },
    },
    {
      id: "01J6GGGGGGGGGGGGGGGGGGGGG2",
      workspaceId: WS_ID,
      act: "platform.workspace.provisioned",
      actor: "process:better-answers-bootstrap",
      subjectId: WS_ID,
      detail: { adminUserId: USER_ID, role: "Admin" },
    },
    {
      id: "01J6GGGGGGGGGGGGGGGGGGGGG3",
      workspaceId: WS_ID,
      act: "knowledge.suggestion.accepted",
      actor: "better-answers-enrichment/1.2",
      subjectId: "01J6GGGGGGGGGGGGGGGGGGGGG4",
      detail: { confirmed: true, count: 3 },
      batchId: BATCH_ID,
    },
  ],

  accessRequest: [
    {
      id: ACCESS_REQUEST_ID,
      workspaceId: WS_ID,
      requesterId: USER_ID,
      reason: "I have joined the bids team and need the answer library.",
    },
    {
      id: "01J6KKKKKKKKKKKKKKKKKKKKK2",
      workspaceId: WS_ID,
      requesterId: USER_ID,
      reason: "Second ask, already decided.",
      status: "approved",
      decidedBy: USER_ID,
      decidedAt: NOW,
      invitationId: INVITATION_ID,
    },
  ],
  chunk: [
    {
      id: "chunk-1",
      workspaceId: WS_ID,
      content: "hello",
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5),
      embeddingRouteId: "route-embed",
      sensitivity: "Internal",
      audience: "everyone",
      bindingId: "binding-1",
    },
  ],

  sourceBinding: [
    {
      workspaceId: WS_ID,
      id: BINDING_ID,
      publishedAt: NOW,
      sensitivity: "Restricted",
      audience: "everyone",
      name: "The board minutes",
      connector: "upload",
      destination: ["chunk-index", "bundle"],
      retentionClass: "keep",
      state: "landed",
    },
    {
      workspaceId: WS_ID,
      id: "01J6VVVVVVVVVVVVVVVVVVVVV2",
      publishedAt: NOW,
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [GROUP_ID],
      rulesInForce: { default_on: true, default_off: true },
      name: "The HR handbook",
      connector: "upload",

      destination: ["graph"],
      retentionClass: "mirror",
      state: "published",
    },
  ],

  sourceDocument: [
    {
      workspaceId: WS_ID,
      id: DOCUMENT_ID,
      bindingId: BINDING_ID,
      sourceSystemId: "board-minutes-2026-03.md",
      title: "Board minutes, March 2026",
      mediaType: "text/markdown",
      byteSize: 4_096,
      originalKey: `documents/${DOCUMENT_ID.toLowerCase()}/original`,
    },
    {
      workspaceId: WS_ID,
      id: "01J6NNNNNNNNNNNNNNNNNNNNN2",
      bindingId: BINDING_ID,
      sourceSystemId: "handbook.md",
      title: "The handbook",
      mediaType: "text/markdown",
      byteSize: 0,
      originalKey: "documents/01j6nnnnnnnnnnnnnnnnnnnnn2/original",
      normalisedKey: "documents/01j6nnnnnnnnnnnnnnnnnnnnn2/normalised",
      contentHash: CONTENT_SHA256,
      redactionVersion: "1",
      firstSeen: NOW,
      lastSeen: NOW,
      lastModified: NOW,
      goneAt: NOW,
      outcome: "converted",
      sensitivity: "Restricted",
    },
  ],

  finding: [
    {
      workspaceId: WS_ID,
      id: FINDING_ID,
      documentId: DOCUMENT_ID,
      category: "bank-details",
      tier: "always",
      ruleId: "sort-code-with-account-number",
      charStart: 12,
      charEnd: 20,
      score: 0.85,
      ruleVersion: "1",
      detectorPin: "presidio-2.2.364",
    },
    {
      workspaceId: WS_ID,
      id: "01J6XXXXXXXXXXXXXXXXXXXXX2",
      documentId: DOCUMENT_ID,
      category: "special-category",
      tier: "always",
      ruleId: "health-cue-list",
      charStart: 40,
      charEnd: 64,
      score: 0.6,
      ruleVersion: "1",
      detectorPin: "presidio-2.2.364",
      reviewState: "narrowed",
      reviewedBy: `human:${USER_ID}`,
      reviewedAt: NOW,
      reviewReason: "a health cue in a case study, so the document is Restricted",
    },
    {
      workspaceId: WS_ID,
      id: "01J6XXXXXXXXXXXXXXXXXXXXX3",
      documentId: DOCUMENT_ID,
      category: "person-name",
      tier: "always",
      ruleId: "officer-block",
      charStart: 80,
      charEnd: 92,
      score: 0.9,
      ruleVersion: "1",
      detectorPin: "presidio-2.2.364",
      restoredAt: NOW,
      restoredBy: `human:${USER_ID}`,
      restoreReason: "the officer block is on the company's own filing",
    },
  ],

  subjectRequest: [
    {
      workspaceId: WS_ID,
      id: SUBJECT_REQUEST_ID,
      kind: "access",
      personId: USER_ID,
      identifiers: { emails: ["person@example.invalid"], names: ["A person"], other: [] },
      receivedAt: NOW,
      clockStartedAt: NOW,
      dueAt: DUE,
    },
    {
      workspaceId: WS_ID,
      id: STRANGER_REQUEST_ID,
      kind: "erasure",
      personId: null,
      identifiers: {
        emails: ["priya@client.invalid"],
        names: ["Priya Nair"],
        other: ["07700 900123"],
      },
      receivedAt: NOW,
      clockStartedAt: new Date("2026-09-08T00:00:00Z"),
      dueAt: DUE,
      extendedTo: EXTENDED,
      answeredAt: new Date("2026-09-20T00:00:00Z"),
      answer: "The platform holds this person in the concept files and the git history.",
    },
    {
      workspaceId: WS_ID,
      id: MEMBER_ERASURE_ID,
      kind: "erasure",
      personId: USER_ID,
      identifiers: { emails: ["person@example.invalid"], names: [], other: [] },
      receivedAt: NOW,
      clockStartedAt: NOW,
      dueAt: DUE,
    },
  ],

  erasureRequest: [
    {
      workspaceId: WS_ID,
      id: ERASURE_REQUEST_ID,
      subjectRequestId: MEMBER_ERASURE_ID,
      pseudonym: ERASURE_PSEUDONYM,
      lockedAt: NOW,
      anchoredAt: NOW,
      beyondUseHourlyAt: BEYOND_USE.hourly,
      beyondUseDailyAt: BEYOND_USE.daily,
      beyondUseWeeklyAt: BEYOND_USE.weekly,
      beyondUseMonthlyAt: BEYOND_USE.monthly,
    },
    {
      workspaceId: WS_ID,
      id: "01J6ZZZZZZZZZZZZZZZZZZZZZ3",
      subjectRequestId: STRANGER_REQUEST_ID,
      pseudonym: "01J6ZZZZZZZZZZZZZZZZZZZZZ4",
      lockedAt: NOW,
      anchoredAt: NOW,
      actions: {
        git: { rewritten: true, commits: 12 },
        "identity-set": { pseudonymised: false, reason: "no user row" },
      },
      beyondUseHourlyAt: BEYOND_USE.hourly,
      beyondUseDailyAt: BEYOND_USE.daily,
      beyondUseWeeklyAt: BEYOND_USE.weekly,
      beyondUseMonthlyAt: BEYOND_USE.monthly,
      completedAt: new Date("2026-09-02T00:00:00Z"),
      report: "Backup copies taken before 2026-09-01 are beyond use.",
    },
  ],

  suppression: [
    {
      workspaceId: WS_ID,
      erasureRequestId: ERASURE_REQUEST_ID,
      documentId: DOCUMENT_ID,
      identifiers: { emails: ["person@example.invalid"], names: ["A person"], other: [] },
    },
  ],

  conceptEvidence: [
    { workspaceId: WS_ID, iri: CONCEPT_IRI, sourceDocumentId: DOCUMENT_ID, locator: "p.4#para-2" },
  ],

  conceptClassOverride: [
    {
      workspaceId: WS_ID,
      iri: CONCEPT_IRI,
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [GROUP_ID],
      actor: `human:${USER_ID}`,
      auditEventId: AUDIT_EVENT_ID,
    },
  ],
  composition: [
    {
      workspaceId: WS_ID,
      id: COMPOSITION_ID,
      publishedAt: NOW,
      sensitivity: "Internal",
      audience: "everyone",
    },
  ],
  compositionInclude: [
    { workspaceId: WS_ID, compositionId: COMPOSITION_ID, id: "i1", ordinal: 0, iri: CONCEPT_IRI },
  ],
  conceptIdentity: [{ workspaceId: WS_ID, iri: CONCEPT_IRI, mergeKey: "policy:expenses" }],
  conceptIndex: [
    {
      workspaceId: WS_ID,
      iri: CONCEPT_IRI,
      path: "knowledge/expenses.md",
      kind: "Policy",
      title: "Expenses",
      frontmatter: { title: "Expenses", type: "Policy", tags: ["finance"] },
      body: "Expenses are claimed within thirty days.",
      contentHash: CONTENT_SHA256,
      commitSha: COMMIT_SHA,
      status: "stable",
      publishedAt: NOW,
      sensitivity: "Internal",
      audience: "everyone",
    },
  ],

  bundleCommit: [
    {
      workspaceId: WS_ID,
      sha: COMMIT_SHA,
      auditEventId: AUDIT_EVENT_ID,
      actor: `human:${USER_ID}`,
    },
    {
      workspaceId: WS_ID,
      sha: "c".repeat(40),
      parentSha: COMMIT_SHA,
      auditEventId: BATCH_ID,
      actor: "process:better-answers-reconciler",
      committedAt: NOW,
    },
  ],
  evidence: [
    {
      workspaceId: WS_ID,
      sourceDocumentId: "01J6NNNNNNNNNNNNNNNNNNNNNN",
      locator: "p.4#para-2",
      resource: "Expenses policy (2026 edition)",
      contentVersion: "2026-03-01",
    },
  ],

  conceptVerification: [
    {
      id: "01J6PPPPPPPPPPPPPPPPPPPPPP",
      workspaceId: WS_ID,
      iri: CONCEPT_IRI,
      actor: `human:${USER_ID}`,
      checkedAt: NOW,
      contentHash: CONTENT_SHA256,
      origin: "platform",
    },
    {
      id: "01J6QQQQQQQQQQQQQQQQQQQQQQ",
      workspaceId: WS_ID,
      iri: CONCEPT_IRI,
      actor: "better-answers-enrichment/1.2",
      contentHash: null,
      origin: "imported",
    },
  ],
  graphGeneration: [{ workspaceId: WS_ID, liveGen: 1 }],

  graphNode: [
    {
      workspaceId: WS_ID,
      gen: 1,
      uid: CONCEPT_IRI,
      label: "Concept",
      kind: "Policy",
      publishedAt: NOW,
      sensitivity: "Internal",
      audience: "everyone",
    },
    {
      workspaceId: WS_ID,
      gen: null,
      uid: "01J6NNNNNNNNNNNNNNNNNNNNNN:person:abc123",
      label: "source-entity:Person",
      sensitivity: "Restricted",
      audience: "everyone",
    },
  ],

  graphEdge: [
    {
      workspaceId: WS_ID,
      gen: 1,
      uid: `links_to:${CONCEPT_IRI}:0`,
      label: "LINKS_TO",
      fromUid: CONCEPT_IRI,
      toUid: "https://better-answers.com/c/01J6RRRRRRRRRRRRRRRRRRRRRR",
      fromKind: "Policy",
      toKind: "Product",
      section: "Details",
      sentence: "The expenses policy applies per product tier.",
      publishedAt: NOW,
      sensitivity: "Internal",
      audience: "everyone",
    },
    {
      workspaceId: WS_ID,
      gen: 1,
      uid: `supersedes:${CONCEPT_IRI}`,
      label: "SUPERSEDES",
      fromUid: CONCEPT_IRI,
      toUid: "https://better-answers.com/c/01J6SSSSSSSSSSSSSSSSSSSSSS",
      publishedAt: NOW,
      sensitivity: "Internal",
      audience: "everyone",
    },
    {
      workspaceId: WS_ID,
      gen: null,
      uid: "is_concept:01J6NNNNNNNNNNNNNNNNNNNNNN:person:abc123",
      label: "IS_CONCEPT",
      fromUid: "01J6NNNNNNNNNNNNNNNNNNNNNN:person:abc123",
      toUid: CONCEPT_IRI,
      publishedAt: NOW,
      sensitivity: "Restricted",
      audience: "everyone",
    },
  ],

  job: [
    { workspaceId: WS_ID, id: "01J6J1AAAAAAAAAAAAAAAAAAAA", kind: "nightly-audit" },
    {
      workspaceId: WS_ID,
      id: "01J6J2AAAAAAAAAAAAAAAAAAAA",
      kind: "full-rebuild",
      reason: "drill",
      status: "done",
      attempts: 1,
      claimedBy: "worker-7c2f",
      claimedAt: NOW,
      leaseExpiresAt: NOW,
      heartbeatAt: NOW,
      finishedAt: NOW,

      outcome: { checked: 2, mismatched: [{ path: "knowledge/expenses.md" }], unparsed: [] },
    },
  ],

  suggestion: [
    {
      workspaceId: WS_ID,
      id: SUGGESTION_ID,
      setId: SUGGESTION_SET_ID,
      kind: "edit",
      proposer: `human:${USER_ID}`,
    },
    {
      workspaceId: WS_ID,
      id: "01J6TTTTTTTTTTTTTTTTTTTTTT",
      setId: SUGGESTION_SET_ID,
      kind: "candidate",
      status: "accepted",
      proposer: "better-answers-extraction/1.2",
      targetIri: CONCEPT_IRI,
      decider: `human:${USER_ID}`,
      decidedAt: NOW,
    },
  ],

  conceptWriteRequest: [
    {
      workspaceId: WS_ID,
      suggestionId: SUGGESTION_ID,
      mergeKey: "policy:expenses",
      path: "knowledge/expenses.md",
      conceptKind: "Policy",
      title: "Expenses",
      frontmatter: { title: "Expenses", type: "Policy", sources: [{ resource: "/s.md" }] },
      body: "Expenses are claimed within sixty days.",
      baseContentHash: CONTENT_SHA256,
    },
  ],
} as const;

// `hasOwn` is what `keyof` means at runtime, so the filter narrows rather than asserts.
const ownKeys = <T extends object>(record: T): readonly (keyof T)[] =>
  Object.keys(record).filter((name): name is Extract<keyof T, string> =>
    Object.hasOwn(record, name),
  );

const registryNames = ownKeys(boundarySchemas);
const forms = ["select", "insert", "update"] as const;

const unrefinedFor = (
  name: keyof typeof boundarySchemas,
): Record<(typeof forms)[number], z.ZodObject> => {
  const table: PgTable = boundarySchemas[name].table;
  return {
    select: createSelectSchema(table),
    insert: createInsertSchema(table),
    update: createUpdateSchema(table),
  };
};
const unrefined = new Map(registryNames.map((name) => [name, unrefinedFor(name)]));
const unrefinedOf = (
  name: keyof typeof boundarySchemas,
): Record<(typeof forms)[number], z.ZodObject> => {
  const found = unrefined.get(name);
  if (found === undefined) throw new Error(`no generated schemas for ${name}`);
  return found;
};

describe("1 — every table has a boundary", () => {
  it("registers exactly the PgTables the public entry point exports", () => {
    const exportedTables = Object.values(publicEntry).filter((value) => is(value, PgTable));
    const registeredTables = registryNames.map((name) => boundarySchemas[name].table);
    expect(new Set(registeredTables)).toEqual(new Set(exportedTables));
  });

  it("has an accepted row for every registered table, and no row for an unregistered one", () => {
    expect(Object.keys(acceptedRows).toSorted()).toEqual(registryNames.toSorted());
  });
});

describe("2 — the key sets agree", () => {
  for (const name of registryNames) {
    for (const form of forms) {
      it(`${name}.${form} names exactly the generated keys`, () => {
        expect(Object.keys(boundarySchemas[name][form].shape).toSorted()).toEqual(
          Object.keys(unrefinedOf(name)[form].shape).toSorted(),
        );
      });
    }
  }
});

describe("3 — optionality and nullability agree, per key, at runtime", () => {
  for (const name of registryNames) {
    for (const form of forms) {
      it(`${name}.${form} accepts undefined and null exactly where the column does`, () => {
        const refinedShape = boundarySchemas[name][form].shape;
        const unrefinedShape: Readonly<Record<string, z.ZodType>> = unrefinedOf(name)[form].shape;
        const columns: Readonly<Record<string, { dataType: string }>> = getTableColumns(
          boundarySchemas[name].table,
        );
        for (const [key, refinedField] of Object.entries<z.ZodType>(refinedShape)) {
          if (columns[key]?.dataType === "custom") continue;
          const unrefinedField = unrefinedShape[key];
          if (unrefinedField === undefined) throw new Error(`no generated field for ${key}`);
          expect({
            key,
            undefined: refinedField.safeParse(undefined).success,
            null: refinedField.safeParse(null).success,
          }).toEqual({
            key,
            undefined: unrefinedField.safeParse(undefined).success,
            null: unrefinedField.safeParse(null).success,
          });
        }
      });
    }
  }
});

describe("4 — a refinement only narrows, proved against the column", () => {
  let db: MigratedPostgres;

  beforeAll(async () => {
    db = await openMigratedPostgres();
  });

  afterAll(async () => {
    await db.stop();
  });

  it("inserts every row the refined insert schemas accept", async () => {
    await withRollback(db.pool, async (client) => {
      const database = drizzle(client);
      let accepted = 0;

      const insertOrder = [
        "workspace",
        "user",
        "llmRoute",
        "workspaceConfig",
        "member",

        "group",
        "groupMember",
        "session",
        "account",
        "verification",
        "jwks",
        "invitation",
        "oauthClient",
        "oauthResource",
        "oauthClientResource",
        "oauthRefreshToken",
        "oauthAccessToken",
        "oauthConsent",
        "oauthClientAssertion",
        "rateLimit",
        "mcpCallCounter",
        "ingressCounter",
        "auditEvent",
        "accessRequest",

        "conceptIdentity",
        "conceptIndex",
        "bundleCommit",

        "sourceBinding",
        "sourceDocument",
        "evidence",
        "conceptVerification",

        "graphGeneration",
        "graphNode",
        "graphEdge",

        "job",

        "suggestion",
        "conceptWriteRequest",

        "finding",

        "subjectRequest",
        "erasureRequest",

        "suppression",
        "conceptEvidence",
        "conceptClassOverride",
        "composition",
        "compositionInclude",
        "chunk",
      ] as const;
      expect(insertOrder.toSorted()).toEqual(registryNames.toSorted());

      for (const name of insertOrder) {
        if (name === "chunk") {
          await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_ID]);
          await client.query("SELECT create_workspace_partition($1)", [WS_ID]);
        }
        for (const row of acceptedRows[name]) {
          const parsed = boundarySchemas[name].insert.parse(row);
          await database.insert(boundarySchemas[name].table).values(parsed);
          accepted += 1;
        }
      }
      expect(accepted).toBe(Object.values(acceptedRows).flat().length);
    });
  });
});

describe("the rejection half: a violated refinement never reaches Postgres", () => {
  const rejectedRows = {
    workspace: [
      { id: "not-a-ulid", name: "Workspace A", slug: "a" },
      { id: WS_ID, name: "   ", slug: "a" },
    ],

    llmRoute: [
      { ...acceptedRows.llmRoute[0], dimensions: 0 },
      { ...acceptedRows.llmRoute[0], retentionTail: "   " },
    ],

    user: [{ ...acceptedRows.user[0], id: "kEyIkQBmQ1EnBJnUvKMR6nSFXlQKUcuJ" }],
    member: [
      { ...acceptedRows.member[0], role: "owner" },
      { ...acceptedRows.member[0], id: `member-${WS_ID}-${USER_ID}` },
    ],
    session: [{ ...acceptedRows.session[0], id: "kEyIkQBmQ1EnBJnUvKMR6nSFXlQKUcuJ" }],
    invitation: [{ ...acceptedRows.invitation[0], id: "invitation-1" }],

    group: [
      { ...acceptedRows.group[0], id: "group-1" },
      { ...acceptedRows.group[0], name: "   " },
      { ...acceptedRows.group[0], origin: "self-service" },
    ],
    groupMember: [
      { ...acceptedRows.groupMember[0], groupId: "group-1" },
      { ...acceptedRows.groupMember[0], userId: "priya@example.invalid" },
    ],
    workspaceConfig: [{ ...acceptedRows.workspaceConfig[0], key: "  " }],
    ingressCounter: [{ ...acceptedRows.ingressCounter[0], scope: "user-agent" }],
    mcpCallCounter: [{ ...acceptedRows.mcpCallCounter[0], count: -1 }],

    auditEvent: [
      { ...acceptedRows.auditEvent[0], id: "audit-1" },
      { ...acceptedRows.auditEvent[0], act: "billing.invoice.sent" },
      { ...acceptedRows.auditEvent[0], act: "people.member" },
      { ...acceptedRows.auditEvent[0], actor: "human:priya@example.invalid" },
      { ...acceptedRows.auditEvent[0], actor: USER_ID },
      { ...acceptedRows.auditEvent[0], actor: "Priya Patel" },
      { ...acceptedRows.auditEvent[0], detail: { person: { name: "Priya" } } },
      { ...acceptedRows.auditEvent[2], batchId: "batch-1" },
    ],

    accessRequest: [
      { ...acceptedRows.accessRequest[0], id: "request-1" },
      { ...acceptedRows.accessRequest[0], reason: "" },
      { ...acceptedRows.accessRequest[0], reason: "   " },
      { ...acceptedRows.accessRequest[0], reason: "x".repeat(ACCESS_REQUEST_REASON_MAX + 1) },
      { ...acceptedRows.accessRequest[0], status: "expired" },
      { ...acceptedRows.accessRequest[0], requesterId: "priya@example.invalid" },
    ],
    chunk: [
      {
        ...acceptedRows.chunk[0],
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0.5),
      },
      { ...acceptedRows.chunk[0], sensitivity: "Secret" },
    ],

    graphGeneration: [{ ...acceptedRows.graphGeneration[0], liveGen: 0 }],
    graphNode: [
      { ...acceptedRows.graphNode[0], label: "Widget" },
      { ...acceptedRows.graphNode[0], sensitivity: "Secret" },
      { ...acceptedRows.graphNode[0], gen: 0 },
      { ...acceptedRows.graphNode[0], gen: null },
      { ...acceptedRows.graphNode[1], gen: 1 },
    ],
    graphEdge: [
      { ...acceptedRows.graphEdge[0], label: "RELATES_TO" },
      { ...acceptedRows.graphEdge[0], sensitivity: "Secret" },
      { ...acceptedRows.graphEdge[0], fromUid: "   " },
      { ...acceptedRows.graphEdge[1], label: "source-entity:mentions" },
    ],

    suggestion: [
      { ...acceptedRows.suggestion[0], kind: "merge" },
      { ...acceptedRows.suggestion[0], proposer: "ada@acme.invalid" },
      { ...acceptedRows.suggestion[0], reason: "x".repeat(SUGGESTION_REASON_MAX + 1) },
    ],

    finding: [
      { ...acceptedRows.finding[0], tier: "sometimes" },
      { ...acceptedRows.finding[1], reviewState: "dismissed" },
      { ...acceptedRows.finding[0], charStart: 1.5 },
      { ...acceptedRows.finding[0], charEnd: 0 },
      { ...acceptedRows.finding[0], score: 1.1 },
      { ...acceptedRows.finding[0], category: "   " },
      { ...acceptedRows.finding[1], reviewedBy: "priya@example.invalid" },
      { ...acceptedRows.finding[1], reviewReason: "x".repeat(FINDING_REASON_MAX + 1) },
      { ...acceptedRows.finding[2], restoreReason: "x".repeat(FINDING_REASON_MAX + 1) },
    ],

    sourceBinding: [
      {
        ...acceptedRows.sourceBinding[1],
        rulesInForce: { default_on: true, default_off: false, always: false },
      },
      { ...acceptedRows.sourceBinding[1], rulesInForce: { default_on: true } },
      { ...acceptedRows.sourceBinding[1], rulesInForce: { default_on: true, default_off: "no" } },

      { ...acceptedRows.sourceBinding[0], connector: "sharepoint" },
      { ...acceptedRows.sourceBinding[0], name: "   " },
      { ...acceptedRows.sourceBinding[0], destination: ["chunk-index", "warehouse"] },
      { ...acceptedRows.sourceBinding[0], destination: [] },
      { ...acceptedRows.sourceBinding[0], retentionClass: "forever" },
      { ...acceptedRows.sourceBinding[0], state: "reviewing" },
    ],

    sourceDocument: [
      { ...acceptedRows.sourceDocument[0], sourceSystemId: "   " },
      { ...acceptedRows.sourceDocument[0], title: "   " },
      { ...acceptedRows.sourceDocument[0], mediaType: "   " },
      { ...acceptedRows.sourceDocument[0], byteSize: -1 },
      { ...acceptedRows.sourceDocument[0], byteSize: 1.5 },
      { ...acceptedRows.sourceDocument[0], originalKey: "   " },
      { ...acceptedRows.sourceDocument[1], normalisedKey: "   " },
      { ...acceptedRows.sourceDocument[1], contentHash: "not-a-digest" },
      { ...acceptedRows.sourceDocument[1], redactionVersion: "   " },
      { ...acceptedRows.sourceDocument[1], outcome: "skipped" },
      { ...acceptedRows.sourceDocument[1], sensitivity: "Secret" },
    ],

    job: [
      { ...acceptedRows.job[0], subjectId: "   " },
      { ...acceptedRows.job[0], subjectId: "" },
    ],

    subjectRequest: [
      { ...acceptedRows.subjectRequest[0], kind: "portability" },
      { ...acceptedRows.subjectRequest[0], personId: "priya@example.invalid" },
      { ...acceptedRows.subjectRequest[1], answer: "   " },
      {
        ...acceptedRows.subjectRequest[0],
        identifiers: { emails: [], names: [], other: [], phones: ["07700 900123"] },
      },
      { ...acceptedRows.subjectRequest[0], identifiers: { emails: [], names: [] } },
      {
        ...acceptedRows.subjectRequest[0],
        identifiers: { emails: "person@example.invalid", names: [], other: [] },
      },
      {
        ...acceptedRows.subjectRequest[0],
        identifiers: { emails: [{ address: "person@example.invalid" }], names: [], other: [] },
      },
      { ...acceptedRows.subjectRequest[0], identifiers: { emails: ["   "], names: [], other: [] } },
      {
        ...acceptedRows.subjectRequest[0],
        identifiers: { emails: ["x".repeat(SUBJECT_IDENTIFIER_MAX + 1)], names: [], other: [] },
      },
      {
        ...acceptedRows.subjectRequest[0],
        identifiers: {
          emails: Array.from(
            { length: SUBJECT_IDENTIFIERS_MAX + 1 },
            (_, at) => `p${at}@x.invalid`,
          ),
          names: [],
          other: [],
        },
      },
    ],

    erasureRequest: [
      { ...acceptedRows.erasureRequest[0], pseudonym: `erasure-${USER_ID}` },
      { ...acceptedRows.erasureRequest[1], report: "   " },
      {
        ...acceptedRows.erasureRequest[1],
        actions: { git: { rewritten: { commits: ["abc123"] } } },
      },
    ],

    suppression: [
      {
        ...acceptedRows.suppression[0],
        identifiers: { emails: [], names: [], other: [], phones: ["07700 900123"] },
      },
      {
        ...acceptedRows.suppression[0],
        identifiers: { emails: ["x".repeat(SUBJECT_IDENTIFIER_MAX + 1)], names: [], other: [] },
      },
    ],

    conceptWriteRequest: [
      { ...acceptedRows.conceptWriteRequest[0], path: "knowledge/manifest.yaml" },
      { ...acceptedRows.conceptWriteRequest[0], body: "x".repeat(SUGGESTION_BODY_MAX + 1) },
      {
        ...acceptedRows.conceptWriteRequest[0],
        frontmatter: { title: "x".repeat(CONCEPT_FRONTMATTER_MAX) },
      },
    ],
  } as const;

  for (const name of ownKeys(rejectedRows)) {
    it(`${name} refuses every row that violates a refinement`, () => {
      for (const row of rejectedRows[name]) {
        expect(boundarySchemas[name].insert.safeParse(row).success).toBe(false);
      }
    });
  }
});

describe("what a finding may hold", () => {
  it("has exactly these columns, and not one a personal detail could sit in", () => {
    expect(Object.keys(boundarySchemas.finding.select.shape).toSorted()).toEqual(
      [
        "workspaceId",
        "id",
        "documentId",
        "category",
        "tier",
        "ruleId",
        "charStart",
        "charEnd",
        "score",
        "ruleVersion",
        "detectorPin",
        "reviewState",
        "reviewedBy",
        "reviewedAt",
        "reviewReason",
        "restoredAt",
        "restoredBy",
        "restoreReason",
      ].toSorted(),
    );
  });
});

describe("the rules in force a binding carries", () => {
  const asKey = (tier: string) => tier.replaceAll("-", "_");
  const keyed: readonly string[] = RULES_IN_FORCE_KEYS;

  it("keys the column on the two tiers a binding switches, and on no other", () => {
    expect(RULES_IN_FORCE_KEYS).toEqual(["default_on", "default_off"]);
    expect(RULES_IN_FORCE_KEYS).toEqual(
      REDACTION_TIERS.filter((tier) => tier !== REDACTION_ALWAYS_TIER).map(asKey),
    );

    expect(REDACTION_TIERS.filter((tier) => !keyed.includes(asKey(tier)))).toEqual([
      REDACTION_ALWAYS_TIER,
    ]);
  });

  it("defaults to the safe set, so a binding nobody configured withholds the more", () => {
    expect(RULES_IN_FORCE_DEFAULT).toEqual({ default_on: true, default_off: false });
    expect(
      boundarySchemas.sourceBinding.select.shape.rulesInForce.safeParse(RULES_IN_FORCE_DEFAULT)
        .success,
    ).toBe(true);
  });
});

describe("who a subject request is about", () => {
  const stranger = acceptedRows.subjectRequest[1];

  it("takes a request whose subject never signed in, written either way", () => {
    expect(boundarySchemas.subjectRequest.insert.safeParse(stranger).success).toBe(true);

    const { personId: _absent, ...omitted } = { ...stranger };
    expect(boundarySchemas.subjectRequest.insert.safeParse(omitted).success).toBe(true);
  });

  it("keeps the identifier set's three kinds, so every finder reads its own arm", () => {
    const parsed = boundarySchemas.subjectRequest.insert.parse(stranger);
    expect(parsed.identifiers).toEqual({
      emails: ["priya@client.invalid"],
      names: ["Priya Nair"],
      other: ["07700 900123"],
    });
  });
});

describe("the frontmatter bound's unit", () => {
  const astral = (characters: number) => ({ a: "\u{1D11E}".repeat(characters) });

  it("counts the characters `char_length` counts, not the units JavaScript measures", () => {
    const inside = astral(CONCEPT_FRONTMATTER_MAX - 100);
    expect(JSON.stringify(inside).length).toBeGreaterThan(CONCEPT_FRONTMATTER_MAX);
    expect(conceptFrontmatter.safeParse(inside).success).toBe(true);

    expect(conceptFrontmatter.safeParse(astral(CONCEPT_FRONTMATTER_MAX)).success).toBe(false);
  });
});

describe("the customType exception, per shape", () => {
  const tooShort = Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0);

  it("chunk.select requires an embedding of the route's width", () => {
    const row = {
      ...acceptedRows.chunk[0],
      publishedAt: null,
      audienceGroups: null,
      sourceDocumentId: null,
      locator: null,
      ordinal: null,
      charStart: null,
      charEnd: null,
    };
    const select = boundarySchemas.chunk.select;
    expect(select.safeParse(row).success).toBe(true);
    expect(select.safeParse({ ...row, embedding: undefined }).success).toBe(false);
    expect(select.safeParse({ ...row, embedding: tooShort }).success).toBe(false);
  });

  it("chunk.insert requires an embedding of the route's width", () => {
    const row = acceptedRows.chunk[0];
    const insert = boundarySchemas.chunk.insert;
    expect(insert.safeParse(row).success).toBe(true);
    expect(insert.safeParse({ ...row, embedding: undefined }).success).toBe(false);
    expect(insert.safeParse({ ...row, embedding: tooShort }).success).toBe(false);
  });

  it("chunk.update accepts a row that touches no embedding, and still checks one it does", () => {
    const update = boundarySchemas.chunk.update;
    expect(update.safeParse({ content: "edited" }).success).toBe(true);
    expect(update.safeParse({ embedding: tooShort }).success).toBe(false);
  });
});

describe("5 — the inferred type is pinned", () => {
  type Expect<T extends true> = T;
  type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

  type WorkspaceId = string & z.core.$brand<"WorkspaceId">;
  type UserId = string & z.core.$brand<"UserId">;

  type _workspaceSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.workspace.select>,
      {
        id: WorkspaceId;
        name: string;
        slug: string;
        logo: string | null;
        createdAt: Date;
        metadata: string | null;
      }
    >
  >;
  type _llmRouteSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.llmRoute.select>,
      {
        id: string;
        workspaceId: WorkspaceId;
        purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
        provider: string;
        model: string;
        dimensions: number | null;
        retentionTail: string | null;
      }
    >
  >;
  type _workspaceConfigSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.workspaceConfig.select>,
      { workspaceId: WorkspaceId; key: string; value: string; updatedAt: Date }
    >
  >;
  type _memberSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.member.select>,
      {
        id: string;
        workspaceId: WorkspaceId;
        userId: UserId;
        role: "Admin" | "Editor" | "Viewer";
        createdAt: Date;
        credentialsRevokedAt: Date | null;
      }
    >
  >;
  type _userSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.user.select>,
      {
        id: UserId;
        name: string;
        email: string;
        emailVerified: boolean;
        image: string | null;
        createdAt: Date;
        updatedAt: Date;
        credentialsRevokedAt: Date | null;
      }
    >
  >;
  type GroupId = string & z.core.$brand<"GroupId">;
  type _groupSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.group.select>,
      {
        id: GroupId;
        workspaceId: WorkspaceId;
        name: string;
        origin: "admin-curated" | "audience-minted";
        createdAt: Date;
      }
    >
  >;
  type _groupMemberSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.groupMember.select>,
      { workspaceId: WorkspaceId; groupId: GroupId; userId: UserId; addedAt: Date }
    >
  >;
  type _sessionSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.session.select>,
      {
        id: string;
        expiresAt: Date;
        token: string;
        createdAt: Date;
        updatedAt: Date;
        ipAddress: string | null;
        userAgent: string | null;
        userId: string;
        activeWorkspaceId: string | null;
      }
    >
  >;
  type _invitationSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.invitation.select>,
      {
        id: string;
        workspaceId: string;
        email: string;
        role: string | null;
        status: string;
        expiresAt: Date;
        createdAt: Date;
        inviterId: string;
      }
    >
  >;
  type _mcpCallCounterSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.mcpCallCounter.select>,
      { workspaceId: WorkspaceId; tokenId: string; windowStart: Date; count: number }
    >
  >;
  type AuditEventId = string & z.core.$brand<"AuditEventId">;
  type Family = "people" | "knowledge" | "sources" | "platform";
  type _auditEventSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.auditEvent.select>,
      {
        id: AuditEventId;
        workspaceId: WorkspaceId;
        act: `${Family}.${string}.${string}`;
        family: Family;
        actor: string;
        subjectKind: string;
        subjectId: string;
        at: Date;
        detail: Record<string, string | number | boolean> | null;
        batchId: string | null;
      }
    >
  >;
  type AccessRequestId = string & z.core.$brand<"AccessRequestId">;
  type _accessRequestSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.accessRequest.select>,
      {
        id: AccessRequestId;
        workspaceId: WorkspaceId;
        requesterId: UserId;
        reason: string;
        status: "waiting" | "approved" | "declined";
        createdAt: Date;
        decidedBy: UserId | null;
        decidedAt: Date | null;
        invitationId: string | null;
      }
    >
  >;
  type _ingressCounterSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.ingressCounter.select>,
      { scope: "ip" | "email"; key: string; windowStart: Date; count: number }
    >
  >;
  type _chunkSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.chunk.select>,
      {
        id: string;
        workspaceId: WorkspaceId;
        content: string;
        embedding: number[] | null;
        embeddingRouteId: string | null;
        publishedAt: Date | null;
        sensitivity: "Restricted" | "Internal" | "Public";
        audience: "everyone" | "groups";
        audienceGroups: GroupId[] | null;
        bindingId: string;
        sourceDocumentId: string | null;
        locator: string | null;
        ordinal: number | null;
        charStart: number | null;
        charEnd: number | null;
        search?: string | undefined;
      }
    >
  >;

  it("holds at compile time (the assertions above are types, not values)", () => {
    expect(true).toBe(true);
  });
});
