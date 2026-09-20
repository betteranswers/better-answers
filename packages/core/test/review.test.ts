import type pg from "pg";
import { describe, expect, it } from "vitest";

import type { UserPrincipal } from "../src/kernel/index.ts";
import {
  findingsOf,
  keepInText,
  narrowDocuments,
  passageAt,
  reprocessBinding,
  type NarrowDocumentsInput,
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

/** The narrowing act as a person at this role would reach it, through the slice's own export. */
const narrowAs = (who: UserPrincipal, input: NarrowDocumentsInput) =>
  acting(who, (principal, tx) => narrowDocuments(principal, tx, input));

/** One span the seam raised in a document, at the category, rule and tier the case is about. */
const findingIn = async (
  workspaceId: string,
  documentId: string,
  overrides: {
    readonly category?: string;
    readonly ruleId?: string;
    readonly tier?: string;
  } = {},
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const row = await seed.finding({ workspaceId, documentId, ...overrides });
    return row.id;
  });

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
 * The keep both of its cases below are read off: the Admin keeps one span in each document of
 * the binding and leaves a third, in the first document, that nobody selected.
 */
const keepingTwoSpansOfThree = async (scenario: Scenario) => {
  const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
  const kept = await findingIn(scenario.workspaceId, first.documentId);
  const alsoKept = await findingIn(scenario.workspaceId, second.documentId);
  const left = await findingIn(scenario.workspaceId, first.documentId);
  const outcome = await acting(scenario.admin, (principal, tx) =>
    keepInText(principal, tx, { bindingId, findingIds: [kept, alsoKept], reason: BUSINESS_FACT }),
  );
  return { bindingId, kept, alsoKept, left, outcome };
};

describe("an Admin keeping named spans in the text", () => {
  it("restores every one of them under a batch id and queues one index run to let them back in", async () => {
    const scenario = await arrange();

    const { bindingId, kept, alsoKept, left, outcome } = await keepingTwoSpansOfThree(scenario);

    expect(outcome).toMatchObject({ ok: true, value: { bindingId, findingIds: [kept, alsoKept] } });
    expect(await restoreOf(scenario.workspaceId, kept)).toEqual({
      restored: true,
      restored_by: `human:${scenario.admin.userId}`,
      restore_reason: BUSINESS_FACT,
    });
    expect(await restoreOf(scenario.workspaceId, alsoKept)).toMatchObject({ restored: true });
    // The span nobody selected is untouched: a bulk act reaches what it was given and no more.
    expect(await restoreOf(scenario.workspaceId, left)).toEqual({
      restored: false,
      restored_by: null,
      restore_reason: null,
    });

    const ledger = await batchedRowsOf(db().pool, scenario.workspaceId, "sources.finding.restored");
    const batchId = outcome.ok ? outcome.value.batchId : undefined;
    expect(typeof batchId).toBe("string");
    // Two rows sharing one batch id, never one row hiding two (ADR 0014 rule 4).
    expect(ledger).toEqual([
      { subject_id: kept, batch_id: batchId, detail: { findingId: kept } },
      { subject_id: alsoKept, batch_id: batchId, detail: { findingId: alsoKept } },
    ]);
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "restored", subject_id: bindingId },
    ]);
  });

  it("marks every span it kept as reviewed — kept in text, by this Admin, for the batch's reason — and no other", async () => {
    const scenario = await arrange();

    const { kept, alsoKept, left } = await keepingTwoSpansOfThree(scenario);

    const keptInText = {
      review_state: "kept-in-text",
      reviewed: true,
      reviewed_by: `human:${scenario.admin.userId}`,
      review_reason: BUSINESS_FACT,
    };
    expect(await reviewOf(scenario.workspaceId, kept)).toEqual(keptInText);
    expect(await reviewOf(scenario.workspaceId, alsoKept)).toEqual(keptInText);
    // The span nobody selected is still nobody's review: the widening block reads this column.
    expect(await reviewOf(scenario.workspaceId, left)).toEqual(UNREVIEWED);
  });

  it("keeps one span on its own with no batch id, because there is no batch to name", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const kept = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await acting(scenario.admin, (principal, tx) =>
      keepInText(principal, tx, { bindingId, findingIds: [kept], reason: BUSINESS_FACT }),
    );

    expect(outcome).toMatchObject({ ok: true, value: { batchId: undefined } });
    expect(
      await batchedRowsOf(db().pool, scenario.workspaceId, "sources.finding.restored"),
    ).toEqual([{ subject_id: kept, batch_id: null, detail: { findingId: kept } }]);
  });

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor, "role-forbids"],
    ["a Viewer", (scenario: Scenario) => scenario.viewer, "role-forbids"],
  ] as const)("refuses %s, and neither a row nor a run moves", async (_who, personOf, refusal) => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const named = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await acting(personOf(scenario), (principal, tx) =>
      keepInText(principal, tx, { bindingId, findingIds: [named], reason: BUSINESS_FACT }),
    );

    expect(outcome).toEqual({ ok: false, error: refusal });
    expect(await restoreOf(scenario.workspaceId, named)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a span outside the always set, and the batch beside it lands nothing", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const alwaysSet = await findingIn(scenario.workspaceId, first.documentId);
    const switchedAtTheBinding = await findingIn(scenario.workspaceId, first.documentId, {
      tier: "default-on",
      category: "home-address",
      ruleId: "postal-address",
    });

    const outcome = await acting(scenario.admin, (principal, tx) =>
      keepInText(principal, tx, {
        bindingId,
        findingIds: [alwaysSet, switchedAtTheBinding],
        reason: BUSINESS_FACT,
      }),
    );

    expect(outcome).toEqual({ ok: false, error: "not-the-always-set" });
    // The act is one transaction, so the span it did restore before the refusal is rolled
    // back with it: a keep that half landed would leave a run to queue and nobody to queue it.
    expect(await restoreOf(scenario.workspaceId, alwaysSet)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a span of another binding, because a keep is one binding's review", async () => {
    const scenario = await arrange();
    const { bindingId } = await bindingWithTwoDocuments(scenario);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
    const theirs = await findingIn(scenario.workspaceId, elsewhere.documentId);

    const outcome = await acting(scenario.admin, (principal, tx) =>
      keepInText(principal, tx, { bindingId, findingIds: [theirs], reason: BUSINESS_FACT }),
    );

    expect(outcome).toEqual({ ok: false, error: "no-such-finding" });
    expect(await restoreOf(scenario.workspaceId, theirs)).toMatchObject({ restored: false });
  });
});

describe("an Admin narrowing named documents", () => {
  it("takes each one to Restricted, rewrites its chunk copies and writes one ledger row per document", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);

    const outcome = await narrowAs(scenario.admin, { bindingId, documentIds: [first.documentId] });

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

  it("queues one index run with the reason narrowed, however many documents it took", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);

    const outcome = await narrowAs(scenario.admin, {
      bindingId,
      documentIds: [first.documentId, second.documentId],
    });

    expect(typeof (outcome.ok ? outcome.value.jobId : undefined)).toBe("string");
    // One run for the binding and never one per document: the run's subject is the binding.
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "narrowed", subject_id: bindingId },
    ]);
  });

  it("answers the run a keep already queued for the binding, and queues no second one", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const kept = await findingIn(scenario.workspaceId, first.documentId);
    const keep = await acting(scenario.admin, (principal, tx) =>
      keepInText(principal, tx, { bindingId, findingIds: [kept], reason: BUSINESS_FACT }),
    );

    const outcome = await narrowAs(scenario.admin, { bindingId, documentIds: [first.documentId] });

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

    const outcome = await narrowAs(scenario.admin, { bindingId, documentIds: named });

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

    const outcome = await narrowAs(scenario.admin, { bindingId, documentIds: [first.documentId] });

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

    await narrowAs(scenario.admin, { bindingId, documentIds: [first.documentId] });

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

    const outcome = await narrowAs(scenario.admin, {
      bindingId,
      documentIds: [first.documentId],
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

    const outcome = await narrowAs(scenario.admin, {
      bindingId,
      documentIds: [held.documentId],
      sensitivity: "Internal",
    });

    expect(outcome).toEqual({ ok: false, error: "widening-refused" });
    expect(await chunkClassesOf(scenario.workspaceId, held.documentId)).toEqual(["Restricted"]);
  });

  it("refuses a document of another binding, and takes the batch beside it down too", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });

    const outcome = await narrowAs(scenario.admin, {
      bindingId,
      documentIds: [first.documentId, elsewhere.documentId],
    });

    expect(outcome).toEqual({ ok: false, error: "no-such-document" });
    expect(await chunkClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Internal"]);
  });

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor],
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
  ] as const)("refuses %s, and no document moves", async (_who, personOf) => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);

    const outcome = await narrowAs(personOf(scenario), {
      bindingId,
      documentIds: [first.documentId],
    });

    expect(outcome).toEqual({ ok: false, error: "role-forbids" });
    expect(await chunkClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Internal"]);
  });
});

describe("the reprocess that follows a review", () => {
  it("takes the binding's findings away with its chunks, so the next run starts from none", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, { category: "government-id" });
    await findingIn(scenario.workspaceId, second.documentId);

    const outcome = await acting(scenario.admin, (principal, tx) =>
      reprocessBinding(principal, tx, { bindingId, reason: "rule-change" }),
    );

    // A finding's id is a minted ULID and the worker holds INSERT alone, so rows left standing
    // would come back doubled from the run this queues.
    expect(outcome).toMatchObject({ ok: true, value: { chunks: 2, findings: 3 } });
    expect(await findingCountOf(scenario.workspaceId, first.documentId)).toBe(0);
    expect(await findingCountOf(scenario.workspaceId, second.documentId)).toBe(0);
  });

  it("leaves another binding's findings where they are", async () => {
    const scenario = await arrange();
    const { bindingId } = await bindingWithTwoDocuments(scenario);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
    await findingIn(scenario.workspaceId, elsewhere.documentId);

    await acting(scenario.admin, (principal, tx) =>
      reprocessBinding(principal, tx, { bindingId, reason: "rule-change" }),
    );

    expect(await findingCountOf(scenario.workspaceId, elsewhere.documentId)).toBe(1);
  });
});
