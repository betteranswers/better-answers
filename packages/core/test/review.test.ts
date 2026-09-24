import { REASONS_EMPTYING_THE_BINDING } from "@better-answers/schema";
import type pg from "pg";
import { describe, expect, it } from "vitest";

import type { z } from "zod";

import { parse, type UserPrincipal } from "../src/kernel/index.ts";
import {
  dismissAsNotSpecialCategory,
  dismissAsNotSpecialCategoryInput,
  findingsOf,
  findingsOfInput,
  keepInText,
  keepInTextInput,
  narrowDocuments,
  narrowDocumentsInput,
  passageAt,
  reprocessBinding,
  reprocessBindingInput,
  type findingGroupKey,
} from "../src/sources/index.ts";
import { inputOf } from "./suite-input.ts";
import {
  bindingHolding,
  chunkUnder,
  chunkVersionsOf,
  conceptCiting,
  documentUnder,
  seededBy,
  visibilitySuite,
  visibilityHeld,
} from "./sourced-concept.ts";
import { whileWritesAreRefused } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading: acting } = visibilitySuite();

const BUSINESS_FACT = "The sort code is the company's own, printed on every invoice it sends.";

type FindingGroupAsked = z.input<typeof findingGroupKey>;

const keepAs = (
  who: UserPrincipal,
  bindingId: string,
  findingGroups: readonly FindingGroupAsked[],
) =>
  acting(who, (principal, tx) =>
    keepInText(
      principal,
      tx,
      inputOf(keepInTextInput, { bindingId, findingGroups, reason: BUSINESS_FACT }),
    ),
  );

const narrowAs = (
  who: UserPrincipal,
  bindingId: string,
  findingGroups: readonly FindingGroupAsked[],
  to: { readonly sensitivity?: string } = {},
) =>
  acting(who, (principal, tx) =>
    narrowDocuments(
      principal,
      tx,
      inputOf(narrowDocumentsInput, { bindingId, findingGroups, sensitivity: to.sensitivity }),
    ),
  );

const NOT_HEALTH_DATA = "Our engineers diagnose faults in pumps, never in people.";

const HEALTH = { category: "special-category", ruleId: "HEALTH_CUE" };

const dismissAs = (
  who: UserPrincipal,
  bindingId: string,
  findingGroups: readonly FindingGroupAsked[],
) =>
  acting(who, (principal, tx) =>
    dismissAsNotSpecialCategory(
      principal,
      tx,
      inputOf(dismissAsNotSpecialCategoryInput, {
        bindingId,
        findingGroups,
        reason: NOT_HEALTH_DATA,
      }),
    ),
  );

const DISMISSED_ACT = "sources.document.special_category_dismissed";

const narrowedToOf = async (workspaceId: string, documentId: string) => {
  const found = await db().pool.query<{ sensitivity: string | null; narrowed_to: string | null }>(
    "SELECT sensitivity, narrowed_to FROM source_document WHERE workspace_id = $1 AND id = $2",
    [workspaceId, documentId],
  );
  return found.rows[0];
};

const findingIn = async (
  workspaceId: string,
  documentId: string,
  overrides: {
    readonly category?: string;
    readonly ruleId?: string;
    readonly tier?: string;
    readonly charStart?: number;
    readonly charEnd?: number;
    readonly ruleVersion?: string;
  } = {},
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const row = await seed.finding({ workspaceId, documentId, ...overrides });
    return row.id;
  });

const findingGroupIn = (
  documentId: string,
  overrides: Partial<Omit<FindingGroupAsked, "documentId">> = {},
): FindingGroupAsked => ({
  documentId,
  category: "bank-details",
  ruleId: "sort-code-with-account-number",
  tier: "always",
  ...overrides,
});

const SORT_CODE_RULE = { rule_id: "sort-code-with-account-number" };

const finishedIndexRun = (
  workspaceId: string,
  bindingId: string,
  finishedAt: string,
  overridden: ReadonlyArray<{
    readonly document_id: string;
    readonly rule_id: string;
    readonly char_start: number;
    readonly char_end: number;
  }>,
) =>
  seededBy(db(), (seed) =>
    seed.job({
      workspaceId,
      kind: "index",
      subjectId: bindingId,
      reason: "bound",
      status: "done",
      attempts: 1,
      finishedAt: new Date(finishedAt),
      outcome: {
        documents: 2,
        chunks: 2,
        lmdb_bytes: 8192,
        restores_overridden_by_erasure: [...overridden],
      },
    }),
  );

const NO_LONGER_RAISED = { ruleVersion: "0" };

const aGroupHoldingADroppedSpan = async (scenario: Scenario) => {
  const { bindingId, first } = await bindingWithTwoDocuments(scenario);
  const raised = await findingIn(scenario.workspaceId, first.documentId);
  const dropped = await findingIn(scenario.workspaceId, first.documentId, NO_LONGER_RAISED);
  return { bindingId, group: findingGroupIn(first.documentId), raised, dropped };
};

const readAgainAt = async (workspaceId: string, findingId: string, tier: string) => {
  await db().pool.query("UPDATE finding SET tier = $3 WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    findingId,
    tier,
  ]);
};

const NAMES = { category: "person-name", ruleId: "PERSON" };

const NATIONAL_INSURANCE = { category: "government-id", ruleId: "national-insurance-number" };

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

const restoreOf = async (workspaceId: string, findingId: string) => {
  const row = await marksOf(workspaceId, findingId);
  return {
    restored: row?.restored_at instanceof Date,
    restored_by: row?.restored_by ?? null,
    restore_reason: row?.restore_reason ?? null,
  };
};

const reviewOf = async (workspaceId: string, findingId: string) => {
  const row = await marksOf(workspaceId, findingId);
  return {
    review_state: row?.review_state ?? null,
    reviewed: row?.reviewed_at instanceof Date,
    reviewed_by: row?.reviewed_by ?? null,
    review_reason: row?.review_reason ?? null,
  };
};

const UNREVIEWED = {
  review_state: "unreviewed",
  reviewed: false,
  reviewed_by: null,
  review_reason: null,
};

const chunkClassesOf = async (workspaceId: string, documentId: string) => {
  const found = await db().pool.query<{ sensitivity: string }>(
    `SELECT sensitivity FROM "index".readable_chunk
      WHERE workspace_id = $1 AND source_document_id = $2 ORDER BY ordinal`,
    [workspaceId, documentId],
  );
  return found.rows.map((row) => row.sensitivity);
};

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

const jobsOf = async (workspaceId: string) => {
  const found = await db().pool.query<{ kind: string; reason: string | null; subject_id: string }>(
    "SELECT kind, reason, subject_id FROM job WHERE workspace_id = $1 ORDER BY enqueued_at, id",
    [workspaceId],
  );
  return found.rows;
};

const narrowingLeftBehindIn = async (workspaceId: string, documentId: string) => ({
  classes: await chunkClassesOf(workspaceId, documentId),
  ledger: await batchedRowsOf(db().pool, workspaceId, "sources.document.narrowed"),
  jobs: await jobsOf(workspaceId),
});

const NOTHING_NARROWED = { classes: ["Internal"], ledger: [], jobs: [] };

const findingsAs = (who: UserPrincipal, bindingId: string) =>
  acting(who, (principal, tx) =>
    findingsOf(principal, tx, inputOf(findingsOfInput, { bindingId })),
  );

const documentHeldAboveItsBinding = async (workspaceId: string) => {
  const binding = await bindingHolding(db(), workspaceId, { sensitivity: "Restricted" });
  const held = await documentUnder(db(), workspaceId, binding.bindingId, "Internal");
  return { bindingId: binding.bindingId, held };
};

const pageIncluding = (workspaceId: string, iri: string): Promise<string> =>
  seededBy(db(), async (seed) => {
    const page = await seed.composition({ workspaceId });
    await seed.compositionInclude({ workspaceId, compositionId: page.id, iri, ordinal: 0 });
    return page.id;
  });

const findingCountOf = async (workspaceId: string, documentId: string) => {
  const found = await db().pool.query<{ held: number }>(
    "SELECT count(*)::int AS held FROM finding WHERE workspace_id = $1 AND document_id = $2",
    [workspaceId, documentId],
  );
  return found.rows[0]?.held ?? 0;
};

const bindingWithTwoDocuments = async (scenario: Scenario) => {
  const first = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
  const second = await documentUnder(db(), scenario.workspaceId, first.bindingId, null);
  for (const document of [first, second]) {
    await chunkUnder(db(), scenario.workspaceId, document, {
      content: "12-34-56",
      ordinal: 0,
      charStart: 0,
      charEnd: 8,
    });
  }
  return { bindingId: first.bindingId, first, second };
};

const twoDocumentsTheSeamNarrowed = async (scenario: Scenario) => {
  const binding = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
  const first = await documentUnder(db(), scenario.workspaceId, binding.bindingId, "Restricted");
  const second = await documentUnder(db(), scenario.workspaceId, binding.bindingId, "Restricted");
  for (const document of [first, second]) {
    await chunkUnder(db(), scenario.workspaceId, document, {
      content: "He was diagnosed with a heart condition.",
      ordinal: 0,
      charStart: 0,
      charEnd: 40,
    });
  }
  return { bindingId: binding.bindingId, first, second };
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
          overriddenByErasure: 0,
          dismissed: 0,
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
          overriddenByErasure: 0,
          dismissed: 0,
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
          overriddenByErasure: 0,
          dismissed: 0,
        },
      ],
    });
  });

  it("carries no value and no offset — a finding is a location and never a quotation", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);

    const read = await findingsAs(scenario.admin, bindingId);

    expect(read.ok ? Object.keys(read.value[0] ?? {}).toSorted() : []).toEqual([
      "category",
      "dismissed",
      "documentId",
      "found",
      "overriddenByErasure",
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

  it("says how many of a special-category group's spans an Admin dismissed as not special category", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await twoDocumentsTheSeamNarrowed(scenario);
    await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    await findingIn(scenario.workspaceId, first.documentId, {
      ...HEALTH,
      charStart: 60,
      charEnd: 120,
    });
    await findingIn(scenario.workspaceId, second.documentId, HEALTH);
    await dismissAs(scenario.admin, bindingId, [findingGroupIn(first.documentId, HEALTH)]);

    const read = await findingsAs(scenario.admin, bindingId);

    expect(
      read.ok
        ? read.value.map((group) => ({
            documentId: group.documentId,
            found: group.found,
            dismissed: group.dismissed,
          }))
        : [],
    ).toEqual([
      { documentId: first.documentId, found: 2, dismissed: 2 },
      { documentId: second.documentId, found: 1, dismissed: 0 },
    ]);
  });

  it("reads a document held above its binding at the binding's class, which is the narrower", async () => {
    const scenario = await arrange();
    const { bindingId, held } = await documentHeldAboveItsBinding(scenario.workspaceId);
    await findingIn(scenario.workspaceId, held.documentId);

    const read = await findingsAs(scenario.admin, bindingId);

    expect(read.ok ? read.value.map((group) => group.sensitivity) : []).toEqual(["Restricted"]);
  });

  it("leaves out a span the binding's last run did not raise, and a group that holds no other", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, NO_LONGER_RAISED);
    await findingIn(scenario.workspaceId, first.documentId, {
      ...NATIONAL_INSURANCE,
      ...NO_LONGER_RAISED,
    });

    const read = await findingsAs(scenario.admin, bindingId);

    expect(
      read.ok ? read.value.map((group) => ({ ruleId: group.ruleId, found: group.found })) : [],
    ).toEqual([{ ruleId: "sort-code-with-account-number", found: 1 }]);
  });

  it("says how many of a group's kept spans the last finished run withheld all the same, because an erasure request names them", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId, { charStart: 54, charEnd: 97 });
    await findingIn(scenario.workspaceId, first.documentId, { charStart: 120, charEnd: 128 });
    await findingIn(scenario.workspaceId, second.documentId, { charStart: 54, charEnd: 97 });
    await finishedIndexRun(scenario.workspaceId, bindingId, "2026-09-20T10:00:00.000Z", [
      { ...SORT_CODE_RULE, document_id: second.documentId, char_start: 54, char_end: 97 },
    ]);
    await finishedIndexRun(scenario.workspaceId, bindingId, "2026-09-20T11:00:00.000Z", [
      { ...SORT_CODE_RULE, document_id: first.documentId, char_start: 54, char_end: 97 },
    ]);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
    await finishedIndexRun(
      scenario.workspaceId,
      elsewhere.bindingId,
      "2026-09-20T13:00:00.000Z",
      [],
    );

    await seededBy(db(), (seed) =>
      seed.job({
        workspaceId: scenario.workspaceId,
        kind: "index",
        subjectId: bindingId,
        reason: "rule-change",
        status: "failed",
        attempts: 1,
        finishedAt: new Date("2026-09-20T12:00:00.000Z"),
        outcome: { error: "TimeoutError" },
      }),
    );
    await keepAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId),
      findingGroupIn(second.documentId),
    ]);

    const read = await findingsAs(scenario.admin, bindingId);

    expect(
      read.ok
        ? read.value.map((group) => ({
            documentId: group.documentId,
            found: group.found,
            overriddenByErasure: group.overriddenByErasure,
          }))
        : [],
    ).toEqual([
      { documentId: first.documentId, found: 2, overriddenByErasure: 1 },

      { documentId: second.documentId, found: 1, overriddenByErasure: 0 },
    ]);
  });

  it("fails, rather than read nought, over a run whose list of kept spans it cannot read", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await seededBy(db(), (seed) =>
      seed.job({
        workspaceId: scenario.workspaceId,
        kind: "index",
        subjectId: bindingId,
        reason: "bound",
        status: "done",
        attempts: 1,
        finishedAt: new Date("2026-09-20T11:00:00.000Z"),
        outcome: {
          documents: 1,
          restores_overridden_by_erasure: [{ document_id: first.documentId }],
        },
      }),
    );

    const read = await findingsAs(scenario.admin, bindingId);

    expect(read.ok).toBe(false);
    expect(read.ok ? undefined : read.error).toBeInstanceOf(Error);
  });

  it("counts a span the run named only while an Admin's keep stands on it", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId, { charStart: 54, charEnd: 97 });
    await finishedIndexRun(scenario.workspaceId, bindingId, "2026-09-20T11:00:00.000Z", [
      { ...SORT_CODE_RULE, document_id: first.documentId, char_start: 54, char_end: 97 },
    ]);

    const read = await findingsAs(scenario.admin, bindingId);

    expect(read.ok ? read.value.map((group) => group.overriddenByErasure) : []).toEqual([0]);
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

    expect(await restoreOf(scenario.workspaceId, keptBesideIt)).toMatchObject({ restored: true });
    expect(await restoreOf(scenario.workspaceId, alsoKept)).toMatchObject({ restored: true });

    expect(await restoreOf(scenario.workspaceId, left)).toEqual({
      restored: false,
      restored_by: null,
      restore_reason: null,
    });

    const ledger = await batchedRowsOf(db().pool, scenario.workspaceId, "sources.finding.restored");
    const batchId = outcome.ok ? outcome.value.batchId : undefined;
    expect(typeof batchId).toBe("string");

    expect(ledger).toEqual(
      spans.map((span) => ({ subject_id: span, batch_id: batchId, detail: { findingId: span } })),
    );
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "restored", subject_id: bindingId },
    ]);
  });

  it("keeps not one span, and rejects rather than answering a word, when the queue will not hold its run", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const kept = await findingIn(scenario.workspaceId, first.documentId);

    await expect(
      whileWritesAreRefused(db().pool, "job", () =>
        keepAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]),
      ),
    ).rejects.toThrow(/refused a write to job/);

    expect(await restoreOf(scenario.workspaceId, kept)).toEqual({
      restored: false,
      restored_by: null,
      restore_reason: null,
    });
    expect(await reviewOf(scenario.workspaceId, kept)).toEqual(UNREVIEWED);
    expect(
      await batchedRowsOf(db().pool, scenario.workspaceId, "sources.finding.restored"),
    ).toEqual([]);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
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

    expect(outcome).toEqual({ ok: false, error: "no-such-finding" });
    expect(await restoreOf(scenario.workspaceId, held)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("keeps the spans of a group the last run raised, and not one it no longer raises", async () => {
    const scenario = await arrange();
    const { bindingId, group, raised, dropped } = await aGroupHoldingADroppedSpan(scenario);

    const outcome = await keepAs(scenario.admin, bindingId, [group]);

    expect(outcome).toMatchObject({ ok: true, value: { findingIds: [raised] } });
    expect(await restoreOf(scenario.workspaceId, dropped)).toMatchObject({ restored: false });
  });

  it("keeps a name it refused while the row read default-off, once a run has read it at the always tier", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const readAtFirst = { ...NAMES, tier: "default-off" };
    const officer = await findingIn(scenario.workspaceId, first.documentId, readAtFirst);

    const before = await keepAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId, readAtFirst),
    ]);
    await readAgainAt(scenario.workspaceId, officer, "always");
    const after = await keepAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId, NAMES),
    ]);

    expect(before).toEqual({ ok: false, error: "not-the-always-set" });
    expect(after).toMatchObject({ ok: true, value: { findingIds: [officer] } });
  });

  it("keeps an officer's name raised at the always tier and leaves the same rule's default-off names in that document", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const officer = await findingIn(scenario.workspaceId, first.documentId, NAMES);
    const bidWriter = await findingIn(scenario.workspaceId, first.documentId, {
      ...NAMES,
      tier: "default-off",
      charStart: 40,
      charEnd: 48,
    });

    const outcome = await keepAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId, NAMES),
    ]);

    expect(outcome).toMatchObject({ ok: true, value: { findingIds: [officer] } });
    expect(await restoreOf(scenario.workspaceId, bidWriter)).toMatchObject({ restored: false });
  });
});

describe("an Admin narrowing named documents", () => {
  it("takes each one to Restricted, touches no chunk row and writes one ledger row per document", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);
    const stoodAt = await chunkVersionsOf(db(), scenario.workspaceId, bindingId);

    const outcome = await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    expect(outcome).toMatchObject({
      ok: true,
      value: { bindingId, documentIds: [first.documentId], sensitivity: "Restricted" },
    });
    expect(await chunkVersionsOf(db(), scenario.workspaceId, bindingId)).toEqual(stoodAt);
    expect(await chunkClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Restricted"]);

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

    const unopened = await findingIn(scenario.workspaceId, first.documentId, {
      category: "special-category",
      ruleId: "health-condition",
    });
    const siblings = await findingIn(scenario.workspaceId, second.documentId);

    await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    expect(await reviewOf(scenario.workspaceId, answered)).toEqual({
      review_state: "narrowed",
      reviewed: true,
      reviewed_by: `human:${scenario.admin.userId}`,
      review_reason: null,
    });

    expect(await reviewOf(scenario.workspaceId, unopened)).toEqual(UNREVIEWED);
    expect(await reviewOf(scenario.workspaceId, siblings)).toEqual(UNREVIEWED);
  });

  it("reviews no span of a group it narrows that the last run no longer raises", async () => {
    const scenario = await arrange();
    const { bindingId, group, raised, dropped } = await aGroupHoldingADroppedSpan(scenario);

    await narrowAs(scenario.admin, bindingId, [group]);

    expect(await reviewOf(scenario.workspaceId, raised)).toMatchObject({
      review_state: "narrowed",
    });
    expect(await reviewOf(scenario.workspaceId, dropped)).toEqual(UNREVIEWED);
  });

  it("leaves a span an Admin already kept in text as kept, inside a group it narrows", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const kept = await findingIn(scenario.workspaceId, first.documentId);
    await keepAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

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

  it("keeps the class it narrowed a document to apart from the seam's verdict, so a lifted verdict goes back to it", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);

    await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    expect(await narrowedToOf(scenario.workspaceId, first.documentId)).toEqual({
      sensitivity: "Restricted",
      narrowed_to: "Restricted",
    });
    expect(await narrowedToOf(scenario.workspaceId, second.documentId)).toEqual({
      sensitivity: null,
      narrowed_to: null,
    });
  });

  it("puts no job on the workspace's queue, however many documents it took", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await bindingWithTwoDocuments(scenario);

    const outcome = await narrowAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId),
      findingGroupIn(second.documentId),
    ]);

    expect(outcome).toMatchObject({ ok: true });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("narrows not one document when the ledger refuses the event", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    const shown = await findingIn(scenario.workspaceId, first.documentId);

    await expect(
      whileWritesAreRefused(db().pool, "audit_event", () =>
        narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]),
      ),
    ).rejects.toThrow(/refused a write to audit_event/);

    expect(await reviewOf(scenario.workspaceId, shown)).toEqual(UNREVIEWED);
    expect(await narrowingLeftBehindIn(scenario.workspaceId, first.documentId)).toEqual(
      NOTHING_NARROWED,
    );
  });

  it("leaves the run a keep already queued for the binding standing, and queues none of its own", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await bindingWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    const keep = await keepAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);
    expect(typeof (keep.ok ? keep.value.jobId : undefined)).toBe("string");

    const outcome = await narrowAs(scenario.admin, bindingId, [findingGroupIn(first.documentId)]);

    expect(outcome).toMatchObject({ ok: true });
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
    expect(await narrowingLeftBehindIn(scenario.workspaceId, first.documentId)).toEqual(
      NOTHING_NARROWED,
    );
  });

  it("refuses a class wider than the binding's, over a document whose own class is wider still", async () => {
    const scenario = await arrange();
    const { bindingId, held } = await documentHeldAboveItsBinding(scenario.workspaceId);
    await chunkUnder(db(), scenario.workspaceId, held, {
      content: "12-34-56",
      ordinal: 0,
      charStart: 0,
      charEnd: 8,
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

const dismissingTwoGroupsOfThree = async (scenario: Scenario) => {
  const { bindingId, first, second } = await twoDocumentsTheSeamNarrowed(scenario);
  const dismissed = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
  const dismissedBesideIt = await findingIn(scenario.workspaceId, first.documentId, {
    ...HEALTH,
    charStart: 60,
    charEnd: 120,
  });
  const alsoDismissed = await findingIn(scenario.workspaceId, second.documentId, HEALTH);
  const left = await findingIn(scenario.workspaceId, first.documentId);
  const outcome = await dismissAs(scenario.admin, bindingId, [
    findingGroupIn(first.documentId, HEALTH),
    findingGroupIn(second.documentId, HEALTH),
  ]);
  return {
    bindingId,
    first,
    second,
    dismissed,
    dismissedBesideIt,
    alsoDismissed,
    left,
    outcome,
  };
};

describe("an Admin dismissing named special-category finding groups as not special category", () => {
  it("reviews every span of every group as dismissed, by this Admin, for the batch's reason — and no other", async () => {
    const scenario = await arrange();

    const { dismissed, dismissedBesideIt, alsoDismissed, left } =
      await dismissingTwoGroupsOfThree(scenario);

    const dismissal = {
      review_state: "dismissed",
      reviewed: true,
      reviewed_by: `human:${scenario.admin.userId}`,
      review_reason: NOT_HEALTH_DATA,
    };
    expect(await reviewOf(scenario.workspaceId, dismissed)).toEqual(dismissal);
    expect(await reviewOf(scenario.workspaceId, dismissedBesideIt)).toEqual(dismissal);
    expect(await reviewOf(scenario.workspaceId, alsoDismissed)).toEqual(dismissal);
    expect(await reviewOf(scenario.workspaceId, left)).toEqual(UNREVIEWED);
  });

  it("writes one ledger row per document under one batch id and queues one index run to read the dismissal", async () => {
    const scenario = await arrange();

    const { bindingId, first, second, outcome } = await dismissingTwoGroupsOfThree(scenario);

    const documentIds = [first.documentId, second.documentId].toSorted();
    const batchId = outcome.ok ? outcome.value.batchId : undefined;
    expect(outcome).toMatchObject({ ok: true, value: { bindingId, documentIds } });
    expect(typeof batchId).toBe("string");
    expect(await batchedRowsOf(db().pool, scenario.workspaceId, DISMISSED_ACT)).toEqual(
      documentIds.map((documentId) => ({
        subject_id: documentId,
        batch_id: batchId,
        detail: {
          documentId,
          bindingId,
          findingCount: documentId === first.documentId ? 2 : 1,
        },
      })),
    );
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "dismissed", subject_id: bindingId },
    ]);
  });

  it("lets no span back into the text and widens no document itself, because the run is what lifts a verdict", async () => {
    const scenario = await arrange();

    const { first, dismissed } = await dismissingTwoGroupsOfThree(scenario);

    expect(await restoreOf(scenario.workspaceId, dismissed)).toMatchObject({ restored: false });
    expect(await chunkClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Restricted"]);
  });

  it("writes one ledger row with no batch id when it dismisses one document's group", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    await findingIn(scenario.workspaceId, first.documentId, HEALTH);

    const outcome = await dismissAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId, HEALTH),
    ]);

    expect(outcome).toMatchObject({ ok: true, value: { batchId: undefined } });
    expect(await batchedRowsOf(db().pool, scenario.workspaceId, DISMISSED_ACT)).toEqual([
      {
        subject_id: first.documentId,
        batch_id: null,
        detail: { documentId: first.documentId, bindingId, findingCount: 1 },
      },
    ]);
  });

  it("dismisses the spans of a group the last run raised, and not one it no longer raises", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    const raised = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    const dropped = await findingIn(scenario.workspaceId, first.documentId, {
      ...HEALTH,
      ...NO_LONGER_RAISED,
    });

    await dismissAs(scenario.admin, bindingId, [findingGroupIn(first.documentId, HEALTH)]);

    expect(await reviewOf(scenario.workspaceId, raised)).toMatchObject({
      review_state: "dismissed",
    });
    expect(await reviewOf(scenario.workspaceId, dropped)).toEqual(UNREVIEWED);
  });

  it.each([
    ["the queue will not hold its run", "job"],
    ["the ledger refuses the event", "audit_event"],
  ] as const)(
    "dismisses not one span, and rejects rather than answering a word, when %s",
    async (_when, table) => {
      const scenario = await arrange();
      const { bindingId, first } = await twoDocumentsTheSeamNarrowed(scenario);
      const named = await findingIn(scenario.workspaceId, first.documentId, HEALTH);

      await expect(
        whileWritesAreRefused(db().pool, table, () =>
          dismissAs(scenario.admin, bindingId, [findingGroupIn(first.documentId, HEALTH)]),
        ),
      ).rejects.toThrow(new RegExp(`refused a write to ${table}`));

      expect(await reviewOf(scenario.workspaceId, named)).toEqual(UNREVIEWED);
      expect(await batchedRowsOf(db().pool, scenario.workspaceId, DISMISSED_ACT)).toEqual([]);
      expect(await jobsOf(scenario.workspaceId)).toEqual([]);
    },
  );

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor],
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
  ] as const)("refuses %s, and neither a row nor a run moves", async (_who, personOf) => {
    const scenario = await arrange();
    const { bindingId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    const named = await findingIn(scenario.workspaceId, first.documentId, HEALTH);

    const outcome = await dismissAs(personOf(scenario), bindingId, [
      findingGroupIn(first.documentId, HEALTH),
    ]);

    expect(outcome).toEqual({ ok: false, error: "role-forbids" });
    expect(await reviewOf(scenario.workspaceId, named)).toEqual(UNREVIEWED);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a group that is not special category, and the special-category group beside it lands nothing", async () => {
    const scenario = await arrange();
    const { bindingId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    const health = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    const sortCode = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await dismissAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId, HEALTH),
      findingGroupIn(first.documentId),
    ]);

    expect(outcome).toEqual({ ok: false, error: "not-special-category" });
    expect(await reviewOf(scenario.workspaceId, health)).toEqual(UNREVIEWED);
    expect(await reviewOf(scenario.workspaceId, sortCode)).toEqual(UNREVIEWED);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a group the binding holds no span of, and the group beside it lands nothing", async () => {
    const scenario = await arrange();
    const { bindingId, first, second } = await twoDocumentsTheSeamNarrowed(scenario);
    const health = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Internal" });
    const theirs = await findingIn(scenario.workspaceId, elsewhere.documentId, HEALTH);

    const noSpan = await dismissAs(scenario.admin, bindingId, [
      findingGroupIn(first.documentId, HEALTH),
      findingGroupIn(second.documentId, HEALTH),
    ]);
    const anotherBinding = await dismissAs(scenario.admin, bindingId, [
      findingGroupIn(elsewhere.documentId, HEALTH),
    ]);

    expect(noSpan).toEqual({ ok: false, error: "no-such-finding" });
    expect(anotherBinding).toEqual({ ok: false, error: "no-such-finding" });
    expect(await reviewOf(scenario.workspaceId, health)).toEqual(UNREVIEWED);
    expect(await reviewOf(scenario.workspaceId, theirs)).toEqual(UNREVIEWED);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });
});

const reprocessAsAdmin = (
  scenario: Scenario,
  bindingId: string,
  reason: z.input<typeof reprocessBindingInput>["reason"],
) =>
  acting(scenario.admin, (principal, tx) =>
    reprocessBinding(
      principal,
      tx,
      inputOf(reprocessBindingInput, { workspaceId: scenario.workspaceId, bindingId, reason }),
    ),
  );

describe("a bulk act handed no finding group at all", () => {
  const A_BINDING = "01J6NNNNNNNNNNNNNNNNNNNNN1";

  const EMPTY_LIST = {
    ok: false,
    error: { word: "malformed", fields: { findingGroups: "too-small" } },
  };

  it("names the empty list a keep was arranged with, because an empty keep would still queue a run", () => {
    expect(
      parse(keepInTextInput, {
        bindingId: A_BINDING,
        findingGroups: [],
        reason: BUSINESS_FACT,
      }),
    ).toEqual(EMPTY_LIST);
  });

  it("names the empty list a narrowing was arranged with, because it names no document to narrow", () => {
    expect(parse(narrowDocumentsInput, { bindingId: A_BINDING, findingGroups: [] })).toEqual(
      EMPTY_LIST,
    );
  });

  it("names the empty list a dismissal was arranged with, because an empty dismissal would still queue a run", () => {
    expect(
      parse(dismissAsNotSpecialCategoryInput, {
        bindingId: A_BINDING,
        findingGroups: [],
        reason: NOT_HEALTH_DATA,
      }),
    ).toEqual(EMPTY_LIST);
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

  it.each(REASONS_EMPTYING_THE_BINDING)(
    "hands the keep's run still queued the reason %s, so the run the worker claims empties the store the rows went from",
    async (reason) => {
      const scenario = await arrange();
      const { bindingId } = await keepingTwoGroupsOfThree(scenario);

      const outcome = await reprocessAsAdmin(scenario, bindingId, reason);

      expect(outcome).toMatchObject({ ok: true, value: { chunks: 2 } });
      expect(await jobsOf(scenario.workspaceId)).toEqual([
        { kind: "index", reason, subject_id: bindingId },
      ]);
    },
  );

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
