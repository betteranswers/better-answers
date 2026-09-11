import type pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { JOB_KINDS } from "@better-answers/schema";
import { testData, withRollback } from "@better-answers/schema/testing";

import { contractFixture } from "./contract-fixture.ts";
import { postgresForSuite } from "./suite-postgres.ts";

/**
 * The queue agreement's TypeScript half (ADR 0031, ADR 0005): the fixture in
 * `contracts/queue/` is the contract, and this suite proves this tier reads the database's
 * four claim-protocol functions the way the fixture says — the oldest claimable job first,
 * a lapsed lease claimable again and never lost, a heartbeat that keeps a lease only for
 * the claimant, and attempts reaching the ceiling poisoning a job rather than spending
 * another one on it. The Python half runs the same cases in
 * `apps/worker/tests/test_tier_contract.py`.
 *
 * Both tiers claim: the worker on its loop, and the app for the ops command that runs a
 * rebuild in the foreground. That is what makes this an agreement rather than one tier's
 * helper, and it is why the fixture's claims name a role each — and, from `contract_version`
 * 7, a `kinds` array each: a claimant reaches only the kinds it passes, in both arms of the
 * claim, and a subject has one job claimed under a live lease and one waiting behind it.
 */

/**
 * Which job a fixture case is about, and why the case is there: for which workspace, under
 * which id, what to do — its `kind`, and the `reason` a kind that carries one was enqueued
 * for — and about which subject (`CONTEXT.md`, *job*). A job the fixture seeds and an enqueue
 * it expects the queue to refuse name a job the same way, so the fields they share are
 * declared here once and each array adds only what is its own: the lifecycle a seeded row
 * starts in, the SQLSTATE a refusal must answer with.
 */
const jobCaseSchema = z.object({
  why: z.string(),
  workspace_id: z.string(),
  id: z.string(),
  kind: z.enum(JOB_KINDS),
  reason: z.string().nullable(),
  subject_id: z.string().nullable(),
});

const fixtureSchema = z.object({
  description: z.string(),
  lease_seconds: z.number().int().positive(),
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  jobs: z.array(
    jobCaseSchema.extend({
      status: z.string(),
      attempts: z.number().int(),
      max_attempts: z.number().int(),
      enqueued_ago_seconds: z.number().int(),
      claimed_by: z.string().nullable(),
      lease_expires_in_seconds: z.number().int().nullable(),
    }),
  ),
  refused_enqueues: z.array(jobCaseSchema.extend({ sqlstate: z.string() })),
  claims: z.array(
    z.object({
      why: z.string(),
      role: z.string(),
      workspace_id: z.string(),
      worker_id: z.string(),
      kinds: z.array(z.enum(JOB_KINDS)),
      lapse_first: z.array(z.string()).optional(),
      expect_ids: z.array(z.string()),
    }),
  ),
  calls: z.array(
    z.object({
      why: z.string(),
      function: z.enum(["heartbeat_job", "finish_job", "fail_job"]),
      role: z.string(),
      workspace_id: z.string(),
      job_id: z.string(),
      worker_id: z.string(),
      outcome: z.record(z.string(), z.unknown()).optional(),
      expect: z.boolean(),
    }),
  ),
  expect_final: z.array(
    z.object({
      why: z.string(),
      workspace_id: z.string(),
      id: z.string(),
      status: z.string(),
      attempts: z.number().int(),
      claimed_by: z.string().nullable(),
    }),
  ),
});

const fixture = contractFixture("queue", fixtureSchema);

const db = postgresForSuite();

/** Seconds as an interval literal, which is how both tiers hand a lease to the function. */
const seconds = (count: number): string => `${count} seconds`;

/**
 * The fixture's workspaces and jobs, as the container's superuser. The two relative
 * instants become absolute here — that is how the fixture advances time without a suite
 * waiting for a lease to lapse.
 */
const seedFixture = async (client: pg.PoolClient) => {
  const seed = testData(client);
  for (const workspace of fixture.workspaces) await seed.workspace(workspace);
  const now = Date.now();
  for (const seeded of fixture.jobs) {
    await seed.job({
      workspaceId: seeded.workspace_id,
      id: seeded.id,
      kind: seeded.kind,
      reason: seeded.reason,
      subjectId: seeded.subject_id,
      status: seeded.status,
      attempts: seeded.attempts,
      maxAttempts: seeded.max_attempts,
      enqueuedAt: new Date(now - seeded.enqueued_ago_seconds * 1000),
      claimedBy: seeded.claimed_by,
      claimedAt: seeded.claimed_by === null ? null : new Date(now - 1000),
      leaseExpiresAt:
        seeded.lease_expires_in_seconds === null
          ? null
          : new Date(now + seeded.lease_expires_in_seconds * 1000),
      heartbeatAt: seeded.claimed_by === null ? null : new Date(now - 1000),
    });
  }
};

/**
 * One enqueue the queue must refuse, answered with the SQLSTATE that refused it. A failed
 * statement aborts the transaction it happened in, so the probe runs against a savepoint it
 * can come back to.
 */
const refusedEnqueue = async (
  client: pg.PoolClient,
  refused: (typeof fixture.refused_enqueues)[number],
): Promise<string> => {
  await client.query("SAVEPOINT refused_enqueue");
  try {
    await client.query(
      `INSERT INTO job (workspace_id, id, kind, reason, subject_id, status)
         VALUES ($1, $2, $3, $4, $5, 'queued')`,
      [refused.workspace_id, refused.id, refused.kind, refused.reason, refused.subject_id],
    );
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT refused_enqueue");
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "none";
    return code;
  }
  await client.query("ROLLBACK TO SAVEPOINT refused_enqueue");
  return "admitted";
};

/**
 * Push a lease thirty seconds into the past, as the superuser: how the fixture lapses a
 * lease part-way through a sequence of claims without a suite waiting a minute for one.
 */
const lapseLeases = async (client: pg.PoolClient, jobIds: readonly string[]) => {
  if (jobIds.length === 0) return;
  await client.query(
    "UPDATE job SET lease_expires_at = now() - interval '30 seconds' WHERE id = ANY($1)",
    [[...jobIds]],
  );
};

/** Run one statement as the fixture's role, in the fixture's scope ('' = none). */
const asRoleInScope = async (
  client: pg.PoolClient,
  where: { readonly role: string; readonly workspace_id: string },
) => {
  await client.query(`SET LOCAL ROLE ${where.role}`);
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [where.workspace_id]);
};

describe("the queue agreement", () => {
  it("hands out the jobs the fixture says, in the fixture's order, and answers every call the way it says", async () => {
    await withRollback(db().pool, async (client) => {
      await seedFixture(client);

      // The run key first, while the jobs it collides with are still queued: a second
      // queued job for a subject that already has one is the database's refusal, which is
      // what lets an enqueue read the waiting job's id back instead of landing a duplicate.
      const enqueues: { readonly why: string; readonly sqlstate: string }[] = [];
      for (const refused of fixture.refused_enqueues) {
        enqueues.push({ why: refused.why, sqlstate: await refusedEnqueue(client, refused) });
      }
      expect(enqueues).toEqual(
        fixture.refused_enqueues.map((refused) => ({
          why: refused.why,
          sqlstate: refused.sqlstate,
        })),
      );

      // The claims in order and the whole list at once: the agreement is about which job
      // goes next, so asserting one at a time would let a claim the function never made
      // pass unnoticed.
      const claimed: { readonly why: string; readonly ids: readonly string[] }[] = [];
      for (const claim of fixture.claims) {
        await lapseLeases(client, claim.lapse_first ?? []);
        await asRoleInScope(client, claim);
        const answered = await client.query<{ id: string }>(
          "SELECT id FROM claim_job($1, $2::interval, $3)",
          [claim.worker_id, seconds(fixture.lease_seconds), [...claim.kinds]],
        );
        claimed.push({ why: claim.why, ids: answered.rows.map((row) => row.id) });
        await client.query("RESET ROLE");
      }
      expect(claimed).toEqual(
        fixture.claims.map((claim) => ({ why: claim.why, ids: claim.expect_ids })),
      );

      const answered: { readonly why: string; readonly answer: boolean }[] = [];
      for (const call of fixture.calls) {
        await asRoleInScope(client, call);
        const statement =
          call.function === "heartbeat_job"
            ? "SELECT heartbeat_job($1, $2, $3::interval) AS answer"
            : `SELECT ${call.function}($1, $2, $3::jsonb) AS answer`;
        const third =
          call.function === "heartbeat_job"
            ? seconds(fixture.lease_seconds)
            : call.outcome === undefined
              ? null
              : JSON.stringify(call.outcome);
        const result = await client.query<{ answer: boolean }>(statement, [
          call.job_id,
          call.worker_id,
          third,
        ]);
        answered.push({ why: call.why, answer: result.rows[0]?.answer ?? false });
        await client.query("RESET ROLE");
      }
      expect(answered).toEqual(
        fixture.calls.map((call) => ({ why: call.why, answer: call.expect })),
      );

      // What every job was left as, read back as the superuser: a poisoning and a lapsed
      // lease are facts about a row, and the row is where the fixture says to look.
      const rows = await client.query<{
        workspace_id: string;
        id: string;
        status: string;
        attempts: number;
        claimed_by: string | null;
      }>(
        "SELECT workspace_id, id, status, attempts, claimed_by FROM job ORDER BY workspace_id, id",
      );
      expect(rows.rows).toEqual(
        [...fixture.expect_final]
          .toSorted((a, b) => `${a.workspace_id}${a.id}`.localeCompare(`${b.workspace_id}${b.id}`))
          .map((expected) => ({
            workspace_id: expected.workspace_id,
            id: expected.id,
            status: expected.status,
            attempts: expected.attempts,
            claimed_by: expected.claimed_by,
          })),
      );
    });
  });
});

/**
 * The kinds the fixture exercises, held to the kinds the descriptors declare.
 *
 * A kind is declared once — `JOB_KIND_DESCRIPTORS` — and the row's three CHECKs are written
 * off that list (`packages/schema/test/job-kinds.test.ts`). This agreement is the other half
 * of the same list: a kind this queue carries is a kind both tiers must have claimed a job
 * of, so the fixture's kinds and the descriptors are one list and not two. Left apart, a
 * descriptor could land with no case to exercise it — the seeded rows would satisfy the kind
 * CHECK by coincidence and nothing would say the agreement had not caught up.
 *
 * Held both ways (`[TEST7]`), and between two sources neither of which derives from the
 * other (`[TEST9]`): the exercised kinds are read off `contracts/queue/cases.json` as it
 * sits on disk, the declared ones off the schema package. The enum in the fixture schema
 * refuses an undeclared kind where it is parsed, so a `kind` no descriptor names fails the
 * file's load; what the assertion below adds is the direction no parse can see, a kind
 * declared and never put through the claim protocol.
 */
describe("the kinds the queue agreement exercises", () => {
  it("are the kinds the descriptors declare, neither more nor fewer", () => {
    const exercised = new Set<string>([
      ...fixture.jobs.map((seeded) => seeded.kind),
      ...fixture.refused_enqueues.map((refused) => refused.kind),
      ...fixture.claims.flatMap((claim) => claim.kinds),
    ]);
    const declared = new Set<string>(JOB_KINDS);

    expect({
      declaredButNeverExercised: [...declared].filter((kind) => !exercised.has(kind)).toSorted(),
      exercisedButNeverDeclared: [...exercised].filter((kind) => !declared.has(kind)).toSorted(),
    }).toEqual({ declaredButNeverExercised: [], exercisedButNeverDeclared: [] });
  });
});
