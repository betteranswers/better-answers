import type pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { JOB_KINDS } from "@better-answers/schema";
import { testData, withRollback } from "@better-answers/schema/testing";
import { enqueueAttempted } from "@better-answers/schema/testing/probes";

import { contractFixture } from "../fixtures/contract-fixture.ts";
import { postgresForSuite } from "../support/suite-postgres.ts";

const jobCaseSchema = z.object({
  why: z.string(),
  workspace_id: z.string(),
  id: z.string(),
  kind: z.enum(JOB_KINDS),
  reason: z.string().nullable(),
  subject_id: z.string().nullable(),
});

const CALLS_WITH_AN_OUTCOME = ["finish_job", "fail_job"] as const;

const callWhere = z.object({
  why: z.string(),
  role: z.string(),
  workspace_id: z.string(),
  job_id: z.string(),
  worker_id: z.string(),
  expect: z.boolean(),
});

const callSchema = z.discriminatedUnion("function", [
  callWhere.extend({ function: z.literal("heartbeat_job") }),
  callWhere.extend({ function: z.literal("hand_back_job") }),
  callWhere.extend({
    function: z.enum(CALLS_WITH_AN_OUTCOME),
    outcome: z.record(z.string(), z.unknown()).optional(),
  }),
]);

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
      backoff_ends_in_seconds: z.number().int().nullable(),
    }),
  ),
  enqueues: z.array(jobCaseSchema.extend({ answer: z.string() })),
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
  calls: z.array(callSchema),
  expect_final: z.array(
    z.object({
      why: z.string(),
      workspace_id: z.string(),
      id: z.string(),
      status: z.string(),
      attempts: z.number().int(),
      max_attempts: z.number().int(),
      claimed_by: z.string().nullable(),
      backoff_ends_in_seconds: z.number().int().nullable(),
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
    if (seeded.backoff_ends_in_seconds !== null) {
      await client.query(
        "UPDATE job SET backoff_ends_at = now() + make_interval(secs => $1) WHERE id = $2",
        [seeded.backoff_ends_in_seconds, seeded.id],
      );
    }
  }
};

const enqueueAnswer = (
  client: pg.PoolClient,
  enqueue: (typeof fixture.enqueues)[number],
): Promise<string> =>
  enqueueAttempted(client, {
    workspaceId: enqueue.workspace_id,
    id: enqueue.id,
    kind: enqueue.kind,
    reason: enqueue.reason,
    subjectId: enqueue.subject_id,
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

const enqueuesAnswered = async (client: pg.PoolClient) => {
  const enqueues: { readonly why: string; readonly answer: string }[] = [];
  for (const enqueue of fixture.enqueues) {
    enqueues.push({ why: enqueue.why, answer: await enqueueAnswer(client, enqueue) });
  }
  return enqueues;
};

const claimsAnswered = async (client: pg.PoolClient) => {
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
  return claimed;
};

const callStatement = (
  call: z.output<typeof callSchema>,
): { readonly statement: string; readonly values: (string | null)[] } => {
  const claim = [call.job_id, call.worker_id];
  switch (call.function) {
    case "heartbeat_job":
      return {
        statement: "SELECT heartbeat_job($1, $2, $3::interval) AS answer",
        values: [...claim, seconds(fixture.lease_seconds)],
      };
    case "hand_back_job":
      return { statement: "SELECT hand_back_job($1, $2) AS answer", values: claim };
    case "finish_job":
    case "fail_job":
      return {
        statement: `SELECT ${call.function}($1, $2, $3::jsonb) AS answer`,
        values: [...claim, call.outcome === undefined ? null : JSON.stringify(call.outcome)],
      };
  }
};

const callsAnswered = async (client: pg.PoolClient) => {
  const answered: { readonly why: string; readonly answer: boolean }[] = [];
  for (const call of fixture.calls) {
    await asRoleInScope(client, call);
    const { statement, values } = callStatement(call);
    const result = await client.query<{ answer: boolean }>(statement, values);
    answered.push({ why: call.why, answer: result.rows[0]?.answer ?? false });
    await client.query("RESET ROLE");
  }
  return answered;
};

const finalRows = async (client: pg.PoolClient) => {
  const rows = await client.query<{
    workspace_id: string;
    id: string;
    status: string;
    attempts: number;
    max_attempts: number;
    claimed_by: string | null;
    backoff_ends_in_seconds: number | null;
  }>(
    `SELECT workspace_id, id, status, attempts, max_attempts, claimed_by,
            round(extract(epoch FROM backoff_ends_at - now()))::int AS backoff_ends_in_seconds
       FROM job ORDER BY workspace_id, id`,
  );
  return rows.rows;
};

describe("the queue agreement", () => {
  it("refuses, hands out and answers exactly as the fixture says", async () => {
    await withRollback(db().pool, async (client) => {
      await seedFixture(client);

      expect(await enqueuesAnswered(client)).toEqual(
        fixture.enqueues.map((enqueue) => ({
          why: enqueue.why,
          answer: enqueue.answer,
        })),
      );

      expect(await claimsAnswered(client)).toEqual(
        fixture.claims.map((claim) => ({ why: claim.why, ids: claim.expect_ids })),
      );

      expect(await callsAnswered(client)).toEqual(
        fixture.calls.map((call) => ({ why: call.why, answer: call.expect })),
      );

      expect(await finalRows(client)).toEqual(
        [...fixture.expect_final]
          .toSorted((a, b) => `${a.workspace_id}${a.id}`.localeCompare(`${b.workspace_id}${b.id}`))
          .map((expected) => ({
            workspace_id: expected.workspace_id,
            id: expected.id,
            status: expected.status,
            attempts: expected.attempts,
            max_attempts: expected.max_attempts,
            claimed_by: expected.claimed_by,
            backoff_ends_in_seconds: expected.backoff_ends_in_seconds,
          })),
      );
    });
  });
});

describe("the kinds the queue agreement exercises", () => {
  it("are the kinds the descriptors declare, neither more nor fewer", () => {
    const exercised = new Set<string>([
      ...fixture.jobs.map((seeded) => seeded.kind),
      ...fixture.enqueues.map((enqueue) => enqueue.kind),
      ...fixture.claims.flatMap((claim) => claim.kinds),
    ]);
    const declared = new Set<string>(JOB_KINDS);

    expect({
      declaredButNeverExercised: [...declared].filter((kind) => !exercised.has(kind)).toSorted(),
      exercisedButNeverDeclared: [...exercised].filter((kind) => !declared.has(kind)).toSorted(),
    }).toEqual({ declaredButNeverExercised: [], exercisedButNeverDeclared: [] });
  });
});
