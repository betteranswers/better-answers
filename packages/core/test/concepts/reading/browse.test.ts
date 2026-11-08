import { describe, expect, it } from "vitest";

import type { ConceptIri } from "@better-answers/schema";

import {
  readConceptsOfType,
  readKnowledgeTree,
  type ConceptsOfTypeInput,
} from "../../../src/concepts/index.ts";
import type { Role, UserPrincipal } from "../../../src/kernel/index.ts";
import { withMember, type PostgresDoor } from "../../../src/store/postgres/index.ts";
import { joinedAs, shelve as shelveInto, type Shelved } from "../../fixtures/concept-shelf.ts";
import { principalFor } from "../../fixtures/workspace-with-bundle.ts";
import { provisionedWorkspace } from "../../support/platform.ts";
import { answered, postgresForSuite, seedingWith } from "../../support/suite-postgres.ts";

const db = postgresForSuite();

const now = new Date();

type Seeded = {
  readonly workspaceId: string;
  readonly postgres: PostgresDoor;
  readonly admin: UserPrincipal;
  readonly viewer: UserPrincipal;
};

const seededWorkspace = async (): Promise<Seeded> => {
  const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Acme");
  return {
    workspaceId,
    postgres: door,
    admin: await principalFor(db(), workspaceId, adminUserId),
    viewer: await joinedAs(db(), workspaceId, "Viewer"),
  };
};

const joined = (workspaceId: string, role: Role): Promise<UserPrincipal> =>
  joinedAs(db(), workspaceId, role);

const shelve = (seeded: Seeded, concepts: readonly Shelved[]): Promise<readonly ConceptIri[]> =>
  shelveInto(db().pool, seeded.workspaceId, concepts);

const treeReadBy = async (seeded: Seeded, reader: UserPrincipal) =>
  answered(
    answered(
      await withMember(reader, seeded.postgres, (fresh, tx) => readKnowledgeTree(fresh, tx)),
    ),
  );

const conceptTypeReadBy = async (
  seeded: Seeded,
  reader: UserPrincipal,
  input: ConceptsOfTypeInput,
) =>
  answered(
    answered(
      await withMember(reader, seeded.postgres, (fresh, tx) =>
        readConceptsOfType(fresh, tx, input, now),
      ),
    ),
  );

describe("the knowledge tree", () => {
  it("counts only the concepts the reader may read", async () => {
    const seeded = await seededWorkspace();
    await shelve(seeded, [
      { path: "knowledge/company/expenses.md" },
      { path: "knowledge/company/travel.md" },
      { path: "knowledge/company/salaries.md", sensitivity: "Restricted" },
      { path: "knowledge/company/lease.md", conceptType: "Contract" },
      { path: "knowledge/held/board-minutes.md", sensitivity: "Restricted" },
    ]);

    const viewers = await treeReadBy(seeded, seeded.viewer);
    const admins = await treeReadBy(seeded, seeded.admin);

    expect(viewers).toEqual({
      collections: [
        {
          collection: "company",
          count: 3,
          conceptTypes: [
            { conceptType: "Contract", count: 1 },
            { conceptType: "Policy", count: 2 },
          ],
        },
      ],
    });
    expect(admins).toEqual({
      collections: [
        {
          collection: "company",
          count: 4,
          conceptTypes: [
            { conceptType: "Contract", count: 1 },
            { conceptType: "Policy", count: 3 },
          ],
        },
        { collection: "held", count: 1, conceptTypes: [{ conceptType: "Policy", count: 1 }] },
      ],
    });
  });

  it("never shows a withheld concept to an outside Viewer", async () => {
    const seeded = await seededWorkspace();
    const outside = seeded.viewer;
    const inside = await joined(seeded.workspaceId, "Viewer");
    const hr = await seedingWith(db().pool, async (seed) => {
      const group = await seed.group({ workspaceId: seeded.workspaceId, name: "HR team" });
      await seed.groupMember({
        workspaceId: seeded.workspaceId,
        groupId: group.id,
        userId: inside.userId,
      });
      return group.id;
    });
    const [, withheld] = await shelve(seeded, [
      { path: "knowledge/company/expenses.md" },
      { path: "knowledge/people/grievances.md", audienceGroups: [hr] },
      { path: "knowledge/people/salaries.md", sensitivity: "Restricted" },
      { path: "knowledge/people/rota.md", draft: true },
      { path: "knowledge/drafts/plan.md", draft: true },
    ]);
    const people = { collection: "people", conceptType: "Policy" };

    const insideTree = await treeReadBy(seeded, inside);
    const outsideTree = await treeReadBy(seeded, outside);
    const insideBranch = await conceptTypeReadBy(seeded, inside, people);
    const outsideBranch = await conceptTypeReadBy(seeded, outside, people);

    expect(insideTree.collections.map(({ collection, count }) => [collection, count])).toEqual([
      ["company", 1],
      ["people", 1],
    ]);
    expect(outsideTree.collections.map(({ collection }) => collection)).toEqual(["company"]);
    expect(insideBranch.concepts.map(({ iri }) => iri)).toEqual([withheld]);
    expect(outsideBranch).toEqual({ concepts: [], nextCursor: null });
  });

  it("a concept outside every collection falls under No collection", async () => {
    const seeded = await seededWorkspace();
    const [loose] = await shelve(seeded, [
      { path: "knowledge/loose.md", title: "Loose" },
      { path: "knowledge/company/expenses.md", title: "Expenses" },
      { path: "knowledge/archive/old.md", title: "Old" },
    ]);

    const tree = await treeReadBy(seeded, seeded.viewer);
    const outside = await conceptTypeReadBy(seeded, seeded.viewer, {
      collection: null,
      conceptType: "Policy",
    });

    expect(tree.collections).toEqual([
      { collection: "archive", count: 1, conceptTypes: [{ conceptType: "Policy", count: 1 }] },
      { collection: "company", count: 1, conceptTypes: [{ conceptType: "Policy", count: 1 }] },
      { collection: null, count: 1, conceptTypes: [{ conceptType: "Policy", count: 1 }] },
    ]);
    expect(outside).toEqual({
      concepts: [
        {
          iri: loose,
          title: "Loose",
          conceptType: "Policy",
          trust: { tier: "unverified", status: "current" },
          trustWords: "Unverified",
        },
      ],
      nextCursor: null,
    });
  });
});

const POLICIES = 120;

const numbered = (at: number): string => String(at).padStart(3, "0");

const TIED_ACROSS_THE_PAGE_EDGE = 50;

const policyAt = (at: number): Shelved => ({
  path: `knowledge/company/policy-${numbered(at)}.md`,
  title: `Policy ${numbered(at === TIED_ACROSS_THE_PAGE_EDGE ? at - 1 : at)}`,
});

describe("a type's concepts", () => {
  it("lists a type's concepts fifty at a time", async () => {
    const seeded = await seededWorkspace();
    const iris = await shelve(seeded, [
      ...Array.from({ length: POLICIES }, (_unused, at) => policyAt(POLICIES - 1 - at)),
      { path: "knowledge/company/lease.md", conceptType: "Contract" },
    ]);
    const company = { collection: "company", conceptType: "Policy" };

    const first = await conceptTypeReadBy(seeded, seeded.viewer, company);
    const second = await conceptTypeReadBy(seeded, seeded.viewer, {
      ...company,
      cursor: first.nextCursor,
    });
    const third = await conceptTypeReadBy(seeded, seeded.viewer, {
      ...company,
      cursor: second.nextCursor,
    });

    const listed = [first, second, third].flatMap((page) => page.concepts);
    expect([first, second, third].map((page) => page.concepts.length)).toEqual([50, 50, 20]);
    expect(third.nextCursor).toBeNull();
    expect(new Set(listed.map(({ iri }) => iri))).toEqual(new Set(iris.slice(0, POLICIES)));
    expect(listed.map(({ title }) => title)).toEqual(listed.map(({ title }) => title).toSorted());
    expect(listed.every(({ conceptType }) => conceptType === "Policy")).toBe(true);
  });
});
