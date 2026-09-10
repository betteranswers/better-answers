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
  SUGGESTION_BODY_MAX,
  SUGGESTION_REASON_MAX,
} from "../src/index.ts";
import * as publicEntry from "../src/index.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "../src/drizzle-zod.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

/**
 * ADR 0028's five assertions, over the registry, against a real Postgres
 * (`[TEST2]`). Assertion 4 is what makes "a refinement only narrows" a test rather
 * than a convention: every row the refined insert schema accepts must be accepted by
 * the table itself.
 */

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
// The one form a concept IRI has: the bare apex, `/c/`, a minted id (ADR 0002's amendments).
const CONCEPT_IRI = "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM";
const CONTENT_SHA256 = "a".repeat(64);
const COMMIT_SHA = "b".repeat(40);
const SUGGESTION_SET_ID = "01J6RRRRRRRRRRRRRRRRRRRRRR";
const SUGGESTION_ID = "01J6SSSSSSSSSSSSSSSSSSSSSS";
const BINDING_ID = "01J6VVVVVVVVVVVVVVVVVVVVVV";
// The document the evidence row below locates into, catalogued under the binding above.
const DOCUMENT_ID = "01J6NNNNNNNNNNNNNNNNNNNNNN";
const COMPOSITION_ID = "01J6WWWWWWWWWWWWWWWWWWWWWW";
// A span the seam withheld in the document above.
const FINDING_ID = "01J6XXXXXXXXXXXXXXXXXXXXXX";

/** Rows each refined insert schema accepts — assertion 4's input. */
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
  // The membership carries the workspace-scoped revocation instant (ADR 0035); one row
  // only, because `member_workspace_id_user_id_uidx` allows a person one membership here.
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
  // Admin-curated, the only kind anything mints; the pair is closed at the boundary.
  group: [{ id: GROUP_ID, workspaceId: WS_ID, name: "HR team", origin: "admin-curated" }],
  // Keyed by the workspace, the group and the person, and carrying nothing else: the row
  // that says what somebody may see, never what they may do.
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
  // One row per actor form the boundary admits — a person by person id, the platform, an
  // agent — the third carrying a batch id; `family` and `subject_kind` are the database's.
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
  // A waiting request and a decided one: the second carries the whole decision — the
  // decider, the instant and the invitation approve minted — which the row's own CHECK
  // holds together.
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
  // A binding narrowed to Admins over no array, and one for named groups — the two whole
  // shapes of the audience pair (ADR 0039), so the array refinement is proved on the column.
  sourceBinding: [
    {
      workspaceId: WS_ID,
      id: BINDING_ID,
      publishedAt: NOW,
      sensitivity: "Restricted",
      audience: "everyone",
    },
    {
      workspaceId: WS_ID,
      id: "01J6VVVVVVVVVVVVVVVVVVVVV2",
      publishedAt: NOW,
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [GROUP_ID],
    },
  ],
  sourceDocument: [{ workspaceId: WS_ID, id: DOCUMENT_ID, bindingId: BINDING_ID }],
  // Three findings in the document above: one as the seam wrote it, one an Admin narrowed
  // the document on, and one always-set span an Admin restored with a reason — the three
  // whole shapes the review and restore CHECKs admit.
  finding: [
    {
      workspaceId: WS_ID,
      id: FINDING_ID,
      documentId: DOCUMENT_ID,
      category: "sort-code",
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
      category: "health-cue",
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
  // The citation: the concept above, the evidence row above by its own key.
  conceptEvidence: [
    { workspaceId: WS_ID, iri: CONCEPT_IRI, sourceDocumentId: DOCUMENT_ID, locator: "p.4#para-2" },
  ],
  // An Admin's override to named groups, booked to the ledger row above.
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
  // A bundle's first commit, whose parent is NULL, and the one after it.
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
  // A check the platform made, which carries its hash, and one carried in with a bundle,
  // which carries none — the CHECK that ties `origin` to `content_hash` (ADR 0019).
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
  // One row per partition (ADR 0032): a bundle-and-record node in the live generation,
  // and a source entity, which carries no generation and wears the prefixed label.
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
  // A LINKS_TO with the four link columns; a named edge, which may carry none of them; and
  // the source-entity partition's own closed-label edge — `IS_CONCEPT` at `gen` NULL (ADR
  // 0026's amendment), which the edge schemas must keep accepting.
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
  // A queued audit, which carries no reason, and a rebuild that ran and reported what it
  // found — the two ends of a job's life, so the fixture proves the boundary accepts one
  // before anything has claimed it and after it has finished, outcome and all.
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
      // Counts, and the paths the counts were taken at: the whole of what an outcome may
      // hold, in the auditor's own shape.
      outcome: { checked: 2, mismatched: [{ path: "knowledge/expenses.md" }], unparsed: [] },
    },
  ],
  // One waiting and one accepted: the decision CHECK's two whole shapes, so the fixture
  // proves the boundary accepts a suggestion before its decision and after it.
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
  // The payload of the waiting one: a merge key and no IRI at all, because identity is
  // the acceptance's to resolve (ADR 0012).
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

const registryNames = Object.keys(boundarySchemas) as (keyof typeof boundarySchemas)[];
const forms = ["select", "insert", "update"] as const;

/** The unrefined generation of a registered table — what assertions 2 and 3 compare against. */
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
const unrefined = Object.fromEntries(
  registryNames.map((name) => [name, unrefinedFor(name)]),
) as Readonly<Record<keyof typeof boundarySchemas, Record<(typeof forms)[number], z.ZodObject>>>;

describe("1 — every table has a boundary", () => {
  it("registers exactly the PgTables the public entry point exports", () => {
    const exportedTables = Object.values(publicEntry).filter((value) => is(value, PgTable));
    const registeredTables = registryNames.map((name) => boundarySchemas[name].table);
    expect(new Set(registeredTables)).toEqual(new Set(exportedTables));
  });

  it("has an accepted row for every registered table, and no row for an unregistered one", () => {
    // Both directions (`[TEST7]`): assertion 4 walks the fixture; a table with no
    // fixture would never be proved, and a fixture with no table is a stale claim.
    expect(Object.keys(acceptedRows).toSorted()).toEqual(registryNames.toSorted());
  });
});

describe("2 — the key sets agree", () => {
  for (const name of registryNames) {
    for (const form of forms) {
      it(`${name}.${form} names exactly the generated keys`, () => {
        expect(Object.keys(boundarySchemas[name][form].shape).toSorted()).toEqual(
          Object.keys(unrefined[name][form].shape).toSorted(),
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
        const unrefinedShape: Readonly<Record<string, z.ZodType>> = unrefined[name][form].shape;
        const columns: Readonly<Record<string, { dataType: string }>> = getTableColumns(
          boundarySchemas[name].table,
        );
        for (const [key, refinedField] of Object.entries<z.ZodType>(refinedShape)) {
          // The customType exception (ADR 0028): drizzle-zod emits z.any() for a
          // custom column, which accepts the null/undefined the column itself
          // refuses — the generated side is the wrong witness there, and assertion 4
          // carries the whole burden.
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
      // Explicit insert order, never the registry's key order: every FK target comes
      // before its referrer, and index.chunk is list-partitioned so its workspace
      // partition exists first (ADR 0028 assertion 4's note) — created through the
      // one lifecycle function, which requires the transaction scoped to it.
      const insertOrder = [
        "workspace",
        "user",
        "llmRoute",
        "workspaceConfig",
        "member",
        // Both group tables come after `member`: `group_member`'s composite key names the
        // membership pair, so the membership has to be there before a group row can.
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
        // The identity comes before the index row and the check, which name it by the
        // composite key `(workspace_id, iri)`.
        "conceptIdentity",
        "conceptIndex",
        "bundleCommit",
        "evidence",
        "conceptVerification",
        // The generation row before the rows that stamp it — not a key, but the reading
        // order a walk binds — and edges after the nodes they run between.
        "graphGeneration",
        "graphNode",
        "graphEdge",
        // A job names only its workspace, so it needs nothing but that row.
        "job",
        // The suggestion before its payload, which names it by the composite key, and
        // after the identity its accepted row resolved to.
        "suggestion",
        "conceptWriteRequest",
        // The binding before the document it yielded, and the findings after the document
        // whose spans they locate; the citation after the identity and the evidence row its
        // key names; the override after the identity; the composition before the include
        // that names it and the concept it includes.
        "sourceBinding",
        "sourceDocument",
        "finding",
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
  // No database here on purpose — the whole point is that the parse refuses the row
  // client-side, before any INSERT exists to fail.
  const rejectedRows = {
    workspace: [
      { id: "not-a-ulid", name: "Workspace A", slug: "a" },
      { id: WS_ID, name: "   ", slug: "a" },
    ],
    llmRoute: [{ ...acceptedRows.llmRoute[0], dimensions: 0 }],
    // The identity ids the platform reads: one shape, the minter's (ADR 0035). Better
    // Auth's own default id and a hand-composed key are both refused at the boundary.
    user: [{ ...acceptedRows.user[0], id: "kEyIkQBmQ1EnBJnUvKMR6nSFXlQKUcuJ" }],
    member: [
      { ...acceptedRows.member[0], role: "owner" },
      { ...acceptedRows.member[0], id: `member-${WS_ID}-${USER_ID}` },
    ],
    session: [{ ...acceptedRows.session[0], id: "kEyIkQBmQ1EnBJnUvKMR6nSFXlQKUcuJ" }],
    invitation: [{ ...acceptedRows.invitation[0], id: "invitation-1" }],
    // An id that is not the minter's, a nameless group, and a third origin: the pair is
    // closed at the boundary, so the day a surface mints an implicit group it adds the
    // word here and nowhere else.
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
    // The ledger's refusals: an id not the minter's; an act outside the four families, or
    // with a segment missing; an actor that is an email, a bare person id or a display
    // name; a nested detail, where a name or a prompt would have somewhere to hide.
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
    // The queue's refusals: an id not the minter's; a reason that is blank, whitespace or
    // longer than a sentence of why; a fourth status; a requester named by address rather
    // than by person id.
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
    // The graph's refusals: a generation before the first, a label outside the closed set
    // that wears no source-entity prefix, a class outside the three — and the label family
    // parted from its partition: a source-entity label inside a generation on either
    // table, and a closed node label carrying none.
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
    // The queue's refusals: a fifth kind, a proposer that is an address rather than an
    // actor, and a reason longer than the column carries.
    suggestion: [
      { ...acceptedRows.suggestion[0], kind: "merge" },
      { ...acceptedRows.suggestion[0], proposer: "ada@acme.invalid" },
      { ...acceptedRows.suggestion[0], reason: "x".repeat(SUGGESTION_REASON_MAX + 1) },
    ],
    // The finding's refusals: a fourth tier and a fourth review state, both word sets being
    // closed; an offset that is not a whole number and a span of no length; a score outside
    // the detector's range; a category that is only whitespace; an Admin named by address
    // rather than by person id; and a reason longer than the column carries.
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
    // The payload's refusals: the bundle's manifest, which is not a concept file — and the
    // two columns a producer fills at a size of its own choosing, each held to its bound,
    // so a compromised one cannot fill a tenant's storage a suggestion at a time.
    conceptWriteRequest: [
      { ...acceptedRows.conceptWriteRequest[0], path: "knowledge/manifest.yaml" },
      { ...acceptedRows.conceptWriteRequest[0], body: "x".repeat(SUGGESTION_BODY_MAX + 1) },
      {
        ...acceptedRows.conceptWriteRequest[0],
        frontmatter: { title: "x".repeat(CONCEPT_FRONTMATTER_MAX) },
      },
    ],
  } as const;

  for (const name of Object.keys(rejectedRows) as (keyof typeof rejectedRows)[]) {
    it(`${name} refuses every row that violates a refinement`, () => {
      for (const row of rejectedRows[name]) {
        expect(boundarySchemas[name].insert.safeParse(row).success).toBe(false);
      }
    });
  }
});

/**
 * The claim the `finding` table is built on (ADR 0020): **it never holds the value**. A
 * category, a tier, a rule id, two offsets and a score locate a span; they do not quote it.
 * That is what makes a finding safe to keep for as long as the document lives, safe to put
 * on a review screen, and nothing an erasure has to rewrite.
 *
 * The whole column set is written down here as a literal (`[TEST9]`) rather than asserted by
 * a rule about names, because there is no rule that could tell a column holding a postcode
 * from one holding a rule id. A column that could carry a value has to be added to this list
 * by hand, in the same diff — which is the review the claim actually needs.
 */
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

describe("the frontmatter bound's unit", () => {
  /** A frontmatter of one astral character repeated — two UTF-16 code units each. */
  const astral = (characters: number) => ({ a: "\u{1D11E}".repeat(characters) });

  it("counts the characters `char_length` counts, not the units JavaScript measures", () => {
    // The bound is enforced in `submit_suggestion_set`, which measures the caller's own JSON
    // text with `char_length` — characters. Measuring UTF-16 code units here would make one
    // bound into two numbers, and the gap between them is a payload the boundary refuses and
    // the database would have taken, or the other way about.
    const inside = astral(CONCEPT_FRONTMATTER_MAX - 100);
    expect(JSON.stringify(inside).length).toBeGreaterThan(CONCEPT_FRONTMATTER_MAX);
    expect(conceptFrontmatter.safeParse(inside).success).toBe(true);

    expect(conceptFrontmatter.safeParse(astral(CONCEPT_FRONTMATTER_MAX)).success).toBe(false);
  });
});

describe("the customType exception, per shape", () => {
  // The plain schema replaces the generated field wholesale — the column's
  // nullability and update's .optional() included — so each shape is constructed
  // on its own and each carries its own proof (ADR 0028, 2026-09-01 amendment).
  const tooShort = Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0);

  it("chunk.select requires an embedding of the route's width", () => {
    const row = { ...acceptedRows.chunk[0], publishedAt: null, audienceGroups: null };
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
        embedding: number[];
        embeddingRouteId: string;
        publishedAt: Date | null;
        sensitivity: "Restricted" | "Internal" | "Public";
        audience: "everyone" | "groups";
        audienceGroups: GroupId[] | null;
        bindingId: string;
      }
    >
  >;

  it("holds at compile time (the assertions above are types, not values)", () => {
    expect(true).toBe(true);
  });
});
