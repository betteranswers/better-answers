import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { conceptIriOf, ulid, WELL_FORMED_ULID, type ConceptIri } from "@better-answers/schema";

import { allKnowledgeInput, readAllKnowledge, readConceptTypes } from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { withMember, type PostgresDoor } from "../../src/store/postgres/index.ts";
import {
  joinedAs,
  seedWideKnowledge,
  shelve,
  shelveOne,
  type Shelved,
} from "../fixtures/concept-shelf.ts";
import { nameOwnerAs, principalFor } from "../fixtures/workspace-with-bundle.ts";
import { provisionedWorkspace } from "../support/platform.ts";
import { answered, postgresForSuite, seedingWith } from "../support/suite-postgres.ts";

const db = postgresForSuite();

const NOW = new Date("2026-11-05T10:00:00Z");

const FIXED = (suffix: string): ConceptIri =>
  conceptIriOf(WELL_FORMED_ULID.parse(`01${suffix.padStart(24, "0")}`));

type Seeded = {
  readonly workspaceId: string;
  readonly postgres: PostgresDoor;
  readonly admin: UserPrincipal;
  readonly owner: UserPrincipal;
  readonly ownsNothing: UserPrincipal;
  readonly viewer: UserPrincipal;
};

const seededWorkspace = async (): Promise<Seeded> => {
  const { door, workspaceId, adminUserId } = await provisionedWorkspace(db(), "Acme");
  const admin = await principalFor(db(), workspaceId, adminUserId);
  const owner = await joinedAs(db(), workspaceId, "Editor", { name: "Olive Owner" });
  await nameOwnerAs(admin, door, { collection: "company", personId: owner.userId });
  return {
    workspaceId,
    postgres: door,
    admin,
    owner,
    ownsNothing: await joinedAs(db(), workspaceId, "Editor"),
    viewer: await joinedAs(db(), workspaceId, "Viewer", { name: "Victor Viewer" }),
  };
};

const shelved = (seeded: Seeded, concepts: readonly Shelved[]) =>
  shelve(db().pool, seeded.workspaceId, concepts);

type Asked = Partial<z.input<typeof allKnowledgeInput>>;

type Column = z.input<typeof allKnowledgeInput>["sort"]["column"];

const asked = (overrides: Asked = {}) =>
  allKnowledgeInput.parse({
    collections: [],
    sort: { column: "title", desc: false },
    ...overrides,
  });

const allKnowledgeAs = (seeded: Seeded, reader: UserPrincipal, input = asked()) =>
  withMember(reader, seeded.postgres, (fresh, tx) => readAllKnowledge(fresh, tx, input, NOW));

const conceptTypesAs = (seeded: Seeded, reader: UserPrincipal) =>
  withMember(reader, seeded.postgres, (fresh, tx) => readConceptTypes(fresh, tx));

const knowledgeRead = async (seeded: Seeded, reader: UserPrincipal, input = asked()) =>
  answered(answered(await allKnowledgeAs(seeded, reader, input)));

const conceptTypesRead = async (seeded: Seeded, reader: UserPrincipal) =>
  answered(answered(await conceptTypesAs(seeded, reader))).conceptTypes;

const READS = [
  ["All knowledge", (seeded: Seeded, reader: UserPrincipal) => allKnowledgeAs(seeded, reader)],
  ["Concept Types", (seeded: Seeded, reader: UserPrincipal) => conceptTypesAs(seeded, reader)],
] as const;

const REFUSED = { ok: true, value: { ok: false, error: "owner-forbids" } };

const ADMITTED = { ok: true, value: { ok: true } };

describe("who may read the Curation tables", () => {
  it.each(READS)("refuses %s to an Editor who owns nothing", async (_name, read) => {
    const seeded = await seededWorkspace();
    await shelved(seeded, [{ path: "knowledge/company/expenses.md" }]);

    const owning = await read(seeded, seeded.owner);
    const owningNothing = await read(seeded, seeded.ownsNothing);

    expect(owning).toMatchObject(ADMITTED);
    expect(owningNothing).toEqual(REFUSED);
  });

  it("reads rows for an Editor who owns a collection", async () => {
    const seeded = await seededWorkspace();
    await shelved(seeded, [{ path: "knowledge/company/expenses.md", title: "Expenses" }]);

    const owning = await knowledgeRead(seeded, seeded.owner);

    expect(owning.rows.map(({ title }) => title)).toEqual(["Expenses"]);
  });

  it.each(READS)("refuses %s to a Viewer who owns nothing", async (_name, read) => {
    const seeded = await seededWorkspace();

    expect(await read(seeded, seeded.viewer)).toEqual(REFUSED);
  });

  it.each(READS)("admits an Admin who owns nothing to %s", async (_name, read) => {
    const seeded = await seededWorkspace();

    expect(await read(seeded, seeded.admin)).toMatchObject(ADMITTED);
  });

  it.each(READS)("admits a Viewer who owns a collection to %s", async (_name, read) => {
    const seeded = await seededWorkspace();
    await nameOwnerAs(seeded.admin, seeded.postgres, {
      collection: "people",
      personId: seeded.viewer.userId,
    });

    expect(await read(seeded, seeded.viewer)).toMatchObject(ADMITTED);
  });

  it.each(READS)("refuses %s to someone who owns only one concept", async (_name, read) => {
    const seeded = await seededWorkspace();
    const iri = await shelveOne(db().pool, seeded.workspaceId, {
      path: "knowledge/people/rota.md",
    });
    await nameOwnerAs(seeded.admin, seeded.postgres, { iri, personId: seeded.viewer.userId });

    expect(await read(seeded, seeded.viewer)).toEqual(REFUSED);
  });

  it.each(READS)("refuses %s to an owner whose collection was cleared", async (_name, read) => {
    const seeded = await seededWorkspace();
    const before = await read(seeded, seeded.owner);
    await nameOwnerAs(seeded.admin, seeded.postgres, { collection: "company", personId: null });

    const after = await read(seeded, seeded.owner);

    expect(before).toMatchObject(ADMITTED);
    expect(after).toEqual(REFUSED);
  });
});

describe("the All knowledge row for each concept", () => {
  it("names each concept's owner and last checker", async () => {
    const seeded = await seededWorkspace();
    const priya = await joinedAs(db(), seeded.workspaceId, "Editor", { name: "Priya Anand" });
    const quentin = await joinedAs(db(), seeded.workspaceId, "Editor", { name: "Quentin Quill" });
    const formerMember = `human:${ulid()}`;
    await shelved(seeded, [
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
      {
        iri: FIXED("D"),
        path: "knowledge/company/lease.md",
        title: "Lease",
        conceptType: "Contract",
      },
      {
        iri: FIXED("E"),
        path: "knowledge/loose.md",
        title: "Loose",
        checks: [{ actor: "process:better-answers-test", at: new Date("2026-10-05T09:00:00Z") }],
      },
      { iri: FIXED("F"), path: "knowledge/archive/old.md", title: "Archive" },
    ]);
    await nameOwnerAs(seeded.admin, seeded.postgres, {
      iri: FIXED("D"),
      personId: seeded.viewer.userId,
    });
    const olive = { id: seeded.owner.userId, name: "Olive Owner", own: false };
    const victor = { id: seeded.viewer.userId, name: "Victor Viewer", own: true };

    const read = await knowledgeRead(seeded, seeded.admin);

    expect(read.rows).toEqual([
      {
        iri: FIXED("F"),
        title: "Archive",
        conceptType: "Policy",
        collection: "archive",
        trust: { tier: "unverified", status: "current" },
        trustWords: "Unverified",
        owner: null,
        checkedBy: null,
        checkedOn: null,
      },
      {
        iri: FIXED("A"),
        title: "Expenses",
        conceptType: "Policy",
        collection: "company",
        trust: { tier: "human-reviewed", status: "current" },
        trustWords: "Verified by Priya Anand · 3 October 2026",
        owner: olive,
        checkedBy: "Priya Anand",
        checkedOn: "3 October 2026",
      },
      {
        iri: FIXED("C"),
        title: "Holiday",
        conceptType: "Policy",
        collection: "company",
        trust: { tier: "human-reviewed", status: "current" },
        trustWords: "Verified by Priya Anand · 1 August 2026",
        owner: olive,
        checkedBy: "Priya Anand",
        checkedOn: "1 August 2026",
      },
      {
        iri: FIXED("D"),
        title: "Lease",
        conceptType: "Contract",
        collection: "company",
        trust: { tier: "unverified", status: "current" },
        trustWords: "Unverified",
        owner: victor,
        checkedBy: null,
        checkedOn: null,
      },
      {
        iri: FIXED("E"),
        title: "Loose",
        conceptType: "Policy",
        collection: null,
        trust: { tier: "machine-confirmed", status: "current" },
        trustWords: "Verified automatically",
        owner: null,
        checkedBy: null,
        checkedOn: "5 October 2026",
      },
      {
        iri: FIXED("B"),
        title: "Travel",
        conceptType: "Policy",
        collection: "company",
        trust: { tier: "human-reviewed", status: "current" },
        trustWords: "Verified by a former member · 4 October 2026",
        owner: olive,
        checkedBy: "a former member",
        checkedOn: "4 October 2026",
      },
    ]);
    expect(read).toMatchObject({ total: 6, page: 1, pageSize: 50 });
    expect(JSON.stringify(read)).not.toContain(formerMember);
  });

  it("names the last checker of a concept changed since verified", async () => {
    const seeded = await seededWorkspace();
    const priya = await joinedAs(db(), seeded.workspaceId, "Editor", { name: "Priya Anand" });
    const iri = await shelveOne(db().pool, seeded.workspaceId, { path: "knowledge/company/a.md" });
    await seedingWith(db().pool, (seed) =>
      seed.conceptVerification({
        workspaceId: seeded.workspaceId,
        iri,
        actor: `human:${priya.userId}`,
        verifiedAt: new Date("2026-10-03T09:00:00Z"),
      }),
    );

    const read = await knowledgeRead(seeded, seeded.admin);

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

const priyaIn = (seeded: Seeded) =>
  joinedAs(db(), seeded.workspaceId, "Editor", { name: "Priya Anand" });

const seededForSorting = async () => {
  const seeded = await seededWorkspace();
  const priya = await priyaIn(seeded);
  await shelved(seeded, [
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
      conceptType: "Contract",
      checks: checked(priya, "2026-03-01T09:00:00Z"),
    },
    { iri: FIXED("C"), path: "knowledge/people/c.md", title: "beta" },
    { iri: FIXED("D"), path: "knowledge/d.md", title: "Gamma", conceptType: "Contract" },
    {
      iri: FIXED("E"),
      path: "knowledge/people/e.md",
      title: "Delta",
      conceptType: "Standard",
      checks: checked(priya, "2026-03-01T09:00:00Z"),
    },
  ]);
  await nameOwnerAs(seeded.admin, seeded.postgres, {
    collection: "people",
    personId: seeded.viewer.userId,
  });
  await nameOwnerAs(seeded.admin, seeded.postgres, {
    iri: FIXED("B"),
    personId: seeded.viewer.userId,
  });
  return seeded;
};

const lettersOf = (rows: readonly { readonly iri: ConceptIri }[]): string =>
  rows.map(({ iri }) => iri.slice(-1)).join("");

describe("sorting, filtering and paging All knowledge", () => {
  it.each([
    ["title", false, "ABEDC"],
    ["title", true, "CDEAB"],
    ["type", false, "BDACE"],
    ["type", true, "EACBD"],
    ["collection", false, "ABCED"],
    ["collection", true, "DCEAB"],
    ["owner", false, "ABCED"],
    ["owner", true, "DBCEA"],
    ["trust", false, "CDABE"],
    ["trust", true, "BEACD"],
  ] as const)("sorts by %s, descending %s", async (column, desc, letters) => {
    const seeded = await seededForSorting();

    const read = await knowledgeRead(seeded, seeded.admin, asked({ sort: { column, desc } }));

    expect(lettersOf(read.rows)).toBe(letters);
    expect(read.total).toBe(5);
  });

  it.each<[Column, (group: number, at: string) => Omit<Shelved, "iri">]>([
    ["title", (group, at) => ({ path: `knowledge/company/${at}.md`, title: `Group ${group}` })],
    [
      "type",
      (group, at) => ({
        path: `knowledge/company/${at}.md`,
        title: "Same",
        conceptType: `Type ${group}`,
      }),
    ],
    ["collection", (group, at) => ({ path: `knowledge/group-${group}/${at}.md`, title: "Same" })],
  ])("breaks a tie in %s by the concept, either way", async (column, grouped) => {
    const seeded = await seededWorkspace();
    const GROUPS = 5;
    const tied = Array.from({ length: 40 }, (_unused, at) => FIXED(String(at).padStart(2, "0")));
    await shelved(
      seeded,
      tied.toReversed().map((iri) => {
        const at = iri.slice(-2);
        return { iri, ...grouped(Number(at) % GROUPS, at) };
      }),
    );
    const inGroup = (group: number) => tied.filter((_iri, at) => at % GROUPS === group);
    const groups = Array.from({ length: GROUPS }, (_unused, group) => group);

    const up = await knowledgeRead(seeded, seeded.admin, asked({ sort: { column, desc: false } }));
    const down = await knowledgeRead(seeded, seeded.admin, asked({ sort: { column, desc: true } }));

    expect(up.rows.map(({ iri }) => iri)).toEqual(groups.flatMap(inGroup));
    expect(down.rows.map(({ iri }) => iri)).toEqual(groups.toReversed().flatMap(inGroup));
  });

  it("keeps each concept's checker on its row under every sort", async () => {
    const seeded = await seededForSorting();

    const read = await knowledgeRead(
      seeded,
      seeded.admin,
      asked({ sort: { column: "trust", desc: true } }),
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
    ["a type", { conceptType: "Contract" }, "BD"],
    ["a collection and a type", { collections: ["company"], conceptType: "Policy" }, "A"],
    ["a collection holding no such type", { collections: ["people"], conceptType: "Contract" }, ""],
    ["a collection holding nothing", { collections: ["archive"] }, ""],
  ])("filters by %s", async (_name, filter, letters) => {
    const seeded = await seededForSorting();

    const read = await knowledgeRead(seeded, seeded.admin, asked(filter));

    expect(lettersOf(read.rows)).toBe(letters);
    expect(read.total).toBe(letters.length);
  });

  describe("by the trust word a concept shows", () => {
    const seededForTrust = async () => {
      const seeded = await seededWorkspace();
      const priya = await priyaIn(seeded);
      await shelved(seeded, [
        { iri: FIXED("A"), path: "knowledge/company/a.md", title: "Unverified" },
        {
          iri: FIXED("B"),
          path: "knowledge/company/b.md",
          title: "Verified",
          checks: checked(priya, "2026-10-01T09:00:00Z"),
        },
        {
          iri: FIXED("C"),
          path: "knowledge/people/c.md",
          title: "Out of date",
          staleAfter: "2026-10-01",
        },
        {
          iri: FIXED("D"),
          path: "knowledge/people/d.md",
          title: "Out of date and verified",
          staleAfter: "2026-10-01",
          checks: checked(priya, "2026-09-01T09:00:00Z"),
        },
        { iri: FIXED("E"), path: "knowledge/company/e.md", title: "Deprecated", deprecated: true },
        { iri: FIXED("F"), path: "knowledge/company/f.md", title: "Changed since verified" },
      ]);
      await seedingWith(db().pool, (seed) =>
        seed.conceptVerification({
          workspaceId: seeded.workspaceId,
          iri: FIXED("F"),
          actor: `human:${priya.userId}`,
          verifiedAt: new Date("2026-10-03T09:00:00Z"),
        }),
      );
      return seeded;
    };

    it.each<[NonNullable<Asked["trust"]>, string, string]>([
      ["unverified", "A", "Unverified"],
      ["out-of-date", "CD", "Out of date"],
      ["changed-since-checked", "F", "Changed since verified"],
      ["deprecated", "E", "Deprecated"],
    ])("lists only %s concepts and counts only them", async (trust, letters, words) => {
      const seeded = await seededForTrust();

      const read = await knowledgeRead(seeded, seeded.admin, asked({ trust }));

      expect(lettersOf(read.rows)).toBe(letters);
      expect(read.total).toBe(letters.length);
      expect(read.rows.map((row) => row.trustWords)).toEqual(Array.from(letters, () => words));
    });

    it("narrows by trust with a collection, type and sort", async () => {
      const seeded = await seededForTrust();

      const read = await knowledgeRead(
        seeded,
        seeded.admin,
        asked({
          trust: "out-of-date",
          collections: ["people"],
          conceptType: "Policy",
          sort: { column: "trust", desc: true },
        }),
      );

      expect(lettersOf(read.rows)).toBe("DC");
      expect(read.total).toBe(2);
    });

    it("pages the concepts that show a trust word", async () => {
      const seeded = await seededWorkspace();
      const numbered = (at: number) => String(at).padStart(3, "0");
      await shelved(
        seeded,
        Array.from({ length: 60 }, (_unused, at) => ({
          path: `knowledge/company/old-${numbered(at)}.md`,
          title: `Old ${numbered(at)}`,
          staleAfter: "2026-10-01",
        })),
      );
      await shelved(seeded, [{ path: "knowledge/company/new.md", title: "New" }]);

      const reads = await Promise.all(
        [1, 2, 3].map((page) =>
          knowledgeRead(seeded, seeded.admin, asked({ trust: "out-of-date", page })),
        ),
      );

      expect(reads.map((read) => read.rows.length)).toEqual([50, 10, 0]);
      expect(reads.map((read) => read.total)).toEqual([60, 60, 60]);
    });
  });

  it("pages fifty at a time and reports the total", async () => {
    const seeded = await seededWorkspace();
    const numbered = (at: number) => String(at).padStart(3, "0");
    await shelved(
      seeded,
      Array.from({ length: 120 }, (_unused, at) => ({
        path: `knowledge/company/policy-${numbered(at)}.md`,
        title: `Policy ${numbered(at)}`,
      })),
    );

    const reads = await Promise.all(
      [1, 2, 3, 4].map((page) => knowledgeRead(seeded, seeded.owner, asked({ page }))),
    );

    expect(reads.map((read) => read.rows.length)).toEqual([50, 50, 20, 0]);
    expect(reads.map((read) => read.total)).toEqual([120, 120, 120, 120]);
    expect(reads.map((read) => read.page)).toEqual([1, 2, 3, 4]);
    const titles = reads.flatMap((read) => read.rows.map(({ title }) => title));
    expect(titles).toEqual(Array.from({ length: 120 }, (_unused, at) => `Policy ${numbered(at)}`));
  });

  it.each([false, true])(
    "pages tied concepts without repeats or gaps, descending %s",
    async (desc) => {
      const seeded = await seededWorkspace();
      const tied = Array.from({ length: 120 }, (_unused, at) => FIXED(String(at).padStart(3, "0")));
      await shelved(
        seeded,
        tied.toReversed().map((iri) => ({
          iri,
          path: `knowledge/company/${iri.slice(-3)}.md`,
          title: "Same",
        })),
      );

      const reads = await Promise.all(
        [1, 2, 3].map((page) =>
          knowledgeRead(seeded, seeded.admin, asked({ page, sort: { column: "title", desc } })),
        ),
      );

      expect(reads.flatMap((read) => read.rows.map(({ iri }) => iri))).toEqual(tied);
    },
  );

  it("reports the filtered total on a page past the end", async () => {
    const seeded = await seededForSorting();

    const past = await knowledgeRead(
      seeded,
      seeded.admin,
      asked({ collections: ["company"], page: 9 }),
    );

    expect(past).toEqual({ rows: [], total: 2, page: 9, pageSize: 50 });
  });

  it("reports an empty table as no rows on page one", async () => {
    const seeded = await seededWorkspace();

    const read = await knowledgeRead(seeded, seeded.admin);

    expect(read).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
  });

  it.each([
    ["a collection with a slash", { collections: ["company/policy"] }],
    ["a collection with a space", { collections: ["our policy"] }],
    ["a dot as a collection", { collections: ["."] }],
    ["an empty collection", { collections: [""] }],
    ["page zero", { page: 0 }],
    ["a fractional page", { page: 1.5 }],
    ["an empty type", { conceptType: " " }],
    ["a sort by something else", { sort: { column: "body", desc: false } }],
    ["a stray key", { colour: "red" }],
  ])("refuses %s in the input", (_name, overrides) => {
    const parsed = allKnowledgeInput.safeParse({
      collections: [],
      sort: { column: "title", desc: false },
      ...overrides,
    });

    expect(parsed.success).toBe(false);
  });

  it("starts at page one when no page is given", () => {
    const parsed = allKnowledgeInput.parse({
      collections: [],
      sort: { column: "title", desc: false },
    });

    expect(parsed.page).toBe(1);
  });
});

describe("only what the reader may read", () => {
  const shelveCompany = (seeded: Seeded, hr: string) =>
    shelved(seeded, [
      { path: "knowledge/company/expenses.md", title: "Expenses" },
      { path: "knowledge/company/travel.md", title: "Travel" },
      { path: "knowledge/company/lease.md", title: "Lease", conceptType: "Contract" },
      { path: "knowledge/company/salaries.md", title: "Salaries", sensitivity: "Restricted" },
      { path: "knowledge/company/grievances.md", title: "Grievances", audienceGroups: [hr] },
      { path: "knowledge/people/rota.md", title: "Rota" },
      {
        path: "knowledge/people/appraisals.md",
        title: "Appraisals",
        conceptType: "Appraisal",
        audienceGroups: [hr],
      },
      { path: "knowledge/loose.md", title: "Loose", conceptType: "Contract" },
    ]);

  const seededWithHr = async () => {
    const seeded = await seededWorkspace();
    const { id } = await seedingWith(db().pool, (seed) =>
      seed.group({ workspaceId: seeded.workspaceId, name: "HR team" }),
    );
    const hrOwner = await joinedAs(db(), seeded.workspaceId, "Editor", { group: id });
    await nameOwnerAs(seeded.admin, seeded.postgres, {
      collection: "people",
      personId: hrOwner.userId,
    });
    await shelveCompany(seeded, id);
    return { seeded, hrOwner };
  };

  it("leaves concepts the reader cannot read out of type counts", async () => {
    const { seeded, hrOwner } = await seededWithHr();

    const outside = await conceptTypesRead(seeded, seeded.owner);
    const inside = await conceptTypesRead(seeded, hrOwner);
    const admins = await conceptTypesRead(seeded, seeded.admin);

    expect(outside).toEqual([
      {
        conceptType: "Contract",
        count: 2,
        collections: [
          { collection: "company", count: 1 },
          { collection: null, count: 1 },
        ],
      },
      {
        conceptType: "Policy",
        count: 3,
        collections: [
          { collection: "company", count: 2 },
          { collection: "people", count: 1 },
        ],
      },
    ]);
    expect(inside).toEqual([
      { conceptType: "Appraisal", count: 1, collections: [{ collection: "people", count: 1 }] },
      {
        conceptType: "Contract",
        count: 2,
        collections: [
          { collection: "company", count: 1 },
          { collection: null, count: 1 },
        ],
      },
      {
        conceptType: "Policy",
        count: 4,
        collections: [
          { collection: "company", count: 3 },
          { collection: "people", count: 1 },
        ],
      },
    ]);
    expect(admins.map(({ conceptType, count }) => [conceptType, count])).toEqual([
      ["Contract", 2],
      ["Policy", 4],
    ]);
  });

  it("names no withheld concept in All knowledge", async () => {
    const { seeded, hrOwner } = await seededWithHr();

    const outside = await knowledgeRead(seeded, seeded.owner);
    const inside = await knowledgeRead(seeded, hrOwner);
    const admins = await knowledgeRead(seeded, seeded.admin);

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

  it("counts no withheld concept in any filter, type or total", async () => {
    const { seeded } = await seededWithHr();

    const filtered = await knowledgeRead(seeded, seeded.owner, asked({ collections: ["people"] }));
    const ofConceptType = await knowledgeRead(
      seeded,
      seeded.owner,
      asked({ conceptType: "Appraisal" }),
    );
    const secondPage = await knowledgeRead(seeded, seeded.owner, asked({ page: 2 }));

    expect(filtered.rows.map(({ title }) => title)).toEqual(["Rota"]);
    expect(filtered.total).toBe(1);
    expect(ofConceptType).toEqual({ rows: [], total: 0, page: 1, pageSize: 50 });
    expect(secondPage.total).toBe(5);
  });

  it("leaves drafts out of the tables for every reader", async () => {
    const seeded = await seededWorkspace();
    await shelved(seeded, [
      { path: "knowledge/company/plan.md", title: "Plan", draft: true },
      { path: "knowledge/company/expenses.md", title: "Expenses" },
    ]);

    const read = await knowledgeRead(seeded, seeded.admin);
    const conceptTypes = await conceptTypesRead(seeded, seeded.admin);

    expect(read.rows.map(({ title }) => title)).toEqual(["Expenses"]);
    expect(conceptTypes.map(({ count }) => count)).toEqual([1]);
  });
});

describe("the wide workspace the budget reads", () => {
  it("seeds a wide workspace the Curation reads can count", async () => {
    const seeded = await seededWorkspace();
    const checker = await joinedAs(db(), seeded.workspaceId, "Editor");
    await seedWideKnowledge(db().pool, seeded.workspaceId, {
      count: 120,
      owners: [seeded.owner.userId],
      checker: `human:${checker.userId}`,
    });

    const page = await knowledgeRead(seeded, seeded.owner);
    const conceptTypes = await conceptTypesRead(seeded, seeded.owner);

    expect(page).toMatchObject({ total: 120, pageSize: 50 });
    expect(page.rows).toHaveLength(50);
    expect(conceptTypes.map(({ conceptType, count }) => [conceptType, count])).toEqual(
      Array.from({ length: 8 }, (_unused, at) => [`Type ${at}`, 15]),
    );
    expect(conceptTypes.every(({ collections }) => collections.length === 3)).toBe(true);
  });
});
