import { describe, expect, it } from "vitest";

import type { UserPrincipal } from "../src/kernel/index.ts";
import { runsOfSubject, runsOfSubjectInput } from "../src/runs/index.ts";
import { listBindings } from "../src/sources/index.ts";
import { chunkUnder, seededBy } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { answered, readingAs } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const QUEUED_AT = new Date("2026-09-11T08:00:00.000Z");
const FAILED_AT = new Date("2026-09-11T08:30:00.000Z");
const REQUEUED_AT = new Date("2026-09-11T09:00:00.000Z");
const FINISHED_AT = new Date("2026-09-11T09:30:00.000Z");
const PUBLISHED_AT = new Date("2026-09-11T10:00:00.000Z");

const listedFor = (who: UserPrincipal) =>
  readingAs(db().runtimePool, who, (principal, tx) => listBindings(principal, tx));

const runsFor = (who: UserPrincipal, subjectId: string) =>
  readingAs(db().runtimePool, who, (principal, tx) =>
    runsOfSubject(principal, tx, inputOf(runsOfSubjectInput, { subjectId })),
  );

type Seeded = { readonly bindingId: string; readonly documentIds: readonly string[] };

const bindingOf = (
  scenario: Scenario,
  name: string,
  documents: ReadonlyArray<{ readonly title: string; readonly quarantineError?: string }>,
  publishedAt: Date | null = null,
): Promise<Seeded> =>
  seededBy(db(), async (seed) => {
    const binding = await seed.sourceBinding({
      workspaceId: scenario.workspaceId,
      name,
      publishedAt,
    });
    const documentIds: string[] = [];
    for (const { title, quarantineError } of documents) {
      const quarantined =
        quarantineError === undefined ? {} : { outcome: "quarantined", quarantineError };
      const document = await seed.sourceDocument({
        workspaceId: scenario.workspaceId,
        bindingId: binding.id,
        title,
        ...quarantined,
      });
      documentIds.push(document.id);
    }
    return { bindingId: binding.id, documentIds };
  });

type RunShape = {
  readonly reason: string;
  readonly status: "queued" | "claimed" | "done" | "failed";
  readonly enqueuedAt: Date;
  readonly finishedAt?: Date;
  readonly outcome?: Readonly<Record<string, string | number>>;
};

const INDEXED = { documents: 2, chunks: 3 };

const TIMED_OUT = { error: "DeadlineExceededError" };

const columnsOf = (run: RunShape) => {
  if (run.status === "queued") return {};
  const claimed = {
    attempts: 1,
    claimedBy: "worker-1",
    claimedAt: run.enqueuedAt,
    heartbeatAt: run.enqueuedAt,
  };
  if (run.status === "claimed") return { ...claimed, leaseExpiresAt: run.enqueuedAt };
  return { ...claimed, finishedAt: run.finishedAt ?? null, outcome: run.outcome ?? {} };
};

const runOver = (scenario: Scenario, bindingId: string, run: RunShape): Promise<string> =>
  seededBy(db(), async (seed) => {
    const row = await seed.job({
      workspaceId: scenario.workspaceId,
      kind: "index",
      subjectId: bindingId,
      reason: run.reason,
      status: run.status,
      enqueuedAt: run.enqueuedAt,
      ...columnsOf(run),
    });
    return row.id;
  });

const chunksUnder = async (
  scenario: Scenario,
  bindingId: string,
  documentId: string,
  count: number,
): Promise<void> => {
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    await chunkUnder(
      db(),
      scenario.workspaceId,
      { bindingId, documentId },
      {
        content: `Paragraph ${String(ordinal)}.`,
        ordinal,
        charStart: ordinal * 20,
        charEnd: ordinal * 20 + 12,
      },
    );
  }
};

const AS_BOUND = {
  connector: "upload",
  sensitivity: "Internal",
  audience: "everyone",
  audienceGroups: null,
  destination: ["chunk-index", "bundle"],
  retentionClass: "keep",
  quarantined: [],
  quarantinedByError: {},
};

describe("the Sources list an Admin reads", () => {
  it("names each binding's state, counts and last run", async () => {
    const scenario = await arrange();
    const handbook = await bindingOf(scenario, "Handbook", [{ title: "handbook.md" }]);
    const handbookRun = await runOver(scenario, handbook.bindingId, {
      reason: "bound",
      status: "queued",
      enqueuedAt: QUEUED_AT,
    });
    const policies = await bindingOf(scenario, "Policies", [
      { title: "leave.md" },
      { title: "expenses.md" },
    ]);
    await runOver(scenario, policies.bindingId, {
      reason: "bound",
      status: "failed",
      enqueuedAt: QUEUED_AT,
      finishedAt: FAILED_AT,
      outcome: TIMED_OUT,
    });
    const policiesRun = await runOver(scenario, policies.bindingId, {
      reason: "restored",
      status: "done",
      enqueuedAt: REQUEUED_AT,
      finishedAt: FINISHED_AT,
      outcome: INDEXED,
    });
    await chunksUnder(scenario, policies.bindingId, policies.documentIds[0] ?? "", 2);
    await chunksUnder(scenario, policies.bindingId, policies.documentIds[1] ?? "", 1);
    const rota = await bindingOf(scenario, "Rota", [{ title: "rota.md" }], PUBLISHED_AT);
    const rotaRun = await runOver(scenario, rota.bindingId, {
      reason: "bound",
      status: "done",
      enqueuedAt: QUEUED_AT,
      finishedAt: FINISHED_AT,
      outcome: INDEXED,
    });
    const contracts = await bindingOf(scenario, "Contracts", [{ title: "contracts.pdf" }]);
    const contractsRun = await runOver(scenario, contracts.bindingId, {
      reason: "bound",
      status: "claimed",
      enqueuedAt: QUEUED_AT,
    });

    const listed = answered(await listedFor(scenario.admin));

    expect(listed).toEqual([
      {
        ...AS_BOUND,
        bindingId: contracts.bindingId,
        name: "Contracts",
        state: "indexing",
        publishedAt: null,
        documentCount: 1,
        chunkCount: 0,
        lastRun: {
          jobId: contractsRun,
          kind: "index",
          reason: "bound",
          status: "claimed",
          attempts: 1,
          enqueuedAt: "2026-09-11T08:00:00.000Z",
          finishedAt: null,
          outcome: null,
        },
      },
      {
        ...AS_BOUND,
        bindingId: handbook.bindingId,
        name: "Handbook",
        state: "landed",
        publishedAt: null,
        documentCount: 1,
        chunkCount: 0,
        lastRun: {
          jobId: handbookRun,
          kind: "index",
          reason: "bound",
          status: "queued",
          attempts: 0,
          enqueuedAt: "2026-09-11T08:00:00.000Z",
          finishedAt: null,
          outcome: null,
        },
      },
      {
        ...AS_BOUND,
        bindingId: policies.bindingId,
        name: "Policies",
        state: "indexed",
        publishedAt: null,
        documentCount: 2,
        chunkCount: 3,
        lastRun: {
          jobId: policiesRun,
          kind: "index",
          reason: "restored",
          status: "done",
          attempts: 1,
          enqueuedAt: "2026-09-11T09:00:00.000Z",
          finishedAt: "2026-09-11T09:30:00.000Z",
          outcome: { documents: 2, chunks: 3 },
        },
      },
      {
        ...AS_BOUND,
        bindingId: rota.bindingId,
        name: "Rota",
        state: "published",
        publishedAt: "2026-09-11T10:00:00.000Z",
        documentCount: 1,
        chunkCount: 0,
        lastRun: {
          jobId: rotaRun,
          kind: "index",
          reason: "bound",
          status: "done",
          attempts: 1,
          enqueuedAt: "2026-09-11T08:00:00.000Z",
          finishedAt: "2026-09-11T09:30:00.000Z",
          outcome: { documents: 2, chunks: 3 },
        },
      },
    ]);
  });

  it("shows an unrun binding as landed with no last run", async () => {
    const scenario = await arrange();
    const minutes = await bindingOf(scenario, "Minutes", [{ title: "minutes.md" }]);

    const listed = answered(await listedFor(scenario.admin));

    expect(listed.map((binding) => [binding.bindingId, binding.state, binding.lastRun])).toEqual([
      [minutes.bindingId, "landed", null],
    ]);
  });

  it("names each quarantined document's error and counts by error", async () => {
    const scenario = await arrange();
    const scans = await bindingOf(scenario, "Scans", [
      { title: "Minutes" },
      { title: "Floor plan", quarantineError: "NeedsOcrError" },
      { title: "Site survey", quarantineError: "NeedsOcrError" },
      { title: "Archive", quarantineError: "DeadlineExceededError" },
    ]);
    const [, floorPlan, siteSurvey, archive] = scans.documentIds;

    const [listed] = answered(await listedFor(scenario.admin));

    expect(listed?.documentCount).toBe(4);
    expect(listed?.quarantined).toEqual([
      { documentId: archive, title: "Archive", error: "DeadlineExceededError" },
      { documentId: floorPlan, title: "Floor plan", error: "NeedsOcrError" },
      { documentId: siteSurvey, title: "Site survey", error: "NeedsOcrError" },
    ]);
    expect(listed?.quarantinedByError).toEqual({ NeedsOcrError: 2, DeadlineExceededError: 1 });
  });

  it("lists no binding another workspace holds", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    await bindingOf(elsewhere, "Their handbook", [{ title: "theirs.md" }]);

    expect(answered(await listedFor(scenario.admin))).toEqual([]);
  });

  it.each(["editor", "viewer"] as const)(
    "refuses the %s, as the list is an Admin's",
    async (role) => {
      const scenario = await arrange();
      await bindingOf(scenario, "Handbook", [{ title: "handbook.md" }]);

      expect(await listedFor(scenario[role])).toEqual({ ok: false, error: "role-forbids" });
    },
  );
});

describe("the runs of a binding, read by subject", () => {
  it("answers every run newest first, with outcome and ISO instants", async () => {
    const scenario = await arrange();
    const handbook = await bindingOf(scenario, "Handbook", [{ title: "handbook.md" }]);
    const failed = await runOver(scenario, handbook.bindingId, {
      reason: "bound",
      status: "failed",
      enqueuedAt: QUEUED_AT,
      finishedAt: FAILED_AT,
      outcome: TIMED_OUT,
    });
    const requeued = await runOver(scenario, handbook.bindingId, {
      reason: "restored",
      status: "queued",
      enqueuedAt: REQUEUED_AT,
    });
    const other = await bindingOf(scenario, "Rota", [{ title: "rota.md" }]);
    await runOver(scenario, other.bindingId, {
      reason: "bound",
      status: "queued",
      enqueuedAt: QUEUED_AT,
    });

    const runs = answered(await runsFor(scenario.admin, handbook.bindingId));

    expect(runs).toEqual([
      {
        jobId: requeued,
        kind: "index",
        reason: "restored",
        status: "queued",
        attempts: 0,
        enqueuedAt: "2026-09-11T09:00:00.000Z",
        finishedAt: null,
        outcome: null,
      },
      {
        jobId: failed,
        kind: "index",
        reason: "bound",
        status: "failed",
        attempts: 1,
        enqueuedAt: "2026-09-11T08:00:00.000Z",
        finishedAt: "2026-09-11T08:30:00.000Z",
        outcome: { error: "DeadlineExceededError" },
      },
    ]);
  });

  it("answers another workspace's subject with nothing", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const theirs = await bindingOf(elsewhere, "Handbook", [{ title: "handbook.md" }]);
    await runOver(elsewhere, theirs.bindingId, {
      reason: "bound",
      status: "queued",
      enqueuedAt: QUEUED_AT,
    });

    expect(answered(await runsFor(scenario.admin, theirs.bindingId))).toEqual([]);
  });

  it.each(["editor", "viewer"] as const)("refuses the %s", async (role) => {
    const scenario = await arrange();
    const handbook = await bindingOf(scenario, "Handbook", [{ title: "handbook.md" }]);

    expect(await runsFor(scenario[role], handbook.bindingId)).toEqual({
      ok: false,
      error: "role-forbids",
    });
  });
});
