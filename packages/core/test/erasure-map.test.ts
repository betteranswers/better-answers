import { ulid } from "@better-answers/schema";
import { describe, expect, it } from "vitest";

import { commit, type GitDoor } from "@better-answers/core/store/git";

import {
  accessAnswerOf,
  ERASURE_FAMILIES,
  erasureMapOf,
  subjectRequestFor,
  type AccessAnswer,
  type ErasureFamily,
  type ErasureFamilyDescriptor,
  type ErasureMap,
  type SubjectIdentifiers,
  type SubjectRequest,
} from "../src/erasure/index.ts";
import { actorIdOfPerson, type UserPrincipal } from "../src/kernel/index.ts";
import { withScope } from "../src/store/postgres/index.ts";
import { bootstrap } from "./platform.ts";
import { readingAs, seedingWith } from "./suite-postgres.ts";
import {
  memberOf,
  principalFor,
  suiteWithBundles,
  type Scenario,
} from "./workspace-with-bundle.ts";

/**
 * The **erasure map** through the slice's own face (`[TEST1]`), against real Postgres and a
 * real bare repository: what the platform holds about one subject, family by family, over an
 * exhaustive union — and what it says about a subject it holds nothing about.
 *
 * Three sentences this suite is here to hold. The union is closed, so a store family added
 * without a finder does not compile. Every family answers, so an empty store is an entry with
 * no locations and never a missing entry. And the map is computed **in one workspace's
 * scope**, so a person who belongs to two of them is never mapped across both.
 */

const { db, arrange } = suiteWithBundles();

/**
 * A fresh address per arrange block, because `user.email` is unique and this suite seeds a
 * subject several times over one Postgres. The expected values below are written from what
 * the arrange returns, never from a second call to the thing under test (`[TEST9]`).
 */
const addressOf = (person: string): string => `${person}-${ulid().toLowerCase()}@example.invalid`;

const identifiersOf = (email: string): SubjectIdentifiers => ({
  emails: [email],
  names: ["Priya Anand"],
  other: ["ACME-4471"],
});

/** The concept file the bundle carries: a person named the way ADR 0019 names one in a file. */
const CONCEPT_PATH = "knowledge/expenses.md";
const conceptFileNaming = (email: string): string =>
  `---\ngenerated:\n  by: human:${email}\n---\n\nExpenses are claimed within thirty days.\n`;

/**
 * Sessions, linked accounts and verification codes are Better Auth's own writes, so the test
 * factory holds none — `workspaces.test.ts` seeds a session the same way, to prove that
 * provisioning ends it. Everything else in this suite is built through the factory
 * (`[TEST4]`).
 */
const identityRowsFor = async (userId: string, email: string) => {
  const sessionId = ulid();
  const accountId = ulid();
  const verificationId = ulid();
  const superuser = await db().pool.connect();
  try {
    await superuser.query(
      `INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
       VALUES ($1, now(), $2, now(), now(), '203.0.113.7', 'Mozilla/5.0', $3)`,
      [sessionId, `token-${sessionId}`, userId],
    );
    await superuser.query(
      `INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at)
       VALUES ($1, 'https://accounts.example.invalid', $2, 'google', $3, now(), now())`,
      [accountId, `google-${accountId}`, userId],
    );
    await superuser.query(
      "INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES ($1, $2, 'code', now(), now(), now())",
      [verificationId, email],
    );
  } finally {
    superuser.release();
  }
  return { sessionId, accountId, verificationId };
};

/** The request as the slice reads it back — the row an Admin recorded, identifier set and all. */
const requestFor = async (
  scenario: Scenario,
  overrides: { readonly personId?: string | null; readonly identifiers: SubjectIdentifiers },
): Promise<SubjectRequest> => {
  const row = await seedingWith(db().pool, (seed) =>
    seed.subjectRequest({
      workspaceId: scenario.workspaceId,
      kind: "erasure",
      ...overrides,
    }),
  );
  const read = await readingAs(db().pool, scenario.admin, (principal, tx) =>
    subjectRequestFor(principal, tx, row.id),
  );
  if (!read.ok) throw new Error(`the request did not read back: ${String(read.error)}`);
  return read.value;
};

/** The map as the routine computes it: the platform principal, in this workspace's scope. */
const mapOf = (scenario: Scenario, request: SubjectRequest): Promise<ErasureMap> =>
  withScope(bootstrap, scenario.postgres, scenario.workspaceId, (tx, platform) =>
    erasureMapOf(platform, tx, scenario.git, request),
  );

/** One governed write by the subject themselves, so their address is in a file and an author line. */
const conceptFileBy = async (
  scenario: Scenario,
  principal: UserPrincipal,
  email: string,
  door: GitDoor,
): Promise<string> => {
  const written = await commit(principal, door, {
    path: CONCEPT_PATH,
    content: conceptFileNaming(email),
    message: "Record the expenses policy",
    author: { name: "Priya Anand", email },
    trailers: { actor: actorIdOfPerson(principal.userId), audit: ulid() },
    expectedHead: null,
    at: new Date("2026-04-02T11:00:00.000Z"),
  });
  if (!written.ok) throw new Error(`the commit was refused: ${String(written.error)}`);
  return written.value.sha;
};

/** The families and what each named, so a test about locations is not a test about categories. */
const locationsOf = (map: ErasureMap): readonly (readonly [ErasureFamily, readonly string[]])[] =>
  map.map((entry) => [entry.family, entry.locations] as const);

/**
 * A workspace holding everything one member's erasure would have to reach: a concept file
 * they wrote and authored, the commit's ledger row, a check they made, an invitation to their
 * address, and their session, linked account and verification code.
 */
const workspaceHoldingAMember = async () => {
  const scenario = await arrange();
  const email = addressOf("priya");
  const person = await memberOf(db().pool, scenario.workspaceId, email);
  const principal = await principalFor(db(), scenario.workspaceId, person.id);
  const sha = await conceptFileBy(scenario, principal, email, scenario.git);
  const actor = actorIdOfPerson(person.id);

  const seeded = await seedingWith(db().pool, async (seed) => ({
    ledger: await seed.bundleCommit({ workspaceId: scenario.workspaceId, sha, actor }),
    check: await seed.conceptVerification({ workspaceId: scenario.workspaceId, actor }),
    invite: await seed.invitation({
      workspaceId: scenario.workspaceId,
      email,
      inviterId: scenario.admin.userId,
    }),
  }));
  const identity = await identityRowsFor(person.id, email);
  const request = await requestFor(scenario, {
    personId: person.id,
    identifiers: identifiersOf(email),
  });
  return { scenario, email, person, sha, ...seeded, ...identity, request };
};

describe("the erasure map's union", () => {
  it("answers one entry for every store family the platform holds, in the union's own order", async () => {
    const scenario = await arrange();
    const request = await requestFor(scenario, {
      personId: null,
      identifiers: identifiersOf(addressOf("nobody")),
    });

    const families = (await mapOf(scenario, request)).map((entry) => entry.family);

    // Both ways (`[TEST7]`): every family of the union has an entry, and every entry names a
    // family of the union. One direction finds the store nobody searched, the other the entry
    // for a store the union does not hold.
    expect(ERASURE_FAMILIES.filter((family) => !families.includes(family))).toEqual([]);
    expect(families.filter((family) => !ERASURE_FAMILIES.includes(family))).toEqual([]);
    expect(families).toEqual([
      "concept-file",
      "bundle-commit",
      "concept-verification",
      "identity-user",
      "identity-session",
      "identity-verification",
      "identity-invitation",
      "identity-account",
      "source-document",
    ]);
  });

  it("refuses a store family declared without a finder", () => {
    const findsNothing: ErasureFamilyDescriptor = {
      categories: [],
      find: () => Promise.resolve([]),
    };

    // Eight of the nine families is not a registry over the union: the ninth would be a store
    // the routine never searched and the access answer never mentioned. Held at compile time
    // first — `tsc --noEmit` over `test/` is a step of this workspace's own `check` — and this
    // is the runtime half for a reader without the compiler.
    // @ts-expect-error — `source-document` has no descriptor here.
    const withoutADocumentFinder: Record<ErasureFamily, ErasureFamilyDescriptor> = {
      "concept-file": findsNothing,
      "bundle-commit": findsNothing,
      "concept-verification": findsNothing,
      "identity-user": findsNothing,
      "identity-session": findsNothing,
      "identity-verification": findsNothing,
      "identity-invitation": findsNothing,
      "identity-account": findsNothing,
    };

    expect(Object.keys(withoutADocumentFinder)).toHaveLength(8);
    expect(ERASURE_FAMILIES).toHaveLength(9);
  });
});

describe("the erasure map for a member", () => {
  it("names their concept file and its author line, the commit and check rows, and every identity-set family", async () => {
    const held = await workspaceHoldingAMember();

    const map = await mapOf(held.scenario, held.request);

    expect(map).toEqual([
      {
        family: "concept-file",
        categories: ["actor-id", "email-address", "name"],
        locations: [`${held.sha} (author line)`, `${held.sha}:${CONCEPT_PATH}`],
      },
      { family: "bundle-commit", categories: ["actor-id"], locations: [held.sha] },
      { family: "concept-verification", categories: ["actor-id"], locations: [held.check.id] },
      {
        family: "identity-user",
        categories: ["name", "email-address"],
        locations: [held.person.id],
      },
      {
        family: "identity-session",
        categories: ["sign-in", "ip-address", "device"],
        locations: [held.sessionId],
      },
      {
        family: "identity-verification",
        categories: ["email-address"],
        locations: [held.verificationId],
      },
      { family: "identity-invitation", categories: ["email-address"], locations: [held.invite.id] },
      { family: "identity-account", categories: ["linked-account"], locations: [held.accountId] },
      { family: "source-document", categories: ["document-text"], locations: [] },
    ]);
  });

  it("carries no text from anything it names", async () => {
    const held = await workspaceHoldingAMember();

    const named = (await mapOf(held.scenario, held.request)).flatMap((entry) => entry.locations);

    // The file says "Expenses are claimed within thirty days." and the session came from
    // 203.0.113.7 on Mozilla/5.0. A location names where the platform holds the person; a
    // reply under Article 15 built from one therefore carries no third party's data.
    expect(named.some((location) => location.includes("Expenses are claimed"))).toBe(false);
    expect(named.some((location) => location.includes("203.0.113.7"))).toBe(false);
    expect(named.some((location) => location.includes("Mozilla/5.0"))).toBe(false);
    expect(named.some((location) => location.includes(held.email))).toBe(false);
  });
});

describe("the erasure map for a subject with no user row", () => {
  it("says the git and identity arms found nothing, family by family", async () => {
    const scenario = await arrange();
    const stranger = addressOf("a-client-contact");
    const request = await requestFor(scenario, {
      personId: null,
      identifiers: identifiersOf(stranger),
    });

    const map = await mapOf(scenario, request);

    // Nine entries with nothing in them, never eight entries and a silence: a reader has to be
    // able to tell a store that holds nothing about this person from a store nobody asked.
    expect(locationsOf(map)).toEqual([
      ["concept-file", []],
      ["bundle-commit", []],
      ["concept-verification", []],
      ["identity-user", []],
      ["identity-session", []],
      ["identity-verification", []],
      ["identity-invitation", []],
      ["identity-account", []],
      ["source-document", []],
    ]);
  });
});

describe("the erasure map in one workspace's scope", () => {
  it("names nothing the other workspace holds, for a person who belongs to both", async () => {
    const here = await arrange();
    const elsewhere = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, here.workspaceId, email);
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Editor" }),
    );
    const actor = actorIdOfPerson(person.id);

    const mine = await seedingWith(db().pool, async (seed) => ({
      ledger: await seed.bundleCommit({ workspaceId: here.workspaceId, actor }),
      check: await seed.conceptVerification({ workspaceId: here.workspaceId, actor }),
      invite: await seed.invitation({
        workspaceId: here.workspaceId,
        email,
        inviterId: here.admin.userId,
      }),
    }));
    const theirs = await seedingWith(db().pool, async (seed) => ({
      ledger: await seed.bundleCommit({ workspaceId: elsewhere.workspaceId, actor }),
      check: await seed.conceptVerification({ workspaceId: elsewhere.workspaceId, actor }),
      invite: await seed.invitation({
        workspaceId: elsewhere.workspaceId,
        email,
        inviterId: elsewhere.admin.userId,
      }),
    }));
    // The same person writes a concept file in the other workspace's bundle, so the git arm
    // has something to find there and must not.
    const elsewherePrincipal = await principalFor(db(), elsewhere.workspaceId, person.id);
    const shaElsewhere = await conceptFileBy(elsewhere, elsewherePrincipal, email, elsewhere.git);
    const request = await requestFor(here, {
      personId: person.id,
      identifiers: identifiersOf(email),
    });

    const map = await mapOf(here, request);

    expect(locationsOf(map)).toEqual([
      ["concept-file", []],
      ["bundle-commit", [mine.ledger.sha]],
      ["concept-verification", [mine.check.id]],
      ["identity-user", [person.id]],
      ["identity-session", []],
      ["identity-verification", []],
      ["identity-invitation", [mine.invite.id]],
      ["identity-account", []],
      ["source-document", []],
    ]);
    const named = map.flatMap((entry) => entry.locations);
    for (const theirsOwn of [theirs.ledger.sha, theirs.check.id, theirs.invite.id, shaElsewhere]) {
      expect(named).not.toContain(theirsOwn);
    }
  });
});

describe("the access answer", () => {
  it("is the whole of what a reply under Article 15 may say: locations and categories", async () => {
    const held = await workspaceHoldingAMember();
    const map = await mapOf(held.scenario, held.request);

    const answer: AccessAnswer = accessAnswerOf(map);

    // The whole answer against one literal (`[TEST9]`), because what this test is for is what
    // the answer does **not** carry: the file says "Expenses are claimed within thirty days.",
    // the session came from 203.0.113.7 on Mozilla/5.0 and the person's own address is on the
    // user row — and none of the three can be here, where every field is written down. A reply
    // built from this therefore carries no third party's data.
    //
    // `document-text` is not in the categories: `source-document` named nothing, and a category
    // no location evidences is not a category the platform tells the person it holds.
    expect(answer).toEqual({
      categories: [
        "actor-id",
        "name",
        "email-address",
        "sign-in",
        "ip-address",
        "device",
        "linked-account",
      ],
      locations: [
        {
          family: "concept-file",
          categories: ["actor-id", "email-address", "name"],
          location: `${held.sha} (author line)`,
        },
        {
          family: "concept-file",
          categories: ["actor-id", "email-address", "name"],
          location: `${held.sha}:${CONCEPT_PATH}`,
        },
        { family: "bundle-commit", categories: ["actor-id"], location: held.sha },
        { family: "concept-verification", categories: ["actor-id"], location: held.check.id },
        {
          family: "identity-user",
          categories: ["name", "email-address"],
          location: held.person.id,
        },
        {
          family: "identity-session",
          categories: ["sign-in", "ip-address", "device"],
          location: held.sessionId,
        },
        {
          family: "identity-verification",
          categories: ["email-address"],
          location: held.verificationId,
        },
        { family: "identity-invitation", categories: ["email-address"], location: held.invite.id },
        { family: "identity-account", categories: ["linked-account"], location: held.accountId },
      ],
    });
  });

  it("says nothing at all for a subject the platform holds nothing about", async () => {
    const scenario = await arrange();
    const request = await requestFor(scenario, {
      personId: null,
      identifiers: identifiersOf(addressOf("a-client-contact")),
    });
    const map = await mapOf(scenario, request);

    // The map answered nine families with no locations; the answer is where the platform holds
    // the person, so nine nothings are one nothing. The person is told the platform holds them
    // nowhere and under no category — not handed a list of stores they have to read.
    expect(map).toHaveLength(9);
    expect(accessAnswerOf(map)).toEqual({ categories: [], locations: [] });
  });
});
