import { describe, expect, it } from "vitest";

import type { UserPrincipal } from "../src/kernel/index.ts";
import { runsOfSubject, runsOfSubjectInput } from "../src/runs/index.ts";
import { listConnectedSources } from "../src/sources/index.ts";
import { passageUnder, seededBy } from "./sourced-concept.ts";
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
  readingAs(db().runtimePool, who, (principal, tx) => listConnectedSources(principal, tx));

const runsFor = (who: UserPrincipal, subjectId: string) =>
  readingAs(db().runtimePool, who, (principal, tx) =>
    runsOfSubject(principal, tx, inputOf(runsOfSubjectInput, { subjectId })),
  );

type Seeded = { readonly connectedSourceId: string; readonly documentIds: readonly string[] };

const connectedSourceOf = (
  scenario: Scenario,
  name: string,
  documents: ReadonlyArray<{ readonly title: string; readonly quarantineError?: string }>,
  publishedAt: Date | null = null,
): Promise<Seeded> =>
  seededBy(db(), async (seed) => {
    const connectedSource = await seed.connectedSource({
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
        connectedSourceId: connectedSource.id,
        title,
        ...quarantined,
      });
      documentIds.push(document.id);
    }
    return { connectedSourceId: connectedSource.id, documentIds };
  });

type SyncShape = {
  readonly reason: string;
  readonly status: "queued" | "claimed" | "done" | "failed";
  readonly enqueuedAt: Date;
  readonly finishedAt?: Date;
  readonly outcome?: Readonly<Record<string, string | number>>;
};

const INDEXED = { documents: 2, passages: 3 };

const TIMED_OUT = { error: "DeadlineExceededError" };

const columnsOf = (run: SyncShape) => {
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

const syncOver = (scenario: Scenario, connectedSourceId: string, run: SyncShape): Promise<string> =>
  seededBy(db(), async (seed) => {
    const row = await seed.job({
      workspaceId: scenario.workspaceId,
      kind: "index",
      subjectId: connectedSourceId,
      reason: run.reason,
      status: run.status,
      enqueuedAt: run.enqueuedAt,
      ...columnsOf(run),
    });
    return row.id;
  });

const passagesUnder = async (
  scenario: Scenario,
  connectedSourceId: string,
  documentId: string,
  count: number,
): Promise<void> => {
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    await passageUnder(
      db(),
      scenario.workspaceId,
      { connectedSourceId, documentId },
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
  destination: ["passage-index", "bundle"],
  retentionClass: "keep",
  quarantined: [],
  quarantinedByError: {},
};

describe("the Sources list an Admin reads", () => {
  it("names each connected source's state, counts and last sync", async () => {
    const scenario = await arrange();
    const handbook = await connectedSourceOf(scenario, "Handbook", [{ title: "handbook.md" }]);
    const handbookSync = await syncOver(scenario, handbook.connectedSourceId, {
      reason: "connected",
      status: "queued",
      enqueuedAt: QUEUED_AT,
    });
    const policies = await connectedSourceOf(scenario, "Policies", [
      { title: "leave.md" },
      { title: "expenses.md" },
    ]);
    await syncOver(scenario, policies.connectedSourceId, {
      reason: "connected",
      status: "failed",
      enqueuedAt: QUEUED_AT,
      finishedAt: FAILED_AT,
      outcome: TIMED_OUT,
    });
    const policiesSync = await syncOver(scenario, policies.connectedSourceId, {
      reason: "restored",
      status: "done",
      enqueuedAt: REQUEUED_AT,
      finishedAt: FINISHED_AT,
      outcome: INDEXED,
    });
    await passagesUnder(scenario, policies.connectedSourceId, policies.documentIds[0] ?? "", 2);
    await passagesUnder(scenario, policies.connectedSourceId, policies.documentIds[1] ?? "", 1);
    const rota = await connectedSourceOf(scenario, "Rota", [{ title: "rota.md" }], PUBLISHED_AT);
    const rotaSync = await syncOver(scenario, rota.connectedSourceId, {
      reason: "connected",
      status: "done",
      enqueuedAt: QUEUED_AT,
      finishedAt: FINISHED_AT,
      outcome: INDEXED,
    });
    const contracts = await connectedSourceOf(scenario, "Contracts", [{ title: "contracts.pdf" }]);
    const contractsSync = await syncOver(scenario, contracts.connectedSourceId, {
      reason: "connected",
      status: "claimed",
      enqueuedAt: QUEUED_AT,
    });

    const listed = answered(await listedFor(scenario.admin));

    expect(listed).toEqual([
      {
        ...AS_BOUND,
        connectedSourceId: contracts.connectedSourceId,
        name: "Contracts",
        state: "indexing",
        publishedAt: null,
        documentCount: 1,
        passageCount: 0,
        lastSync: {
          jobId: contractsSync,
          kind: "index",
          reason: "connected",
          status: "claimed",
          attempts: 1,
          enqueuedAt: "2026-09-11T08:00:00.000Z",
          finishedAt: null,
        },
      },
      {
        ...AS_BOUND,
        connectedSourceId: handbook.connectedSourceId,
        name: "Handbook",
        state: "received",
        publishedAt: null,
        documentCount: 1,
        passageCount: 0,
        lastSync: {
          jobId: handbookSync,
          kind: "index",
          reason: "connected",
          status: "queued",
          attempts: 0,
          enqueuedAt: "2026-09-11T08:00:00.000Z",
          finishedAt: null,
        },
      },
      {
        ...AS_BOUND,
        connectedSourceId: policies.connectedSourceId,
        name: "Policies",
        state: "indexed",
        publishedAt: null,
        documentCount: 2,
        passageCount: 3,
        lastSync: {
          jobId: policiesSync,
          kind: "index",
          reason: "restored",
          status: "done",
          attempts: 1,
          enqueuedAt: "2026-09-11T09:00:00.000Z",
          finishedAt: "2026-09-11T09:30:00.000Z",
        },
      },
      {
        ...AS_BOUND,
        connectedSourceId: rota.connectedSourceId,
        name: "Rota",
        state: "published",
        publishedAt: "2026-09-11T10:00:00.000Z",
        documentCount: 1,
        passageCount: 0,
        lastSync: {
          jobId: rotaSync,
          kind: "index",
          reason: "connected",
          status: "done",
          attempts: 1,
          enqueuedAt: "2026-09-11T08:00:00.000Z",
          finishedAt: "2026-09-11T09:30:00.000Z",
        },
      },
    ]);
  });

  it("shows an unrun source as received with no last sync", async () => {
    const scenario = await arrange();
    const minutes = await connectedSourceOf(scenario, "Minutes", [{ title: "minutes.md" }]);

    const listed = answered(await listedFor(scenario.admin));

    expect(
      listed.map((connectedSource) => [
        connectedSource.connectedSourceId,
        connectedSource.state,
        connectedSource.lastSync,
      ]),
    ).toEqual([[minutes.connectedSourceId, "received", null]]);
  });

  it("names each quarantined document's error and counts by error", async () => {
    const scenario = await arrange();
    const scans = await connectedSourceOf(scenario, "Scans", [
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

  it("lists no connected source another workspace holds", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    await connectedSourceOf(elsewhere, "Their handbook", [{ title: "theirs.md" }]);

    expect(answered(await listedFor(scenario.admin))).toEqual([]);
  });

  it.each(["editor", "viewer"] as const)(
    "refuses the %s, as the list is an Admin's",
    async (role) => {
      const scenario = await arrange();
      await connectedSourceOf(scenario, "Handbook", [{ title: "handbook.md" }]);

      expect(await listedFor(scenario[role])).toEqual({ ok: false, error: "role-forbids" });
    },
  );
});

describe("the runs of a connected source, read by subject", () => {
  it("answers every sync newest first, in ISO instants", async () => {
    const scenario = await arrange();
    const handbook = await connectedSourceOf(scenario, "Handbook", [{ title: "handbook.md" }]);
    const failed = await syncOver(scenario, handbook.connectedSourceId, {
      reason: "connected",
      status: "failed",
      enqueuedAt: QUEUED_AT,
      finishedAt: FAILED_AT,
      outcome: TIMED_OUT,
    });
    const requeued = await syncOver(scenario, handbook.connectedSourceId, {
      reason: "restored",
      status: "queued",
      enqueuedAt: REQUEUED_AT,
    });
    const other = await connectedSourceOf(scenario, "Rota", [{ title: "rota.md" }]);
    await syncOver(scenario, other.connectedSourceId, {
      reason: "connected",
      status: "queued",
      enqueuedAt: QUEUED_AT,
    });

    const runs = answered(await runsFor(scenario.admin, handbook.connectedSourceId));

    expect(runs).toEqual([
      {
        jobId: requeued,
        kind: "index",
        reason: "restored",
        status: "queued",
        attempts: 0,
        enqueuedAt: "2026-09-11T09:00:00.000Z",
        finishedAt: null,
      },
      {
        jobId: failed,
        kind: "index",
        reason: "connected",
        status: "failed",
        attempts: 1,
        enqueuedAt: "2026-09-11T08:00:00.000Z",
        finishedAt: "2026-09-11T08:30:00.000Z",
      },
    ]);
  });

  it("answers another workspace's subject with nothing", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const theirs = await connectedSourceOf(elsewhere, "Handbook", [{ title: "handbook.md" }]);
    await syncOver(elsewhere, theirs.connectedSourceId, {
      reason: "connected",
      status: "queued",
      enqueuedAt: QUEUED_AT,
    });

    expect(answered(await runsFor(scenario.admin, theirs.connectedSourceId))).toEqual([]);
  });

  it.each(["editor", "viewer"] as const)("refuses the %s", async (role) => {
    const scenario = await arrange();
    const handbook = await connectedSourceOf(scenario, "Handbook", [{ title: "handbook.md" }]);

    expect(await runsFor(scenario[role], handbook.connectedSourceId)).toEqual({
      ok: false,
      error: "role-forbids",
    });
  });
});
