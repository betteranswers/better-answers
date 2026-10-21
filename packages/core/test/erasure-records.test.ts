import { describe, expect, it } from "vitest";

import { acceptSuggestions, submitSuggestionSet } from "../src/concepts/index.ts";
import { ERASURE, runErasure } from "../src/erasure/index.ts";
import { actorIdOfPerson, type UserPrincipal } from "../src/kernel/index.ts";
import { authorLinesOf } from "./bundle.ts";
import { erasureDoorsFor } from "./erasure-doors.ts";
import { objectStoreForSuite } from "./suite-objects.ts";
import { addressOf, seedingWith } from "./suite-postgres.ts";
import { doorsOf, memberOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const objects = objectStoreForSuite();

const LOCKED_AT = new Date("2026-06-01T12:00:00.000Z");

const erasing = async (scenario: Scenario, person: { readonly id: string }, email: string) => {
  const request = await seedingWith(db().pool, (seed) =>
    seed.subjectRequest({
      workspaceId: scenario.workspaceId,
      kind: "erasure",
      personId: person.id,
      identifiers: { emails: [email], names: ["Priya Anand"], other: [] },
    }),
  );
  const run = await runErasure(ERASURE, erasureDoorsFor(scenario, objects().door, LOCKED_AT), {
    workspaceId: scenario.workspaceId,
    subjectRequestId: request.id,
  });
  if (!run.ok) throw new Error(`the routine refused: ${String(run.error)}`);
  const erased = await db().pool.query<{ pseudonym: string }>(
    "SELECT pseudonym FROM erasure_request WHERE workspace_id = $1",
    [scenario.workspaceId],
  );
  return { run: run.value, erasedAs: `human:${erased.rows[0]?.pseudonym ?? ""}` };
};

const aMemberToErase = async () => {
  const scenario = await arrange();
  const email = addressOf("priya");
  const person = await memberOf(db().pool, scenario.workspaceId, email);
  return { scenario, email, person, actor: actorIdOfPerson(person.id) };
};

describe("a sensitivity override the person set", () => {
  const overridesIn = async (workspaceId: string) =>
    (
      await db().pool.query<{ iri: string; actor: string }>(
        "SELECT iri, actor FROM concept_sensitivity_override WHERE workspace_id = $1 ORDER BY iri",
        [workspaceId],
      )
    ).rows;

  it("names the pseudonym as who set it, not the person", async () => {
    const { scenario, email, person, actor } = await aMemberToErase();
    const theirs = await seedingWith(db().pool, (seed) =>
      seed.conceptSensitivityOverride({ workspaceId: scenario.workspaceId, actor }),
    );
    const anothers = await seedingWith(db().pool, (seed) =>
      seed.conceptSensitivityOverride({
        workspaceId: scenario.workspaceId,
        actor: actorIdOfPerson(scenario.admin.userId),
      }),
    );

    const { run, erasedAs } = await erasing(scenario, person, email);

    expect(await overridesIn(scenario.workspaceId)).toEqual(
      [
        { iri: theirs.iri, actor: erasedAs },
        { iri: anothers.iri, actor: anothers.actor },
      ].toSorted((left, right) => (left.iri < right.iri ? -1 : 1)),
    );
    expect(run.report).toContain("concept-sensitivity-override: actorsRewritten 1, found 1");
  });
});

describe("a finding the person reviewed or restored", () => {
  const findingOf = async (workspaceId: string, id: string) =>
    (
      await db().pool.query<Record<string, unknown>>(
        `SELECT reviewed_by, review_reason, restored_by, restore_reason
           FROM finding WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id],
      )
    ).rows[0];

  it("names the pseudonym and clears the reasons the person typed", async () => {
    const { scenario, email, person, actor } = await aMemberToErase();
    const at = new Date("2026-05-01T09:00:00.000Z");
    const restored = await seedingWith(db().pool, (seed) =>
      seed.finding({
        workspaceId: scenario.workspaceId,
        reviewState: "kept-in-text",
        reviewedBy: actor,
        reviewedAt: at,
        reviewReason: "Priya needs her sort code on the payroll page.",
        restoredBy: actor,
        restoredAt: at,
        restoreReason: "Priya needs her sort code on the payroll page.",
      }),
    );

    const { run, erasedAs } = await erasing(scenario, person, email);

    expect(await findingOf(scenario.workspaceId, restored.id)).toEqual({
      reviewed_by: erasedAs,
      review_reason: null,
      restored_by: erasedAs,
      restore_reason: "",
    });
    expect(run.report).toContain("finding: actorsRewritten 1, found 1");
  });

  it("keeps another reviewer's decision on a finding the person restored", async () => {
    const { scenario, email, person, actor } = await aMemberToErase();
    const at = new Date("2026-05-01T09:00:00.000Z");
    const reviewer = actorIdOfPerson(scenario.admin.userId);
    const restored = await seedingWith(db().pool, (seed) =>
      seed.finding({
        workspaceId: scenario.workspaceId,
        reviewState: "dismissed",
        reviewedBy: reviewer,
        reviewedAt: at,
        reviewReason: "Not special category.",
        restoredBy: actor,
        restoredAt: at,
        restoreReason: "Priya needs her sort code on the payroll page.",
      }),
    );

    const { erasedAs } = await erasing(scenario, person, email);

    expect(await findingOf(scenario.workspaceId, restored.id)).toEqual({
      reviewed_by: reviewer,
      review_reason: "Not special category.",
      restored_by: erasedAs,
      restore_reason: "",
    });
  });
});

describe("a suggestion the person proposed or decided", () => {
  const suggestionsIn = async (workspaceId: string) =>
    (
      await db().pool.query<Record<string, unknown>>(
        "SELECT id, proposer, decider, reason FROM suggestion WHERE workspace_id = $1 ORDER BY id",
        [workspaceId],
      )
    ).rows;

  const declined = (decider: string, reason: string) => ({
    status: "declined",
    decider,
    decidedAt: new Date("2026-05-01T09:00:00.000Z"),
    reason,
  });

  it("names the pseudonym and replaces only the person's reasons", async () => {
    const { scenario, email, person, actor } = await aMemberToErase();
    const another = actorIdOfPerson(scenario.admin.userId);
    const workspaceId = scenario.workspaceId;
    const [proposed, decided, untouched] = await seedingWith(db().pool, async (seed) => [
      await seed.suggestion({
        workspaceId,
        proposer: actor,
        ...declined(another, "Not the company's word on this."),
      }),
      await seed.suggestion({
        workspaceId,
        proposer: another,
        ...declined(actor, "Priya says the policy changed in May."),
      }),
      await seed.suggestion({
        workspaceId,
        proposer: another,
        ...declined(another, "Already in the handbook."),
      }),
    ]);

    const { run, erasedAs } = await erasing(scenario, person, email);

    expect(await suggestionsIn(workspaceId)).toEqual(
      [
        {
          id: proposed.id,
          proposer: erasedAs,
          decider: another,
          reason: "Not the company's word on this.",
        },
        {
          id: decided.id,
          proposer: another,
          decider: erasedAs,
          reason: "Removed when its author's personal data was erased.",
        },
        {
          id: untouched.id,
          proposer: another,
          decider: another,
          reason: "Already in the handbook.",
        },
      ].toSorted((left, right) => (left.id < right.id ? -1 : 1)),
    );
    expect(run.report).toContain("suggestion: actorsRewritten 2, found 2");
  });
});

describe("a write request that names the person", () => {
  const requestOf = async (workspaceId: string, suggestionId: string) =>
    (
      await db().pool.query<Record<string, unknown>>(
        `SELECT title, frontmatter, body FROM concept_write_request
          WHERE workspace_id = $1 AND suggestion_id = $2`,
        [workspaceId, suggestionId],
      )
    ).rows[0];

  it("names the pseudonym wherever the request named the person", async () => {
    const { scenario, email, person, actor } = await aMemberToErase();
    const workspaceId = scenario.workspaceId;
    const shouted = `human:${email.toUpperCase()}`;
    const [naming, anothers] = await seedingWith(db().pool, async (seed) => [
      await seed.conceptWriteRequest({
        workspaceId,
        suggestionId: (await seed.suggestion({ workspaceId, proposer: actor })).id,
        title: `Expenses, checked by ${actor}`,
        frontmatter: { title: "Expenses", verified: [{ by: shouted }] },
        body: `Ask ${actor} or ${shouted} about expenses.`,
      }),
      await seed.conceptWriteRequest({ workspaceId }),
    ]);

    const { run, erasedAs } = await erasing(scenario, person, email);

    expect(await requestOf(workspaceId, naming.suggestionId)).toEqual({
      title: `Expenses, checked by ${erasedAs}`,
      frontmatter: { title: "Expenses", verified: [{ by: erasedAs }] },
      body: `Ask ${erasedAs} or ${erasedAs} about expenses.`,
    });
    expect(await requestOf(workspaceId, anothers.suggestionId)).toEqual({
      title: anothers.title,
      frontmatter: anothers.frontmatter,
      body: anothers.body,
    });
    expect(run.report).toContain("concept-write-request: actorsRewritten 1, found 1");
  });
});

describe("an accepted edit the person proposed", () => {
  const proposedAndAccepted = async (scenario: Scenario, proposer: UserPrincipal) => {
    const set = await submitSuggestionSet(
      proposer,
      { postgres: scenario.postgres },
      {
        kind: "edit",
        requests: [
          {
            mergeKey: "policy:expenses",
            path: "knowledge/expenses.md",
            conceptKind: "Policy",
            title: "Expenses",
            frontmatter: { title: "Expenses", type: "Policy" },
            body: "Expenses are claimed within sixty days.",
          },
        ],
      },
    );
    if (!set.ok) throw new Error(`the set was not submitted: ${String(set.error)}`);
    const accepted = await acceptSuggestions(scenario.admin, doorsOf(scenario), {
      decisions: set.value.suggestionIds.map((suggestionId) => ({
        suggestionId,
        expectedTarget: null,
      })),
    });
    if (!accepted.ok || !accepted.value.every((each) => each.outcome.ok)) {
      throw new Error("the acceptance was refused");
    }
  };

  it("leaves the proposer on no author line", async () => {
    const scenario = await arrange();
    const proposer = await db().pool.query<{ author: string; email: string }>(
      `SELECT name || ' <' || email || '>' AS author, email FROM "user" WHERE id = $1`,
      [scenario.editor.userId],
    );
    const { author, email } = proposer.rows[0] ?? { author: "", email: "" };
    await proposedAndAccepted(scenario, scenario.editor);
    const actors = await db().pool.query<{ actor: string }>(
      "SELECT actor FROM bundle_commit WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    expect(actors.rows).toEqual([{ actor: actorIdOfPerson(scenario.admin.userId) }]);
    expect(await authorLinesOf(scenario.git, scenario.workspaceId)).toEqual([author]);

    const { erasedAs } = await erasing(scenario, { id: scenario.editor.userId }, email);

    const pseudonym = erasedAs.slice("human:".length);
    expect(await authorLinesOf(scenario.git, scenario.workspaceId)).toEqual([
      `${erasedAs} <${pseudonym}@erased.better-answers.invalid>`,
    ]);
  });
});
