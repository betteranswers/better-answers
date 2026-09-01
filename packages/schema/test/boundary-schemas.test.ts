import { getTableColumns, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundarySchemas, EMBEDDING_DIMENSIONS } from "../src/index.ts";
import * as publicEntry from "../src/index.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "../src/drizzle-zod.ts";
import { type MigratedPostgres, startMigratedPostgres, withRollback } from "./harness.ts";

/**
 * ADR 0028's five assertions, over the registry, against a real Postgres
 * (`[TEST2]`). Assertion 4 is what makes "a refinement only narrows" a test rather
 * than a convention: every row the refined insert schema accepts must be accepted by
 * the table itself.
 */

const WS_ID = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const USER_ID = "user-1";
const NOW = new Date("2026-09-01T00:00:00Z");

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
  member: [{ id: "member-1", workspaceId: WS_ID, userId: USER_ID, role: "Admin", createdAt: NOW }],
  session: [
    { id: "session-1", expiresAt: NOW, token: "session-token", updatedAt: NOW, userId: USER_ID },
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
      id: "invitation-1",
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
  oauthResource: [{ id: "resource-1", identifier: "https://mcp.example.test/mcp", name: "mcp" }],
  oauthClientResource: [
    {
      id: "client-resource-1",
      clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata",
      resourceId: "https://mcp.example.test/mcp",
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
  chunk: [
    {
      id: "chunk-1",
      workspaceId: WS_ID,
      content: "hello",
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5),
      embeddingRouteId: "route-embed",
      sensitivity: "Internal",
      audience: "Everyone",
      bindingId: "binding-1",
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
    db = await startMigratedPostgres();
  }, 120_000);

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
    member: [{ ...acceptedRows.member[0], role: "owner" }],
    workspaceConfig: [{ ...acceptedRows.workspaceConfig[0], key: "  " }],
    ingressCounter: [{ ...acceptedRows.ingressCounter[0], scope: "user-agent" }],
    mcpCallCounter: [{ ...acceptedRows.mcpCallCounter[0], count: -1 }],
    chunk: [
      {
        ...acceptedRows.chunk[0],
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0.5),
      },
      { ...acceptedRows.chunk[0], sensitivity: "Secret" },
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

describe("the customType exception, per shape", () => {
  // The plain schema replaces the generated field wholesale — the column's
  // nullability and update's .optional() included — so each shape is constructed
  // on its own and each carries its own proof (ADR 0028, 2026-09-01 amendment).
  const tooShort = Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0);

  it("chunk.select requires an embedding of the route's width", () => {
    const row = { ...acceptedRows.chunk[0], publishedAt: null };
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
  type _mcpCallCounterSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.mcpCallCounter.select>,
      { workspaceId: WorkspaceId; tokenId: string; windowStart: Date; count: number }
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
        audience: string;
        bindingId: string;
      }
    >
  >;

  it("holds at compile time (the assertions above are types, not values)", () => {
    expect(true).toBe(true);
  });
});
