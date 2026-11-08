import { describe, expect, it } from "vitest";

import type { ConceptIri } from "@better-answers/schema";

import { open } from "../../src/answering/index.ts";
import { actorIdOfPerson, type UserPrincipal } from "../../src/kernel/index.ts";
import { withMember } from "../../src/store/postgres/index.ts";
import { joinedAs, shelve } from "../fixtures/concept-shelf.ts";
import { writeUpIncluding } from "../fixtures/sourced-concept.ts";
import { principalFor } from "../fixtures/workspace-with-bundle.ts";
import { provisionedWorkspace } from "../support/platform.ts";
import { answered, postgresForSuite, seedingWith } from "../support/suite-postgres.ts";

const db = postgresForSuite();

const now = new Date("2026-06-01T09:00:00.000Z");

const PRIYA = "Priya Shah";
const RAJ = "Raj Patel";
const CHECKER = "process:better-answers-records-checker";

const seededWorkspace = async () => {
  const provisioned = await provisionedWorkspace(db(), "Acme");
  const { workspaceId } = provisioned;
  const [admin, priya, raj] = await Promise.all([
    principalFor(db(), workspaceId, provisioned.adminUserId),
    joinedAs(db(), workspaceId, "Viewer", { name: PRIYA }),
    joinedAs(db(), workspaceId, "Editor", { name: RAJ }),
  ]);
  return { workspaceId, postgres: provisioned.door, admin, priya, raj };
};

type Seeded = Awaited<ReturnType<typeof seededWorkspace>>;

const openedBy = async (seeded: Seeded, reader: UserPrincipal, iri: ConceptIri) => {
  const opened = answered(
    answered(
      await withMember(reader, seeded.postgres, (fresh, tx) => open(fresh, tx, { iri }, now)),
    ),
  );
  if (!opened.found || opened.concept === undefined) throw new Error(`${iri} did not open`);
  return opened.concept;
};

const aConcept = async (
  seeded: Seeded,
  checks: readonly { actor: string; at: Date }[] = [],
  path = "knowledge/company/expenses.md",
) => {
  const [iri] = await shelve(db().pool, seeded.workspaceId, [{ path, checks }]);
  if (iri === undefined) throw new Error("no concept was shelved");
  return iri;
};

const ownedBy = (
  seeded: Seeded,
  person: UserPrincipal,
  subject: { readonly iri: string } | { readonly collection: string },
) =>
  seedingWith(db().pool, (seed) =>
    seed.conceptOwner({ workspaceId: seeded.workspaceId, personId: person.userId, ...subject }),
  );

const answeredFor = (seeded: Seeded, asker: UserPrincipal, iris: readonly string[], done = true) =>
  seedingWith(db().pool, (seed) =>
    seed.questionAsked({
      workspaceId: seeded.workspaceId,
      askedBy: actorIdOfPerson(asker.userId),
      predicateRole: asker.role,
      ...(done ? { completedAt: now, verdict: "related", judgeState: "not-judged" } : {}),
      concepts: iris.map((iri) => ({
        iri,
        contentHash: "a".repeat(64),
        trust: { tier: "unverified", status: "current", verifiedAt: null, rider: null },
      })),
    }),
  );

const inAHiddenSection = (seeded: Seeded, iri: string) =>
  seedingWith(db().pool, async (seed) => {
    const section = await seed.guideSection({ workspaceId: seeded.workspaceId, hidden: true });
    const writeUp = await seed.writeUp({
      workspaceId: seeded.workspaceId,
      guideId: section.guideId,
      sectionId: section.id,
    });
    await seed.writeUpInclude({ workspaceId: seeded.workspaceId, writeUpId: writeUp.id, iri });
  });

describe("an opened concept's place", () => {
  it("carries its path and its collection", async () => {
    const seeded = await seededWorkspace();
    const iri = await aConcept(seeded);

    const concept = await openedBy(seeded, seeded.priya, iri);

    expect(concept.path).toBe("knowledge/company/expenses.md");
    expect(concept.collection).toBe("company");
  });

  it("has no collection for a concept outside every collection", async () => {
    const seeded = await seededWorkspace();
    const iri = await aConcept(seeded, [], "knowledge/loose.md");

    const concept = await openedBy(seeded, seeded.priya, iri);

    expect(concept.path).toBe("knowledge/loose.md");
    expect(concept.collection).toBeNull();
  });
});

describe("an opened concept's verifications", () => {
  it("lists every verification newest first, and trusts the newest", async () => {
    const seeded = await seededWorkspace();
    const iri = await aConcept(seeded, [
      { actor: CHECKER, at: new Date("2026-01-05T09:00:00.000Z") },
      { actor: actorIdOfPerson(seeded.priya.userId), at: new Date("2026-03-03T09:00:00.000Z") },
      { actor: actorIdOfPerson(seeded.raj.userId), at: new Date("2026-02-01T09:00:00.000Z") },
    ]);

    const concept = await openedBy(seeded, seeded.priya, iri);

    expect(concept.verifications).toEqual([
      {
        tier: "human-reviewed",
        actor: actorIdOfPerson(seeded.priya.userId),
        name: PRIYA,
        at: "2026-03-03T09:00:00.000Z",
      },
      {
        tier: "human-reviewed",
        actor: actorIdOfPerson(seeded.raj.userId),
        name: RAJ,
        at: "2026-02-01T09:00:00.000Z",
      },
      { tier: "machine-confirmed", actor: CHECKER, name: null, at: "2026-01-05T09:00:00.000Z" },
    ]);
    expect(concept.trust).toMatchObject({
      tier: "human-reviewed",
      verifiedBy: PRIYA,
      verifiedAt: "2026-03-03T09:00:00.000Z",
    });
    expect(concept.trustWords).toBe(`Verified by ${PRIYA} · 3 March 2026`);
  });

  it("is empty for an unverified concept", async () => {
    const seeded = await seededWorkspace();
    const iri = await aConcept(seeded);

    const concept = await openedBy(seeded, seeded.priya, iri);

    expect(concept.verifications).toEqual([]);
    expect(concept.trustWords).toBe("Unverified");
  });
});

describe("an opened concept's owner", () => {
  it("falls back from the concept to its collection", async () => {
    const seeded = await seededWorkspace();
    const iri = await aConcept(seeded);

    const unowned = await openedBy(seeded, seeded.priya, iri);
    await ownedBy(seeded, seeded.raj, { collection: "company" });
    const byCollection = await openedBy(seeded, seeded.priya, iri);
    await ownedBy(seeded, seeded.priya, { iri });
    const byConcept = await openedBy(seeded, seeded.priya, iri);

    expect(unowned.owner).toBeNull();
    expect(byCollection.owner).toEqual({
      personId: seeded.raj.userId,
      name: RAJ,
      via: "collection",
    });
    expect(byConcept.owner).toEqual({ personId: seeded.priya.userId, name: PRIYA, via: "concept" });
  });
});

describe("an opened concept's use", () => {
  it("counts only the guides and answers the reader can read", async () => {
    const seeded = await seededWorkspace();
    const iri = await aConcept(seeded);
    const elsewhere = await shelve(db().pool, seeded.workspaceId, [
      { path: "knowledge/company/travel.md" },
    ]);
    await writeUpIncluding(db(), seeded.workspaceId, [iri]);
    await writeUpIncluding(db(), seeded.workspaceId, [iri], { sensitivity: "Restricted" });
    await writeUpIncluding(db(), seeded.workspaceId, elsewhere);
    await inAHiddenSection(seeded, iri);
    await answeredFor(seeded, seeded.priya, [iri]);
    await answeredFor(seeded, seeded.priya, [iri], false);
    await answeredFor(seeded, seeded.priya, elsewhere);
    await answeredFor(seeded, seeded.raj, [iri]);

    const priyas = await openedBy(seeded, seeded.priya, iri);
    const admins = await openedBy(seeded, seeded.admin, iri);

    expect(priyas.usedIn).toEqual({ guides: 1, answers: 1 });
    expect(admins.usedIn).toEqual({ guides: 3, answers: 2 });
  });
});
