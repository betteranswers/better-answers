import type pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";

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
 * helper, and it is why the fixture's claims name a role each.
 */

const fixtureSchema = z.object({
  description: z.string(),
  lease_seconds: z.number().int().positive(),
  workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  jobs: z.array(
    z.object({
      why: z.string(),
      workspace_id: z.string(),
      id: z.string(),
      kind: z.string(),
      reason: z.string().nullable(),
      status: z.string(),
      attempts: z.number().int(),
      max_attempts: z.number().int(),
      enqueued_ago_seconds: z.number().int(),
      claimed_by: z.string().nullable(),
      lease_expires_in_seconds: z.number().int().nullable(),
    }),
  ),
  claims: z.array(
    z.object({
      why: z.string(),
      role: z.string(),
      workspace_id: z.string(),
      worker_id: z.string(),
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

      // The claims in order and the whole list at once: the agreement is about which job
      // goes next, so asserting one at a time would let a claim the function never made
      // pass unnoticed.
      const claimed: { readonly why: string; readonly ids: readonly string[] }[] = [];
      for (const claim of fixture.claims) {
        await asRoleInScope(client, claim);
        const answered = await client.query<{ id: string }>(
          "SELECT id FROM claim_job($1, $2::interval)",
          [claim.worker_id, seconds(fixture.lease_seconds)],
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
