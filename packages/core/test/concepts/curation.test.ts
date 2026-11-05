import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { conceptIriOf, ulid, WELL_FORMED_ULID, type ConceptIri } from "@better-answers/schema";

import { allKnowledgeInput, readAllKnowledge, readKinds } from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { withMember, type PostgresDoor } from "../../src/store/postgres/index.ts";
import { joinedAs, shelve, shelveOne, type Shelved } from "../fixtures/concept-shelf.ts";
import { nameOwnerAs, principalFor } from "../fixtures/workspace-with-bundle.ts";
import { provisionedWorkspace } from "../support/platform.ts";
import { answered, postgresForSuite, seedingWith } from "../support/suite-postgres.ts";

const db = postgresForSuite();

const NOW = new Date("2026-11-05T10:00:00Z");

const FIXED = (suffix: string): ConceptIri =>
  conceptIriOf(WELL_FORMED_ULID.parse(`01${suffix.padStart(24, "0")}`));

type Floor = {
  readonly workspaceId: string;
  readonly postgres: PostgresDoor;
  readonly admin: UserPrincipal;

  /** An Editor who owns the company collection. */
  readonly owner: UserPrincipal;

  /** An Editor who owns nothing, so differs from `owner` in ownership alone. */
  readonly idle: UserPrincipal;
  readonly viewer: UserPrincipal;
};

const aFloor = async (): Promise<Floor> => {
  const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Acme");
  const admin = await principalFor(db(), workspaceId, adminUserId);
  const owner = await joinedAs(db(), workspaceId, "Editor", { name: "Olive Owner" });
  await nameOwnerAs(admin, door, { collection: "company", personId: owner.userId });
  return {
    workspaceId,
    postgres: door,
    admin,
    owner,
    idle: await joinedAs(db(), workspaceId, "Editor"),
    viewer: await joinedAs(db(), workspaceId, "Viewer", { name: "Victor Viewer" }),
  };
};

const shelved = (floor: Floor, concepts: readonly Shelved[]) =>
  shelve(db().pool, floor.workspaceId, concepts);

type Asked = Partial<z.input<typeof allKnowledgeInput>>;

type Column = z.input<typeof allKnowledgeInput>["sort"]["column"];

const asked = (overrides: Asked = {}) =>
  allKnowledgeInput.parse({
    collections: [],
    sort: { column: "title", desc: false },
    ...overrides,
  });

const allKnowledgeAs = (floor: Floor, reader: UserPrincipal, input = asked()) =>
  withMember(reader, floor.postgres, (fresh, tx) => readAllKnowledge(fresh, tx, input, NOW));

const kindsAs = (floor: Floor, reader: UserPrincipal) =>
  withMember(reader, floor.postgres, (fresh, tx) => readKinds(fresh, tx));

const knowledgeRead = async (floor: Floor, reader: UserPrincipal, input = asked()) =>
  answered(answered(await allKnowledgeAs(floor, reader, input)));

const kindsRead = async (floor: Floor, reader: UserPrincipal) =>
  answered(answered(await kindsAs(floor, reader))).kinds;

const READS = [
  ["All knowledge", (floor: Floor, reader: UserPrincipal) => allKnowledgeAs(floor, reader)],
  ["Kinds", (floor: Floor, reader: UserPrincipal) => kindsAs(floor, reader)],
] as const;

const REFUSED = { ok: true, value: { ok: false, error: "owner-forbids" } };

const ADMITTED = { ok: true, value: { ok: true } };

describe("who may read the Curation tables", () => {
  it.each(READS)("an Editor owning nothing is refused %s", async (_name, read) => {
    const floor = await aFloor();
    await shelved(floor, [{ path: "knowledge/company/expenses.md" }]);

    const owning = await read(floor, floor.owner);
    const owningNothing = await read(floor, floor.idle);

    expect(owning).toMatchObject(ADMITTED);
    expect(owningNothing).toEqual(REFUSED);
  });

  it("reads rows for an Editor who owns a collection", async () => {
    const floor = await aFloor();
    await shelved(floor, [{ path: "knowledge/company/expenses.md", title: "Expenses" }]);

    const owning = await knowledgeRead(floor, floor.owner);

    expect(owning.rows.map(({ title }) => title)).toEqual(["Expenses"]);
  });

  it.each(READS)("a Viewer owning nothing is refused %s", async (_name, read) => {
    const floor = await aFloor();

    expect(await read(floor, floor.viewer)).toEqual(REFUSED);
  });

  it.each(READS)("an Admin owning nothing is admitted to %s", async (_name, read) => {
    const floor = await aFloor();

    expect(await read(floor, floor.admin)).toMatchObject(ADMITTED);
  });

  it.each(READS)("a Viewer owning a collection is admitted to %s", async (_name, read) => {
    const floor = await aFloor();
    await nameOwnerAs(floor.admin, floor.postgres, {
      collection: "people",
      personId: floor.viewer.userId,
    });

    expect(await read(floor, floor.viewer)).toMatchObject(ADMITTED);
  });

  it.each(READS)("a person owning only one concept is refused %s", async (_name, read) => {
    const floor = await aFloor();
    const iri = await shelveOne(db().pool, floor.workspaceId, { path: "knowledge/people/rota.md" });
    await nameOwnerAs(floor.admin, floor.postgres, { iri, personId: floor.viewer.userId });

    expect(await read(floor, floor.viewer)).toEqual(REFUSED);
  });

  it.each(READS)("an owner whose collection is cleared is refused %s", async (_name, read) => {
    const floor = await aFloor();
    const before = await read(floor, floor.owner);
    await nameOwnerAs(floor.admin, floor.postgres, { collection: "company", personId: null });

    const after = await read(floor, floor.owner);

    expect(before).toMatchObject(ADMITTED);
    expect(after).toEqual(REFUSED);
  });
});

describe("what All knowledge says of each concept", () => {
  it("All knowledge names each concept's owner and last checker", async () => {
    const floor = await aFloor();
    const priya = await joinedAs(db(), floor.workspaceId, "Editor", { name: "Priya Anand" });
    const quentin = await joinedAs(db(), floor.workspaceId, "Editor", { name: "Quentin Quill" });
    const formerMember = `human:${ulid()}`;
    await shelved(floor, [
      {
        iri: FIXED("A"),
        path: "knowledge/company/expenses.md",
        title: "Expenses",
        checks: [
          { actor: `human:${quentin.userId}`, at: new Date("2026-09-01T09:00:00Z") },
          { actor: `human:${priya.userId}`, at: new Date("2026-10-03T09:00:00Z") },
        ],
      },
      {
        iri: FIXED("B"),
        path: "knowledge/company/travel.md",
        title: "Travel",
        checks: [{ actor: formerMember, at: new Date("2026-10-04T09:00:00Z") }],
      },
      {
        iri: FIXED("C"),
        path: "knowledge/company/holiday.md",
        title: "Holiday",
        checks: [{ actor: `human:${priya.userId}`, at: new Date("2026-07-31T23:30:00Z") }],
      },
      { iri: FIXED("D"), path: "knowledge/company/lease.md", title: "Lease", kind: "Contract" },
      {
        iri: FIXED("E"),
        path: "knowledge/loose.md",
        title: "Loose",
        checks: [{ actor: "process:better-answers-test", at: new Date("2026-10-05T09:00:00Z") }],
      },
      { iri: FIXED("F"), path: "knowledge/archive/old.md", title: "Archive" },
    ]);
    await nameOwnerAs(floor.admin, floor.postgres, {
      iri: FIXED("D"),
      personId: floor.viewer.userId,
    });
    const olive = { id: floor.owner.userId, name: "Olive Owner", own: false };
    const victor = { id: floor.viewer.userId, name: "Victor Viewer", own: true };

    const read = await knowledgeRead(floor, floor.admin);

    expect(read.rows).toEqual([
      {
        iri: FIXED("F"),
        title: "Archive",
        kind: "Policy",
        collection: "archive",
        trustWords: "Unverified",
        owner: null,
        checkedBy: null,
        checkedOn: null,
      },
      {
        iri: FIXED("A"),
        title: "Expenses",
        kind: "Policy",
        collection: "company",
        trustWords: "Verified by Priya Anand · 3 October 2026",
        owner: olive,
        checkedBy: "Priya Anand",
        checkedOn: "3 October 2026",
      },
      {
        iri: FIXED("C"),
        title: "Holiday",
        kind: "Policy",
        collection: "company",
        trustWords: "Verified by Priya Anand · 1 August 2026",
        owner: olive,
        checkedBy: "Priya Anand",
        checkedOn: "1 August 2026",
      },
      {
        iri: FIXED("D"),
        title: "Lease",
        kind: "Contract",
        collection: "company",
        trustWords: "Unverified",
        owner: victor,
        checkedBy: null,
        checkedOn: null,
      },
      {
        iri: FIXED("E"),
        title: "Loose",
        kind: "Policy",
        collection: null,
        trustWords: "Verified automatically",
        owner: null,
        checkedBy: "an automatic check",
        checkedOn: "5 October 2026",
      },
      {
        iri: FIXED("B"),
        title: "Travel",
        kind: "Policy",
        collection: "company",
        trustWords: "Verified by a former member · 4 October 2026",
        owner: olive,
        checkedBy: "a former member",
        checkedOn: "4 October 2026",
      },
    ]);
    expect(read).toMatchObject({ total: 6, page: 1, pageSize: 50 });
    expect(JSON.stringify(read)).not.toContain(formerMember);
  });

  it("names the checker of a concept changed since", async () => {
    const floor = await aFloor();
    const priya = await joinedAs(db(), floor.workspaceId, "Editor", { name: "Priya Anand" });
    const iri = await shelveOne(db().pool, floor.workspaceId, { path: "knowledge/company/a.md" });
    await seedingWith(db().pool, (seed) =>
      seed.conceptVerification({
        workspaceId: floor.workspaceId,
        iri,
        actor: `human:${priya.userId}`,
        verifiedAt: new Date("2026-10-03T09:00:00Z"),
      }),
    );

    const read = await knowledgeRead(floor, floor.admin);

    expect(read.rows).toMatchObject([
      {
        trustWords: "Changed since verified",
        checkedBy: "Priya Anand",
        checkedOn: "3 October 2026",
      },
    ]);
  });
});

const checked = (priya: UserPrincipal, on: string) => [
  { actor: `human:${priya.userId}`, at: new Date(on) },
];

const sortedFloor = async () => {
  const floor = await aFloor();
  const priya = await joinedAs(db(), floor.workspaceId, "Editor", { name: "Priya Anand" });
  await shelved(floor, [
    {
      iri: FIXED("A"),
      path: "knowledge/company/a.md",
      title: "Alpha",
      checks: checked(priya, "2026-01-10T09:00:00Z"),
    },
    {
      iri: FIXED("B"),
      path: "knowledge/company/b.md",
      title: "Alpha",
      kind: "Contract",
      checks: checked(priya, "2026-03-01T09:00:00Z"),
    },
    { iri: FIXED("C"), path: "knowledge/people/c.md", title: "beta" },
    { iri: FIXED("D"), path: "knowledge/d.md", title: "Gamma", kind: "Contract" },
    {
      iri: FIXED("E"),
      path: "knowledge/people/e.md",
      title: "Delta",
      kind: "Standard",
      checks: checked(priya, "2026-03-01T09:00:00Z"),
    },
  ]);
  await nameOwnerAs(floor.admin, floor.postgres, {
    collection: "people",
    personId: floor.viewer.userId,
  });
  await nameOwnerAs(floor.admin, floor.postgres, {
    iri: FIXED("B"),
    personId: floor.viewer.userId,
  });
  return floor;
};

const lettersOf = (rows: readonly { readonly iri: ConceptIri }[]): string =>
  rows.map(({ iri }) => iri.slice(-1)).join("");

describe("sorting, filtering and paging All knowledge", () => {
  it.each([
    ["title", false, "ABEDC"],
    ["title", true, "CDEAB"],
    ["kind", false, "BDACE"],
    ["kind", true, "EACBD"],
    ["collection", false, "ABCED"],
    ["collection", true, "DCEAB"],
    ["owner", false, "ABCED"],
    ["owner", true, "DBCEA"],
    ["checked", false, "CDABE"],
    ["checked", true, "BEACD"],
  ] as const)("sorts by %s, descending %s", async (column, desc, letters) => {
    const floor = await sortedFloor();

    const read = await knowledgeRead(floor, floor.admin, asked({ sort: { column, desc } }));

    expect(lettersOf(read.rows)).toBe(letters);
    expect(read.total).toBe(5);
  });

  it.each<[Column, (group: number, at: string) => Omit<Shelved, "iri">]>([
    ["title", (group, at) => ({ path: `knowledge/company/${at}.md`, title: `Group ${group}` })],
    [
      "kind",
      (group, at) => ({ path: `knowledge/company/${at}.md`, title: "Same", kind: `Kind ${group}` }),
    ],
    ["collection", (group, at) => ({ path: `knowledge/group-${group}/${at}.md`, title: "Same" })],
  ])("breaks a tie in %s by the concept, either way", async (column, grouped) => {
    const floor = await aFloor();
    const GROUPS = 5;
    const tied = Array.from({ length: 40 }, (_unused, at) => FIXED(String(at).padStart(2, "0")));
    await shelved(
      floor,
      tied.toReversed().map((iri) => {
        const at = iri.slice(-2);
        return { iri, ...grouped(Number(at) % GROUPS, at) };
      }),
    );
    const inGroup = (group: number) => tied.filter((_iri, at) => at % GROUPS === group);
    const groups = Array.from({ length: GROUPS }, (_unused, group) => group);

    const up = await knowledgeRead(floor, floor.admin, asked({ sort: { column, desc: false } }));
    const down = await knowledgeRead(floor, floor.admin, asked({ sort: { column, desc: true } }));

    expect(up.rows.map(({ iri }) => iri)).toEqual(groups.flatMap(inGroup));
    expect(down.rows.map(({ iri }) => iri)).toEqual(groups.toReversed().flatMap(inGroup));
  });

  it("keeps each concept's checker beside it under any sort", async () => {
    const floor = await sortedFloor();

    const read = await knowledgeRead(
      floor,
      floor.admin,
      asked({ sort: { column: "checked", desc: true } }),
    );

    expect(read.rows.map(({ checkedOn }) => checkedOn)).toEqual([
      "1 March 2026",
      "1 March 2026",
      "10 January 2026",
      null,
      null,
    ]);
  });

  it.each<[string, Asked, string]>([
    ["a collection", { collections: ["people"] }, "EC"],
    ["two collections", { collections: ["company", "people"] }, "ABEC"],
    ["a kind", { kind: "Contract" }, "BD"],
    ["a collection and a kind", { collections: ["company"], kind: "Policy" }, "A"],
    ["a collection holding no such kind", { collections: ["people"], kind: "Contract" }, ""],
    ["a collection holding nothing", { collections: ["archive"] }, ""],
  ])("filters by %s", async (_name, filter, letters) => {
    const floor = await sortedFloor();

    const read = await knowledgeRead(floor, floor.admin, asked(filter));

    expect(lettersOf(read.rows)).toBe(letters);
    expect(read.total).toBe(letters.length);
  });

  it("pages fifty at a time and reports the total", async () => {
    const floor = await aFloor();
    const numbered = (at: number) => String(at).padStart(3, "0");
    await shelved(
      floor,
      Array.from({ length: 120 }, (_unused, at) => ({
        path: `knowledge/company/policy-${numbered(at)}.md`,
        title: `Policy ${numbered(at)}`,
      })),
    );

    const reads = await Promise.all(
      [1, 2, 3, 4].map((page) => knowledgeRead(floor, floor.owner, asked({ page }))),
    );

    expect(reads.map((read) => read.rows.length)).toEqual([50, 50, 20, 0]);
    expect(reads.map((read) => read.total)).toEqual([120, 120, 120, 120]);
    expect(reads.map((read) => read.page)).toEqual([1, 2, 3, 4]);
    const titles = reads.flatMap((read) => read.rows.map(({ title }) => title));
    expect(titles).toEqual(Array.from({ length: 120 }, (_unused, at) => `Policy ${numbered(at)}`));
  });

  it.each([false, true])(
    "pages tied concepts without repeating or missing one, descending %s",
    async (desc) => {
      const floor = await aFloor();
      const tied = Array.from({ length: 120 }, (_unused, at) => FIXED(String(at).padStart(3, "0")));
      await shelved(
        floor,
        tied.toReversed().map((iri) => ({
          iri,
          path: `knowledge/company/${iri.slice(-3)}.md`,
          title: "Same",
        })),
      );

      const reads = await Promise.all(
        [1, 2, 3].map((page) =>
          knowledgeRead(floor, floor.admin, asked({ page, sort: { column: "title", desc } })),
        ),
      );

      expect(reads.flatMap((read) => read.rows.map(({ iri }) => iri))).toEqual(tied);
    },
  );

  it("reports the filtered total on a page past the end", async () => {
    const floor = await sortedFloor();

    const past = await knowledgeRead(
      floor,
      floor.admin,
      asked({ collections: ["company"], page: 9 }),
    );

    expect(past).toEqual({ rows: [], total: 2, page: 9, pageSize: 50 });
  });

  it("reports an empty table as nothing on its first page", async () => {
    const floor = await aFloor();

    const read = await knowledgeRead(floor, floor.admin);

    expect(read).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
  });

  it.each([
    ["a collection with a slash", { collections: ["company/policy"] }],
    ["a collection with a space", { collections: ["our policy"] }],
    ["a dot as a collection", { collections: ["."] }],
    ["an empty collection", { collections: [""] }],
    ["page zero", { page: 0 }],
    ["a fractional page", { page: 1.5 }],
    ["an empty kind", { kind: " " }],
    ["a sort by something else", { sort: { column: "body", desc: false } }],
    ["a stray key", { colour: "red" }],
  ])("refuses %s at the input", (_name, overrides) => {
    const parsed = allKnowledgeInput.safeParse({
      collections: [],
      sort: { column: "title", desc: false },
      ...overrides,
    });

    expect(parsed.success).toBe(false);
  });

  it("starts at page one when the page is left out", () => {
    const parsed = allKnowledgeInput.parse({
      collections: [],
      sort: { column: "title", desc: false },
    });

    expect(parsed.page).toBe(1);
  });
});

describe("reading what the reader may read", () => {
  const shelveCompany = (floor: Floor, hr: string) =>
    shelved(floor, [
      { path: "knowledge/company/expenses.md", title: "Expenses" },
      { path: "knowledge/company/travel.md", title: "Travel" },
      { path: "knowledge/company/lease.md", title: "Lease", kind: "Contract" },
      { path: "knowledge/company/salaries.md", title: "Salaries", sensitivity: "Restricted" },
      { path: "knowledge/company/grievances.md", title: "Grievances", audienceGroups: [hr] },
      { path: "knowledge/people/rota.md", title: "Rota" },
      {
        path: "knowledge/people/appraisals.md",
        title: "Appraisals",
        kind: "Appraisal",
        audienceGroups: [hr],
      },
      { path: "knowledge/loose.md", title: "Loose", kind: "Contract" },
    ]);

  const floorWithHr = async () => {
    const floor = await aFloor();
    const { id } = await seedingWith(db().pool, (seed) =>
      seed.group({ workspaceId: floor.workspaceId, name: "HR team" }),
    );
    const hrOwner = await joinedAs(db(), floor.workspaceId, "Editor", { group: id });
    await nameOwnerAs(floor.admin, floor.postgres, {
      collection: "people",
      personId: hrOwner.userId,
    });
    await shelveCompany(floor, id);
    return { floor, hrOwner };
  };

  it("kind counts leave out a concept the reader cannot read", async () => {
    const { floor, hrOwner } = await floorWithHr();

    const outside = await kindsRead(floor, floor.owner);
    const inside = await kindsRead(floor, hrOwner);
    const admins = await kindsRead(floor, floor.admin);

    expect(outside).toEqual([
      {
        kind: "Contract",
        count: 2,
        collections: [
          { collection: "company", count: 1 },
          { collection: null, count: 1 },
        ],
      },
      {
        kind: "Policy",
        count: 3,
        collections: [
          { collection: "company", count: 2 },
          { collection: "people", count: 1 },
        ],
      },
    ]);
    expect(inside).toEqual([
      { kind: "Appraisal", count: 1, collections: [{ collection: "people", count: 1 }] },
      {
        kind: "Contract",
        count: 2,
        collections: [
          { collection: "company", count: 1 },
          { collection: null, count: 1 },
        ],
      },
      {
        kind: "Policy",
        count: 4,
        collections: [
          { collection: "company", count: 3 },
          { collection: "people", count: 1 },
        ],
      },
    ]);
    expect(admins.map(({ kind, count }) => [kind, count])).toEqual([
      ["Contract", 2],
      ["Policy", 4],
    ]);
  });

  it("names no withheld concept in All knowledge", async () => {
    const { floor, hrOwner } = await floorWithHr();

    const outside = await knowledgeRead(floor, floor.owner);
    const inside = await knowledgeRead(floor, hrOwner);
    const admins = await knowledgeRead(floor, floor.admin);

    expect(outside.rows.map(({ title }) => title)).toEqual([
      "Expenses",
      "Lease",
      "Loose",
      "Rota",
      "Travel",
    ]);
    expect(inside.rows.map(({ title }) => title)).toEqual([
      "Appraisals",
      "Expenses",
      "Grievances",
      "Lease",
      "Loose",
      "Rota",
      "Travel",
    ]);
    expect(admins.rows.map(({ title }) => title)).toEqual([
      "Expenses",
      "Lease",
      "Loose",
      "Rota",
      "Salaries",
      "Travel",
    ]);
    expect([outside.total, inside.total, admins.total]).toEqual([5, 7, 6]);
  });

  it("counts a withheld concept in no filter, kind or total", async () => {
    const { floor } = await floorWithHr();

    const filtered = await knowledgeRead(floor, floor.owner, asked({ collections: ["people"] }));
    const ofKind = await knowledgeRead(floor, floor.owner, asked({ kind: "Appraisal" }));
    const secondPage = await knowledgeRead(floor, floor.owner, asked({ page: 2 }));

    expect(filtered.rows.map(({ title }) => title)).toEqual(["Rota"]);
    expect(filtered.total).toBe(1);
    expect(ofKind).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
    expect(secondPage.total).toBe(5);
  });

  it("leaves a draft out of the tables for everyone", async () => {
    const floor = await aFloor();
    await shelved(floor, [
      { path: "knowledge/company/plan.md", title: "Plan", draft: true },
      { path: "knowledge/company/expenses.md", title: "Expenses" },
    ]);

    const read = await knowledgeRead(floor, floor.admin);
    const kinds = await kindsRead(floor, floor.admin);

    expect(read.rows.map(({ title }) => title)).toEqual(["Expenses"]);
    expect(kinds.map(({ count }) => count)).toEqual([1]);
  });
});
