import type pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { JOB_KINDS } from "@better-answers/schema";
import { testData, withRollback } from "@better-answers/schema/testing";
import { enqueueAttempted } from "@better-answers/schema/testing/probes";

import { contractFixture } from "./contract-fixture.ts";
import { postgresForSuite } from "./suite-postgres.ts";

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

const seconds = (count: number): string => `${count} seconds`;

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

const refusedEnqueue = (
  client: pg.PoolClient,
  refused: (typeof fixture.refused_enqueues)[number],
): Promise<string> =>
  enqueueAttempted(client, {
    workspaceId: refused.workspace_id,
    id: refused.id,
    kind: refused.kind,
    reason: refused.reason,
    subjectId: refused.subject_id,
  });

const lapseLeases = async (client: pg.PoolClient, jobIds: readonly string[]) => {
  if (jobIds.length === 0) return;
  await client.query(
    "UPDATE job SET lease_expires_at = now() - interval '30 seconds' WHERE id = ANY($1)",
    [[...jobIds]],
  );
};

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
