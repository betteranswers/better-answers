import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";

import {
  ERASURE,
  rehearseErasure,
  seedSyntheticSubject,
  type ErasureRehearsed,
  type SubjectIdentifiers,
} from "@better-answers/core/erasure";
import { initRepository } from "@better-answers/core/store/git";
import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import { testData } from "@better-answers/schema/testing";
import { matching } from "@better-answers/schema/testing/matching";

import { EXIT_OF_CLASS } from "../../src/ops/index.ts";
import {
  capturingLogger,
  doorsFor,
  openTestGit,
  type TestApp,
} from "../support/harness/harness.ts";
import {
  opsRunner,
  jobsOf,
  auditLogOf,
  queuedIndexJob,
  theIndexJobEnded,
  whatAReplayReaches,
} from "../support/ops-run.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { opsWith, opsBeforeTheJournal, theSyncLanded, boundAndIndexed } = opsRunner(objects);

const FROM_THE_ROWS_AT = new Date("2026-06-01T12:00:00.000Z");

const FROM_THE_ROWS_SINCE = "2026-05-31T00:00:00Z";

const FROM_THE_COPY_AT = new Date("2026-07-01T12:00:00.000Z");

const FROM_THE_COPY_SINCE = "2026-06-15T00:00:00Z";

const REPLAYED_AT = new Date("2026-07-15T09:00:00.000Z");

const BEFORE_THE_FINDER_AT = new Date("2026-07-20T12:00:00.000Z");

const BEFORE_THE_FINDER_SINCE = "2026-07-18T00:00:00Z";

const REHEARSED_AT = new Date("2026-08-01T12:00:00.000Z");

const BEYOND_USE =
  "2026-08-03T12:00:00.000Z · 2026-08-31T12:00:00.000Z · " +
  "2026-09-26T12:00:00.000Z · 2027-02-01T12:00:00.000Z";

const erasureDoors = (app: TestApp, at: Date) => ({
  git: openTestGit(app),
  postgres: app.doors.postgres,
  objects: objects().door,
  clock: { now: () => at },
  log: capturingLogger().logger,
});

const erasedAt = async (
  app: TestApp,
  at: Date,
): Promise<ErasureRehearsed & { readonly workspaceId: string }> => {
  const { workspaceId } = await app.provision();
  await initRepository(openTestGit(app), workspaceId);
  const doors = erasureDoors(app, at);
  const seeded = await seedSyntheticSubject(ERASURE, doors, { workspaceId });
  if (!seeded.ok) throw new Error(`the seed refused: ${String(seeded.error)}`);
  const rehearsed = await rehearseErasure(ERASURE, doors, { workspaceId });
  if (!rehearsed.ok) throw new Error(`the rehearsal refused: ${String(rehearsed.error)}`);
  return { ...rehearsed.value, workspaceId };
};

const reportPath = async (): Promise<string> =>
  path.join(await mkdtemp(path.join(tmpdir(), "ops-rehearsal-")), "erasure-report.txt");

const theSyncFailed = async (app: TestApp, workspaceId: string): Promise<void> => {
  const run = await queuedIndexJob(app, workspaceId);
  await theIndexJobEnded(app, workspaceId, run.id, "failed");
};

const completedBeforeTheFinder = async (
  app: TestApp,
  workspaceId: string,
  at: Date,
  identifiers: SubjectIdentifiers,
): Promise<string> => {
  const client = await app.database.superuser.connect();
  try {
    const seed = testData(client);
    const request = await seed.subjectRequest({
      workspaceId,
      kind: "erasure",
      personId: null,
      identifiers,
      receivedAt: at,
    });
    const erasure = await seed.erasureRequest({
      workspaceId,
      subjectRequestId: request.id,
      anchoredAt: at,
      completedAt: at,
      report: "the report its first run wrote",
    });
    return erasure.id;
  } finally {
    client.release();
  }
};

const tokensThePassagesHold = async (
  app: TestApp,
  workspaceId: string,
  tokens: readonly string[],
): Promise<readonly string[]> => {
  const found = await app.database.superuser.query<{ content: string }>(
    `SELECT content FROM "index".passage WHERE workspace_id = $1`,
    [workspaceId],
  );
  return tokens.filter((token) => found.rows.some((row) => row.content.includes(token)));
};

const indexJobsIn = async (app: TestApp, workspaceId: string) => {
  const found = await app.database.superuser.query<{ reason: string; status: string }>(
    "SELECT reason, status FROM job WHERE workspace_id = $1 AND kind = 'index' ORDER BY enqueued_at, id",
    [workspaceId],
  );
  return found.rows;
};

describe("pnpm ops — the restore scripts' commands", () => {
  const served = servedApp();

  describe("replay-erasures — mandatory in every restore, never quietly a no-op", () => {
    it("proves there is nothing to replay on a pre-journal database", async () => {
      const run = await opsBeforeTheJournal(served(), [
        "replay-erasures",
        "--since",
        "20260901T020500Z",
      ]);

      expect(run.exitCode).toBe(0);
      expect(run.lines.join("\n")).toContain("replayed 0 erasures");
      expect(run.lines.join("\n")).toContain("no erasure_request table");
    });

    it("is done, replaying nothing, when no erasure followed the dump", async () => {
      const run = await opsWith(
        served(),
        ["replay-erasures", "--since", "2026-12-01T00:00:00Z"],
        {},
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "replay-erasures: done — replayed 0 erasures since 2026-12-01T00:00:00.000Z",
      ]);
    });

    it("re-applies an erasure the dump undid, from the restored rows", async () => {
      const erased = await erasedAt(served(), FROM_THE_ROWS_AT);

      const run = await opsWith(served(), ["replay-erasures", "--since", FROM_THE_ROWS_SINCE], {});

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        `replay-erasures: ${erased.erasureRequestId} in workspace ${erased.workspaceId} — ` +
          "completed 2026-06-01T12:00:00.000Z, read from the restored rows",
        "replay-erasures: done — replayed 1 erasure since 2026-05-31T00:00:00.000Z",
      ]);

      expect(await auditLogOf(served(), erased.workspaceId)).toContainEqual({
        action: "platform.erasure.replayed",
        actor: "process:better-answers-erasure",
        subject_id: erased.erasureRequestId,
      });
    });

    it("re-applies an erasure the rows lack, from its replay copy", async () => {
      const erased = await erasedAt(served(), FROM_THE_COPY_AT);

      await served().database.superuser.query(
        "DELETE FROM erasure_request WHERE workspace_id = $1",
        [erased.workspaceId],
      );
      await served().database.superuser.query(
        "DELETE FROM subject_request WHERE workspace_id = $1",
        [erased.workspaceId],
      );

      const run = await opsWith(served(), ["replay-erasures", "--since", FROM_THE_COPY_SINCE], {
        doors: { clock: { now: () => REPLAYED_AT } },
      });

      expect(run.exitCode).toBe(0);

      expect(run.lines).toEqual([
        `replay-erasures: ${erased.erasureRequestId} in workspace ${erased.workspaceId} — ` +
          "completed 2026-07-15T09:00:00.000Z, re-created from its replay copy",
        "replay-erasures: done — replayed 1 erasure since 2026-06-15T00:00:00.000Z",
      ]);
      const restored = await served().database.superuser.query<{ id: string; pseudonym: string }>(
        "SELECT id, pseudonym FROM erasure_request WHERE workspace_id = $1",
        [erased.workspaceId],
      );

      expect(restored.rows).toEqual([
        { id: erased.erasureRequestId, pseudonym: matching.any(String) },
      ]);
    });

    it("wipes and requeues the subject's source; a rerun only logs", async () => {
      const { workspaceId, admin } = await served().provision();
      await initRepository(openTestGit(served()), workspaceId);
      const identifiers: SubjectIdentifiers = {
        emails: ["sam.okafor@meridianfenland.co.uk"],
        names: ["Sam Okafor"],
        other: [],
      };
      await boundAndIndexed(
        served(),
        workspaceId,
        admin.id,
        "Expense claims go to Sam Okafor at sam.okafor@meridianfenland.co.uk by Friday.\n",
      );
      const indexedBefore = await whatAReplayReaches(served(), workspaceId);
      const erasureRequestId = await completedBeforeTheFinder(
        served(),
        workspaceId,
        BEFORE_THE_FINDER_AT,
        identifiers,
      );

      const first = await opsWith(
        served(),
        ["replay-erasures", "--since", BEFORE_THE_FINDER_SINCE],
        {},
      );
      const afterTheFirst = await whatAReplayReaches(served(), workspaceId);
      const second = await opsWith(
        served(),
        ["replay-erasures", "--since", BEFORE_THE_FINDER_SINCE],
        {},
      );

      const replayedOnce = [
        `replay-erasures: ${erasureRequestId} in workspace ${workspaceId} — ` +
          "completed 2026-07-20T12:00:00.000Z, read from the restored rows",
        "replay-erasures: done — replayed 1 erasure since 2026-07-18T00:00:00.000Z",
      ];
      expect(indexedBefore.passages).toHaveLength(1);
      expect([first.exitCode, first.lines]).toEqual([0, replayedOnce]);
      expect(afterTheFirst).toEqual({
        passages: [],
        jobs: [
          { kind: "index", reason: "connected", status: "done" },
          { kind: "index", reason: "wiped", status: "queued" },
        ],
        erasures: [
          {
            id: erasureRequestId,
            completed_at: BEFORE_THE_FINDER_AT,
            report: "the report its first run wrote",
          },
        ],
        suppressions: [{ identifiers }],
      });
      expect([second.exitCode, second.lines]).toEqual([0, replayedOnce]);
      expect(await whatAReplayReaches(served(), workspaceId)).toEqual(afterTheFirst);
      expect(
        (await auditLogOf(served(), workspaceId)).filter(
          (row) => row.action === "platform.erasure.replayed",
        ),
      ).toHaveLength(2);
    });

    it("refuses without a repositories' root, which the rewrite needs", async () => {
      const run = await opsWith(served(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        doors: { git: undefined },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("GIT_STORE_DIR");
      expect(run.lines.join("\n")).toContain("do not start api");
    });

    it("refuses when the image names no object store", async () => {
      const run = await opsWith(served(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        doors: { objects: undefined },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("no object store is configured");
      expect(run.lines.join("\n")).toContain("do not start api");
    });

    it("refuses an unreachable object store, not assuming nothing is owed", async () => {
      const unreachable = doorsFor(served().database.pool, {
        objectStore: {
          endpoint: "http://127.0.0.1:1",
          region: "garage",
          bucket: "better-answers",
          accessKeyId: "key",
          secretAccessKey: "secret",
        },
      });

      const run = await opsWith(served(), ["replay-erasures", "--since", "2026-09-01T02:05:00Z"], {
        doors: { objects: unreachable.objects },
      });

      expect(run.exitCode).toBe(1);
      expect(run.lines.join("\n")).toContain("REFUSED");
      expect(run.lines.join("\n")).toContain("do not start api");
    });
  });

  describe("erasure-rehearsal — the drill's proof that an erasure erases", () => {
    const pinned = { doors: { clock: { now: () => REHEARSED_AT } } };

    const aWorkspaceToDrillIn = async () => {
      const provisioned = await served().provision();
      await initRepository(openTestGit(served()), provisioned.workspaceId);
      return provisioned;
    };

    const seededBeside = async (workspaceId: string, worker: () => Promise<void>) => {
      const [seed] = await Promise.all([
        opsWith(
          served(),
          ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--seed"],
          pinned,
        ),
        worker(),
      ]);
      return seed;
    };

    const seeded = (workspaceId: string, readerId: string) =>
      seededBeside(workspaceId, () => theSyncLanded(served(), workspaceId, readerId));

    it("seeds the subject, answers once indexed, prints their tokens last", async () => {
      const { workspaceId, admin } = await aWorkspaceToDrillIn();

      const run = await seeded(workspaceId, admin.id);

      expect(run.exitCode).toBe(0);

      const email = `subject-${workspaceId.toLowerCase()}@erasure-rehearsal.example.test`;
      expect(run.lines).toEqual([
        `erasure-rehearsal: done — the synthetic subject of ${workspaceId} is seeded (a user row, an Admin member, one concept file and one indexed document naming them); take the dump, then run phase two`,
        `${email},human:${email},Rehearsal subject ${workspaceId}`,
      ]);
      const seededRow = await served().database.superuser.query(
        'SELECT 1 FROM "user" WHERE lower(email) = lower($1)',
        [email],
      );
      expect(seededRow.rowCount).toBe(1);
    });

    it("wipes the subject's passages in phase two, requeueing the source", async () => {
      const { workspaceId, admin } = await aWorkspaceToDrillIn();
      const email = `subject-${workspaceId.toLowerCase()}@erasure-rehearsal.example.test`;
      const name = `Rehearsal subject ${workspaceId}`;

      const seed = await seeded(workspaceId, admin.id);
      const printed = seed.lines.at(-1);
      assert(printed !== undefined, "the seed printed its tokens");
      const tokens = printed.split(",");
      const indexedBefore = await tokensThePassagesHold(served(), workspaceId, tokens);
      const run = await opsWith(
        served(),
        [
          "erasure-rehearsal",
          "--workspace",
          workspaceId,
          "--synthetic",
          "--run",
          "--report",
          await reportPath(),
        ],
        pinned,
      );

      expect(indexedBefore).toEqual([email, name]);
      expect(run.exitCode).toBe(0);
      expect(await tokensThePassagesHold(served(), workspaceId, tokens)).toEqual([]);
      expect(await indexJobsIn(served(), workspaceId)).toEqual([
        { reason: "connected", status: "done" },
        { reason: "wiped", status: "queued" },
      ]);
    });

    it("refuses phase one when indexing the subject's document fails", async () => {
      const { workspaceId } = await aWorkspaceToDrillIn();

      const run = await seededBeside(workspaceId, () => theSyncFailed(served(), workspaceId));

      const [sync] = await indexJobsIn(served(), workspaceId);
      const [queued] = await jobsOf(served(), workspaceId);
      assert(queued !== undefined, "the subject's document was queued");
      expect(run.exitCode).toBe(1);
      expect(sync).toEqual({ reason: "connected", status: "failed" });
      expect(run.lines).toEqual([
        `erasure-rehearsal: REFUSED — the synthetic subject's document is not indexed: job ${queued.id} is failed after 1 attempt; the job's own row says what it found`,
      ]);
    });

    it("refuses phase one when no worker indexes in time", async () => {
      const { workspaceId } = await aWorkspaceToDrillIn();

      const run = await opsWith(
        served(),
        [
          "erasure-rehearsal",
          "--workspace",
          workspaceId,
          "--synthetic",
          "--seed",
          "--wait-seconds",
          "1",
        ],
        {},
      );

      const [queued] = await jobsOf(served(), workspaceId);
      assert(queued !== undefined, "the subject's document was queued");
      expect(run.exitCode).toBe(1);
      expect(run.lines).toEqual([
        `erasure-rehearsal: REFUSED — the synthetic subject's document is not indexed: job ${queued.id} is still queued after 1 second, so no worker has indexed it`,
      ]);
    });

    it("erases the subject, writes the routine's report, reprints the tokens", async () => {
      const { workspaceId, admin } = await aWorkspaceToDrillIn();
      const file = await reportPath();

      const seed = await seeded(workspaceId, admin.id);

      const run = await opsWith(
        served(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--run", "--report", file],
        pinned,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines.at(-1)).toBe(seed.lines.at(-1));
      const request = await served().database.superuser.query<{ id: string }>(
        "SELECT id FROM subject_request WHERE workspace_id = $1",
        [workspaceId],
      );

      const written = await readFile(file, "utf8");
      const [requested] = request.rows;
      assert(requested !== undefined, "the erasure request was recorded");
      expect(written).toContain(`Erasure report for subject request ${requested.id}.`);
      expect(written).toContain(
        "Backup copies taken before 2026-08-01T12:00:00.000Z are beyond use: restored only in a " +
          "disaster, encrypted at rest, deletable only by the escrowed credential, expiring on " +
          `${BEYOND_USE}.`,
      );
      expect(written).toContain("Exports already issued are not recalled.");
      expect(await auditLogOf(served(), workspaceId)).toContainEqual({
        action: "platform.erasure.rehearsed",
        actor: "process:better-answers-erasure",
        subject_id: matching.any(String),
      });
    });

    it("logs the erasure's request, arm and deletions, and no address", async () => {
      const { workspaceId, admin } = await aWorkspaceToDrillIn();
      await seeded(workspaceId, admin.id);

      const run = await opsWith(
        served(),
        [
          "erasure-rehearsal",
          "--workspace",
          workspaceId,
          "--synthetic",
          "--run",
          "--report",
          await reportPath(),
        ],
        pinned,
      );

      const erasure = await served().database.superuser.query<{ id: string }>(
        "SELECT id FROM erasure_request WHERE workspace_id = $1",
        [workspaceId],
      );
      expect(run.exitCode).toBe(0);
      expect(run.logs).toEqual([
        matching.objectContaining({
          level: 30,
          actor: "process:better-answers-erasure",
          erasure_request_id: erasure.rows[0]?.id,
          arm: "last-workspace",
          pseudonymised: 1,
          sessions_deleted: 0,
          verifications_deleted: 0,
          accounts_deleted: 0,
          invitations_deleted_here: 0,
          invitations_deleted: 0,
          msg: "erasure: the identity step's arm, and what it pseudonymised and deleted",
        }),
      ]);
      expect(JSON.stringify(run.logs)).not.toContain("@");
    });

    it("refuses phase two where phase one never ran, erasing nobody", async () => {
      const { workspaceId } = await served().provision();
      await initRepository(openTestGit(served()), workspaceId);
      const file = await reportPath();

      const run = await opsWith(
        served(),
        ["erasure-rehearsal", "--workspace", workspaceId, "--synthetic", "--run", "--report", file],
        {},
      );

      expect(run.exitCode).toBe(EXIT_OF_CLASS.precondition);
      expect(run.lines.join("\n")).toContain("no synthetic subject stands in this workspace");
    });
  });
});
