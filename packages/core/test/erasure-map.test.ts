import { SUBJECT_IDENTIFIER_KINDS, ulid } from "@better-answers/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";

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
import { identityRowsFor, verificationCodeFor } from "./identity-rows.ts";
import { contractFixture } from "./contract-fixture.ts";
import { bootstrap } from "./platform.ts";
import { addressOf, readingAs, seedingWith } from "./suite-postgres.ts";
import {
  memberOf,
  principalFor,
  suiteWithBundles,
  type Scenario,
} from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const identifiersOf = (email: string): SubjectIdentifiers => ({
  emails: [email],
  names: ["Priya Anand"],
  other: ["ACME-4471"],
});

const CONCEPT_PATH = "knowledge/expenses.md";
const conceptFileNaming = (email: string): string =>
  `---\ngenerated:\n  by: human:${email}\n---\n\nExpenses are claimed within thirty days.\n`;

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

const mapOf = (scenario: Scenario, request: SubjectRequest): Promise<ErasureMap> =>
  withScope(bootstrap, scenario.postgres, scenario.workspaceId, (tx, platform) =>
    erasureMapOf(platform, tx, scenario.git, request),
  );

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

const locationsOf = (map: ErasureMap): readonly (readonly [ErasureFamily, readonly string[]])[] =>
  map.map((entry) => [entry.family, entry.locations] as const);

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
  const identity = await identityRowsFor(db().pool, { userId: person.id, email });
  const request = await requestFor(scenario, {
    personId: person.id,
    identifiers: identifiersOf(email),
  });
  return { scenario, email, person, sha, ...seeded, ...identity, request };
};

describe("the erasure map's union", () => {
  it("answers one entry per store family, in the union's order", async () => {
    const scenario = await arrange();
    const request = await requestFor(scenario, {
      personId: null,
      identifiers: identifiersOf(addressOf("nobody")),
    });

    const families = (await mapOf(scenario, request)).map((entry) => entry.family);

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
  it("names their concept file, commit, check and identity-set rows", async () => {
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

    expect(named.some((location) => location.includes("Expenses are claimed"))).toBe(false);
    expect(named.some((location) => location.includes("203.0.113.7"))).toBe(false);
    expect(named.some((location) => location.includes("Mozilla/5.0"))).toBe(false);
    expect(named.some((location) => location.includes(held.email))).toBe(false);
  });
});

describe("the erasure map for a subject with no user row", () => {
  it("says each git and identity family found nothing", async () => {
    const scenario = await arrange();
    const stranger = addressOf("a-client-contact");
    const request = await requestFor(scenario, {
      personId: null,
      identifiers: identifiersOf(stranger),
    });

    const map = await mapOf(scenario, request);

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
  it("names nothing another workspace holds for a member of both", async () => {
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

const WORK_ADDRESS = "ann.raman@meridianfenland.co.uk";

const GONE_AT = new Date("2026-09-01T09:00:00.000Z");

const documentHolding = (
  workspaceId: string,
  chunks: readonly string[],
  shape: { readonly goneAt?: Date } = {},
): Promise<string> =>
  seedingWith(db().pool, async (seed) => {
    const binding = await seed.sourceBinding({ workspaceId });
    const document = await seed.sourceDocument({
      workspaceId,
      bindingId: binding.id,
      goneAt: shape.goneAt ?? null,
    });
    const lengths = chunks.map((content) => Array.from(content).length);
    for (const [ordinal, content] of chunks.entries()) {
      const charStart = lengths.slice(0, ordinal).reduce((sum, length) => sum + length, 0);
      const charEnd = charStart + (lengths[ordinal] ?? 0);
      await seed.chunk({
        workspaceId,
        bindingId: binding.id,
        sourceDocumentId: document.id,
        content,
        locator: `${document.id}/chars:${charStart}-${charEnd}`,
        ordinal,
        charStart,
        charEnd,
      });
    }
    return document.id;
  });

const AGREEMENT_CASES = contractFixture(
  "erasure-match",
  z.object({
    cases: z.array(
      z.object({
        kind: z.enum(SUBJECT_IDENTIFIER_KINDS),
        identifier: z.string().min(1),
        text: z.string().min(1),
        occurrences: z.array(z.unknown()),
        why: z.string().min(1),
      }),
    ),
  }),
).cases;

const documentsFoundFor = async (
  scenario: Scenario,
  identifiers: SubjectIdentifiers,
): Promise<readonly string[] | undefined> => {
  const request = await requestFor(scenario, { personId: null, identifiers });
  const map = await mapOf(scenario, request);
  return map.find((entry) => entry.family === "source-document")?.locations;
};

describe("the erasure map's documents", () => {
  it("names only live documents holding the subject, across chunks too", async () => {
    const scenario = await arrange();
    const workspaceId = scenario.workspaceId;
    const byTheWorkAddress = await documentHolding(workspaceId, [
      `Send the signed lease to ${WORK_ADDRESS} before Friday.`,
    ]);
    const byTheNameSplit = await documentHolding(workspaceId, [
      "The lease was countersigned by Ann",
      " Raman on 3 March.",
    ]);
    await documentHolding(workspaceId, ["The Annual Raman lecture is on Friday."]);
    await documentHolding(workspaceId, [
      "The lease was countersigned by [withheld]; write to [withheld] with any query.",
    ]);
    await documentHolding(workspaceId, [`Ann Raman signed; write to ${WORK_ADDRESS}.`], {
      goneAt: GONE_AT,
    });
    const request = await requestFor(scenario, {
      personId: null,
      identifiers: { emails: [WORK_ADDRESS], names: ["Ann Raman"], other: [] },
    });

    const map = await mapOf(scenario, request);

    expect(map.find((entry) => entry.family === "source-document")).toEqual({
      family: "source-document",
      categories: ["document-text"],
      locations: [byTheWorkAddress, byTheNameSplit].sort(),
    });
    expect(accessAnswerOf(map).categories).toEqual(["document-text"]);
  });

  it("finds another identifier whole, never as a longer number's prefix", async () => {
    const scenario = await arrange();
    const byTheNumber = await documentHolding(scenario.workspaceId, [
      "Payroll number EMP-00417 is closed.",
    ]);
    await documentHolding(scenario.workspaceId, ["Payroll number EMP-004171 is open."]);

    expect(
      await documentsFoundFor(scenario, { emails: [], names: [], other: ["EMP-00417"] }),
    ).toEqual([byTheNumber]);
  });

  it("searches for no identifier below the floor", async () => {
    const scenario = await arrange();
    await documentHolding(scenario.workspaceId, ["Ann asked HR about her leave."]);

    expect(
      await documentsFoundFor(scenario, { emails: [], names: ["Ann"], other: ["HR"] }),
    ).toEqual([]);
  });

  it("names a document writing the name as recorded, not folded", async () => {
    const scenario = await arrange();
    const asRecorded = await documentHolding(scenario.workspaceId, [
      "The deed was witnessed by Νίκος Παππάς.",
    ]);

    expect(
      await documentsFoundFor(scenario, { emails: [], names: ["Νίκος Παππάς"], other: [] }),
    ).toEqual([asRecorded]);
  });

  it("finds the sign-in address for a request by id alone", async () => {
    const scenario = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);
    const byTheSignIn = await documentHolding(scenario.workspaceId, [
      `Claims go to ${email} for approval.`,
    ]);
    const request = await requestFor(scenario, {
      personId: person.id,
      identifiers: { emails: [], names: [], other: [] },
    });

    const map = await mapOf(scenario, request);

    expect(map.find((entry) => entry.family === "source-document")?.locations).toEqual([
      byTheSignIn,
    ]);
  });

  it("finds a name made only of full-text stop words", async () => {
    const scenario = await arrange();
    const byTheName = await documentHolding(scenario.workspaceId, [
      "Tickets for The Who sold out.",
    ]);
    await documentHolding(scenario.workspaceId, ["Who is the owner of the lease?"]);

    expect(
      await documentsFoundFor(scenario, { emails: [], names: ["The Who"], other: [] }),
    ).toEqual([byTheName]);
  });

  it("names each agreement case's document exactly where the agreement matches", async () => {
    const scenario = await arrange();
    for (const { kind, identifier, text, occurrences, why } of AGREEMENT_CASES) {
      const document = await documentHolding(scenario.workspaceId, [text]);

      const found = await documentsFoundFor(scenario, {
        emails: [],
        names: [],
        other: [],
        [kind]: [identifier],
      });

      expect({ why, named: found?.includes(document) }).toEqual({
        why,
        named: occurrences.length > 0,
      });
    }
  });

  it("names nothing another workspace holds", async () => {
    const here = await arrange();
    const elsewhere = await arrange();
    await documentHolding(elsewhere.workspaceId, [`Ann Raman signed; write to ${WORK_ADDRESS}.`]);

    expect(
      await documentsFoundFor(here, { emails: [WORK_ADDRESS], names: ["Ann Raman"], other: [] }),
    ).toEqual([]);
  });
});

describe("the erasure map for a stranger's address in the set", () => {
  it("names the subject's own verification code, never the stranger's", async () => {
    const here = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, here.workspaceId, email);

    const notTheirs = addressOf("a-stranger");
    const theirs = await verificationCodeFor(db().pool, email);
    await verificationCodeFor(db().pool, notTheirs);
    const request = await requestFor(here, {
      personId: person.id,
      identifiers: { ...identifiersOf(email), emails: [email, notTheirs] },
    });

    const map = await mapOf(here, request);

    expect(map.find((entry) => entry.family === "identity-verification")?.locations).toEqual([
      theirs,
    ]);
  });
});

describe("the access answer", () => {
  it("is only the locations and categories a reply may say", async () => {
    const held = await workspaceHoldingAMember();
    const map = await mapOf(held.scenario, held.request);

    const answer: AccessAnswer = accessAnswerOf(map);

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

  it("says nothing for a subject the platform holds nothing about", async () => {
    const scenario = await arrange();
    const request = await requestFor(scenario, {
      personId: null,
      identifiers: identifiersOf(addressOf("a-client-contact")),
    });
    const map = await mapOf(scenario, request);

    expect(map).toHaveLength(9);
    expect(accessAnswerOf(map)).toEqual({ categories: [], locations: [] });
  });
});
