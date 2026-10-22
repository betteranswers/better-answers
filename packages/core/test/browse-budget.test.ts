import { beforeAll, describe, expect, it } from "vitest";

import { readKnowledgeBranch, readKnowledgeTree } from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { withMember, type PostgresDoor } from "../src/store/postgres/index.ts";
import { inMs, percentile, recordFigures } from "./figures.ts";
import { provisionedWorkspace } from "./platform.ts";
import { answered, postgresForSuite, seedingWith } from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

const db = postgresForSuite();

const CONCEPTS = 3_000;

const COLLECTIONS = 10;

const KINDS = ["Contract", "Policy", "Procedure"] as const;

const ROUNDS = 5;

const READ_BUDGET_MS = 200;

type Shelf = { readonly postgres: PostgresDoor; readonly viewer: UserPrincipal };

const collectionAt = (at: number): string => `collection-${at % COLLECTIONS}`;

const kindAt = (at: number): string => KINDS[Math.floor(at / COLLECTIONS) % KINDS.length] ?? "";

const seedWideShelf = async (): Promise<Shelf> => {
  const { door, workspaceId } = await provisionedWorkspace(db(), "Acme");
  const viewerId = await seedingWith(db().pool, async (seed) => {
    const viewer = await seed.user();
    await seed.member({ workspaceId, userId: viewer.id, role: "Viewer" });
    const commitSha = (await seed.bundleCommit({ workspaceId })).sha;
    for (let at = 0; at < CONCEPTS; at += 1) {
      const title = `Concept ${String(CONCEPTS - at).padStart(4, "0")}`;
      await seed.conceptIndex({
        workspaceId,
        commitSha,
        path: `knowledge/${collectionAt(at)}/concept-${at}.md`,
        kind: kindAt(at),
        title,
        frontmatter: { title, type: kindAt(at) },
      });
    }
    return viewer.id;
  });
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
  }, 300_000);

  it("reads the tree and a kind's first page within budget", async () => {
    const treeMs: number[] = [];
    const branchMs: number[] = [];
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
      branchMs.push(
        await timed(async () => {
          const branch = answered(
            answered(
              await withMember(shelf.viewer, shelf.postgres, (fresh, tx) =>
                readKnowledgeBranch(
                  fresh,
                  tx,
                  { collection: collectionAt(0), kind: kindAt(0) },
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
      ["a kind's first page at the median", inMs(percentile(branchMs, 0.5))],
      [
        "the slowest first page",
        `${inMs(percentile(branchMs, 1))}, against a budget of ${READ_BUDGET_MS} ms`,
      ],
    ]);

    expect(counted, "the concepts the tree counts").toBe(CONCEPTS);
    expect(listed, "the concepts on a kind's first page").toBe(50);
    expect(percentile(treeMs, 1), "the slowest tree read, in milliseconds").toBeLessThan(
      READ_BUDGET_MS,
    );
    expect(percentile(branchMs, 1), "the slowest first page, in milliseconds").toBeLessThan(
      READ_BUDGET_MS,
    );
  });
});
