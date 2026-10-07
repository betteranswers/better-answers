import type pg from "pg";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { REASONS_EMPTYING_THE_CONNECTED_SOURCE } from "@better-answers/schema";

import { STORED_DETAIL_KEYS } from "../src/audit/index.ts";
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
  reprocessConnectedSource,
  reprocessConnectedSourceInput,
  type findingGroupKey,
} from "../src/sources/index.ts";
import {
  connectedSourceHolding,
  passageUnder,
  passageVersionsOf,
  conceptCiting,
  documentUnder,
  seededBy,
  visibilitySuite,
  visibilityHeld,
} from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { whileWritesAreRefused } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading: acting } = visibilitySuite();

const BUSINESS_FACT = "The sort code is the company's own, printed on every invoice it sends.";

type FindingGroupAsked = z.input<typeof findingGroupKey>;

const keepAs = (
  who: UserPrincipal,
  connectedSourceId: string,
  findingGroups: readonly FindingGroupAsked[],
) =>
  acting(who, (principal, tx) =>
    keepInText(
      principal,
      tx,
      inputOf(keepInTextInput, { connectedSourceId, findingGroups, reason: BUSINESS_FACT }),
    ),
  );

const narrowAs = (
  who: UserPrincipal,
  connectedSourceId: string,
  findingGroups: readonly FindingGroupAsked[],
  to: { readonly sensitivity?: string } = {},
) =>
  acting(who, (principal, tx) =>
    narrowDocuments(
      principal,
      tx,
      inputOf(narrowDocumentsInput, {
        connectedSourceId,
        findingGroups,
        sensitivity: to.sensitivity,
      }),
    ),
  );

const NOT_HEALTH_DATA = "Our engineers diagnose faults in pumps, never in people.";

const HEALTH = { category: "special-category", ruleId: "HEALTH_CUE" };

const dismissAs = (
  who: UserPrincipal,
  connectedSourceId: string,
  findingGroups: readonly FindingGroupAsked[],
) =>
  acting(who, (principal, tx) =>
    dismissAsNotSpecialCategory(
      principal,
      tx,
      inputOf(dismissAsNotSpecialCategoryInput, {
        connectedSourceId,
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

const finishedSync = (
  workspaceId: string,
  connectedSourceId: string,
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
      subjectId: connectedSourceId,
      reason: "connected",
      status: "done",
      attempts: 1,
      finishedAt: new Date(finishedAt),
      outcome: {
        documents: 2,
        passages: 2,
        lmdb_bytes: 8192,
        restores_overridden_by_erasure: [...overridden],
      },
    }),
  );

const NO_LONGER_RAISED = { ruleVersion: "0" };

const aGroupHoldingADroppedSpan = async (scenario: Scenario) => {
  const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
  const raised = await findingIn(scenario.workspaceId, first.documentId);
  const dropped = await findingIn(scenario.workspaceId, first.documentId, NO_LONGER_RAISED);
  return { connectedSourceId, group: findingGroupIn(first.documentId), raised, dropped };
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

const passageClassesOf = async (workspaceId: string, documentId: string) => {
  const found = await db().pool.query<{ sensitivity: string }>(
    `SELECT sensitivity FROM "index".readable_passage
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
  classes: await passageClassesOf(workspaceId, documentId),
  auditEvents: await batchedRowsOf(db().pool, workspaceId, "sources.document.narrowed"),
  jobs: await jobsOf(workspaceId),
});

const NOTHING_NARROWED = { classes: ["Internal"], auditEvents: [], jobs: [] };

const findingsAs = (who: UserPrincipal, connectedSourceId: string) =>
  acting(who, (principal, tx) =>
    findingsOf(principal, tx, inputOf(findingsOfInput, { connectedSourceId })),
  );

const documentHeldAboveItsConnectedSource = async (workspaceId: string) => {
  const connectedSource = await connectedSourceHolding(db(), workspaceId, {
    sensitivity: "Restricted",
  });
  const held = await documentUnder(
    db(),
    workspaceId,
    connectedSource.connectedSourceId,
    "Internal",
  );
  return { connectedSourceId: connectedSource.connectedSourceId, held };
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

const connectedSourceWithTwoDocuments = async (scenario: Scenario) => {
  const first = await connectedSourceHolding(db(), scenario.workspaceId, {
    sensitivity: "Internal",
  });
  const second = await documentUnder(db(), scenario.workspaceId, first.connectedSourceId, null);
  for (const document of [first, second]) {
    await passageUnder(db(), scenario.workspaceId, document, {
      content: "12-34-56",
      ordinal: 0,
      charStart: 0,
      charEnd: 8,
    });
  }
  return { connectedSourceId: first.connectedSourceId, first, second };
};

const twoDocumentsTheSeamNarrowed = async (scenario: Scenario) => {
  const connectedSource = await connectedSourceHolding(db(), scenario.workspaceId, {
    sensitivity: "Internal",
  });
  const first = await documentUnder(
    db(),
    scenario.workspaceId,
    connectedSource.connectedSourceId,
    "Restricted",
  );
  const second = await documentUnder(
    db(),
    scenario.workspaceId,
    connectedSource.connectedSourceId,
    "Restricted",
  );
  for (const document of [first, second]) {
    await passageUnder(db(), scenario.workspaceId, document, {
      content: "He was diagnosed with a heart condition.",
      ordinal: 0,
      charStart: 0,
      charEnd: 40,
    });
  }
  return { connectedSourceId: connectedSource.connectedSourceId, first, second };
};

describe("the review read of a connected source's findings", () => {
  it("groups findings by document, category and rule, with a count", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, {
      category: "government-id",
      ruleId: "national-insurance-number",
    });
    await findingIn(scenario.workspaceId, second.documentId);

    const read = await findingsAs(scenario.admin, connectedSourceId);

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

  it("carries no value and no offset", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);

    const read = await findingsAs(scenario.admin, connectedSourceId);

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

  it("reads a document the seam narrowed as already Restricted", async () => {
    const scenario = await arrange();
    const connectedSource = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Internal",
    });

    const narrowed = await documentUnder(
      db(),
      scenario.workspaceId,
      connectedSource.connectedSourceId,
      "Restricted",
    );
    await findingIn(scenario.workspaceId, narrowed.documentId, {
      category: "special-category",
      ruleId: "health-condition",
    });
    await findingIn(scenario.workspaceId, connectedSource.documentId);

    const read = await findingsAs(scenario.admin, connectedSource.connectedSourceId);

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

  it("counts the spans an Admin dismissed in a special-category group", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await twoDocumentsTheSeamNarrowed(scenario);
    await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    await findingIn(scenario.workspaceId, first.documentId, {
      ...HEALTH,
      charStart: 60,
      charEnd: 120,
    });
    await findingIn(scenario.workspaceId, second.documentId, HEALTH);
    await dismissAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId, HEALTH)]);

    const read = await findingsAs(scenario.admin, connectedSourceId);

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

  it("reads a document above its source at the source's class", async () => {
    const scenario = await arrange();
    const { connectedSourceId, held } = await documentHeldAboveItsConnectedSource(
      scenario.workspaceId,
    );
    await findingIn(scenario.workspaceId, held.documentId);

    const read = await findingsAs(scenario.admin, connectedSourceId);

    expect(read.ok ? read.value.map((group) => group.sensitivity) : []).toEqual(["Restricted"]);
  });

  it("omits spans and groups the last sync no longer raises", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, NO_LONGER_RAISED);
    await findingIn(scenario.workspaceId, first.documentId, {
      ...NATIONAL_INSURANCE,
      ...NO_LONGER_RAISED,
    });

    const read = await findingsAs(scenario.admin, connectedSourceId);

    expect(
      read.ok ? read.value.map((group) => ({ ruleId: group.ruleId, found: group.found })) : [],
    ).toEqual([{ ruleId: "sort-code-with-account-number", found: 1 }]);
  });

  it("counts kept spans the last finished sync withheld for erasure", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId, { charStart: 54, charEnd: 97 });
    await findingIn(scenario.workspaceId, first.documentId, { charStart: 120, charEnd: 128 });
    await findingIn(scenario.workspaceId, second.documentId, { charStart: 54, charEnd: 97 });
    await finishedSync(scenario.workspaceId, connectedSourceId, "2026-09-20T10:00:00.000Z", [
      { ...SORT_CODE_RULE, document_id: second.documentId, char_start: 54, char_end: 97 },
    ]);
    await finishedSync(scenario.workspaceId, connectedSourceId, "2026-09-20T11:00:00.000Z", [
      { ...SORT_CODE_RULE, document_id: first.documentId, char_start: 54, char_end: 97 },
    ]);
    const elsewhere = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Internal",
    });
    await finishedSync(
      scenario.workspaceId,
      elsewhere.connectedSourceId,
      "2026-09-20T13:00:00.000Z",
      [],
    );

    await seededBy(db(), (seed) =>
      seed.job({
        workspaceId: scenario.workspaceId,
        kind: "index",
        subjectId: connectedSourceId,
        reason: "rule-change",
        status: "failed",
        attempts: 1,
        finishedAt: new Date("2026-09-20T12:00:00.000Z"),
        outcome: { error: "TimeoutError" },
      }),
    );
    await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
      findingGroupIn(second.documentId),
    ]);

    const read = await findingsAs(scenario.admin, connectedSourceId);

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

  it("fails, rather than read nought, on an unreadable kept-span list", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await seededBy(db(), (seed) =>
      seed.job({
        workspaceId: scenario.workspaceId,
        kind: "index",
        subjectId: connectedSourceId,
        reason: "connected",
        status: "done",
        attempts: 1,
        finishedAt: new Date("2026-09-20T11:00:00.000Z"),
        outcome: {
          documents: 1,
          restores_overridden_by_erasure: [{ document_id: first.documentId }],
        },
      }),
    );

    const read = await findingsAs(scenario.admin, connectedSourceId);

    expect(read.ok).toBe(false);
    expect(read.ok ? undefined : read.error).toEqual(
      new Error(
        "the connected source's last sync names the kept spans an erasure overrode in a shape the review cannot read",
      ),
    );
  });

  it("reads a connected source's findings while another holds its row", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await connectedSourceWithTwoDocuments(scenario);
    const holder = await db().pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "SELECT 1 FROM connected_source WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [scenario.workspaceId, connectedSourceId],
      );

      const read = await acting(scenario.admin, async (principal, tx) => {
        await tx.query("SET LOCAL lock_timeout = '2s'");
        return findingsOf(principal, tx, inputOf(findingsOfInput, { connectedSourceId }));
      });

      expect(read).toEqual({ ok: true, value: [] });
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });

  it("answers the store's failure to read the connected source", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await connectedSourceWithTwoDocuments(scenario);

    const read = await acting(scenario.admin, async (principal, tx) => {
      await tx.query("SELECT 1 / 0").catch(() => undefined);
      return findingsOf(principal, tx, inputOf(findingsOfInput, { connectedSourceId }));
    });

    expect(read.ok ? undefined : read.error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("current transaction is aborted"),
      }),
    );
  });

  it("counts a named span only while an Admin's keep stands", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId, { charStart: 54, charEnd: 97 });
    await finishedSync(scenario.workspaceId, connectedSourceId, "2026-09-20T11:00:00.000Z", [
      { ...SORT_CODE_RULE, document_id: first.documentId, char_start: 54, char_end: 97 },
    ]);

    const read = await findingsAs(scenario.admin, connectedSourceId);

    expect(read.ok ? read.value.map((group) => group.overriddenByErasure) : []).toEqual([0]);
  });

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor],
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
  ] as const)("refuses %s, who never learns what the seam found", async (_who, personOf) => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);

    const read = await findingsAs(personOf(scenario), connectedSourceId);

    expect(read).toEqual({ ok: false, error: "role-forbids" });
  });
});

const keepingTwoGroupsOfThree = async (scenario: Scenario) => {
  const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
  const kept = await findingIn(scenario.workspaceId, first.documentId);
  const keptBesideIt = await findingIn(scenario.workspaceId, first.documentId, {
    charStart: 40,
    charEnd: 48,
  });
  const alsoKept = await findingIn(scenario.workspaceId, second.documentId);
  const left = await findingIn(scenario.workspaceId, first.documentId, NATIONAL_INSURANCE);
  const outcome = await keepAs(scenario.admin, connectedSourceId, [
    findingGroupIn(first.documentId),
    findingGroupIn(second.documentId),
  ]);

  const spans = [kept, keptBesideIt, alsoKept].toSorted();
  return { connectedSourceId, first, second, kept, keptBesideIt, alsoKept, left, spans, outcome };
};

describe("an Admin keeping named finding groups in the text", () => {
  it("restores every span in one batch, queueing one sync", async () => {
    const scenario = await arrange();

    const { connectedSourceId, first, second, kept, keptBesideIt, alsoKept, left, spans, outcome } =
      await keepingTwoGroupsOfThree(scenario);

    expect(outcome).toEqual({
      ok: true,
      value: {
        connectedSourceId,
        documentIds: [first.documentId, second.documentId].toSorted(),
        batchId: expect.any(String),
        jobId: expect.any(String),
      },
    });
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

    const auditEvents = await batchedRowsOf(
      db().pool,
      scenario.workspaceId,
      "sources.finding.restored",
    );
    const batchId = outcome.ok ? outcome.value.batchId : undefined;
    expect(typeof batchId).toBe("string");

    expect(auditEvents).toEqual(
      spans.map((span) => ({ subject_id: span, batch_id: batchId, detail: { findingId: span } })),
    );
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "restored", subject_id: connectedSourceId },
    ]);
  });

  it("rejects, keeping no span, when the queue refuses its sync", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const kept = await findingIn(scenario.workspaceId, first.documentId);

    await expect(
      whileWritesAreRefused(db().pool, "job", () =>
        keepAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId)]),
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

  it("reviews only the kept spans, as kept in text", async () => {
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

  it("keeps one group of two spans under a batch id", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, { charStart: 40, charEnd: 48 });

    const outcome = await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
    ]);

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
    ["named twice, still one group", 2],
  ] as const)("keeps a one-span group, %s, unbatched", async (_how, times) => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const kept = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await keepAs(
      scenario.admin,
      connectedSourceId,
      Array.from({ length: times }, () => findingGroupIn(first.documentId)),
    );

    expect(outcome).toMatchObject({
      ok: true,
      value: { documentIds: [first.documentId], batchId: undefined },
    });
    expect(
      await batchedRowsOf(db().pool, scenario.workspaceId, "sources.finding.restored"),
    ).toEqual([{ subject_id: kept, batch_id: null, detail: { findingId: kept } }]);
  });

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor, "role-forbids"],
    ["a Viewer", (scenario: Scenario) => scenario.viewer, "role-forbids"],
  ] as const)("refuses %s, moving neither a row nor a sync", async (_who, personOf, refusal) => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const named = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await keepAs(personOf(scenario), connectedSourceId, [
      findingGroupIn(first.documentId),
    ]);

    expect(outcome).toEqual({ ok: false, error: refusal });
    expect(await restoreOf(scenario.workspaceId, named)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a group outside the always set, landing neither group", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const alwaysSet = await findingIn(scenario.workspaceId, first.documentId);
    const switchedAtTheConnectedSource = {
      tier: "default-on",
      category: "home-address",
      ruleId: "postal-address",
    };
    await findingIn(scenario.workspaceId, first.documentId, switchedAtTheConnectedSource);

    const outcome = await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
      findingGroupIn(first.documentId, switchedAtTheConnectedSource),
    ]);

    expect(outcome).toEqual({ ok: false, error: "not-the-always-set" });

    expect(await restoreOf(scenario.workspaceId, alwaysSet)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a group of another connected source", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await connectedSourceWithTwoDocuments(scenario);
    const elsewhere = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Internal",
    });
    const theirs = await findingIn(scenario.workspaceId, elsewhere.documentId);

    const outcome = await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(elsewhere.documentId),
    ]);

    expect(outcome).toEqual({ ok: false, error: "no-such-finding" });
    expect(await restoreOf(scenario.workspaceId, theirs)).toMatchObject({ restored: false });
  });

  it("refuses a group holding no finding, landing neither group", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const held = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
      findingGroupIn(first.documentId, NATIONAL_INSURANCE),
    ]);

    expect(outcome).toEqual({ ok: false, error: "no-such-finding" });
    expect(await restoreOf(scenario.workspaceId, held)).toMatchObject({ restored: false });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("keeps only the spans the last sync raised", async () => {
    const scenario = await arrange();
    const { connectedSourceId, group, raised, dropped } = await aGroupHoldingADroppedSpan(scenario);

    const outcome = await keepAs(scenario.admin, connectedSourceId, [group]);

    expect(outcome).toMatchObject({ ok: true });
    expect(await restoreOf(scenario.workspaceId, raised)).toMatchObject({ restored: true });
    expect(await restoreOf(scenario.workspaceId, dropped)).toMatchObject({ restored: false });
  });

  it("keeps a name refused at default-off once re-read at always", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const readAtFirst = { ...NAMES, tier: "default-off" };
    const officer = await findingIn(scenario.workspaceId, first.documentId, readAtFirst);

    const before = await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId, readAtFirst),
    ]);
    await readAgainAt(scenario.workspaceId, officer, "always");
    const after = await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId, NAMES),
    ]);

    expect(before).toEqual({ ok: false, error: "not-the-always-set" });
    expect(after).toMatchObject({ ok: true });
    expect(await restoreOf(scenario.workspaceId, officer)).toMatchObject({ restored: true });
  });

  it("keeps an always-tier officer's name, not the rule's default-off names", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const officer = await findingIn(scenario.workspaceId, first.documentId, NAMES);
    const bidWriter = await findingIn(scenario.workspaceId, first.documentId, {
      ...NAMES,
      tier: "default-off",
      charStart: 40,
      charEnd: 48,
    });

    const outcome = await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId, NAMES),
    ]);

    expect(outcome).toMatchObject({ ok: true });
    expect(await restoreOf(scenario.workspaceId, officer)).toMatchObject({ restored: true });
    expect(await restoreOf(scenario.workspaceId, bidWriter)).toMatchObject({ restored: false });
  });
});

describe("an Admin narrowing named documents", () => {
  it("takes each to Restricted with one audit event, passages untouched", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
    const stoodAt = await passageVersionsOf(db(), scenario.workspaceId, connectedSourceId);

    const outcome = await narrowAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
    ]);

    expect(outcome).toMatchObject({
      ok: true,
      value: { connectedSourceId, documentIds: [first.documentId], sensitivity: "Restricted" },
    });
    expect(await passageVersionsOf(db(), scenario.workspaceId, connectedSourceId)).toEqual(stoodAt);
    expect(await passageClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Restricted"]);

    expect(await passageClassesOf(scenario.workspaceId, second.documentId)).toEqual(["Internal"]);
    expect(
      await batchedRowsOf(db().pool, scenario.workspaceId, "sources.document.narrowed"),
    ).toEqual([
      {
        subject_id: first.documentId,
        batch_id: null,
        detail: {
          documentId: first.documentId,
          [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
          sensitivity: "Restricted",
        },
      },
    ]);
  });

  it("reviews only the named groups' findings as narrowed", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
    const answered = await findingIn(scenario.workspaceId, first.documentId);

    const unopened = await findingIn(scenario.workspaceId, first.documentId, {
      category: "special-category",
      ruleId: "health-condition",
    });
    const siblings = await findingIn(scenario.workspaceId, second.documentId);

    await narrowAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId)]);

    expect(await reviewOf(scenario.workspaceId, answered)).toEqual({
      review_state: "narrowed",
      reviewed: true,
      reviewed_by: `human:${scenario.admin.userId}`,
      review_reason: null,
    });

    expect(await reviewOf(scenario.workspaceId, unopened)).toEqual(UNREVIEWED);
    expect(await reviewOf(scenario.workspaceId, siblings)).toEqual(UNREVIEWED);
  });

  it("reviews no span the last sync no longer raises", async () => {
    const scenario = await arrange();
    const { connectedSourceId, group, raised, dropped } = await aGroupHoldingADroppedSpan(scenario);

    await narrowAs(scenario.admin, connectedSourceId, [group]);

    expect(await reviewOf(scenario.workspaceId, raised)).toMatchObject({
      review_state: "narrowed",
    });
    expect(await reviewOf(scenario.workspaceId, dropped)).toEqual(UNREVIEWED);
  });

  it("leaves an already-kept span kept inside a narrowed group", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const kept = await findingIn(scenario.workspaceId, first.documentId);
    await keepAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId)]);

    const raisedSince = await findingIn(scenario.workspaceId, first.documentId, {
      charStart: 40,
      charEnd: 48,
    });

    await narrowAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId)]);

    expect(await reviewOf(scenario.workspaceId, kept)).toMatchObject({
      review_state: "kept-in-text",
      review_reason: BUSINESS_FACT,
    });
    expect(await reviewOf(scenario.workspaceId, raisedSince)).toMatchObject({
      review_state: "narrowed",
    });
  });

  it("records the narrowed class beside the document's read class", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);

    await narrowAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId)]);

    expect(await narrowedToOf(scenario.workspaceId, first.documentId)).toEqual({
      sensitivity: "Restricted",
      narrowed_to: "Restricted",
    });
    expect(await narrowedToOf(scenario.workspaceId, second.documentId)).toEqual({
      sensitivity: null,
      narrowed_to: null,
    });
  });

  it("queues no job, however many documents it narrows", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);

    const outcome = await narrowAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
      findingGroupIn(second.documentId),
    ]);

    expect(outcome).toMatchObject({ ok: true });
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("narrows no document when the audit log refuses the event", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const shown = await findingIn(scenario.workspaceId, first.documentId);

    await expect(
      whileWritesAreRefused(db().pool, "audit_event", () =>
        narrowAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId)]),
      ),
    ).rejects.toThrow(/refused a write to audit_event/);

    expect(await reviewOf(scenario.workspaceId, shown)).toEqual(UNREVIEWED);
    expect(await narrowingLeftBehindIn(scenario.workspaceId, first.documentId)).toEqual(
      NOTHING_NARROWED,
    );
  });

  it("leaves a keep's queued sync standing and queues none itself", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    const keep = await keepAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
    ]);
    expect(typeof (keep.ok ? keep.value.jobId : undefined)).toBe("string");

    const outcome = await narrowAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
    ]);

    expect(outcome).toMatchObject({ ok: true });
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "restored", subject_id: connectedSourceId },
    ]);
  });

  it("writes one row per document under one batch id", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
    const named = [first.documentId, second.documentId].toSorted();

    const outcome = await narrowAs(
      scenario.admin,
      connectedSourceId,
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

  it("cascades only from concepts citing the narrowed documents", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
    const citing = await conceptCiting(scenario, scenario.editor, [first.documentId]);
    const untouched = await conceptCiting(scenario, scenario.editor, [second.documentId]);

    const page = await pageIncluding(scenario.workspaceId, citing.iri);

    const outcome = await narrowAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
    ]);

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

  it("hides a narrowed document from a Viewer, not its sibling", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
    const spanOf = (documentId: string) => `${documentId}/chars:0-8`;

    await narrowAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId)]);

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
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);

    const outcome = await narrowAs(
      scenario.admin,
      connectedSourceId,
      [findingGroupIn(first.documentId)],
      {
        sensitivity: "Public",
      },
    );

    expect(outcome).toEqual({ ok: false, error: "widening-refused" });
    expect(await narrowingLeftBehindIn(scenario.workspaceId, first.documentId)).toEqual(
      NOTHING_NARROWED,
    );
  });

  it("refuses widening past the source's class over a wider document", async () => {
    const scenario = await arrange();
    const { connectedSourceId, held } = await documentHeldAboveItsConnectedSource(
      scenario.workspaceId,
    );
    await passageUnder(db(), scenario.workspaceId, held, {
      content: "12-34-56",
      ordinal: 0,
      charStart: 0,
      charEnd: 8,
    });

    const outcome = await narrowAs(
      scenario.admin,
      connectedSourceId,
      [findingGroupIn(held.documentId)],
      {
        sensitivity: "Internal",
      },
    );

    expect(outcome).toEqual({ ok: false, error: "widening-refused" });
    expect(await passageClassesOf(scenario.workspaceId, held.documentId)).toEqual(["Restricted"]);
  });

  it("refuses another connected source's document, failing the whole batch", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const elsewhere = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Internal",
    });

    const outcome = await narrowAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId),
      findingGroupIn(elsewhere.documentId),
    ]);

    expect(outcome).toEqual({ ok: false, error: "no-such-document" });
    expect(await passageClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Internal"]);
  });

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor],
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
  ] as const)("refuses %s, and no document moves", async (_who, personOf) => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);

    const outcome = await narrowAs(personOf(scenario), connectedSourceId, [
      findingGroupIn(first.documentId),
    ]);

    expect(outcome).toEqual({ ok: false, error: "role-forbids" });
    expect(await passageClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Internal"]);
  });
});

const dismissingTwoGroupsOfThree = async (scenario: Scenario) => {
  const { connectedSourceId, first, second } = await twoDocumentsTheSeamNarrowed(scenario);
  const dismissed = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
  const dismissedBesideIt = await findingIn(scenario.workspaceId, first.documentId, {
    ...HEALTH,
    charStart: 60,
    charEnd: 120,
  });
  const alsoDismissed = await findingIn(scenario.workspaceId, second.documentId, HEALTH);
  const left = await findingIn(scenario.workspaceId, first.documentId);
  const outcome = await dismissAs(scenario.admin, connectedSourceId, [
    findingGroupIn(first.documentId, HEALTH),
    findingGroupIn(second.documentId, HEALTH),
  ]);
  return {
    connectedSourceId,
    first,
    second,
    dismissed,
    dismissedBesideIt,
    alsoDismissed,
    left,
    outcome,
  };
};

describe("an Admin dismissing finding groups as not special category", () => {
  it("reviews only the named groups' spans as dismissed", async () => {
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

  it("writes a batched audit event per document, queueing one sync", async () => {
    const scenario = await arrange();

    const { connectedSourceId, first, second, outcome } =
      await dismissingTwoGroupsOfThree(scenario);

    const documentIds = [first.documentId, second.documentId].toSorted();
    const batchId = outcome.ok ? outcome.value.batchId : undefined;
    expect(outcome).toMatchObject({ ok: true, value: { connectedSourceId, documentIds } });
    expect(typeof batchId).toBe("string");
    expect(await batchedRowsOf(db().pool, scenario.workspaceId, DISMISSED_ACT)).toEqual(
      documentIds.map((documentId) => ({
        subject_id: documentId,
        batch_id: batchId,
        detail: {
          documentId,
          [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
          findingCount: documentId === first.documentId ? 2 : 1,
        },
      })),
    );
    expect(await jobsOf(scenario.workspaceId)).toEqual([
      { kind: "index", reason: "dismissed", subject_id: connectedSourceId },
    ]);
  });

  it("restores no span and widens no document itself", async () => {
    const scenario = await arrange();

    const { first, dismissed } = await dismissingTwoGroupsOfThree(scenario);

    expect(await restoreOf(scenario.workspaceId, dismissed)).toMatchObject({ restored: false });
    expect(await passageClassesOf(scenario.workspaceId, first.documentId)).toEqual(["Restricted"]);
  });

  it("writes one unbatched row for one document's group", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    await findingIn(scenario.workspaceId, first.documentId, HEALTH);

    const outcome = await dismissAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId, HEALTH),
    ]);

    expect(outcome).toMatchObject({ ok: true, value: { batchId: undefined } });
    expect(await batchedRowsOf(db().pool, scenario.workspaceId, DISMISSED_ACT)).toEqual([
      {
        subject_id: first.documentId,
        batch_id: null,
        detail: {
          documentId: first.documentId,
          [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
          findingCount: 1,
        },
      },
    ]);
  });

  it("dismisses only the spans the last sync raised", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    const raised = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    const dropped = await findingIn(scenario.workspaceId, first.documentId, {
      ...HEALTH,
      ...NO_LONGER_RAISED,
    });

    await dismissAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId, HEALTH)]);

    expect(await reviewOf(scenario.workspaceId, raised)).toMatchObject({
      review_state: "dismissed",
    });
    expect(await reviewOf(scenario.workspaceId, dropped)).toEqual(UNREVIEWED);
  });

  it.each([
    ["dismissed, then kept-in-text", ["dismiss", "keep"]],
    ["kept-in-text, then dismissed", ["keep", "dismiss"]],
  ] as const)("leaves a span %s, both dismissed and restored", async (_order, acts) => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    const named = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    const group = [findingGroupIn(first.documentId, HEALTH)];

    for (const taken of acts) {
      await (taken === "dismiss" ? dismissAs : keepAs)(scenario.admin, connectedSourceId, group);
    }

    expect(await reviewOf(scenario.workspaceId, named)).toMatchObject({
      review_state: "dismissed",
      review_reason: NOT_HEALTH_DATA,
    });
    expect(await restoreOf(scenario.workspaceId, named)).toMatchObject({
      restored: true,
      restore_reason: BUSINESS_FACT,
    });
  });

  it.each([
    ["the queue refuses its sync", "job"],
    ["the audit log refuses", "audit_event"],
  ] as const)("rejects, dismissing no span, when %s", async (_when, table) => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    const named = await findingIn(scenario.workspaceId, first.documentId, HEALTH);

    await expect(
      whileWritesAreRefused(db().pool, table, () =>
        dismissAs(scenario.admin, connectedSourceId, [findingGroupIn(first.documentId, HEALTH)]),
      ),
    ).rejects.toThrow(new RegExp(`refused a write to ${table}`));

    expect(await reviewOf(scenario.workspaceId, named)).toEqual(UNREVIEWED);
    expect(await batchedRowsOf(db().pool, scenario.workspaceId, DISMISSED_ACT)).toEqual([]);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it.each([
    ["an Editor", (scenario: Scenario) => scenario.editor],
    ["a Viewer", (scenario: Scenario) => scenario.viewer],
  ] as const)("refuses %s, moving neither a row nor a sync", async (_who, personOf) => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    const named = await findingIn(scenario.workspaceId, first.documentId, HEALTH);

    const outcome = await dismissAs(personOf(scenario), connectedSourceId, [
      findingGroupIn(first.documentId, HEALTH),
    ]);

    expect(outcome).toEqual({ ok: false, error: "role-forbids" });
    expect(await reviewOf(scenario.workspaceId, named)).toEqual(UNREVIEWED);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a non-special-category group, landing neither group", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await twoDocumentsTheSeamNarrowed(scenario);
    const health = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    const sortCode = await findingIn(scenario.workspaceId, first.documentId);

    const outcome = await dismissAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId, HEALTH),
      findingGroupIn(first.documentId),
    ]);

    expect(outcome).toEqual({ ok: false, error: "not-special-category" });
    expect(await reviewOf(scenario.workspaceId, health)).toEqual(UNREVIEWED);
    expect(await reviewOf(scenario.workspaceId, sortCode)).toEqual(UNREVIEWED);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a group the connected source lacks, landing neither group", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await twoDocumentsTheSeamNarrowed(scenario);
    const health = await findingIn(scenario.workspaceId, first.documentId, HEALTH);
    const elsewhere = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Internal",
    });
    const theirs = await findingIn(scenario.workspaceId, elsewhere.documentId, HEALTH);

    const noSpan = await dismissAs(scenario.admin, connectedSourceId, [
      findingGroupIn(first.documentId, HEALTH),
      findingGroupIn(second.documentId, HEALTH),
    ]);
    const anotherConnectedSource = await dismissAs(scenario.admin, connectedSourceId, [
      findingGroupIn(elsewhere.documentId, HEALTH),
    ]);

    expect(noSpan).toEqual({ ok: false, error: "no-such-finding" });
    expect(anotherConnectedSource).toEqual({ ok: false, error: "no-such-finding" });
    expect(await reviewOf(scenario.workspaceId, health)).toEqual(UNREVIEWED);
    expect(await reviewOf(scenario.workspaceId, theirs)).toEqual(UNREVIEWED);
    expect(await jobsOf(scenario.workspaceId)).toEqual([]);
  });
});

const reprocessAsAdmin = (
  scenario: Scenario,
  connectedSourceId: string,
  reason: z.input<typeof reprocessConnectedSourceInput>["reason"],
) =>
  acting(scenario.admin, (principal, tx) =>
    reprocessConnectedSource(
      principal,
      tx,
      inputOf(reprocessConnectedSourceInput, {
        workspaceId: scenario.workspaceId,
        connectedSourceId,
        reason,
      }),
    ),
  );

describe("a bulk act handed no finding group at all", () => {
  const A_CONNECTED_SOURCE = "01J6NNNNNNNNNNNNNNNNNNNNN1";

  const EMPTY_LIST = {
    ok: false,
    error: { word: "malformed", fields: { findingGroups: "too-small" } },
  };

  it("names an empty list for a keep", () => {
    expect(
      parse(keepInTextInput, {
        connectedSourceId: A_CONNECTED_SOURCE,
        findingGroups: [],
        reason: BUSINESS_FACT,
      }),
    ).toEqual(EMPTY_LIST);
  });

  it("names an empty list for a narrowing", () => {
    expect(
      parse(narrowDocumentsInput, { connectedSourceId: A_CONNECTED_SOURCE, findingGroups: [] }),
    ).toEqual(EMPTY_LIST);
  });

  it("names an empty list for a dismissal", () => {
    expect(
      parse(dismissAsNotSpecialCategoryInput, {
        connectedSourceId: A_CONNECTED_SOURCE,
        findingGroups: [],
        reason: NOT_HEALTH_DATA,
      }),
    ).toEqual(EMPTY_LIST);
  });
});

describe("the reprocess that follows a review", () => {
  it("takes unmarked findings away with the passages", async () => {
    const scenario = await arrange();
    const { connectedSourceId, first, second } = await connectedSourceWithTwoDocuments(scenario);
    await findingIn(scenario.workspaceId, first.documentId);
    await findingIn(scenario.workspaceId, first.documentId, { category: "government-id" });
    await findingIn(scenario.workspaceId, second.documentId);

    const outcome = await reprocessAsAdmin(scenario, connectedSourceId, "rule-change");

    expect(outcome).toMatchObject({ ok: true, value: { passages: 2, findings: 3 } });
    expect(await findingCountOf(scenario.workspaceId, first.documentId)).toBe(0);
    expect(await findingCountOf(scenario.workspaceId, second.documentId)).toBe(0);
  });

  it("leaves a kept span whole and takes the unmarked one", async () => {
    const scenario = await arrange();

    const { connectedSourceId, kept, left } = await keepingTwoGroupsOfThree(scenario);
    const outcome = await reprocessAsAdmin(scenario, connectedSourceId, "rule-change");

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

  it.each(REASONS_EMPTYING_THE_CONNECTED_SOURCE)(
    "hands the keep's still-queued sync the reason %s",
    async (reason) => {
      const scenario = await arrange();
      const { connectedSourceId } = await keepingTwoGroupsOfThree(scenario);

      const outcome = await reprocessAsAdmin(scenario, connectedSourceId, reason);

      expect(outcome).toMatchObject({ ok: true, value: { passages: 2 } });
      expect(await jobsOf(scenario.workspaceId)).toEqual([
        { kind: "index", reason, subject_id: connectedSourceId },
      ]);
    },
  );

  it.each([
    [
      "an Admin restored singly, never reviewed",
      { restoredAt: new Date("2026-09-12T10:00:00.000Z"), restoreReason: BUSINESS_FACT },
      "restoredBy",
    ],
    [
      "an Admin reviewed as narrowed, never restored",
      { reviewState: "narrowed", reviewedAt: new Date("2026-09-12T10:00:00.000Z") },
      "reviewedBy",
    ],
  ] as const)("spares a finding %s", async (_how, marks, actorColumn) => {
    const scenario = await arrange();
    const { connectedSourceId, first } = await connectedSourceWithTwoDocuments(scenario);
    const marked = await seededBy(db(), async (seed) => {
      const row = await seed.finding({
        workspaceId: scenario.workspaceId,
        documentId: first.documentId,
        ...marks,
        [actorColumn]: `human:${scenario.admin.userId}`,
      });
      return row.id;
    });

    const outcome = await reprocessAsAdmin(scenario, connectedSourceId, "wiped");

    expect(outcome).toMatchObject({ ok: true, value: { findings: 0 } });
    expect(await marksOf(scenario.workspaceId, marked)).toBeDefined();
  });

  it("leaves another connected source's findings where they are", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await connectedSourceWithTwoDocuments(scenario);
    const elsewhere = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Internal",
    });
    await findingIn(scenario.workspaceId, elsewhere.documentId);

    await reprocessAsAdmin(scenario, connectedSourceId, "rule-change");

    expect(await findingCountOf(scenario.workspaceId, elsewhere.documentId)).toBe(1);
  });
});
