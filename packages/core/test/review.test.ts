import type pg from "pg";
import { describe, expect, it } from "vitest";

import type { UserPrincipal } from "../src/kernel/index.ts";
import {
  findingsOf,
  keepInText,
  narrowDocuments,
  passageAt,
  reprocessBinding,
  type FindingGroupKey,
  type ReprocessBindingInput,
} from "../src/sources/index.ts";
import {
  bindingHolding,
  chunkUnder,
  conceptCiting,
  documentUnder,
  seededBy,
  visibilitySuite,
  visibilityHeld,
} from "./sourced-concept.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

/**
 * The review of what the redaction seam found in one binding, through the sources slice's own
 * exports: the read an Admin opens the review screen with, and the two bulk acts taken over
 * what it lists (ADR 0020; the S1 spec, *The sources slice's acts*).
 *
 * What a caller can observe is the list the read answers, the rows each act moved, the ledger
 * rows that landed with them and the refusal word when nothing landed — so every case below
 * asserts on those and never on how an act reached them. Real Postgres throughout, rows
 * through the factory, and every expected value written down rather than derived.
 *
 * The two acts are proved over a binding with **two documents**, because both of them are
 * about the difference between what was named and what was not: a keep that restored a span
 * nobody selected and a narrowing that took a sibling down with its neighbour are the two
 * faults a single-document arrangement cannot see.
 */

const { db, arrange, reading: acting } = visibilitySuite();

/** The sentence an Admin types over a batch of spans, written once so every case reads the same one. */
const BUSINESS_FACT = "The sort code is the company's own, printed on every invoice it sends.";

/** The keep as a person at this role would reach it, over these groups and for the one reason. */
const keepAs = (who: UserPrincipal, bindingId: string, findingGroups: readonly FindingGroupKey[]) =>
  acting(who, (principal, tx) =>
    keepInText(principal, tx, { bindingId, findingGroups, reason: BUSINESS_FACT }),
  );

/** The narrowing act as a person at this role would reach it, through the slice's own export. */
const narrowAs = (
  who: UserPrincipal,
  bindingId: string,
  findingGroups: readonly FindingGroupKey[],
  to: { readonly sensitivity?: string } = {},
) =>
  acting(who, (principal, tx) =>
    narrowDocuments(principal, tx, { bindingId, findingGroups, sensitivity: to.sensitivity }),
  );

/** One span the seam raised in a document, at the category, rule and tier the case is about. */
const findingIn = async (
  workspaceId: string,
  documentId: string,
  overrides: {
    readonly category?: string;
    readonly ruleId?: string;
    readonly tier?: string;
    readonly charStart?: number;
    readonly charEnd?: number;
  } = {},
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const row = await seed.finding({ workspaceId, documentId, ...overrides });
    return row.id;
  });

/**
 * A finding group of one document, as the review read lists it and a caller hands it back. The
 * words are the ones a seeded finding carries unless a case says otherwise — the company's own
 * sort code, raised at the always tier.
 */
const findingGroupIn = (
  documentId: string,
  overrides: Partial<Omit<FindingGroupKey, "documentId">> = {},
): FindingGroupKey => ({
  documentId,
  category: "bank-details",
  ruleId: "sort-code-with-account-number",
  tier: "always",
  ...overrides,
});

/** A second group of the always set, for the span or the group a case leaves alone. */
const NATIONAL_INSURANCE = { category: "government-id", ruleId: "national-insurance-number" };

/** The columns the two acts write on one finding, as the superuser reads them off the row. */
const marksOf = async (workspaceId: string, findingId: string) => {
  const found = await db().pool.query<{
    review_state: string;
    reviewed_at: Date | null;
    reviewed_by: string | null;
    review_reason: string | null;
    restored_at: Date | null;
    restored_by: string | null;
    restore_reason: string | null;
  }>(
    `SELECT review_state, reviewed_at, reviewed_by, review_reason,
            restored_at, restored_by, restore_reason
       FROM finding WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, findingId],
  );
  return found.rows[0];
};

/** The three restore columns of one finding. */
const restoreOf = async (workspaceId: string, findingId: string) => {
  const row = await marksOf(workspaceId, findingId);
  return {
    restored: row?.restored_at instanceof Date,
    restored_by: row?.restored_by ?? null,
    restore_reason: row?.restore_reason ?? null,
  };
};

/** The review's own columns of one finding. */
const reviewOf = async (workspaceId: string, findingId: string) => {
  const row = await marksOf(workspaceId, findingId);
  return {
    review_state: row?.review_state ?? null,
    reviewed: row?.reviewed_at instanceof Date,
    reviewed_by: row?.reviewed_by ?? null,
    review_reason: row?.review_reason ?? null,
  };
};

/** A finding as the seam leaves it: nobody has looked, so the review's columns hold nothing. */
const UNREVIEWED = {
  review_state: "unreviewed",
  reviewed: false,
  reviewed_by: null,
  review_reason: null,
};

/** The class each chunk of a document carries, oldest ordinal first. */
const chunkClassesOf = async (workspaceId: string, documentId: string) => {
  const found = await db().pool.query<{ sensitivity: string }>(
    `SELECT sensitivity FROM "index".chunk
      WHERE workspace_id = $1 AND source_document_id = $2 ORDER BY ordinal`,
    [workspaceId, documentId],
  );
  return found.rows.map((row) => row.sensitivity);
};

/**
 * The ledger rows of one act with the **batch id** beside the detail — the column the other
 * ledger readers here leave off, and the one thing a bulk act is checked on.
 */
const batchedRowsOf = async (pool: pg.Pool, workspaceId: string, act: string) => {
  const found = await pool.query<{
    subject_id: string;
    batch_id: string | null;
    detail: Record<string, unknown>;
  }>(
    `SELECT subject_id, batch_id, detail FROM audit_event
      WHERE workspace_id = $1 AND act = $2 ORDER BY id`,
    [workspaceId, act],
  );
  return found.rows;
};

/** Every job this workspace holds, in the order they were queued. */
const jobsOf = async (workspaceId: string) => {
  const found = await db().pool.query<{ kind: string; reason: string | null; subject_id: string }>(
    "SELECT kind, reason, subject_id FROM job WHERE workspace_id = $1 ORDER BY enqueued_at, id",
    [workspaceId],
  );
  return found.rows;
};

/** The review read as a person at this role would reach it, through the slice's own export. */
const findingsAs = (who: UserPrincipal, bindingId: string) =>
  acting(who, (principal, tx) => findingsOf(principal, tx, { bindingId }));

/**
 * A binding at Restricted holding one document that still says Internal of its own — the
 * shape a binding narrowed after its documents were catalogued leaves behind, since a
 * binding's narrowing rewrites its own row and the chunk copies and not this column.
 */
const documentHeldAboveItsBinding = async (workspaceId: string) => {
  const binding = await bindingHolding(db(), workspaceId, { sensitivity: "Restricted" });
  const held = await documentUnder(db(), workspaceId, binding.bindingId, "Internal");
  return { bindingId: binding.bindingId, held };
};

/** A guide page that includes this one concept — the cascade's second level, seeded. */
const pageIncluding = (workspaceId: string, iri: string): Promise<string> =>
  seededBy(db(), async (seed) => {
    const page = await seed.composition({ workspaceId });
    await seed.compositionInclude({ workspaceId, compositionId: page.id, iri, ordinal: 0 });
    return page.id;
  });

/** How many findings a document still holds. */
const findingCountOf = async (workspaceId: string, documentId: string) => {
  const found = await db().pool.query<{ held: number }>(
    "SELECT count(*)::int AS held FROM finding WHERE workspace_id = $1 AND document_id = $2",
    [workspaceId, documentId],
  );
  return found.rows[0]?.held ?? 0;
};

/**
 * One Internal binding with two documents under it, each holding one published chunk of the
 * same eight characters — the arrangement both acts below are taken over.
 */
const bindingWithTwoDocuments = async (scenario: Scenario) => {
  const first = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
  const second = await documentUnder(db(), scenario.workspaceId, first.bindingId, null);
  const published = new Date("2026-09-01T09:00:00.000Z");
  for (const document of [first, second]) {
    await chunkUnder(db(), scenario.workspaceId, document, {
      content: "12-34-56",
      ordinal: 0,
      charStart: 0,
      charEnd: 8,
      sensitivity: "Internal",
      publishedAt: published,
    });
  }
  return { bindingId: first.bindingId, first, second };
};

describe("the review read of a binding's findings", () => {
  it("groups them by category and rule, with the document each sits in and how many", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, {
      category: "government-id",
      ruleId: "national-insurance-number",
    });
    await findingIn(scenario.workspaceId, second.documentId);

    const read = await findingsAs(scenario.admin, bindingId);

    expect(read).toEqual({
      ok: true,
      value: [
        {
          documentId: first.documentId,
          title: "The handbook",
          sensitivity: "Internal",
          category: "bank-details",
          ruleId: "sort-code-with-account-number",
          tier: "always",
          specialCategory: false,
          found: 2,
        },
        {
          documentId: second.documentId,
          title: "The handbook",
          sensitivity: "Internal",
          category: "bank-details",
          ruleId: "sort-code-with-account-number",
          tier: "always",
          specialCategory: false,
          found: 1,
        },
        {
          documentId: first.documentId,
          title: "The handbook",
          sensitivity: "Internal",
          category: "government-id",
          ruleId: "national-insurance-number",
          tier: "always",
          specialCategory: false,
          found: 1,
        },
      ],
    });
  });

  it("carries no value and no offset — a finding is a location and never a quotation", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);

    const read = await findingsAs(scenario.admin, bindingId);

    // The whole field list, spelled out: a column added to the read is a decision this case
    // makes somebody take, and `char_start`, `char_end` and any text are what it keeps out.
    expect(read.ok ? Object.keys(read.value[0] ?? {}).toSorted() : []).toEqual([
      "category",
      "documentId",
      "found",
      "ruleId",
      "sensitivity",
      "specialCategory",
      "tier",
      "title",
    ]);
  });

  it("reads a document the seam narrowed for special category as already Restricted", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
    // The seam's own verdict, as the column's declaration describes it: a document holding
    // special category data is written down to Restricted by the run that found it.
    const narrowed = await documentUnder(
      db(),
      scenario.workspaceId,
      binding.bindingId,
      "Restricted",
    );
    await findingIn(scenario.workspaceId, narrowed.documentId, {
      category: "special-category",
      ruleId: "health-condition",
    });
    await findingIn(scenario.workspaceId, binding.documentId);

    const read = await findingsAs(scenario.admin, binding.bindingId);

    expect(
      read.ok
        ? read.value.map((group) => ({
            category: group.category,
            specialCategory: group.specialCategory,
            sensitivity: group.sensitivity,
          }))
        : [],
    ).toEqual([
      { category: "bank-details", specialCategory: false, sensitivity: "Internal" },
      { category: "special-category", specialCategory: true, sensitivity: "Restricted" },
    ]);
  });

  it("reads a document held above its binding at the binding's class, which is the narrower", async () => {
    // A binding narrowed after its documents were catalogued rewrites its own row and the
    // chunk copies and leaves `source_document.sensitivity` alone, so this shape is ordinary
    // rather than contrived: the document says Internal and nobody below Admin can see it.
    const scenario = await arrange();
    const { bindingId, held } = await documentHeldAboveItsBinding(scenario.workspaceId);
    await findingIn(scenario.workspaceId, held.documentId);

    const read = await findingsAs(scenario.admin, bindingId);

    expect(read.ok ? read.value.map((group) => group.sensitivity) : []).toEqual(["Restricted"]);
  });

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor],
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
  ] as const)("is refused to %s, who never learns what the seam found", async (_who, personOf) => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);

    const read = await findingsAs(personOf(scenario), bindingId);

    expect(read).toEqual({ ok: false, error: "role-forbids" });
  });
});

/**
 * The keep its cases below are read off: the Admin keeps the sort-code group of each document —
 * the first document's holding **two** spans, because a group is kept whole and the act finds
 * its spans itself — and leaves a second group in the first document that nobody selected.
 */
const keepingTwoGroupsOfThree = async (scenario: Scenario) => {
  const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
  const kept = await findingIn(scenario.workspaceId, first.documentId);
  const keptBesideIt = await findingIn(scenario.workspaceId, first.documentId, {
    charStart: 40,
    charEnd: 48,
  });
  const alsoKept = await findingIn(scenario.workspaceId, second.documentId);
  const left = await findingIn(scenario.workspaceId, first.documentId, NATIONAL_INSURANCE);
  const outcome = await keepAs(scenario.admin, bindingId, [
    findingGroupIn(first.documentId),
    findingGroupIn(second.documentId),
  ]);
  // Oldest id first, which is the order the act restores in and the ledger rows land in.
  const spans = [kept, keptBesideIt, alsoKept].toSorted();
  return { bindingId, kept, keptBesideIt, alsoKept, left, spans, outcome };
};

describe("an Admin keeping named finding groups in the text", () => {
  it("restores every span of every group under one batch id and queues one index run to let them back in", async () => {
    const scenario = await arrange();

    const { bindingId, kept, keptBesideIt, alsoKept, left, spans, outcome } =
      await keepingTwoGroupsOfThree(scenario);

    expect(outcome).toMatchObject({ ok: true, value: { bindingId, findingIds: spans } });
    expect(await restoreOf(scenario.workspaceId, kept)).toEqual({
      restored: true,
      restored_by: `human:${scenario.admin.userId}`,
      restore_reason: BUSINESS_FACT,
    });
    // The group is kept whole: the act was handed no span, and found both of this one's.
    expect(await restoreOf(scenario.workspaceId, keptBesideIt)).toMatchObject({ restored: true });
    expect(await restoreOf(scenario.workspaceId, alsoKept)).toMatchObject({ restored: true });
    // The group nobody selected is untouched: a bulk act reaches what it was given and no more.
    expect(await restoreOf(scenario.workspaceId, left)).toEqual({
      restored: false,
      restored_by: null,
      restore_reason: null,
    });

    const ledger = await batchedRowsOf(db().pool, scenario.workspaceId, "sources.finding.restored");
    const batchId = outcome.ok ? outcome.value.batchId : undefined;
    expect(typeof batchId).toBe("string");
    // One row per span sharing one batch id, never one row hiding three (ADR 0014 rule 4).
    expect(ledger).toEqual(
      spans.map((span) => ({ subject_id: span, batch_id: batchId, detail: { findingId: span } })),
    );
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "restored", subject_id: bindingId },
    ]);
  });

  it("marks every span it kept as reviewed — kept in text, by this Admin, for the batch's reason — and no other", async () => {
    const scenario = await arrange();

    const { kept, alsoKept, left } = await keepingTwoGroupsOfThree(scenario);

    const keptInText = {
      review_state: "kept-in-text",
      reviewed: true,
      reviewed_by: `human:${scenario.admin.userId}`,
      review_reason: BUSINESS_FACT,
    };
    expect(await reviewOf(scenario.workspaceId, kept)).toEqual(keptInText);
    expect(await reviewOf(scenario.workspaceId, alsoKept)).toEqual(keptInText);
    // The group nobody selected is still nobody's review: the widening block reads this column.
    expect(await reviewOf(scenario.workspaceId, left)).toEqual(UNREVIEWED);
  });

  it("keeps one group of two spans under a batch id, because the batch is the spans and never the groups", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, { charStart: 40, charEnd: 48 });

    const outcome = await keepAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    const batchId = outcome.ok ? outcome.value.batchId : undefined;
    expect(typeof batchId).toBe("string");
    expect(
      (await batchedRowsOf(db().pool, scenario.workspaceId, "sources.finding.restored")).map(
        (row) => row.batch_id,
      ),
    ).toEqual([batchId, batchId]);
  });

  it.each([
    ["named once", 1],
    ["named twice, which is one group all the same", 2],
  ] as const)(
    "keeps a group of one span, %s, as one restore with no batch id — there is no batch to name",
    async (_how, times) => {
      const scenario = await arrange();
      const { bindingId, first } = await bindingWithTwoDocuments(scenario);
      const kept = await findingIn(scenario.workspaceId, first.documentId);

      const outcome = await keepAs(
        scenario.admin,
        bindingId,
        Array.from({ length: times }, () => findingGroupIn(first.documentId)),
      );

      expect(outcome).toMatchObject({
        ok: true,
        value: { findingIds: [kept], batchId: undefined },
      });
      expect(
        await batchedRowsOf(db().pool, scenario.workspaceId, "sources.finding.restored"),
      ).toEqual([{ subject_id: kept, batch_id: null, detail: { findingId: kept } }]);
    },
  );

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor, "role-forbids"],
    ["a Viewer", (scenario: Scenario) => scenario.viewer, "role-forbids"],
  ] as const)("refuses %s, and neither a row nor a run moves", async (_who, personOf, refusal) => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const named = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await keepAs(personOf(scenario), bindingId, [findingGroupIn(first.documentId)]);

    expect(outcome).toEqual({ ok: false, error: refusal });
    expect(await restoreOf(scenario.workspaceId, named)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a group outside the always set, and the group beside it lands nothing", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const alwaysSet = await findingIn(scenario.workspaceId, first.documentId);
    const switchedAtTheBinding = {
      tier: "default-on",
      category: "home-address",
      ruleId: "postal-address",
    };
    await findingIn(scenario.workspaceId, first.documentId, switchedAtTheBinding);

    const outcome = await keepAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId),
      findingGroupIn(first.documentId, switchedAtTheBinding),
    ]);

    expect(outcome).toEqual({ ok: false, error: "not-the-always-set" });
    // Every group is answered before the first span moves, so the always-set group beside the
    // refused one lands nothing: a keep that half landed would leave the caller to undo it.
    expect(await restoreOf(scenario.workspaceId, alwaysSet)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a group of another binding, because a keep is one binding's review", async () => {
    const scenario = await arrange();
    const { bindingId } = await bindingWithTwoDocuments(scenario);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
    const theirs = await findingIn(scenario.workspaceId, elsewhere.documentId);

    const outcome = await keepAs(scenario.admin, bindingId, [findingGroupIn(elsewhere.documentId)]);

    expect(outcome).toEqual({ ok: false, error: "no-such-finding" });
    expect(await restoreOf(scenario.workspaceId, theirs)).toMatchObject({ restored: false });
  });

  it("refuses a group that holds no finding, and the group beside it lands nothing", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const held = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await keepAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId),
      findingGroupIn(first.documentId, NATIONAL_INSURANCE),
    ]);

    // A keep over nothing would queue a run for nothing, and a screen that named a group the
    // binding no longer holds is a screen to read again.
    expect(outcome).toEqual({ ok: false, error: "no-such-finding" });
    expect(await restoreOf(scenario.workspaceId, held)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("keeps an officer's name raised at the always tier and leaves the same rule's default-off names in that document", async () => {
    // The officer-block rule raises a person's name at the always tier under the rule that
    // finds every name (the S0 spec; `findings.ts`), so one document holds one category and one
    // rule at two tiers — two groups on the review, and only one of them is a keep's to take.
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const names = { category: "person-name", ruleId: "PERSON" };
    const officer = await findingIn(scenario.workspaceId, first.documentId, names);
    const bidWriter = await findingIn(scenario.workspaceId, first.documentId, {
      ...names,
      tier: "default-off",
      charStart: 40,
      charEnd: 48,
    });

    const outcome = await keepAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId, names),
    ]);

    expect(outcome).toMatchObject({ ok: true, value: { findingIds: [officer] } });
    expect(await restoreOf(scenario.workspaceId, bidWriter)).toMatchObject({ restored: false });
  });
});

describe("an Admin narrowing named documents", () => {
  it("takes each one to Restricted, rewrites its chunk copies and writes one ledger row per document", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);

    const outcome = await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    expect(outcome).toMatchObject({
      ok: true,
      value: { bindingId, documentIds: [first.documentId], sensitivity: "Restricted" },
    });
    expect(await chunkClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Restricted"]);
    // The sibling under the same binding is where it was: a narrowing reaches what it named.
    expect(await chunkClassesOf(scenario.workspaceId, second.documentId)).toEqual(["Internal"]);
    expect(
      await batchedRowsOf(db().pool, scenario.workspaceId, "sources.document.narrowed"),
    ).toEqual([
      {
        subject_id: first.documentId,
        batch_id: null,
        detail: { documentId: first.documentId, bindingId, sensitivity: "Restricted" },
      },
    ]);
  });

  it("reviews the findings of the groups it was given as narrowed, by this Admin — and no finding the Admin was not shown", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    const answered = await findingIn(scenario.workspaceId, first.documentId);
    // The health finding of the same document, in a group this narrowing was never handed.
    const unopened = await findingIn(scenario.workspaceId, first.documentId, {
      category: "special-category",
      ruleId: "health-condition",
    });
    const siblings = await findingIn(scenario.workspaceId, second.documentId);

    await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    // No reason: the act takes none, and the ledger row it wrote says what was done.
    expect(await reviewOf(scenario.workspaceId, answered)).toEqual({
      review_state: "narrowed",
      reviewed: true,
      reviewed_by: `human:${scenario.admin.userId}`,
      review_reason: null,
    });
    // The document went to Restricted with it, and its health finding is still nobody's review:
    // a widening is held against this column, and a row must not say a review nobody took.
    expect(await reviewOf(scenario.workspaceId, unopened)).toEqual(UNREVIEWED);
    expect(await reviewOf(scenario.workspaceId, siblings)).toEqual(UNREVIEWED);
  });

  it("leaves a span an Admin already kept in text as kept, inside a group it narrows", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const kept = await findingIn(scenario.workspaceId, first.documentId);
    await keepAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);
    // Raised by a later run, so the group the Admin narrows holds a kept span and a new one.
    const raisedSince = await findingIn(scenario.workspaceId, first.documentId, {
      charStart: 40,
      charEnd: 48,
    });

    await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    expect(await reviewOf(scenario.workspaceId, kept)).toMatchObject({
      review_state: "kept-in-text",
      review_reason: BUSINESS_FACT,
    });
    expect(await reviewOf(scenario.workspaceId, raisedSince)).toMatchObject({
      review_state: "narrowed",
    });
  });

  it("queues one index run with the reason narrowed, however many documents it took", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);

    const outcome = await narrowAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId),
      findingGroupIn(second.documentId),
    ]);

    expect(typeof (outcome.ok ? outcome.value.jobId : undefined)).toBe("string");
    // One run for the binding and never one per document: the run's subject is the binding.
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "narrowed", subject_id: bindingId },
    ]);
  });

  it("answers the run a keep already queued for the binding, and queues no second one", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    const keep = await keepAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    const outcome = await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    const queuedByTheKeep = keep.ok ? keep.value.jobId : undefined;
    expect(typeof queuedByTheKeep).toBe("string");
    expect(outcome).toMatchObject({ ok: true, value: { jobId: queuedByTheKeep } });
    // One queued run per binding is the queue's rule, and the run keeps the reason it has.
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "restored", subject_id: bindingId },
    ]);
  });

  it("writes one row per document under one batch id when it narrows two", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    const named = [first.documentId, second.documentId].toSorted();

    const outcome = await narrowAs(
      scenario.admin,
      bindingId,
      named.map((documentId) => findingGroupIn(documentId)),
    );

    const batchId = outcome.ok ? outcome.value.batchId : undefined;
    expect(typeof batchId).toBe("string");
    expect(
      (await batchedRowsOf(db().pool, scenario.workspaceId, "sources.document.narrowed")).map(
        (row) => ({ subject_id: row.subject_id, batch_id: row.batch_id }),
      ),
    ).toEqual(named.map((documentId) => ({ subject_id: documentId, batch_id: batchId })));
  });

  it("runs the cascade from the concepts citing the documents it narrowed, and no further", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    const citing = await conceptCiting(scenario, scenario.editor, [first.documentId]);
    const untouched = await conceptCiting(scenario, scenario.editor, [second.documentId]);

    const page = await pageIncluding(scenario.workspaceId, citing.iri);

    const outcome = await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    expect(outcome).toMatchObject({
      ok: true,
      value: { concepts: [citing.iri], compositions: [page] },
    });
    expect(
      await visibilityHeld(db().pool, "concept_index", scenario.workspaceId, citing.iri),
    ).toMatchObject({ sensitivity: "Restricted" });
    expect(
      await visibilityHeld(db().pool, "concept_index", scenario.workspaceId, untouched.iri),
    ).toMatchObject({ sensitivity: "Internal" });
    // The second level, in the same transaction as the first: a guide that reached a reader
    // its includes no longer do is the leak the synchronous cascade exists to close.
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, page),
    ).toMatchObject({ sensitivity: "Restricted" });
  });

  it("leaves a narrowed document invisible to a Viewer while its sibling is not", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    const spanOf = (documentId: string) => `${documentId}/chars:0-8`;

    await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    const narrowed = await acting(scenario.viewer, (principal, tx) =>
      passageAt(principal, tx, spanOf(first.documentId)),
    );
    const sibling = await acting(scenario.viewer, (principal, tx) =>
      passageAt(principal, tx, spanOf(second.documentId)),
    );
    expect(narrowed).toEqual({ ok: false, error: "not-found" });
    expect(sibling).toMatchObject({ ok: true, value: { text: "12-34-56" } });
  });

  it("refuses a class wider than the document's, and nothing moves", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);

    const outcome = await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)], {
      sensitivity: "Public",
    });

    expect(outcome).toEqual({ ok: false, error: "widening-refused" });
    expect(await chunkClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Internal"]);
    expect(
      await batchedRowsOf(db().pool, scenario.workspaceId, "sources.document.narrowed"),
    ).toEqual([]);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a class wider than the binding's, over a document whose own class is wider still", async () => {
    // The fold, as a refusal: the document says Internal and its binding says Restricted, so
    // the class it is read at is Restricted and Internal would widen it. An act that read the
    // document's own word alone would let this through and rewrite the chunk copies to
    // Internal — a widening of the very rows the read predicate is applied to.
    const scenario = await arrange();
    const { bindingId, held } = await documentHeldAboveItsBinding(scenario.workspaceId);
    await chunkUnder(db(), scenario.workspaceId, held, {
      content: "12-34-56",
      ordinal: 0,
      charStart: 0,
      charEnd: 8,
      sensitivity: "Restricted",
      publishedAt: new Date("2026-09-01T09:00:00.000Z"),
    });

    const outcome = await narrowAs(scenario.admin, bindingId, [findingGroupIn(held.documentId)], {
      sensitivity: "Internal",
    });

    expect(outcome).toEqual({ ok: false, error: "widening-refused" });
    expect(await chunkClassesOf(scenario.workspaceId, held.documentId)).toEqual(["Restricted"]);
  });

  it("refuses a document of another binding, and takes the batch beside it down too", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });

    const outcome = await narrowAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId),
      findingGroupIn(elsewhere.documentId),
    ]);

    expect(outcome).toEqual({ ok: false, error: "no-such-document" });
    expect(await chunkClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Internal"]);
  });

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor],
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
  ] as const)("refuses %s, and no document moves", async (_who, personOf) => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);

    const outcome = await narrowAs(personOf(scenario), bindingId, [
      findingGroupIn(first.documentId),
    ]);

    expect(outcome).toEqual({ ok: false, error: "role-forbids" });
    expect(await chunkClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Internal"]);
  });
});

/** The reprocess as the Admin's act, for the reason the case is about. */
const reprocessAsAdmin = (
  scenario: Scenario,
  bindingId: string,
  reason: ReprocessBindingInput["reason"],
) =>
  acting(scenario.admin, (principal, tx) => reprocessBinding(principal, tx, { bindingId, reason }));

describe("a bulk act handed no finding group at all", () => {
  it("refuses a keep as malformed, because an empty keep would still queue a run", async () => {
    const scenario = await arrange();
    const { bindingId } = await bindingWithTwoDocuments(scenario);

    expect(await keepAs(scenario.admin, bindingId, [])).toEqual({ ok: false, error: "malformed" });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a narrowing as malformed, because it names no document to narrow", async () => {
    const scenario = await arrange();
    const { bindingId } = await bindingWithTwoDocuments(scenario);

    expect(await narrowAs(scenario.admin, bindingId, [])).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });
});

describe("the reprocess that follows a review", () => {
  it("takes the findings nobody has marked away with the chunks, so a span the rules no longer raise does not linger", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, { category: "government-id" });
    await findingIn(scenario.workspaceId, second.documentId);

    const outcome = await reprocessAsAdmin(scenario, bindingId, "rule-change");

    expect(outcome).toMatchObject({ ok: true, value: { chunks: 2, findings: 3 } });
    expect(await findingCountOf(scenario.workspaceId, first.documentId)).toBe(0);
    expect(await findingCountOf(scenario.workspaceId, second.documentId)).toBe(0);
  });

  it("leaves a span an Admin kept in text where it was — its id, its restore and its review — and takes the unmarked span beside it", async () => {
    const scenario = await arrange();

    const { bindingId, kept, left } = await keepingTwoGroupsOfThree(scenario);
    const outcome = await reprocessAsAdmin(scenario, bindingId, "rule-change");

    // Two kept, one left: the count the act answers is the rows that went, and one did.
    expect(outcome).toMatchObject({ ok: true, value: { findings: 1 } });
    expect(await restoreOf(scenario.workspaceId, kept)).toEqual({
      restored: true,
      restored_by: `human:${scenario.admin.userId}`,
      restore_reason: BUSINESS_FACT,
    });
    expect(await reviewOf(scenario.workspaceId, kept)).toMatchObject({
      review_state: "kept-in-text",
    });
    expect(await marksOf(scenario.workspaceId, left)).toBeUndefined();
  });

  it.each([
    [
      "restored through S0's act on its own, and so never reviewed",
      { restoredAt: new Date("2026-09-12T10:00:00.000Z"), restoreReason: BUSINESS_FACT },
      "restoredBy",
    ],
    [
      "reviewed as narrowed, and never restored",
      { reviewState: "narrowed", reviewedAt: new Date("2026-09-12T10:00:00.000Z") },
      "reviewedBy",
    ],
  ] as const)(
    "spares a finding %s — either mark alone is an Admin's act",
    async (_how, marks, actorColumn) => {
      const scenario = await arrange();
      const { bindingId, first } = await bindingWithTwoDocuments(scenario);
      const marked = await seededBy(db(), async (seed) => {
        const row = await seed.finding({
          workspaceId: scenario.workspaceId,
          documentId: first.documentId,
          ...marks,
          [actorColumn]: `human:${scenario.admin.userId}`,
        });
        return row.id;
      });

      const outcome = await reprocessAsAdmin(scenario, bindingId, "wiped");

      expect(outcome).toMatchObject({ ok: true, value: { findings: 0 } });
      expect(await marksOf(scenario.workspaceId, marked)).toBeDefined();
    },
  );

  it("leaves another binding's findings where they are", async () => {
    const scenario = await arrange();
    const { bindingId } = await bindingWithTwoDocuments(scenario);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
    await findingIn(scenario.workspaceId, elsewhere.documentId);

    await reprocessAsAdmin(scenario, bindingId, "rule-change");

    expect(await findingCountOf(scenario.workspaceId, elsewhere.documentId)).toBe(1);
  });
});
