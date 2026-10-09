import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import { find } from "../src/answering/index.ts";
import { STORED_DETAIL_KEYS } from "../src/audit/index.ts";
import {
  followSyncs,
  followSyncsInEveryWorkspace,
  overrideConceptSensitivity,
  SYNC_CASCADE,
  SYNC_CASCADE_ACTIONS,
} from "../src/concepts/index.ts";
import {
  auditEventRowsOf,
  conceptCiting,
  connectedSourceHolding,
  documentUnder,
  seededBy,
  visibilityHeld,
  visibilitySuite,
  type Sourced,
} from "./sourced-concept.ts";
import { countWaitingOnLocks, until } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading } = visibilitySuite();

const now = new Date("2026-10-09T12:00:00.000Z");

const RESTRICTED_TO_ADMINS = {
  sensitivity: "Restricted",
  audience: "everyone",
  audience_groups: null,
};
const INTERNAL_TO_EVERYONE = {
  sensitivity: "Internal",
  audience: "everyone",
  audience_groups: null,
};

const FOLLOWED = SYNC_CASCADE_ACTIONS.followed.name;

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

type SyncShape = {
  readonly connectedSourceId: string;
  readonly status?: "done" | "failed" | "poisoned";
  readonly attempts?: number;
  readonly finishedAt?: Date;
  /** Omitted: the outcome carries no key at all. */
  readonly moved?: readonly string[];
};

const outcomeOf = (sync: SyncShape) => {
  if (sync.status === "failed") return { error: "a passage failed to land" };
  if (sync.status === "poisoned") return null;
  return {
    documents: 1,
    passages: 1,
    lmdb_bytes: 0,
    restores_overridden_by_erasure: [],
    ...(sync.moved === undefined ? {} : { sensitivity_moved: [...sync.moved] }),
  };
};

const syncEnded = (scenario: Scenario, sync: SyncShape): Promise<string> =>
  seededBy(db(), async (seed) => {
    const at = sync.finishedAt ?? minutesAgo(1);
    const job = await seed.job({
      workspaceId: scenario.workspaceId,
      kind: "index",
      subjectId: sync.connectedSourceId,
      reason: "rule-change",
      status: sync.status ?? "done",
      enqueuedAt: at,
      attempts: sync.attempts ?? 1,
      claimedBy: "worker-1",
      claimedAt: at,
      heartbeatAt: at,
      finishedAt: at,
      outcome: outcomeOf(sync),
    });
    return job.id;
  });

const syncLapsed = (scenario: Scenario, connectedSourceId: string): Promise<string> =>
  seededBy(db(), async (seed) => {
    const job = await seed.job({
      workspaceId: scenario.workspaceId,
      kind: "index",
      subjectId: connectedSourceId,
      reason: "rule-change",
      status: "claimed",
      enqueuedAt: minutesAgo(10),
      attempts: 1,
      claimedBy: "a worker that went away",
      claimedAt: minutesAgo(10),
      heartbeatAt: minutesAgo(10),
      leaseExpiresAt: minutesAgo(1),
    });
    return job.id;
  });

/** What a sync's catalogue write leaves on a document; no index job is touched. */
const documentSetTo = (scenario: Scenario, documentId: string, sensitivity: string | null) =>
  db().pool.query(
    "UPDATE source_document SET sensitivity = $3 WHERE workspace_id = $1 AND id = $2",
    [scenario.workspaceId, documentId, sensitivity],
  );

const narrowedBySync = async (scenario: Scenario, document: Sourced) => {
  await documentSetTo(scenario, document.documentId, "Restricted");
  return syncEnded(scenario, {
    connectedSourceId: document.connectedSourceId,
    moved: [document.documentId],
  });
};

const writeUpIncluding = (workspaceId: string, iri: string): Promise<string> =>
  seededBy(db(), async (seed) => {
    const writeUp = await seed.writeUp({ workspaceId });
    await seed.writeUpInclude({ workspaceId, writeUpId: writeUp.id, iri, ordinal: 0 });
    return writeUp.id;
  });

const titlesFoundBy = async (scenario: Scenario, query: string) => {
  const found = await reading(scenario.editor, (reader, tx) =>
    find(reader, tx, { query, limit: 5 }, now),
  );
  if (!found.ok) throw new Error(`find was refused: ${String(found.error)}`);
  return found.value.matches.map((match) => match.title);
};

const heldRow = (scenario: Scenario, iri: string) =>
  visibilityHeld(db().pool, "concept_index", scenario.workspaceId, iri);

const pass = async (scenario: Scenario) => {
  const followed = await followSyncs(SYNC_CASCADE, scenario.postgres, scenario.workspaceId);
  if (!followed.ok) throw new Error(`the pass failed: ${followed.error.message}`);
  return followed.value;
};

const followedEvents = (scenario: Scenario) =>
  auditEventRowsOf(db().pool, scenario.workspaceId, FOLLOWED);

/** A source of two documents, a concept on each; the first document is the one a sync narrows. */
const twoCitedDocuments = async (scenario: Scenario) => {
  const narrowed = await connectedSourceHolding(db(), scenario.workspaceId);
  const untouched = await documentUnder(
    db(),
    scenario.workspaceId,
    narrowed.connectedSourceId,
    null,
  );
  const onNarrowed = await conceptCiting(scenario, scenario.editor, [narrowed.documentId]);
  const onUntouched = await conceptCiting(scenario, scenario.editor, [untouched.documentId]);
  return { narrowed, onNarrowed, onUntouched };
};

describe("a sync that narrows a cited document", () => {
  it("narrows the concepts citing it on the next tick", async () => {
    const scenario = await arrange();
    const document = await connectedSourceHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [document.documentId]);
    const writeUp = await writeUpIncluding(scenario.workspaceId, written.iri);
    expect(await titlesFoundBy(scenario, written.title)).toEqual([written.title]);

    await narrowedBySync(scenario, document);
    await followSyncsInEveryWorkspace(SYNC_CASCADE, scenario.postgres);

    expect(await titlesFoundBy(scenario, written.title)).toEqual([]);
    for (const [table, key] of [
      ["concept_index", written.iri],
      ["map_node", written.iri],
      ["write_up", writeUp],
    ] as const) {
      expect(await visibilityHeld(db().pool, table, scenario.workspaceId, key)).toEqual(
        RESTRICTED_TO_ADMINS,
      );
    }
  });

  it("re-derives the named documents' concepts, recording the sync once", async () => {
    const scenario = await arrange();
    const { narrowed, onNarrowed, onUntouched } = await twoCitedDocuments(scenario);
    const jobId = await narrowedBySync(scenario, narrowed);

    const first = await pass(scenario);
    const second = await pass(scenario);

    expect(first.followed).toEqual([{ jobId, concepts: 1 }]);
    expect(second).toEqual({ workspaceId: scenario.workspaceId, followed: [], skipped: [] });
    expect(await heldRow(scenario, onNarrowed.iri)).toEqual(RESTRICTED_TO_ADMINS);
    expect(await heldRow(scenario, onUntouched.iri)).toEqual(INTERNAL_TO_EVERYONE);
    const events = await followedEvents(scenario);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor: SYNC_CASCADE.actorId,
      subject_id: jobId,
      detail: {
        [STORED_DETAIL_KEYS.connectedSourceId]: narrowed.connectedSourceId,
        attempts: 1,
        documents: 1,
        concepts: 1,
        writeUps: 0,
      },
    });
  });

  it("records a sync that moved nothing, re-deriving nothing", async () => {
    const scenario = await arrange();
    const { narrowed, onNarrowed } = await twoCitedDocuments(scenario);
    await documentSetTo(scenario, narrowed.documentId, "Restricted");
    const jobId = await syncEnded(scenario, {
      connectedSourceId: narrowed.connectedSourceId,
      moved: [],
    });

    expect((await pass(scenario)).followed).toEqual([{ jobId, concepts: 0 }]);
    expect(await heldRow(scenario, onNarrowed.iri)).toEqual(INTERNAL_TO_EVERYONE);
  });

  it.each([
    ["that failed", { status: "failed" }],
    ["poisoned", { status: "poisoned" }],
    ["retried", { attempts: 2, moved: [] }],
    ["without the key", {}],
  ] as const)("re-derives the whole source for a sync %s", async (_, shape) => {
    const scenario = await arrange();
    const { narrowed, onNarrowed, onUntouched } = await twoCitedDocuments(scenario);
    await documentSetTo(scenario, narrowed.documentId, "Restricted");
    const jobId = await syncEnded(scenario, {
      connectedSourceId: narrowed.connectedSourceId,
      ...shape,
    });

    expect((await pass(scenario)).followed).toEqual([{ jobId, concepts: 2 }]);
    expect(await heldRow(scenario, onNarrowed.iri)).toEqual(RESTRICTED_TO_ADMINS);
    expect(await heldRow(scenario, onUntouched.iri)).toEqual(INTERNAL_TO_EVERYONE);
  });

  it("follows a lapsed claim, then its next attempt", async () => {
    const scenario = await arrange();
    const { narrowed, onNarrowed } = await twoCitedDocuments(scenario);
    await documentSetTo(scenario, narrowed.documentId, "Restricted");
    const jobId = await syncLapsed(scenario, narrowed.connectedSourceId);

    expect((await pass(scenario)).followed).toEqual([{ jobId, concepts: 2 }]);
    expect(await heldRow(scenario, onNarrowed.iri)).toEqual(RESTRICTED_TO_ADMINS);
    expect((await pass(scenario)).followed).toEqual([]);

    await db().pool.query(
      `UPDATE job SET status = 'done', attempts = 2, finished_at = now(), lease_expires_at = NULL,
              outcome = '{"passages": 1, "sensitivity_moved": []}'
        WHERE workspace_id = $1 AND id = $2`,
      [scenario.workspaceId, jobId],
    );
    expect((await pass(scenario)).followed).toEqual([{ jobId, concepts: 2 }]);
    expect((await followedEvents(scenario)).map((event) => event.detail["attempts"])).toEqual([
      1, 2,
    ]);
  });

  it("waits for a lapsed claimant's write in flight", async () => {
    const scenario = await arrange();
    const { narrowed, onNarrowed } = await twoCitedDocuments(scenario);
    const jobId = await syncLapsed(scenario, narrowed.connectedSourceId);
    const claimant = await db().pool.connect();
    try {
      await claimant.query("BEGIN");
      await claimant.query("SELECT 1 FROM job WHERE workspace_id = $1 AND id = $2 FOR KEY SHARE", [
        scenario.workspaceId,
        jobId,
      ]);
      await claimant.query(
        "UPDATE source_document SET sensitivity = 'Restricted' WHERE workspace_id = $1 AND id = $2",
        [scenario.workspaceId, narrowed.documentId],
      );

      const following = pass(scenario);
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      await claimant.query("COMMIT");

      expect((await following).followed).toEqual([{ jobId, concepts: 2 }]);
    } finally {
      claimant.release();
    }
    expect(await heldRow(scenario, onNarrowed.iri)).toEqual(RESTRICTED_TO_ADMINS);
  });

  it("records one event for two passes at once", async () => {
    const scenario = await arrange();
    const { narrowed } = await twoCitedDocuments(scenario);
    await narrowedBySync(scenario, narrowed);

    const [first, second] = await Promise.all([pass(scenario), pass(scenario)]);

    expect(first.followed.length + second.followed.length).toBe(1);
    expect(await followedEvents(scenario)).toHaveLength(1);
  });

  it("first follows only each source's newest sync", async () => {
    const scenario = await arrange();
    const { narrowed } = await twoCitedDocuments(scenario);
    await syncEnded(scenario, {
      connectedSourceId: narrowed.connectedSourceId,
      finishedAt: minutesAgo(30),
      moved: [narrowed.documentId],
    });
    const newest = await syncEnded(scenario, {
      connectedSourceId: narrowed.connectedSourceId,
      finishedAt: minutesAgo(5),
      moved: [],
    });

    expect((await pass(scenario)).followed).toEqual([{ jobId: newest, concepts: 0 }]);
  });

  it("follows a sync stamped before one already followed", async () => {
    const scenario = await arrange();
    const { narrowed, onNarrowed } = await twoCitedDocuments(scenario);
    const other = await connectedSourceHolding(db(), scenario.workspaceId);
    await syncEnded(scenario, { connectedSourceId: other.connectedSourceId, moved: [] });
    await pass(scenario);

    await documentSetTo(scenario, narrowed.documentId, "Restricted");
    const stampedEarlier = await syncEnded(scenario, {
      connectedSourceId: narrowed.connectedSourceId,
      finishedAt: minutesAgo(10),
      moved: [narrowed.documentId],
    });

    expect((await pass(scenario)).followed).toEqual([{ jobId: stampedEarlier, concepts: 1 }]);
    expect(await heldRow(scenario, onNarrowed.iri)).toEqual(RESTRICTED_TO_ADMINS);
  });

  it("records a sync of a connected source that is gone", async () => {
    const scenario = await arrange();
    const jobId = await syncEnded(scenario, { connectedSourceId: ulid(), moved: [ulid()] });

    expect(await pass(scenario)).toEqual({
      workspaceId: scenario.workspaceId,
      followed: [{ jobId, concepts: 0 }],
      skipped: [],
    });
  });
});

/** Refuses the step's event for one job, so that sync's transaction fails as a real fault would. */
const refusingTheMarkerOf = async <T>(jobId: string, work: () => Promise<T>): Promise<T> => {
  const name = `refuse_marker_${jobId.toLowerCase()}`;
  await db().pool.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.subject_id = '${jobId}' THEN RAISE EXCEPTION 'the marker is refused'; END IF;
       RETURN NEW;
     END $$`,
  );
  await db().pool.query(
    `CREATE TRIGGER ${name} BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  );
  try {
    return await work();
  } finally {
    await db().pool.query(`DROP TRIGGER ${name} ON audit_event`);
    await db().pool.query(`DROP FUNCTION ${name}()`);
  }
};

describe("a sync whose re-derivation fails", () => {
  it("is named, and followed once it stops failing", async () => {
    const scenario = await arrange();
    const first = await connectedSourceHolding(db(), scenario.workspaceId);
    const second = await connectedSourceHolding(db(), scenario.workspaceId);
    const onSecond = await conceptCiting(scenario, scenario.editor, [second.documentId]);
    await documentSetTo(scenario, second.documentId, "Restricted");
    const followedJob = await syncEnded(scenario, {
      connectedSourceId: first.connectedSourceId,
      finishedAt: minutesAgo(200),
      moved: [],
    });
    const failingJob = await syncEnded(scenario, {
      connectedSourceId: second.connectedSourceId,
      finishedAt: minutesAgo(180),
      moved: [second.documentId],
    });

    const failed = await refusingTheMarkerOf(failingJob, () => pass(scenario));
    const afterwards = await pass(scenario);

    expect(failed.followed).toEqual([{ jobId: followedJob, concepts: 0 }]);
    expect(failed.skipped).toEqual([
      { jobId: failingJob, reason: expect.stringContaining("the marker is refused") },
    ]);
    expect(afterwards.followed).toEqual([{ jobId: failingJob, concepts: 1 }]);
    expect(await heldRow(scenario, onSecond.iri)).toEqual(RESTRICTED_TO_ADMINS);
  });
});

describe("a sync that lifts a cited document", () => {
  it("widens unless an override or other evidence holds it", async () => {
    const scenario = await arrange();
    const source = await connectedSourceHolding(db(), scenario.workspaceId);
    const stillRestricted = await documentUnder(
      db(),
      scenario.workspaceId,
      source.connectedSourceId,
      "Restricted",
    );
    await documentSetTo(scenario, source.documentId, "Restricted");
    const alone = await conceptCiting(scenario, scenario.editor, [source.documentId]);
    const overridden = await conceptCiting(scenario, scenario.editor, [source.documentId]);
    const alsoOnRestricted = await conceptCiting(scenario, scenario.editor, [
      source.documentId,
      stillRestricted.documentId,
    ]);
    const override = await reading(scenario.admin, (admin, tx) =>
      overrideConceptSensitivity(admin, tx, {
        iri: overridden.iri,
        sensitivity: "Restricted",
        audience: "everyone",
      }),
    );
    expect(override.ok).toBe(true);

    await documentSetTo(scenario, source.documentId, null);
    await syncEnded(scenario, {
      connectedSourceId: source.connectedSourceId,
      moved: [source.documentId],
    });
    await pass(scenario);

    expect(await heldRow(scenario, alone.iri)).toEqual(INTERNAL_TO_EVERYONE);
    expect(await heldRow(scenario, overridden.iri)).toEqual(RESTRICTED_TO_ADMINS);
    expect(await heldRow(scenario, alsoOnRestricted.iri)).toEqual(RESTRICTED_TO_ADMINS);
    expect(await titlesFoundBy(scenario, alone.title)).toEqual([alone.title]);
  });
});
