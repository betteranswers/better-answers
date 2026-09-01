import { getTableColumns, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundarySchemas, chunk, EMBEDDING_DIMENSIONS, llmRoute, workspace } from "../src/index.ts";
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

/** Rows each refined insert schema accepts — assertion 4's input. */
const acceptedRows = {
  workspace: [{ id: WS_ID, name: "Workspace A" }],
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

const unrefined = {
  workspace: {
    select: createSelectSchema(workspace),
    insert: createInsertSchema(workspace),
    update: createUpdateSchema(workspace),
  },
  llmRoute: {
    select: createSelectSchema(llmRoute),
    insert: createInsertSchema(llmRoute),
    update: createUpdateSchema(llmRoute),
  },
  chunk: {
    select: createSelectSchema(chunk),
    insert: createInsertSchema(chunk),
    update: createUpdateSchema(chunk),
  },
} as const;

const registryNames = Object.keys(boundarySchemas) as (keyof typeof boundarySchemas)[];
const forms = ["select", "insert", "update"] as const;

describe("1 — every table has a boundary", () => {
  it("registers exactly the PgTables the public entry point exports", () => {
    const exportedTables = Object.values(publicEntry).filter((value) => is(value, PgTable));
    const registeredTables = registryNames.map((name) => boundarySchemas[name].table);
    expect(new Set(registeredTables)).toEqual(new Set(exportedTables));
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
      // Explicit insert order, never the registry's key order: workspace is every
      // other row's FK target, and index.chunk is list-partitioned so its workspace
      // partition exists first (ADR 0028 assertion 4's note) — created through the
      // one lifecycle function, which requires the transaction scoped to it.
      const insertOrder = ["workspace", "llmRoute", "chunk"] as const;
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
      { id: "not-a-ulid", name: "Workspace A" },
      { id: WS_ID, name: "   " },
    ],
    llmRoute: [
      {
        id: "route-embed",
        workspaceId: WS_ID,
        purpose: "embedding",
        provider: "mistral",
        model: "mistral-embed",
        dimensions: 0,
      },
    ],
    chunk: [
      {
        ...acceptedRows.chunk[0],
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS - 1 }, () => 0.5),
      },
      { ...acceptedRows.chunk[0], sensitivity: "Secret" },
    ],
  } as const;

  for (const name of registryNames) {
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

  type _workspaceSelect = Expect<
    Equal<
      z.infer<typeof boundarySchemas.workspace.select>,
      { id: WorkspaceId; name: string; createdAt: Date }
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
