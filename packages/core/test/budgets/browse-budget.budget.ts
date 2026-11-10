import { beforeAll, describe, expect, it } from "vitest";

import { readConceptsOfType, readKnowledgeTree } from "@better-answers/core/concepts";
import type { UserPrincipal } from "@better-answers/core/kernel";
import { withMember, type PostgresDoor } from "@better-answers/core/store/postgres";
import { conceptIndexRows, testData } from "@better-answers/schema/testing";

import { principalFor } from "../fixtures/workspace-with-bundle.ts";
import { inMs, percentile, recordFigures } from "../support/figures.ts";
import { provisionedWorkspace } from "../support/platform.ts";
import { answered, postgresForSuite, seedingWith } from "../support/suite-postgres.ts";

const db = postgresForSuite();

const CONCEPTS = 3_000;

const COLLECTIONS = 10;

const CONCEPT_TYPES = ["Contract", "Policy", "Procedure"] as const;

const ROUNDS = 5;

const READ_BUDGET_MS = 200;

type Shelf = { readonly postgres: PostgresDoor; readonly viewer: UserPrincipal };

const collectionAt = (at: number): string => `collection-${at % COLLECTIONS}`;

const conceptTypeAt = (at: number): string =>
  CONCEPT_TYPES[Math.floor(at / COLLECTIONS) % CONCEPT_TYPES.length] ?? "";

const seedWideShelf = async (): Promise<Shelf> => {
  const { door, workspaceId } = await provisionedWorkspace(db(), "Acme");
  const viewerId = await seedingWith(db().pool, async (seed) => {
    const viewer = await seed.user();
    await seed.member({ workspaceId, userId: viewer.id, role: "Viewer" });
    return viewer.id;
  });
  const client = await db().pool.connect();
  try {
    const commitSha = (await testData(client).bundleCommit({ workspaceId })).sha;
    const places = Array.from({ length: CONCEPTS }, (_unused, at) => at);
    const batches = Map.groupBy(places, (at) => `${collectionAt(at)}/${conceptTypeAt(at)}`);
    for (const held of batches.values()) {
      const first = held[0] ?? 0;
      await conceptIndexRows(client, {
        workspaceId,
        commitSha,
        conceptType: conceptTypeAt(first),
        sensitivity: "Internal",
        audienceGroups: null,
        concepts: held.map((at) => ({
          path: `knowledge/${collectionAt(at)}/concept-${at}.md`,
          title: `Concept ${String(CONCEPTS - at).padStart(4, "0")}`,
        })),
      });
    }
  } finally {
    client.release();
  }
  await db().pool.query("ANALYZE concept_index, concept_verification");
  return { postgres: door, viewer: await principalFor(db(), workspaceId, viewerId) };
};

const timed = async (work: () => Promise<unknown>): Promise<number> => {
  const started = performance.now();
  await work();
  return performance.now() - started;
};

describe("the knowledge base at 3,000 concepts", () => {
  let shelf: Shelf;

  beforeAll(async () => {
    shelf = await seedWideShelf();
  }, 60_000);

  it("reads the tree and a type's first page within budget", async () => {
    const treeMs: number[] = [];
    const conceptTypeMs: number[] = [];
    let counted = 0;
    let listed = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      treeMs.push(
        await timed(async () => {
          const tree = answered(
            answered(
              await withMember(shelf.viewer, shelf.postgres, (fresh, tx) =>
                readKnowledgeTree(fresh, tx),
              ),
            ),
          );
          counted = tree.collections.reduce((sum, { count }) => sum + count, 0);
        }),
      );
      conceptTypeMs.push(
        await timed(async () => {
          const branch = answered(
            answered(
              await withMember(shelf.viewer, shelf.postgres, (fresh, tx) =>
                readConceptsOfType(
                  fresh,
                  tx,
                  { collection: collectionAt(0), conceptType: conceptTypeAt(0) },
                  new Date(),
                ),
              ),
            ),
          );
          listed = branch.concepts.length;
        }),
      );
    }

    await recordFigures("The knowledge base read at 3,000 concepts", [
      ["the tree at the median", inMs(percentile(treeMs, 0.5))],
      [
        "the slowest tree",
        `${inMs(percentile(treeMs, 1))}, against a budget of ${READ_BUDGET_MS} ms`,
      ],
      ["a type's first page at the median", inMs(percentile(conceptTypeMs, 0.5))],
      [
        "the slowest first page",
        `${inMs(percentile(conceptTypeMs, 1))}, against a budget of ${READ_BUDGET_MS} ms`,
      ],
    ]);

    expect(counted, "the concepts counted across the tree").toBe(CONCEPTS);
    expect(listed, "the concepts on a type's first page").toBe(50);
    expect(percentile(treeMs, 1), "the slowest tree read, in milliseconds").toBeLessThan(
      READ_BUDGET_MS,
    );
    expect(percentile(conceptTypeMs, 1), "the slowest first page, in milliseconds").toBeLessThan(
      READ_BUDGET_MS,
    );
  });
});
