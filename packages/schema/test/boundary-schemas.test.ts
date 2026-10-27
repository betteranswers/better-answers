import { getTableColumns, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, jsonb, PgDialect, PgTable, pgTable } from "drizzle-orm/pg-core";
import { afterAll, assert, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "../src/boundary-schemas/drizzle-zod.ts";
import {
  ACCESS_REQUEST_REASON_MAX,
  boundarySchemas,
  CONCEPT_BODY_MAX,
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
import type { ids } from "../src/index.ts";
import * as publicEntry from "../src/index.ts";
import { type MigratedPostgres, withRollback } from "./support/harness.ts";
import { openMigratedPostgres } from "./support/warm-postgres.ts";

const WS_ID = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const USER_ID = "01J6CCCCCCCCCCCCCCCCCCCCCC";
const MEMBER_ID = "01J6DDDDDDDDDDDDDDDDDDDDDD";
const SESSION_ID = "01J6EEEEEEEEEEEEEEEEEEEEEE";
const PASSKEY_ID = "01J6PPPPPPPPPPPPPPPPPPPPPP";
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
const CONNECTED_SOURCE_ID = "01J6VVVVVVVVVVVVVVVVVVVVVV";

const DOCUMENT_ID = "01J6NNNNNNNNNNNNNNNNNNNNNN";
const WRITE_UP_ID = "01J6WWWWWWWWWWWWWWWWWWWWWW";
const RESPONSE_WRITE_UP_ID = "01J6WWWWWWWWWWWWWWWWWWWWW2";

const GUIDE_ID = "01J6BBBBBBBBBBBBBBBBBBBBBB";
const SECTION_ID = "insurance";
const EXPECTED_FACT_ID = "01J6BBBBBBBBBBBBBBBBBBBBB2";
const USAGE_ID = "01J6BBBBBBBBBBBBBBBBBBBBB3";
const CONCEPT_USAGE_ID = "01J6BBBBBBBBBBBBBBBBBBBBB4";

const OWNER_ID = "01J6TTTTTTTTTTTTTTTTTTTTTT";
const OVERRIDE_ID = "01J6TTTTTTTTTTTTTTTTTTTTT2";
const FINDING_ID = "01J6XXXXXXXXXXXXXXXXXXXXXX";

const SUBJECT_REQUEST_ID = "01J6YYYYYYYYYYYYYYYYYYYYYY";
const STRANGER_REQUEST_ID = "01J6YYYYYYYYYYYYYYYYYYYYY2";

const MEMBER_ERASURE_ID = "01J6YYYYYYYYYYYYYYYYYYYYY3";

const QUESTION_RECORD_ID = "01J6QQQQQQQQQQQQQQQQQQQQQQ";
const DRAFTED_RECORD_ID = "01J6QQQQQQQQQQQQQQQQQQQQQ2";

const A_SEALED_FRAME = new Uint8Array(40).fill(7);

const ASKED_IN_THE_MONTH_THE_MIGRATION_PARTITIONED = new Date();

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
  workspace: [{ id: WS_ID, name: "Workspace A", shortName: "workspace-a" }],
  user: [{ id: USER_ID, name: "A person", email: "person@example.invalid" }],
  modelChoice: [
    {
      id: "model-choice-embed",
      workspaceId: WS_ID,
      purpose: "embedding",
      provider: "mistral",
      model: "mistral-embed",
      dimensions: EMBEDDING_DIMENSIONS,
    },
  ],
  modelKey: [{ workspaceId: WS_ID, provider: "anthropic", sealed: A_SEALED_FRAME }],
  modelPrice: [
    {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effectiveFrom: "2026-10-01",
      gbpPerMillionIn: "3",
      gbpPerMillionOut: "15.00",
    },
  ],
  decisionThreshold: [{ provider: "cloudflare", model: "clef-flash", threshold: 0.7 }],
  llmCall: [
    {
      workspaceId: WS_ID,
      id: "01J6TTTTTTTTTTTTTTTTTTTTT1",
      calledAt: NOW,
      purpose: "judging",
      modelChoiceId: "model-choice-judge",
      model: "claude-sonnet-5-5",
      tokensIn: 1580,
      tokensOut: 96,
      seconds: 1.118,
      costGbp: "0.006180",
      outcome: "succeeded",
      answerId: QUESTION_RECORD_ID,
    },
    {
      workspaceId: WS_ID,
      id: "01J6TTTTTTTTTTTTTTTTTTTTT2",
      calledAt: NOW,
      purpose: "extraction",
      modelChoiceId: "model-choice-extract",
      model: "claude-sonnet-5-5",
      tokensIn: 7310,
      tokensOut: 0,
      seconds: 30.004,
      costGbp: "0.02193",
      outcome: "failed",
      runId: "a run of the worker's",
    },
  ],
  spendReservation: [
    {
      workspaceId: WS_ID,
      id: "01J6TTTTTTTTTTTTTTTTTTTTT3",
      takenAt: NOW,
      expiresAt: new Date(NOW.getTime() + 600_000),
      purpose: "judging",
      modelChoiceId: "model-choice-judge",
      model: "claude-sonnet-5-5",
      mostTokensIn: 40_000,
      mostTokensOut: 2_000,
      gbpPerMillionIn: "3",
      gbpPerMillionOut: "15",
      reservedGbp: "0.15",
      answerId: QUESTION_RECORD_ID,
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
  authenticator: [
    { id: "authenticator-1", secret: "sealed", backupCodes: "sealed", userId: USER_ID },
  ],
  passkey: [
    {
      id: PASSKEY_ID,
      publicKey: "public-key",
      userId: USER_ID,
      credentialID: "credential-1",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    },
  ],
  passkeyLastUse: [{ passkeyId: PASSKEY_ID, at: NOW }],
  recoveryCode: [{ id: "recovery-code-1", userId: USER_ID, codeHash: "a".repeat(64) }],
  secondFactorThrottle: [{ userId: USER_ID, kind: "authenticator", failures: 6, waitUntil: NOW }],
  workspaceLastActive: [{ workspaceId: WS_ID, userId: USER_ID, at: NOW }],
  testWorkspaceMark: [{ workspaceId: WS_ID, testingDomain: "people.testing.invalid" }],
  mcpCallCounter: [{ workspaceId: WS_ID, tokenId: "jti-1", windowStart: NOW, count: 1 }],
  invitationEmailCounter: [
    { workspaceId: WS_ID, key: "a".repeat(64), windowStart: NOW, count: 1 },
    { workspaceId: WS_ID, key: "workspace", windowStart: NOW, count: 50 },
  ],
  ingressCounter: [{ scope: "ip", key: "203.0.113.1", windowStart: NOW, count: 1 }],
  contractStamp: [{ onlyRow: true, digest: "a".repeat(64), stampedAt: NOW }],
  sweepPass: [
    {
      id: "01J6SWEEPPASS0000000000000",
      at: NOW,
      uploadSweep: "list",
      workspaces: 3,
      refused: 0,
      found: 2,
      removed: 0,
      generations: 1,
    },
  ],
  backup: [
    {
      kind: "backup",
      store: "postgres",
      startedAt: NOW,
      finishedAt: NOW,
      outcome: "ok",
      bytes: 1024,
      location: "pg/hourly/pg-20260924T020000Z.dump.age",
      reportUrl: null,
      containsPersonalData: true,
      expiresAt: NOW,
      rtoMinutes: null,
    },
  ],

  identityAuditEvent: [
    {
      id: "01J6GGGGGGGGGGGGGGGGGGGGG5",
      action: "people.person.named",
      actor: `human:${USER_ID}`,
      subjectId: USER_ID,
      detail: {},
    },
  ],

  auditEvent: [
    {
      id: AUDIT_EVENT_ID,
      workspaceId: WS_ID,
      action: "people.member.role_changed",
      actor: `human:${USER_ID}`,
      subjectId: USER_ID,
      detail: { role: "Editor", previousRole: "Viewer" },
    },
    {
      id: "01J6GGGGGGGGGGGGGGGGGGGGG2",
      workspaceId: WS_ID,
      action: "platform.workspace.provisioned",
      actor: "process:better-answers-bootstrap",
      subjectId: WS_ID,
      detail: { adminUserId: USER_ID, role: "Admin" },
    },
    {
      id: "01J6GGGGGGGGGGGGGGGGGGGGG3",
      workspaceId: WS_ID,
      action: "knowledge.suggestion.accepted",
      actor: "better-answers-enrichment/1.2",
      subjectId: "01J6GGGGGGGGGGGGGGGGGGGGG4",
      detail: { confirmed: true, count: 3 },
      batchId: BATCH_ID,
    },
    {
      id: "01J6GGGGGGGGGGGGGGGGGGGGG6",
      workspaceId: WS_ID,
      action: "people.member.credentials_revoked",
      actor: `human:${USER_ID}`,
      subjectId: USER_ID,
      detail: {
        grants: [
          {
            clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
            workspaceId: WS_ID,
            issuedAt: "2026-09-26T09:00:00.000Z",
          },
          {
            clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
            workspaceId: null,
            issuedAt: "2026-09-26T09:00:00.000Z",
          },
        ],
      },
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
  passage: [
    {
      id: "passage-1",
      workspaceId: WS_ID,
      content: "hello",
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5),
      embeddingModelChoiceId: "model-choice-embed",
      connectedSourceId: "connected-source-1",
    },
  ],

  connectedSource: [
    {
      workspaceId: WS_ID,
      id: CONNECTED_SOURCE_ID,
      publishedAt: NOW,
      sensitivity: "Restricted",
      audience: "everyone",
      name: "The board minutes",
      connector: "upload",
      destination: ["passage-index", "bundle"],
      retentionClass: "keep",
      state: "received",
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

      destination: ["map"],
      retentionClass: "mirror",
      state: "published",
    },
  ],

  sourceDocument: [
    {
      workspaceId: WS_ID,
      id: DOCUMENT_ID,
      connectedSourceId: CONNECTED_SOURCE_ID,
      sourceSystemId: "board-minutes-2026-03.md",
      title: "Board minutes, March 2026",
      mediaType: "text/markdown",
      byteSize: 4_096,
      originalKey: `documents/${DOCUMENT_ID.toLowerCase()}/original`,
    },
    {
      workspaceId: WS_ID,
      id: "01J6NNNNNNNNNNNNNNNNNNNNN2",
      connectedSourceId: CONNECTED_SOURCE_ID,
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
      narrowedTo: "Internal",
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
      identifiers: { emails: ["person@example.invalid"], names: ["A person"], other: [] },
    },
  ],

  conceptEvidence: [
    { workspaceId: WS_ID, iri: CONCEPT_IRI, sourceDocumentId: DOCUMENT_ID, locator: "p.4#para-2" },
  ],

  conceptSensitivityOverride: [
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

  conceptOwner: [
    { workspaceId: WS_ID, id: OWNER_ID, collection: "policy", iri: null, personId: USER_ID },
    { workspaceId: WS_ID, id: OVERRIDE_ID, collection: null, iri: CONCEPT_IRI, personId: USER_ID },
  ],
  guideDefinition: [
    {
      workspaceId: WS_ID,
      id: GUIDE_ID,
      kind: "bid",
      collection: "bids",
      template: "bid-response",
      subjectIri: CONCEPT_IRI,
    },
  ],
  guideRole: [
    {
      workspaceId: WS_ID,
      guideId: GUIDE_ID,
      role: "Editor",
      defaultLayer: "assembled",
      actionThreshold: "human-reviewed",
    },
  ],
  guideSection: [
    {
      workspaceId: WS_ID,
      guideId: GUIDE_ID,
      id: SECTION_ID,
      parentId: null,
      ordinal: 0,
      prompt: "Describe how you insure the work.",
      roleLabel: "say",
      usageNote: null,
      layers: ["assembled", "quoted"],
    },
    {
      workspaceId: WS_ID,
      guideId: GUIDE_ID,
      id: "insurance-limits",
      parentId: SECTION_ID,
      ordinal: 0,
      prompt: "State the limits.",
      roleLabel: "know",
      usageNote: "Quote the certificate.",
      layers: ["quoted"],
      hidden: true,
    },
  ],
  guideExpectedFact: [
    {
      workspaceId: WS_ID,
      id: EXPECTED_FACT_ID,
      guideId: GUIDE_ID,
      sectionId: SECTION_ID,
      ordinal: 0,
      name: "Insurance cover",
      kind: "Policy",
      tags: ["insurance"],
      collection: null,
      atLeast: 2,
    },
  ],
  guideDefinitionVersion: [
    {
      workspaceId: WS_ID,
      guideId: GUIDE_ID,
      version: 1,
      actor: `human:${USER_ID}`,
      note: null,
      content: { sections: [SECTION_ID] },
    },
  ],
  writeUp: [
    {
      workspaceId: WS_ID,
      id: WRITE_UP_ID,
      publishedAt: NOW,
      sensitivity: "Internal",
      audience: "everyone",
      home: "section",
      guideId: GUIDE_ID,
      sectionId: SECTION_ID,
      questionId: null,
      needsReview: "concept-changed",
    },
    {
      workspaceId: WS_ID,
      id: RESPONSE_WRITE_UP_ID,
      sensitivity: "Internal",
      audience: "everyone",
      home: "response",
      guideId: null,
      sectionId: null,
      questionId: QUESTION_RECORD_ID,
    },
  ],
  writeUpInclude: [
    {
      workspaceId: WS_ID,
      writeUpId: WRITE_UP_ID,
      id: "i1",
      ordinal: 0,
      iri: CONCEPT_IRI,
      contentHash: CONTENT_SHA256,
      expectedFactId: EXPECTED_FACT_ID,
      wordingHeading: "Our cover",
      wordingHash: CONTENT_SHA256,
    },
  ],
  writeUpVersion: [
    {
      workspaceId: WS_ID,
      writeUpId: WRITE_UP_ID,
      version: 1,
      actor: `human:${USER_ID}`,
      note: "First draft.",
      markdown: "We hold public liability cover of five million pounds.",
      includes: [{ iri: CONCEPT_IRI, contentHash: CONTENT_SHA256 }],
    },
  ],
  usage: [
    {
      workspaceId: WS_ID,
      id: USAGE_ID,
      actor: `human:${USER_ID}`,
      act: "copied",
      writeUpId: WRITE_UP_ID,
      writeUpVersion: 1,
      iri: null,
    },
    {
      workspaceId: WS_ID,
      id: CONCEPT_USAGE_ID,
      actor: `human:${USER_ID}`,
      act: "exported",
      writeUpId: null,
      writeUpVersion: null,
      iri: CONCEPT_IRI,
    },
  ],
  questionAsked: [
    {
      workspaceId: WS_ID,
      id: QUESTION_RECORD_ID,
      askedAt: ASKED_IN_THE_MONTH_THE_MIGRATION_PARTITIONED,
      askedBy: `human:${USER_ID}`,
      transport: "mcp",
      predicateRole: "Viewer",
    },
    {
      workspaceId: WS_ID,
      id: DRAFTED_RECORD_ID,
      askedAt: ASKED_IN_THE_MONTH_THE_MIGRATION_PARTITIONED,
      askedBy: `human:${USER_ID}`,
      transport: "trpc",
      collections: ["audits"],
      predicateRole: "Editor",
      predicateGroups: [GROUP_ID],
      completedAt: ASKED_IN_THE_MONTH_THE_MIGRATION_PARTITIONED,
      verdict: "related",
      judgeState: "judged",
      concepts: [
        {
          iri: CONCEPT_IRI,
          contentHash: CONTENT_SHA256,
          trust: {
            tier: "human-reviewed",
            status: "current",
            verifiedAt: "2026-05-02T09:00:00.000Z",
            rider: null,
          },
          judged: "no",
        },
      ],
      unmappedPassages: [`${DOCUMENT_ID}/chars:0-120`],
      mapState: { state: "unavailable_since", since: "2026-05-02T09:00:00.000Z" },
    },
  ],
  questionContent: [
    {
      workspaceId: WS_ID,
      recordId: QUESTION_RECORD_ID,
      askedAt: ASKED_IN_THE_MONTH_THE_MIGRATION_PARTITIONED,
      question: "How long are audit logs kept?",
    },
    {
      workspaceId: WS_ID,
      recordId: DRAFTED_RECORD_ID,
      askedAt: ASKED_IN_THE_MONTH_THE_MIGRATION_PARTITIONED,
      question: "How long are audit logs kept?",
      drafted: [{ sentence: "Audit logs are kept for a year.", concepts: [CONCEPT_IRI] }],
    },
  ],
  questionFeedback: [
    {
      workspaceId: WS_ID,
      id: "01J6QQQQQQQQQQQQQQQQQQQQQ3",
      recordId: QUESTION_RECORD_ID,
      givenAt: NOW,
      givenBy: `human:${USER_ID}`,
      verdict: "helpful",
    },
    {
      workspaceId: WS_ID,
      id: "01J6QQQQQQQQQQQQQQQQQQQQQ4",
      recordId: DRAFTED_RECORD_ID,
      givenAt: NOW,
      givenBy: `human:${USER_ID}`,
      verdict: "flag",
      reason: "wrong",
      note: "The period changed in May.",
      disputedSentence: "Audit logs are kept for a year.",
      disputedConcept: CONCEPT_IRI,
      closedAs: "no-fault-in-the-knowledge",
      closedAt: NOW,
    },
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
      verifiedAt: NOW,
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
  mapGeneration: [{ workspaceId: WS_ID, liveGen: 1 }],

  mapNode: [
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

  mapEdge: [
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

  mapUnresolvedReference: [
    {
      workspaceId: WS_ID,
      gen: 1,
      fromUid: CONCEPT_IRI,
      relation: "link",
      ordinal: 0,
      targetPath: "knowledge/later.md",
    },
    {
      workspaceId: WS_ID,
      gen: 1,
      fromUid: CONCEPT_IRI,
      relation: "lineage",
      ordinal: 0,
      targetPath: "knowledge/policy.md",
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
      kind: "suggested-concept",
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

/** `hasOwn` is what `keyof` means at runtime, so the filter narrows rather than asserts. */
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

  it("has an accepted row for exactly the registered tables", () => {
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

type ColumnShape = { readonly dataType: string; readonly name: string; readonly notNull: boolean };

const admitsNull = (
  field: z.ZodType,
  column: ColumnShape | undefined,
  checks: readonly string[],
): boolean =>
  field.safeParse(null).success &&
  !(
    column?.notNull === true &&
    checks.some((check) => check.includes(`jsonb_typeof(${column.name}) = '`))
  );

describe("3 — optionality and nullability agree, per key, at runtime", () => {
  for (const name of registryNames) {
    for (const form of forms) {
      it(`${name}.${form} accepts undefined and null exactly where the column does`, () => {
        const refinedShape = boundarySchemas[name][form].shape;
        const unrefinedShape: Readonly<Record<string, z.ZodType>> = unrefinedOf(name)[form].shape;
        const { table } = boundarySchemas[name];
        const columns: Readonly<Record<string, ColumnShape>> = getTableColumns(table);
        const checks = getTableConfig(table).checks.map(
          (constraint) => new PgDialect().sqlToQuery(constraint.value).sql,
        );
        const typed = Object.entries<z.ZodType>(refinedShape).filter(
          ([key]) => columns[key]?.dataType !== "custom",
        );
        for (const [key, refinedField] of typed) {
          const unrefinedField = unrefinedShape[key];
          assert(unrefinedField !== undefined, `no generated field for ${key}`);
          expect({
            key,
            undefined: refinedField.safeParse(undefined).success,
            null: refinedField.safeParse(null).success,
          }).toEqual({
            key,
            undefined: unrefinedField.safeParse(undefined).success,
            null: admitsNull(unrefinedField, columns[key], checks),
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
        "modelChoice",
        "modelKey",
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
        "authenticator",
        "passkey",
        "passkeyLastUse",
        "recoveryCode",
        "secondFactorThrottle",
        "workspaceLastActive",
        "testWorkspaceMark",
        "mcpCallCounter",
        "invitationEmailCounter",
        "ingressCounter",
        "contractStamp",
        "sweepPass",
        "backup",
        "auditEvent",
        "identityAuditEvent",
        "accessRequest",

        "conceptIdentity",
        "conceptIndex",
        "bundleCommit",

        "connectedSource",
        "sourceDocument",
        "evidence",
        "conceptVerification",

        "mapGeneration",
        "mapNode",
        "mapEdge",
        "mapUnresolvedReference",

        "job",

        "suggestion",
        "conceptWriteRequest",

        "finding",

        "subjectRequest",
        "erasureRequest",

        "suppression",
        "conceptEvidence",
        "conceptSensitivityOverride",
        "conceptOwner",
        "guideDefinition",
        "guideRole",
        "guideSection",
        "guideExpectedFact",
        "guideDefinitionVersion",
        "writeUp",
        "writeUpInclude",
        "writeUpVersion",
        "usage",
        "questionAsked",
        "questionContent",
        "questionFeedback",
        "modelPrice",
        "decisionThreshold",
        "llmCall",
        "spendReservation",
        "passage",
      ] as const;
      expect(insertOrder.toSorted()).toEqual(registryNames.toSorted());

      const insertAccepted = async (name: (typeof insertOrder)[number]): Promise<void> => {
        for (const row of acceptedRows[name]) {
          const parsed = boundarySchemas[name].insert.parse(row);
          await database.insert(boundarySchemas[name].table).values(parsed);
          accepted += 1;
        }
      };
      for (const name of insertOrder.filter((one) => one !== "passage")) {
        await insertAccepted(name);
      }
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_ID]);
      await client.query("SELECT create_workspace_partition($1)", [WS_ID]);
      await insertAccepted("passage");
      expect(accepted).toBe(Object.values(acceptedRows).flat().length);
    });
  });
});

describe("the rejection half: a violated refinement never reaches Postgres", () => {
  const rejectedRows = {
    workspace: [
      { id: "not-a-ulid", name: "Workspace A", shortName: "a" },
      { id: WS_ID, name: "   ", shortName: "a" },
    ],

    modelChoice: [
      { ...acceptedRows.modelChoice[0], dimensions: 0 },
      { ...acceptedRows.modelChoice[0], retentionTail: "   " },
    ],

    modelKey: [
      { ...acceptedRows.modelKey[0], provider: "openai" },
      { ...acceptedRows.modelKey[0], sealed: "a frame written as text" },
    ],

    llmCall: [
      { ...acceptedRows.llmCall[0], costGbp: "0.1e-3" },
      { ...acceptedRows.llmCall[0], outcome: "cancelled" },
      { ...acceptedRows.llmCall[0], tokensIn: -1 },
    ],
    spendReservation: [{ ...acceptedRows.spendReservation[0], reservedGbp: "-0.15" }],
    modelPrice: [
      { ...acceptedRows.modelPrice[0], provider: "openai" },
      { ...acceptedRows.modelPrice[0], effectiveFrom: "1 October 2026" },
    ],
    decisionThreshold: [
      { ...acceptedRows.decisionThreshold[0], threshold: 0 },
      { ...acceptedRows.decisionThreshold[0], threshold: 1 },
      { ...acceptedRows.decisionThreshold[0], threshold: 1.5 },
      { ...acceptedRows.decisionThreshold[0], provider: "openai" },
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
    contractStamp: [
      { ...acceptedRows.contractStamp[0], digest: "A".repeat(64) },
      { ...acceptedRows.contractStamp[0], digest: "a".repeat(63) },
      { ...acceptedRows.contractStamp[0], onlyRow: false },
    ],
    sweepPass: [
      { ...acceptedRows.sweepPass[0], id: "a-pass" },
      { ...acceptedRows.sweepPass[0], uploadSweep: "delete" },
      { ...acceptedRows.sweepPass[0], found: -1 },
      { ...acceptedRows.sweepPass[0], removed: 0.5 },
    ],
    backup: [
      { ...acceptedRows.backup[0], kind: "snapshot" },
      { ...acceptedRows.backup[0], store: "tape" },
      { ...acceptedRows.backup[0], outcome: "partial" },
      { ...acceptedRows.backup[0], bytes: -1 },
      { ...acceptedRows.backup[0], bytes: 0.5 },
    ],
    mcpCallCounter: [{ ...acceptedRows.mcpCallCounter[0], count: -1 }],
    testWorkspaceMark: [
      { ...acceptedRows.testWorkspaceMark[0], workspaceId: "not-a-ulid" },
      { ...acceptedRows.testWorkspaceMark[0], testingDomain: "People.Testing.Invalid" },
      { ...acceptedRows.testWorkspaceMark[0], testingDomain: "people" },
      { ...acceptedRows.testWorkspaceMark[0], testingDomain: "person@people.invalid" },
    ],
    invitationEmailCounter: [
      { ...acceptedRows.invitationEmailCounter[0], workspaceId: "not-a-ulid" },
      { ...acceptedRows.invitationEmailCounter[0], key: "   " },
      { ...acceptedRows.invitationEmailCounter[0], count: -1 },
    ],

    auditEvent: [
      { ...acceptedRows.auditEvent[0], id: "audit-1" },
      { ...acceptedRows.auditEvent[0], action: "billing.invoice.sent" },
      { ...acceptedRows.auditEvent[0], action: "people.member" },
      { ...acceptedRows.auditEvent[0], actor: "human:priya@example.invalid" },
      { ...acceptedRows.auditEvent[0], actor: USER_ID },
      { ...acceptedRows.auditEvent[0], actor: "Priya Patel" },
      { ...acceptedRows.auditEvent[0], detail: { person: { name: "Priya" } } },
      { ...acceptedRows.auditEvent[0], detail: { grants: [{ assistant: { name: "Claude" } }] } },
      { ...acceptedRows.auditEvent[0], detail: { grants: [{ count: 3 }] } },
      { ...acceptedRows.auditEvent[2], batchId: "batch-1" },
    ],
    identityAuditEvent: [
      { ...acceptedRows.identityAuditEvent[0], id: "named-1" },
      { ...acceptedRows.identityAuditEvent[0], action: "billing.person.named" },
      { ...acceptedRows.identityAuditEvent[0], actor: "Priya Patel" },
      { ...acceptedRows.identityAuditEvent[0], detail: { person: { name: "Priya" } } },
    ],

    accessRequest: [
      { ...acceptedRows.accessRequest[0], id: "request-1" },
      { ...acceptedRows.accessRequest[0], reason: "" },
      { ...acceptedRows.accessRequest[0], reason: "   " },
      { ...acceptedRows.accessRequest[0], reason: "x".repeat(ACCESS_REQUEST_REASON_MAX + 1) },
      { ...acceptedRows.accessRequest[0], status: "expired" },
      { ...acceptedRows.accessRequest[0], requesterId: "priya@example.invalid" },
    ],
    passage: [
      {
        ...acceptedRows.passage[0],
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0.5),
      },
      { ...acceptedRows.passage[0], embeddingModelChoiceId: "   " },
    ],

    mapGeneration: [{ ...acceptedRows.mapGeneration[0], liveGen: 0 }],
    mapNode: [
      { ...acceptedRows.mapNode[0], label: "Widget" },
      { ...acceptedRows.mapNode[0], sensitivity: "Secret" },
      { ...acceptedRows.mapNode[0], gen: 0 },
      { ...acceptedRows.mapNode[0], gen: null },
      { ...acceptedRows.mapNode[1], gen: 1 },
    ],
    mapEdge: [
      { ...acceptedRows.mapEdge[0], label: "RELATES_TO" },
      { ...acceptedRows.mapEdge[0], sensitivity: "Secret" },
      { ...acceptedRows.mapEdge[0], fromUid: "   " },
      { ...acceptedRows.mapEdge[1], label: "source-entity:mentions" },
    ],
    mapUnresolvedReference: [
      { ...acceptedRows.mapUnresolvedReference[0], relation: "edge" },
      { ...acceptedRows.mapUnresolvedReference[0], ordinal: -1 },
      { ...acceptedRows.mapUnresolvedReference[0], gen: 0 },
      { ...acceptedRows.mapUnresolvedReference[0], fromUid: "expenses" },
      { ...acceptedRows.mapUnresolvedReference[0], targetPath: "   " },
    ],

    suggestion: [
      { ...acceptedRows.suggestion[0], kind: "merge" },
      { ...acceptedRows.suggestion[0], proposer: "ada@acme.invalid" },
      { ...acceptedRows.suggestion[0], reason: "x".repeat(SUGGESTION_REASON_MAX + 1) },
    ],

    finding: [
      { ...acceptedRows.finding[0], tier: "sometimes" },
      { ...acceptedRows.finding[1], reviewState: "ignored" },
      { ...acceptedRows.finding[0], charStart: 1.5 },
      { ...acceptedRows.finding[0], charEnd: 0 },
      { ...acceptedRows.finding[0], score: 1.1 },
      { ...acceptedRows.finding[0], category: "   " },
      { ...acceptedRows.finding[1], reviewedBy: "priya@example.invalid" },
      { ...acceptedRows.finding[1], reviewReason: "x".repeat(FINDING_REASON_MAX + 1) },
      { ...acceptedRows.finding[2], restoreReason: "x".repeat(FINDING_REASON_MAX + 1) },
    ],

    connectedSource: [
      {
        ...acceptedRows.connectedSource[1],
        rulesInForce: { default_on: true, default_off: false, always: false },
      },
      { ...acceptedRows.connectedSource[1], rulesInForce: { default_on: true } },
      { ...acceptedRows.connectedSource[1], rulesInForce: { default_on: true, default_off: "no" } },

      { ...acceptedRows.connectedSource[0], connector: "sharepoint" },
      { ...acceptedRows.connectedSource[0], name: "   " },
      { ...acceptedRows.connectedSource[0], destination: ["passage-index", "warehouse"] },
      { ...acceptedRows.connectedSource[0], destination: [] },
      { ...acceptedRows.connectedSource[0], retentionClass: "forever" },
      { ...acceptedRows.connectedSource[0], state: "reviewing" },
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
      { ...acceptedRows.sourceDocument[1], narrowedTo: "Secret" },
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
    guideDefinition: [
      { ...acceptedRows.guideDefinition[0], id: "bid-guide" },
      { ...acceptedRows.guideDefinition[0], collection: "bids/2026" },
      { ...acceptedRows.guideDefinition[0], subjectIri: "expenses" },
    ],
    guideRole: [
      { ...acceptedRows.guideRole[0], role: "Owner" },
      { ...acceptedRows.guideRole[0], defaultLayer: "summarised" },
      { ...acceptedRows.guideRole[0], actionThreshold: "verified" },
    ],
    guideSection: [
      { ...acceptedRows.guideSection[0], layers: [] },
      { ...acceptedRows.guideSection[0], layers: ["drafted"] },
      { ...acceptedRows.guideSection[0], roleLabel: "tell" },
      { ...acceptedRows.guideSection[0], ordinal: -1 },
      { ...acceptedRows.guideSection[1], usageNote: "   " },
    ],
    guideExpectedFact: [
      { ...acceptedRows.guideExpectedFact[0], atLeast: 0 },
      { ...acceptedRows.guideExpectedFact[0], tags: [" "] },
      { ...acceptedRows.guideExpectedFact[0], collection: "a/b" },
      { ...acceptedRows.guideExpectedFact[0], id: "insurance-cover" },
    ],
    guideDefinitionVersion: [
      { ...acceptedRows.guideDefinitionVersion[0], version: 0 },
      { ...acceptedRows.guideDefinitionVersion[0], actor: USER_ID },
    ],
    writeUp: [
      { ...acceptedRows.writeUp[0], home: "inbox" },
      { ...acceptedRows.writeUp[0], needsReview: "stale" },
      { ...acceptedRows.writeUp[1], questionId: "question-1" },
    ],
    writeUpInclude: [
      { ...acceptedRows.writeUpInclude[0], contentHash: "a".repeat(63) },
      { ...acceptedRows.writeUpInclude[0], wordingHash: "A".repeat(64) },
      { ...acceptedRows.writeUpInclude[0], wordingHeading: "  " },
      { ...acceptedRows.writeUpInclude[0], expectedFactId: "insurance-cover" },
    ],
    writeUpVersion: [
      { ...acceptedRows.writeUpVersion[0], version: 0 },
      { ...acceptedRows.writeUpVersion[0], actor: "priya@example.invalid" },
      { ...acceptedRows.writeUpVersion[0], note: "  " },
    ],
    usage: [
      { ...acceptedRows.usage[0], act: "viewed" },
      { ...acceptedRows.usage[0], writeUpVersion: 0 },
      { ...acceptedRows.usage[1], iri: "expenses" },
    ],
    questionAsked: [
      { ...acceptedRows.questionAsked[0], askedBy: USER_ID },
      { ...acceptedRows.questionAsked[0], transport: "email" },
      { ...acceptedRows.questionAsked[0], predicateRole: "Owner" },
      { ...acceptedRows.questionAsked[1], predicateGroups: ["group-1"] },
      { ...acceptedRows.questionAsked[0], collections: ["  "] },
      { ...acceptedRows.questionAsked[1], verdict: "evidence" },
      { ...acceptedRows.questionAsked[1], judgeState: "failed" },
      { ...acceptedRows.questionAsked[1], unmappedPassages: [""] },
      { ...acceptedRows.questionAsked[1], mapState: { state: "unavailable_since" } },
      {
        ...acceptedRows.questionAsked[1],
        concepts: [{ ...acceptedRows.questionAsked[1].concepts[0], body: "The concept's text." }],
      },
      {
        ...acceptedRows.questionAsked[1],
        concepts: [
          {
            ...acceptedRows.questionAsked[1].concepts[0],
            trust: {
              ...acceptedRows.questionAsked[1].concepts[0].trust,
              verifiedBy: "Priya",
            },
          },
        ],
      },
    ],
    questionContent: [
      { ...acceptedRows.questionContent[0], question: "" },
      { ...acceptedRows.questionContent[0], recordId: "record-1" },
      {
        ...acceptedRows.questionContent[1],
        drafted: [{ sentence: "Audit logs are kept for a year.", concepts: [] }],
      },
    ],
    questionFeedback: [
      { ...acceptedRows.questionFeedback[0], verdict: "unhelpful" },
      { ...acceptedRows.questionFeedback[0], givenBy: "priya@example.invalid" },
      { ...acceptedRows.questionFeedback[1], reason: "rude" },
      { ...acceptedRows.questionFeedback[1], note: "   " },
      { ...acceptedRows.questionFeedback[1], disputedConcept: "expenses" },
      { ...acceptedRows.questionFeedback[1], closedAs: "fixed" },
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
  it("has exactly these columns, none for a personal detail", () => {
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

describe("what a flag on an answer holds", () => {
  it("names no one who closed it: the audit event does", () => {
    expect(Object.keys(boundarySchemas.questionFeedback.select.shape).toSorted()).toEqual(
      [
        "workspaceId",
        "id",
        "recordId",
        "givenAt",
        "givenBy",
        "verdict",
        "reason",
        "note",
        "disputedSentence",
        "disputedConcept",
        "closedAs",
        "closedAt",
      ].toSorted(),
    );
  });
});

describe("the rules in force a connected source carries", () => {
  const asKey = (tier: string) => tier.replaceAll("-", "_");
  const keyed: readonly string[] = RULES_IN_FORCE_KEYS;

  it("keys the column on the two tiers a source switches", () => {
    expect(RULES_IN_FORCE_KEYS).toEqual(["default_on", "default_off"]);
    expect(RULES_IN_FORCE_KEYS).toEqual(
      REDACTION_TIERS.filter((tier) => tier !== REDACTION_ALWAYS_TIER).map(asKey),
    );

    expect(REDACTION_TIERS.filter((tier) => !keyed.includes(asKey(tier)))).toEqual([
      REDACTION_ALWAYS_TIER,
    ]);
  });

  it("defaults to the safe set for an unconfigured connected source", () => {
    expect(RULES_IN_FORCE_DEFAULT).toEqual({ default_on: true, default_off: false });
    expect(
      boundarySchemas.connectedSource.select.shape.rulesInForce.safeParse(RULES_IN_FORCE_DEFAULT)
        .success,
    ).toBe(true);
  });
});

describe("the emails a suppression holds", () => {
  const holding = (count: number) =>
    boundarySchemas.suppression.insert.safeParse({
      ...acceptedRows.suppression[0],
      identifiers: {
        emails: Array.from({ length: count }, (_, at) => `p${at}@x.invalid`),
        names: [],
        other: [],
      },
    }).success;

  it("number at most a request's fifty plus an erasure's two", () => {
    expect([holding(52), holding(53)]).toEqual([true, false]);
  });
});

describe("the scopes an ingress counter row takes", () => {
  it("takes the person scope a signed-in caller is counted by", () => {
    const row = { ...acceptedRows.ingressCounter[0], scope: "person" };
    expect(boundarySchemas.ingressCounter.insert.safeParse(row).success).toBe(true);
  });
});

describe("who a subject request is about", () => {
  const stranger = acceptedRows.subjectRequest[1];

  it("takes a never-signed-in subject, with the id null or absent", () => {
    expect(boundarySchemas.subjectRequest.insert.safeParse(stranger).success).toBe(true);

    const { personId: _absent, ...omitted } = { ...stranger };
    expect(boundarySchemas.subjectRequest.insert.safeParse(omitted).success).toBe(true);
  });

  it("keeps the identifier set's three kinds apart", () => {
    const parsed = boundarySchemas.subjectRequest.insert.parse(stranger);
    expect(parsed.identifiers).toEqual({
      emails: ["priya@client.invalid"],
      names: ["Priya Nair"],
      other: ["07700 900123"],
    });
  });
});

describe("a __proto__ key in a concept's frontmatter", () => {
  const frontmatterOf = (json: string) =>
    boundarySchemas.conceptIndex.insert.safeParse({
      ...acceptedRows.conceptIndex[0],
      frontmatter: z.unknown().parse(JSON.parse(json)),
    });

  it("is kept like any other key, in an entry too", () => {
    const parsed = frontmatterOf(
      '{"title":"T","__proto__":"x","sources":[{"resource":"/s/a.pdf","__proto__":null}]}',
    );

    assert(parsed.success, "the frontmatter parses");
    expect(parsed.data.frontmatter).toEqual(
      Object.fromEntries([
        ["title", "T"],
        ["__proto__", "x"],
        [
          "sources",
          [
            Object.fromEntries([
              ["resource", "/s/a.pdf"],
              ["__proto__", null],
            ]),
          ],
        ],
      ]),
    );
    expect(Object.getPrototypeOf(parsed.data.frontmatter)).toBe(Object.prototype);
  });

  it.each([
    ["at the top level", '{"__proto__":{"deep":1}}'],
    ["inside an entry", '{"sources":[{"resource":"/s/a.pdf","__proto__":{"deep":1}}]}'],
  ])("refuses an object value %s", (_shape, json) => {
    expect(frontmatterOf(json).success).toBe(false);
  });

  it("keeps __proto__, ___proto__ and ____proto__ apart, in an entry too", () => {
    const parsed = frontmatterOf(
      '{"__proto__":"a","___proto__":"b","____proto__":"c",' +
        '"sources":[{"resource":"/s/a.pdf","__proto__":"d","___proto__":"e","____proto__":"f"}]}',
    );

    assert(parsed.success, "the frontmatter parses");
    expect(parsed.data.frontmatter).toEqual(
      Object.fromEntries([
        ["__proto__", "a"],
        ["___proto__", "b"],
        ["____proto__", "c"],
        [
          "sources",
          [
            Object.fromEntries([
              ["resource", "/s/a.pdf"],
              ["__proto__", "d"],
              ["___proto__", "e"],
              ["____proto__", "f"],
            ]),
          ],
        ],
      ]),
    );
  });
});

describe("a concept's frontmatter that is not a plain object", () => {
  it.each([
    ["an array", ["T"]],
    ["a Map", new Map([["title", "T"]])],
    ["a Date", new Date(0)],
  ])("is refused when it is %s", (_shape, frontmatter) => {
    expect(conceptFrontmatter.safeParse(frontmatter).success).toBe(false);
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

describe("the body bound's unit", () => {
  const astral = (characters: number) => "\u{1D11E}".repeat(characters);
  const bodyOf = (body: string) =>
    boundarySchemas.conceptIndex.insert.safeParse({ ...acceptedRows.conceptIndex[0], body });

  it("counts the characters `char_length` counts, not the units JavaScript measures", () => {
    const inside = astral(CONCEPT_BODY_MAX - 100);
    expect(inside.length).toBeGreaterThan(CONCEPT_BODY_MAX);
    expect(bodyOf(inside).success).toBe(true);

    expect(bodyOf(astral(CONCEPT_BODY_MAX + 1)).success).toBe(false);
  });

  it("refuses a body over the cap, taking one at it", () => {
    expect(bodyOf("x".repeat(CONCEPT_BODY_MAX + 1)).success).toBe(false);
    expect(bodyOf("x".repeat(CONCEPT_BODY_MAX)).success).toBe(true);
  });
});

describe("the customType exception, per shape", () => {
  const tooShort = Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0);

  it("passage.select requires an embedding of the model choice's width", () => {
    const row = {
      ...acceptedRows.passage[0],
      publishedAt: null,
      audienceGroups: null,
      sourceDocumentId: null,
      locator: null,
      ordinal: null,
      charStart: null,
      charEnd: null,
    };
    const select = boundarySchemas.passage.select;
    expect(select.safeParse(row).success).toBe(true);
    expect(select.safeParse({ ...row, embedding: undefined }).success).toBe(false);
    expect(select.safeParse({ ...row, embedding: tooShort }).success).toBe(false);
  });

  it("passage.insert requires an embedding of the model choice's width", () => {
    const row = acceptedRows.passage[0];
    const insert = boundarySchemas.passage.insert;
    expect(insert.safeParse(row).success).toBe(true);
    expect(insert.safeParse({ ...row, embedding: undefined }).success).toBe(false);
    expect(insert.safeParse({ ...row, embedding: tooShort }).success).toBe(false);
  });

  it("passage.update skips an absent embedding and checks a present one", () => {
    const update = boundarySchemas.passage.update;
    expect(update.safeParse({ content: "edited" }).success).toBe(true);
    expect(update.safeParse({ embedding: tooShort }).success).toBe(false);
  });

  it("passage.select reads a row with or without search", () => {
    const row = {
      ...acceptedRows.passage[0],
      sourceDocumentId: null,
      locator: null,
      ordinal: null,
      charStart: null,
      charEnd: null,
    };
    const select = boundarySchemas.passage.select;
    expect(select.safeParse({ ...row, search: "any text" }).success).toBe(true);
    expect(select.safeParse(row).success).toBe(true);
  });

  it("passage.insert and update carry no search key", () => {
    expect(Object.keys(boundarySchemas.passage.insert.shape)).not.toContain("search");
    expect(Object.keys(boundarySchemas.passage.update.shape)).not.toContain("search");
  });

  it("conceptIndex.select reads a row with or without search", () => {
    const row = {
      ...acceptedRows.conceptIndex[0],
      audienceGroups: null,
      updatedAt: NOW,
      collection: null,
    };
    const select = boundarySchemas.conceptIndex.select;
    expect(select.safeParse({ ...row, search: "'expens':1A" }).success).toBe(true);
    expect(select.safeParse(row).success).toBe(true);
    expect(select.safeParse({ ...row, search: 1 }).success).toBe(false);
  });

  it("conceptIndex.insert and update drop a search the row sets", () => {
    const forged = { search: "'forged':1A" };
    const inserted = boundarySchemas.conceptIndex.insert.parse({
      ...acceptedRows.conceptIndex[0],
      ...forged,
    });
    const updated = boundarySchemas.conceptIndex.update.parse(forged);
    expect(Object.keys(inserted)).not.toContain("search");
    expect(Object.keys(updated)).not.toContain("search");
  });

  it("modelKey.select and insert require a sealed frame of bytes", () => {
    const row = acceptedRows.modelKey[0];
    for (const form of [boundarySchemas.modelKey.select, boundarySchemas.modelKey.insert]) {
      expect(form.safeParse(row).success).toBe(true);
      expect(form.safeParse({ ...row, sealed: Buffer.from(row.sealed) }).success).toBe(true);
      expect(form.safeParse({ ...row, sealed: undefined }).success).toBe(false);
      expect(form.safeParse({ ...row, sealed: null }).success).toBe(false);
    }
  });

  it("modelKey.update skips an absent frame and checks a present one", () => {
    const update = boundarySchemas.modelKey.update;
    expect(update.safeParse({ provider: "mistral" }).success).toBe(true);
    expect(update.safeParse({ sealed: "a frame written as text" }).success).toBe(false);
  });
});

describe("5 — the inferred type is pinned", () => {
  type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
  type NoneOf<T extends never> = T;

  type BrandSpelledApartFromIds<Brand extends string> = string & z.core.$brand<Brand>;
  type WorkspaceId = BrandSpelledApartFromIds<"WorkspaceId">;
  type UserId = BrandSpelledApartFromIds<"UserId">;
  type GroupId = BrandSpelledApartFromIds<"GroupId">;
  type ConnectedSourceId = BrandSpelledApartFromIds<"ConnectedSourceId">;
  type WriteUpId = BrandSpelledApartFromIds<"WriteUpId">;
  type AuditEventId = BrandSpelledApartFromIds<"AuditEventId">;
  type AccessRequestId = BrandSpelledApartFromIds<"AccessRequestId">;
  type ConceptIri = BrandSpelledApartFromIds<"ConceptIri">;

  type PinnedIds = {
    workspaceId: WorkspaceId;
    userId: UserId;
    groupId: GroupId;
    connectedSourceId: ConnectedSourceId;
    writeUpId: WriteUpId;
    auditEventId: AuditEventId;
    accessRequestId: AccessRequestId;
    conceptIri: ConceptIri;
  };
  type _idsCarryThePinnedBrands = NoneOf<
    {
      [K in keyof typeof ids]: Equal<z.output<(typeof ids)[K]>, PinnedIds[K]> extends true
        ? never
        : K;
    }[keyof typeof ids]
  >;

  const jsonProbe = createSelectSchema(pgTable("json_probe", { value: jsonb("value").notNull() }));
  type UnrefinedJson = z.infer<typeof jsonProbe>["value"];

  type Family = "people" | "knowledge" | "sources" | "platform";
  type AuditAction = `${Family}.${string}.${string}`;
  type AuditDetail = Record<
    string,
    string | number | boolean | Record<string, string | null>[]
  > | null;
  type Sensitivity = "Public" | "Internal" | "Restricted";
  type Frontmatter = Record<
    string,
    string | number | boolean | null | string[] | Record<string, string | number | boolean | null>[]
  > | null;
  type SubjectIdentifiers = { emails: string[]; names: string[]; other: string[] };
  type JobOutcomeScalar = string | number | boolean | null;
  type JobOutcome = Record<
    string,
    JobOutcomeScalar | JobOutcomeScalar[] | Record<string, JobOutcomeScalar>[]
  > | null;

  type SelectShapes = {
    workspace: {
      id: WorkspaceId;
      name: string;
      shortName: string;
      logo: string | null;
      createdAt: Date;
      metadata: string | null;
    };
    modelChoice: {
      id: string;
      workspaceId: WorkspaceId;
      purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
      provider: string;
      model: string;
      dimensions: number | null;
      retentionTail: string | null;
    };
    modelKey: {
      workspaceId: WorkspaceId;
      provider: "anthropic" | "mistral" | "cloudflare";
      sealed: Uint8Array<ArrayBuffer>;
    };
    llmCall: {
      workspaceId: WorkspaceId;
      id: string;
      calledAt: Date;
      purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
      modelChoiceId: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      seconds: number;
      costGbp: string;
      outcome: "succeeded" | "failed";
      runId: string | null;
      answerId: string | null;
    };
    spendReservation: {
      workspaceId: WorkspaceId;
      id: string;
      takenAt: Date;
      expiresAt: Date;
      purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
      modelChoiceId: string;
      model: string;
      mostTokensIn: number;
      mostTokensOut: number;
      gbpPerMillionIn: string;
      gbpPerMillionOut: string;
      reservedGbp: string;
      runId: string | null;
      answerId: string | null;
    };
    modelPrice: {
      provider: "anthropic" | "mistral" | "cloudflare";
      model: string;
      effectiveFrom: string;
      gbpPerMillionIn: string;
      gbpPerMillionOut: string;
    };
    decisionThreshold: {
      provider: "anthropic" | "mistral" | "cloudflare";
      model: string;
      threshold: number & z.core.$brand<"DecisionThreshold">;
    };
    workspaceConfig: { workspaceId: WorkspaceId; key: string; value: string; updatedAt: Date };
    passage: {
      id: string;
      workspaceId: WorkspaceId;
      content: string;
      embedding: number[] | null;
      embeddingModelChoiceId: string | null;
      connectedSourceId: string;
      sourceDocumentId: string | null;
      locator: string | null;
      ordinal: number | null;
      charStart: number | null;
      charEnd: number | null;
      search?: string | undefined;
    };
    auditEvent: {
      id: AuditEventId;
      workspaceId: WorkspaceId;
      action: AuditAction;
      family: Family;
      actor: string;
      subjectKind: string;
      subjectId: string;
      at: Date;
      detail: AuditDetail;
      batchId: string | null;
    };
    identityAuditEvent: {
      id: AuditEventId;
      action: AuditAction;
      family: Family;
      actor: string;
      subjectKind: string;
      subjectId: string;
      at: Date;
      detail: AuditDetail;
      batchId: string | null;
    };
    user: {
      id: UserId;
      name: string;
      email: string;
      emailVerified: boolean;
      image: string | null;
      createdAt: Date;
      updatedAt: Date;
      credentialsRevokedAt: Date | null;
      operator: boolean;
      authenticatorEnabled: boolean;
      passkeyOfferDismissedAt: Date | null;
      recoveryCodesAcknowledged: boolean;
      restoreRequiredAt: Date | null;
      promotedAt: Date | null;
    };
    member: {
      id: string;
      workspaceId: WorkspaceId;
      userId: UserId;
      role: "Admin" | "Editor" | "Viewer";
      createdAt: Date;
      credentialsRevokedAt: Date | null;
    };
    group: {
      id: GroupId;
      workspaceId: WorkspaceId;
      name: string;
      origin: "admin-curated" | "audience-minted";
      createdAt: Date;
    };
    groupMember: { workspaceId: WorkspaceId; groupId: GroupId; userId: UserId; addedAt: Date };
    mcpCallCounter: { workspaceId: WorkspaceId; tokenId: string; windowStart: Date; count: number };
    invitationEmailCounter: {
      workspaceId: WorkspaceId;
      key: string;
      windowStart: Date;
      count: number;
    };
    ingressCounter: {
      scope: "ip" | "email" | "person" | "link";
      key: string;
      windowStart: Date;
      count: number;
    };
    contractStamp: { onlyRow: true; digest: string; stampedAt: Date };
    sweepPass: {
      id: string;
      at: Date;
      uploadSweep: "list" | "remove";
      workspaces: number;
      refused: number;
      found: number;
      removed: number;
      generations: number;
    };
    backup: {
      kind: "backup" | "drill" | "restore";
      store: "postgres" | "objectstore" | "git" | "git-mirror" | "all";
      startedAt: Date;
      finishedAt: Date;
      outcome: "ok" | "failed";
      bytes: number | null;
      location: string | null;
      reportUrl: string | null;
      containsPersonalData: boolean;
      expiresAt: Date | null;
      rtoMinutes: number | null;
    };
    session: {
      id: string;
      expiresAt: Date;
      token: string;
      createdAt: Date;
      updatedAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
      userId: string;
      activeWorkspaceId: string | null;
      secondFactorConfirmedAt: Date | null;
      pendingSince: Date | null;
      setupGrantedAt: Date | null;
    };
    account: {
      id: string;
      accountId: string;
      providerId: string;
      userId: string;
      accessToken: string | null;
      refreshToken: string | null;
      idToken: string | null;
      accessTokenExpiresAt: Date | null;
      refreshTokenExpiresAt: Date | null;
      scope: string | null;
      password: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    verification: {
      id: string;
      identifier: string;
      value: string;
      expiresAt: Date;
      createdAt: Date;
      updatedAt: Date;
    };
    jwks: {
      id: string;
      publicKey: string;
      privateKey: string;
      createdAt: Date;
      expiresAt: Date | null;
      alg: string | null;
      crv: string | null;
    };
    invitation: {
      id: string;
      workspaceId: string;
      email: string;
      role: string | null;
      status: string;
      expiresAt: Date;
      createdAt: Date;
      inviterId: string;
    };
    oauthClient: {
      id: string;
      clientId: string;
      clientSecret: string | null;
      clientDiscoveryId: string | null;
      disabled: boolean | null;
      skipConsent: boolean | null;
      enableEndSession: boolean | null;
      subjectType: string | null;
      scopes: string[] | null;
      clientCredentialsScopes: string[] | null;
      userId: string | null;
      createdAt: Date | null;
      updatedAt: Date | null;
      name: string | null;
      uri: string | null;
      icon: string | null;
      contacts: string[] | null;
      tos: string | null;
      policy: string | null;
      softwareId: string | null;
      softwareVersion: string | null;
      softwareStatement: string | null;
      redirectUris: string[];
      postLogoutRedirectUris: string[] | null;
      backchannelLogoutUri: string | null;
      backchannelLogoutSessionRequired: boolean | null;
      tokenEndpointAuthMethod: string | null;
      applicationType: string | null;
      jwks: string | null;
      jwksUri: string | null;
      grantTypes: string[] | null;
      responseTypes: string[] | null;
      requirePKCE: boolean | null;
      dpopBoundAccessTokens: boolean | null;
      referenceId: string | null;
      metadata: UnrefinedJson;
    };
    oauthResource: {
      id: string;
      identifier: string;
      name: string;
      accessTokenTtl: number | null;
      refreshTokenTtl: number | null;
      signingAlgorithm: string | null;
      signingKeyId: string | null;
      allowedScopes: string[] | null;
      customClaims: UnrefinedJson;
      dpopBoundAccessTokensRequired: boolean | null;
      disabled: boolean | null;
      createdAt: Date | null;
      updatedAt: Date | null;
      policyVersion: number | null;
      metadata: UnrefinedJson;
    };
    oauthClientResource: {
      id: string;
      clientId: string;
      resourceId: string;
      metadata: UnrefinedJson;
      createdAt: Date | null;
    };
    oauthRefreshToken: {
      id: string;
      token: string;
      clientId: string;
      sessionId: string | null;
      userId: string;
      referenceId: string | null;
      authorizationCodeId: string | null;
      resources: string[] | null;
      requestedUserInfoClaims: string[] | null;
      expiresAt: Date;
      createdAt: Date;
      revoked: Date | null;
      rotatedAt: Date | null;
      rotationReplayResponse: string | null;
      rotationReplayExpiresAt: Date | null;
      authTime: Date | null;
      confirmation: UnrefinedJson;
      scopes: string[];
    };
    oauthAccessToken: {
      id: string;
      token: string;
      clientId: string;
      sessionId: string | null;
      userId: string | null;
      referenceId: string | null;
      authorizationCodeId: string | null;
      resources: string[] | null;
      requestedUserInfoClaims: string[] | null;
      refreshId: string | null;
      expiresAt: Date;
      createdAt: Date;
      revoked: Date | null;
      confirmation: UnrefinedJson;
      scopes: string[];
    };
    oauthConsent: {
      id: string;
      clientId: string;
      userId: string | null;
      referenceId: string | null;
      resources: string[] | null;
      requestedUserInfoClaims: string[] | null;
      scopes: string[];
      createdAt: Date;
      updatedAt: Date;
    };
    oauthClientAssertion: { id: string; expiresAt: Date };
    authenticator: {
      id: string;
      secret: string;
      backupCodes: string;
      userId: string;
      verified: boolean;
      failedVerificationCount: number;
      lockedUntil: Date | null;
    };
    passkey: {
      id: string;
      name: string | null;
      publicKey: string;
      userId: string;
      credentialID: string;
      counter: number;
      deviceType: string;
      backedUp: boolean;
      transports: string | null;
      createdAt: Date;
      aaguid: string | null;
    };
    passkeyLastUse: { passkeyId: string; at: Date };
    recoveryCode: { id: string; userId: string; codeHash: string; createdAt: Date };
    secondFactorThrottle: {
      userId: string;
      kind: string;
      failures: number;
      waitUntil: Date | null;
      noticedAt: Date | null;
    };
    workspaceLastActive: { workspaceId: string; userId: string; at: Date };
    testWorkspaceMark: { workspaceId: WorkspaceId; testingDomain: string };
    accessRequest: {
      id: AccessRequestId;
      workspaceId: WorkspaceId;
      requesterId: UserId;
      reason: string;
      status: "waiting" | "approved" | "declined";
      createdAt: Date;
      decidedBy: UserId | null;
      decidedAt: Date | null;
      invitationId: string | null;
    };
    conceptIdentity: {
      workspaceId: WorkspaceId;
      iri: ConceptIri;
      mergeKey: string;
      mintedAt: Date;
    };
    conceptIndex: {
      publishedAt: Date | null;
      sensitivity: Sensitivity;
      audience: "everyone" | "groups";
      audienceGroups: GroupId[] | null;
      workspaceId: WorkspaceId;
      iri: ConceptIri;
      path: string;
      kind: string;
      title: string;
      frontmatter: Frontmatter;
      body: string;
      contentHash: string;
      commitSha: string;
      status: "draft" | "stable" | "deprecated" | "removed";
      updatedAt: Date;
      search?: string | undefined;
      collection: string | null;
    };
    bundleCommit: {
      workspaceId: WorkspaceId;
      sha: string;
      parentSha: string | null;
      auditEventId: string;
      actor: string;
      committedAt: Date;
    };
    evidence: {
      workspaceId: WorkspaceId;
      sourceDocumentId: string;
      locator: string;
      resource: string;
      contentVersion: string | null;
      recordedAt: Date;
    };
    conceptVerification: {
      id: string;
      workspaceId: WorkspaceId;
      iri: ConceptIri;
      actor: string;
      verifiedAt: Date;
      contentHash: string | null;
      origin: "platform" | "imported" | "citation-fix" | "erasure-rewrite";
    };
    mapGeneration: { workspaceId: WorkspaceId; liveGen: number };
    mapNode: {
      publishedAt: Date | null;
      sensitivity: Sensitivity;
      audience: "everyone" | "groups";
      audienceGroups: GroupId[] | null;
      workspaceId: WorkspaceId;
      gen: number | null;
      uid: string;
      label: string;
      kind: string | null;
    };
    mapEdge: {
      publishedAt: Date | null;
      sensitivity: Sensitivity;
      audience: "everyone" | "groups";
      audienceGroups: GroupId[] | null;
      workspaceId: WorkspaceId;
      gen: number | null;
      uid: string;
      label: string;
      fromUid: string;
      toUid: string;
      fromKind: string | null;
      toKind: string | null;
      section: string | null;
      sentence: string | null;
    };
    mapUnresolvedReference: {
      workspaceId: WorkspaceId;
      gen: number;
      fromUid: ConceptIri;
      relation: "link" | "lineage";
      ordinal: number;
      targetPath: string;
    };
    job: {
      workspaceId: WorkspaceId;
      id: string;
      kind: "index" | "nightly-audit" | "full-rebuild";
      subjectId: string | null;
      reason:
        | "connected"
        | "dismissed"
        | "drill"
        | "erasure"
        | "first-build"
        | "model-choice-change"
        | "reconciler"
        | "restored"
        | "rule-change"
        | "upgrade"
        | "wiped"
        | null;
      status: "queued" | "claimed" | "done" | "failed" | "poisoned";
      attempts: number;
      maxAttempts: number;
      enqueuedAt: Date;
      claimedBy: string | null;
      claimedAt: Date | null;
      leaseExpiresAt: Date | null;
      heartbeatAt: Date | null;
      backoffEndsAt: Date | null;
      finishedAt: Date | null;
      outcome: JobOutcome;
    };
    suggestion: {
      workspaceId: WorkspaceId;
      id: string;
      setId: string;
      kind: "edit" | "promotion" | "suggested-concept" | "citation-fix";
      status: "waiting" | "accepted" | "declined" | "returned";
      proposer: string;
      targetIri: ConceptIri | null;
      decider: string | null;
      reason: string | null;
      proposedAt: Date;
      decidedAt: Date | null;
    };
    conceptWriteRequest: {
      workspaceId: WorkspaceId;
      suggestionId: string;
      mergeKey: string;
      path: string;
      conceptKind: string;
      title: string;
      frontmatter: Frontmatter;
      body: string;
      baseContentHash: string | null;
    };
    conceptEvidence: {
      workspaceId: WorkspaceId;
      iri: ConceptIri;
      sourceDocumentId: string;
      locator: string;
    };
    conceptSensitivityOverride: {
      sensitivity: Sensitivity;
      audience: "everyone" | "groups";
      audienceGroups: GroupId[] | null;
      workspaceId: WorkspaceId;
      iri: ConceptIri;
      actor: string;
      auditEventId: string;
      recordedAt: Date;
    };
    conceptOwner: {
      workspaceId: WorkspaceId;
      id: string;
      collection: string | null;
      iri: ConceptIri | null;
      personId: string;
      createdAt: Date;
    };
    connectedSource: {
      publishedAt: Date | null;
      sensitivity: Sensitivity;
      audience: "everyone" | "groups";
      audienceGroups: GroupId[] | null;
      workspaceId: WorkspaceId;
      id: ConnectedSourceId;
      createdAt: Date;
      name: string;
      connector: "upload";
      destination: ("bundle" | "map" | "passage-index")[];
      retentionClass: "keep" | "mirror" | "transient";
      state: "received" | "indexing" | "indexed" | "published";
      rulesInForce: { default_on: boolean; default_off: boolean };
    };
    sourceDocument: {
      workspaceId: WorkspaceId;
      id: string;
      connectedSourceId: ConnectedSourceId;
      sourceSystemId: string;
      title: string;
      mediaType: string;
      byteSize: number;
      originalKey: string;
      normalisedKey: string | null;
      contentHash: string | null;
      redactionVersion: string | null;
      firstSeen: Date;
      lastSeen: Date;
      lastModified: Date | null;
      goneAt: Date | null;
      outcome: "converted" | "unreadable" | null;
      unreadableReason: string | null;
      sensitivity: Sensitivity | null;
      narrowedTo: Sensitivity | null;
    };
    finding: {
      workspaceId: WorkspaceId;
      id: string;
      documentId: string;
      category: string;
      tier: "always" | "default-on" | "default-off";
      ruleId: string;
      charStart: number;
      charEnd: number;
      score: number;
      ruleVersion: string;
      detectorPin: string;
      reviewState: "unreviewed" | "kept-in-text" | "narrowed" | "dismissed";
      reviewedBy: string | null;
      reviewedAt: Date | null;
      reviewReason: string | null;
      restoredAt: Date | null;
      restoredBy: string | null;
      restoreReason: string | null;
    };
    subjectRequest: {
      workspaceId: WorkspaceId;
      id: string;
      personId: string | null;
      identifiers: SubjectIdentifiers;
      kind: "access" | "erasure";
      receivedAt: Date;
      clockStartedAt: Date;
      dueAt: Date;
      extendedTo: Date | null;
      answeredAt: Date | null;
      answer: string | null;
    };
    erasureRequest: {
      workspaceId: WorkspaceId;
      id: string;
      subjectRequestId: string;
      pseudonym: string;
      lockedAt: Date;
      actions: Record<string, Record<string, string | number | boolean | null>>;
      anchoredAt: Date;
      beyondUseHourlyAt: Date;
      beyondUseDailyAt: Date;
      beyondUseWeeklyAt: Date;
      beyondUseMonthlyAt: Date;
      completedAt: Date | null;
      report: string | null;
    };
    suppression: {
      workspaceId: WorkspaceId;
      erasureRequestId: string;
      identifiers: SubjectIdentifiers;
    };
    writeUp: {
      publishedAt: Date | null;
      sensitivity: Sensitivity;
      audience: "everyone" | "groups";
      audienceGroups: GroupId[] | null;
      workspaceId: WorkspaceId;
      id: WriteUpId;
      createdAt: Date;
      home: "section" | "response";
      guideId: string | null;
      sectionId: string | null;
      questionId: string | null;
      needsReview:
        | "concept-changed"
        | "concept-removed"
        | "expectation-unmet"
        | "review-finding"
        | null;
    };
    writeUpInclude: {
      workspaceId: WorkspaceId;
      writeUpId: WriteUpId;
      id: string;
      ordinal: number;
      iri: ConceptIri;
      contentHash: string;
      expectedFactId: string | null;
      wordingHeading: string | null;
      wordingHash: string | null;
    };
    writeUpVersion: {
      workspaceId: WorkspaceId;
      writeUpId: WriteUpId;
      version: number;
      actor: string;
      at: Date;
      note: string | null;
      markdown: string;
      includes: UnrefinedJson;
    };
    guideDefinition: {
      workspaceId: WorkspaceId;
      id: string;
      kind: string;
      collection: string;
      template: string;
      subjectIri: ConceptIri | null;
      createdAt: Date;
    };
    guideRole: {
      workspaceId: WorkspaceId;
      guideId: string;
      role: "Admin" | "Editor" | "Viewer";
      defaultLayer: "assembled" | "quoted";
      actionThreshold: "unverified" | "machine-confirmed" | "human-reviewed";
    };
    guideSection: {
      workspaceId: WorkspaceId;
      guideId: string;
      id: string;
      parentId: string | null;
      ordinal: number;
      prompt: string;
      roleLabel: "know" | "say" | "show" | "do";
      usageNote: string | null;
      layers: ("assembled" | "quoted")[];
      hidden: boolean;
    };
    guideExpectedFact: {
      workspaceId: WorkspaceId;
      id: string;
      guideId: string;
      sectionId: string;
      ordinal: number;
      name: string;
      kind: string;
      tags: string[];
      collection: string | null;
      atLeast: number;
    };
    guideDefinitionVersion: {
      workspaceId: WorkspaceId;
      guideId: string;
      version: number;
      actor: string;
      at: Date;
      note: string | null;
      content: UnrefinedJson;
    };
    usage: {
      workspaceId: WorkspaceId;
      id: string;
      actor: string;
      at: Date;
      act: "copied" | "exported" | "submitted";
      writeUpId: WriteUpId | null;
      writeUpVersion: number | null;
      iri: ConceptIri | null;
    };
    questionAsked: {
      workspaceId: WorkspaceId;
      id: string;
      askedAt: Date;
      askedBy: string;
      transport: "mcp" | "trpc";
      collections: string[];
      predicateRole: "Admin" | "Editor" | "Viewer";
      predicateGroups: GroupId[];
      completedAt: Date | null;
      verdict: "ok" | "warn" | "refuse" | "related" | null;
      judgeState: "not-judged" | "judged" | "judging-failed" | null;
      concepts: {
        iri: ConceptIri;
        contentHash: string;
        trust: {
          tier: string;
          status: string;
          verifiedAt: string | null;
          rider: string | null;
        };
        judged?: "yes" | "no";
      }[];
      unmappedPassages: string[];
      mapState: { state: "live" } | { state: "unavailable_since"; since: string } | null;
    };
    questionContent: {
      workspaceId: WorkspaceId;
      recordId: string;
      askedAt: Date;
      question: string;
      drafted: { sentence: string; concepts: ConceptIri[] }[] | null;
    };
    questionFeedback: {
      workspaceId: WorkspaceId;
      id: string;
      recordId: string;
      givenAt: Date;
      givenBy: string;
      verdict: "helpful" | "flag";
      reason: "wrong" | "out-of-date" | "incomplete" | "should-not-have-shown" | null;
      note: string | null;
      disputedSentence: string | null;
      disputedConcept: ConceptIri | null;
      closedAs: "fixed-in-the-knowledge" | "no-fault-in-the-knowledge" | null;
      closedAt: Date | null;
    };
  };

  type Table = keyof typeof boundarySchemas;
  type Mismatched = {
    [K in Table]: K extends keyof SelectShapes
      ? Equal<z.infer<(typeof boundarySchemas)[K]["select"]>, SelectShapes[K]> extends true
        ? never
        : K
      : K;
  }[Table];

  type _noPinOutlivesItsTable = NoneOf<Exclude<keyof SelectShapes, Table>>;
  type _everyTableHasAHoldingPin = NoneOf<Mismatched>;

  it("holds at compile time (the assertions above are types)", () => {
    expect(true).toBe(true);
  });
});
