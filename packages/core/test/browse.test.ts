import { describe, expect, it } from "vitest";

import { AUDIENCE_GROUPS } from "@better-answers/schema";
import type { TestData } from "@better-answers/schema/testing";

import {
  readKnowledgeBranch,
  readKnowledgeTree,
  type KnowledgeBranchInput,
} from "../src/concepts/index.ts";
import type { Role, UserPrincipal } from "../src/kernel/index.ts";
import { withMember, type PostgresDoor } from "../src/store/postgres/index.ts";
import { provisionedWorkspace } from "./platform.ts";
import { answered, postgresForSuite, seedingWith } from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

const db = postgresForSuite();

const now = new Date();

type Shelf = {
  readonly workspaceId: string;
  readonly postgres: PostgresDoor;
  readonly admin: UserPrincipal;
  readonly viewer: UserPrincipal;
};

type Shelved = {
  readonly path: string;
  readonly kind?: string;
  readonly title?: string;
  readonly sensitivity?: "Public" | "Internal" | "Restricted";
  readonly audienceGroups?: readonly string[];
};

const joined = async (workspaceId: string, role: Role): Promise<UserPrincipal> => {
  const person = await seedingWith(db().pool, async (seed) => {
    const user = await seed.user();
    await seed.member({ workspaceId, userId: user.id, role });
    return user;
  });
  return principalFor(db(), workspaceId, person.id);
};

const aShelf = async (): Promise<Shelf> => {
  const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Acme");
  return {
    workspaceId,
    postgres: door,
    admin: await principalFor(db(), workspaceId, adminUserId),
    viewer: await joined(workspaceId, "Viewer"),
  };
};

const shelvedWith = async (
  seed: TestData,
  workspaceId: string,
  commitSha: string,
  shelved: Shelved,
): Promise<string> => {
  const { path, audienceGroups, ...columns } = shelved;
  const title = columns.title ?? path;
  const row = await seed.conceptIndex({
    workspaceId,
    commitSha,
    path,
    ...columns,
    title,
    frontmatter: { title, type: columns.kind ?? "Policy" },
    ...(audienceGroups === undefined
      ? {}
      : { audience: AUDIENCE_GROUPS, audienceGroups: [...audienceGroups] }),
  });
  return row.iri;
};

const shelve = (shelf: Shelf, concepts: readonly Shelved[]): Promise<readonly string[]> =>
  seedingWith(db().pool, async (seed) => {
    const { sha } = await seed.bundleCommit({ workspaceId: shelf.workspaceId });
    const iris: string[] = [];
    for (const shelved of concepts) {
      iris.push(await shelvedWith(seed, shelf.workspaceId, sha, shelved));
    }
    return iris;
  });

const treeReadBy = async (shelf: Shelf, reader: UserPrincipal) =>
  answered(
    answered(await withMember(reader, shelf.postgres, (fresh, tx) => readKnowledgeTree(fresh, tx))),
  );

const branchReadBy = async (shelf: Shelf, reader: UserPrincipal, input: KnowledgeBranchInput) =>
  answered(
    answered(
      await withMember(reader, shelf.postgres, (fresh, tx) =>
        readKnowledgeBranch(fresh, tx, input, now),
      ),
    ),
  );

describe("the knowledge tree", () => {
  it("counts only the concepts the reader may read", async () => {
    const shelf = await aShelf();
    await shelve(shelf, [
      { path: "knowledge/company/expenses.md" },
      { path: "knowledge/company/travel.md" },
      { path: "knowledge/company/salaries.md", sensitivity: "Restricted" },
      { path: "knowledge/company/lease.md", kind: "Contract" },
      { path: "knowledge/held/board-minutes.md", sensitivity: "Restricted" },
    ]);

    const viewers = await treeReadBy(shelf, shelf.viewer);
    const admins = await treeReadBy(shelf, shelf.admin);

    expect(viewers).toEqual({
      collections: [
        {
          collection: "company",
          count: 3,
          kinds: [
            { kind: "Contract", count: 1 },
            { kind: "Policy", count: 2 },
          ],
        },
      ],
    });
    expect(admins).toEqual({
      collections: [
        {
          collection: "company",
          count: 4,
          kinds: [
            { kind: "Contract", count: 1 },
            { kind: "Policy", count: 3 },
          ],
        },
        { collection: "held", count: 1, kinds: [{ kind: "Policy", count: 1 }] },
      ],
    });
  });

  it("an outside Viewer never sees a withheld concept", async () => {
    const shelf = await aShelf();
    const outside = shelf.viewer;
    const inside = await joined(shelf.workspaceId, "Viewer");
    const hr = await seedingWith(db().pool, async (seed) => {
      const group = await seed.group({ workspaceId: shelf.workspaceId, name: "HR team" });
      await seed.groupMember({
        workspaceId: shelf.workspaceId,
        groupId: group.id,
        userId: inside.userId,
      });
      return group.id;
    });
    const [, withheld] = await shelve(shelf, [
      { path: "knowledge/company/expenses.md" },
      { path: "knowledge/people/grievances.md", audienceGroups: [hr] },
    ]);
    const people = { collection: "people", kind: "Policy" };

    const insideTree = await treeReadBy(shelf, inside);
    const outsideTree = await treeReadBy(shelf, outside);
    const insideBranch = await branchReadBy(shelf, inside, people);
    const outsideBranch = await branchReadBy(shelf, outside, people);

    expect(insideTree.collections.map(({ collection }) => collection)).toEqual([
      "company",
      "people",
    ]);
    expect(outsideTree.collections.map(({ collection }) => collection)).toEqual(["company"]);
    expect(insideBranch.concepts.map(({ iri }) => iri)).toEqual([withheld]);
    expect(outsideBranch).toEqual({ concepts: [], nextCursor: null });
  });

  it("a concept outside every collection falls under No collection", async () => {
    const shelf = await aShelf();
    const [loose] = await shelve(shelf, [
      { path: "knowledge/loose.md", title: "Loose" },
      { path: "knowledge/company/expenses.md", title: "Expenses" },
      { path: "knowledge/archive/old.md", title: "Old" },
    ]);

    const tree = await treeReadBy(shelf, shelf.viewer);
    const outside = await branchReadBy(shelf, shelf.viewer, { collection: null, kind: "Policy" });

    expect(tree.collections).toEqual([
      { collection: "archive", count: 1, kinds: [{ kind: "Policy", count: 1 }] },
      { collection: "company", count: 1, kinds: [{ kind: "Policy", count: 1 }] },
      { collection: null, count: 1, kinds: [{ kind: "Policy", count: 1 }] },
    ]);
    expect(outside).toEqual({
      concepts: [{ iri: loose, title: "Loose", kind: "Policy", trustWords: "Unverified" }],
      nextCursor: null,
    });
  });
});

const POLICIES = 120;

const numbered = (at: number): string => String(at).padStart(3, "0");

const policyAt = (at: number): Shelved => ({
  path: `knowledge/company/policy-${numbered(at)}.md`,
  title: `Policy ${numbered(at === 50 ? 49 : at)}`,
});

describe("a kind's concepts", () => {
  it("lists a kind's concepts fifty at a time", async () => {
    const shelf = await aShelf();
    const iris = await shelve(shelf, [
      ...Array.from({ length: POLICIES }, (_unused, at) => policyAt(POLICIES - 1 - at)),
      { path: "knowledge/company/lease.md", kind: "Contract" },
    ]);
    const company = { collection: "company", kind: "Policy" };

    const first = await branchReadBy(shelf, shelf.viewer, company);
    const second = await branchReadBy(shelf, shelf.viewer, {
      ...company,
      cursor: first.nextCursor,
    });
    const third = await branchReadBy(shelf, shelf.viewer, {
      ...company,
      cursor: second.nextCursor,
    });

    const listed = [first, second, third].flatMap((page) => page.concepts);
    expect([first, second, third].map((page) => page.concepts.length)).toEqual([50, 50, 20]);
    expect(third.nextCursor).toBeNull();
    expect(new Set(listed.map(({ iri }) => iri))).toEqual(new Set(iris.slice(0, POLICIES)));
    expect(listed.map(({ title }) => title)).toEqual(
      listed.map(({ title }) => title).toSorted((one, other) => (one < other ? -1 : 1)),
    );
    expect(listed.every(({ kind }) => kind === "Policy")).toBe(true);
  });
});
