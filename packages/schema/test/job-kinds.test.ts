import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import {
  JOB_KIND_DESCRIPTORS,
  type JobKindDescriptor,
  JOB_KINDS,
  JOB_QUEUED_STATUS,
  ulid,
} from "../src/index.ts";
import { testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { ADMITTED, refusalOf } from "./probes.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

const WS = "01J6JJJJJJJJJJJJJJJJJJJJJJ";
const BINDING = "01J6BNNNNNNNNNNNNNNNNNNNNN";
const ANOTHER_BINDING = "01J6BMMMMMMMMMMMMMMMMMMMMM";

type ProbeRow = {
  readonly kind: string;
  readonly reason?: string | null;
  readonly subjectId?: string | null;

  readonly enqueuedAgoSeconds?: number;
};

const DESCRIBED: readonly JobKindDescriptor[] = JOB_KIND_DESCRIPTORS;

const everyReason = DESCRIBED.flatMap((descriptor) => [...descriptor.reasons]);

const insertJob = async (client: pg.PoolClient, row: ProbeRow): Promise<string> => {
  const id = ulid();
  await client.query(
    `INSERT INTO job (workspace_id, id, kind, reason, subject_id, status, enqueued_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() - ($7 || ' seconds')::interval)`,
    [
      WS,
      id,
      row.kind,
      row.reason ?? null,
      row.subjectId ?? null,
      JOB_QUEUED_STATUS,
      String(row.enqueuedAgoSeconds ?? 0),
    ],
  );
  return id;
};

const claimedJob = async (
  client: pg.PoolClient,
  row: ProbeRow,
  leaseInSeconds: number,
): Promise<string> => {
  const id = ulid();
  await client.query(
    `INSERT INTO job (workspace_id, id, kind, reason, subject_id, status, attempts,
                      enqueued_at, claimed_by, claimed_at, lease_expires_at, heartbeat_at)
       VALUES ($1, $2, $3, $4, $5, 'claimed', 1,
               now() - ($6 || ' seconds')::interval, 'worker-holding', now(),
               now() + ($7 || ' seconds')::interval, now())`,
    [
      WS,
      id,
      row.kind,
      row.reason ?? null,
      row.subjectId ?? null,
      String(row.enqueuedAgoSeconds ?? 0),
      String(leaseInSeconds),
    ],
  );
  return id;
};

const claimed = async (
  client: pg.PoolClient,
  kinds: readonly string[],
): Promise<readonly string[]> => {
  await client.query("SET LOCAL ROLE worker_rt");
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS]);
  const answered = await client.query<{ id: string }>(
    "SELECT id FROM claim_job($1, $2::interval, $3)",
    ["worker-claiming", "60 seconds", [...kinds]],
  );
  await client.query("RESET ROLE");
  return answered.rows.map((row) => row.id);
};

const lapseLeaseOf = async (client: pg.PoolClient, jobId: string) => {
  await client.query(
    `UPDATE job SET lease_expires_at = now() - interval '30 seconds'
       WHERE workspace_id = $1 AND id = $2`,
    [WS, jobId],
  );
};

const refusedBy = async (client: pg.PoolClient, row: ProbeRow): Promise<string> => {
  const answer = await refusalOf(client, () => insertJob(client, row));
  return answer === ADMITTED ? `admitted: ${JSON.stringify(row)}` : answer;
};

const admitted = async (client: pg.PoolClient, row: ProbeRow): Promise<string> => {
  await client.query("SAVEPOINT probe");
  const id = await insertJob(client, row);
  const found = await client.query<{
    kind: string;
    reason: string | null;
    subject_id: string | null;
  }>("SELECT kind, reason, subject_id FROM job WHERE workspace_id = $1 AND id = $2", [WS, id]);
  await client.query("ROLLBACK TO SAVEPOINT probe");
  const stored = found.rows[0];
  if (stored === undefined) return "nothing landed";
  return `${stored.kind} · ${stored.reason ?? "no reason"} · ${stored.subject_id ?? "no subject"}`;
};

const rowFor = (descriptor: JobKindDescriptor): ProbeRow => ({
  kind: descriptor.kind,
  reason: descriptor.reasons[0] ?? null,
  subjectId: descriptor.namesASubject ? BINDING : null,
});

const withWorkspace = async (fn: (client: pg.PoolClient) => Promise<void>): Promise<void> => {
  await withRollback(db.pool, async (client) => {
    await testData(client).workspace({ id: WS, name: "The queue's workspace" });
    await fn(client);
  });
};

describe("the job kind descriptors", () => {
  it("declares the queue's two original kinds and index, with what each one is", () => {
    expect(JOB_KIND_DESCRIPTORS).toEqual([
      {
        kind: "nightly-audit",
        claimingTier: "worker",
        namesASubject: false,
        reasons: [],
        enqueuedBy: "Admin",
      },
      {
        kind: "full-rebuild",
        claimingTier: "worker",
        namesASubject: false,
        reasons: ["first-sync", "route-change", "reconciler", "erasure", "upgrade", "drill"],
        enqueuedBy: "Admin",
      },
      {
        kind: "index",
        claimingTier: "worker",
        namesASubject: true,
        reasons: ["bound", "restored", "rule-change", "wiped", "narrowed"],
        enqueuedBy: "Admin",
      },
    ]);
  });

  it("is where the kind list comes from, so neither can gain a word without the other", () => {
    expect([...JOB_KINDS]).toEqual(["nightly-audit", "full-rebuild", "index"]);
  });
});

describe("the kind CHECK", () => {
  it("admits every kind a descriptor declares", async () => {
    await withWorkspace(async (client) => {
      const landed: string[] = [];
      for (const descriptor of DESCRIBED) landed.push(await admitted(client, rowFor(descriptor)));
      expect(landed).toEqual([
        "nightly-audit · no reason · no subject",
        "full-rebuild · first-sync · no subject",
        `index · bound · ${BINDING}`,
      ]);
    });
  });

  it("refuses a kind no descriptor declares", async () => {
    await withWorkspace(async (client) => {
      expect(await refusedBy(client, { kind: "reindex" })).toBe("job_kind_check");
    });
  });
});

describe("the subject CHECK", () => {
  it("requires a subject of the kinds whose descriptor names one, and refuses one on the rest", async () => {
    await withWorkspace(async (client) => {
      for (const descriptor of DESCRIBED) {
        expect(await admitted(client, rowFor(descriptor))).toContain(
          descriptor.namesASubject ? BINDING : "no subject",
        );
        expect(
          await refusedBy(client, {
            kind: descriptor.kind,
            reason: descriptor.reasons[0] ?? null,
            subjectId: descriptor.namesASubject ? null : BINDING,
          }),
        ).toBe("job_subject_check");
      }
    });
  });
});

describe("the reason CHECK", () => {
  it("admits every reason its own descriptor declares", async () => {
    await withWorkspace(async (client) => {
      const landed: string[] = [];
      for (const descriptor of DESCRIBED) {
        for (const reason of descriptor.reasons) {
          landed.push(
            await admitted(client, {
              kind: descriptor.kind,
              reason,
              subjectId: descriptor.namesASubject ? BINDING : null,
            }),
          );
        }
      }

      expect(landed).toEqual([
        "full-rebuild · first-sync · no subject",
        "full-rebuild · route-change · no subject",
        "full-rebuild · reconciler · no subject",
        "full-rebuild · erasure · no subject",
        "full-rebuild · upgrade · no subject",
        "full-rebuild · drill · no subject",
        `index · bound · ${BINDING}`,
        `index · restored · ${BINDING}`,
        `index · rule-change · ${BINDING}`,
        `index · wiped · ${BINDING}`,
        `index · narrowed · ${BINDING}`,
      ]);
    });
  });

  it("refuses another kind's reason, because the rule is the pair and not the word", async () => {
    await withWorkspace(async (client) => {
      for (const descriptor of DESCRIBED) {
        const alien = everyReason.filter((reason) => !descriptor.reasons.includes(reason));
        for (const reason of alien) {
          expect(
            await refusedBy(client, {
              kind: descriptor.kind,
              reason,
              subjectId: descriptor.namesASubject ? BINDING : null,
            }),
          ).toBe("job_reason_check");
        }
      }
    });
  });

  it("refuses a reasonless row of every kind that has reasons, and admits one of the kind that has none", async () => {
    await withWorkspace(async (client) => {
      const outcomes: string[] = [];
      for (const descriptor of DESCRIBED) {
        const row = {
          kind: descriptor.kind,
          reason: null,
          subjectId: descriptor.namesASubject ? BINDING : null,
        };
        outcomes.push(
          descriptor.reasons.length > 0
            ? await refusedBy(client, row)
            : await admitted(client, row),
        );
      }
      expect(outcomes).toEqual([
        "nightly-audit · no reason · no subject",
        "job_reason_check",
        "job_reason_check",
      ]);
    });
  });
});

describe("the run key", () => {
  it("refuses a second queued job for the same subject", async () => {
    await withWorkspace(async (client) => {
      await insertJob(client, { kind: "index", reason: "bound", subjectId: BINDING });
      expect(
        await refusedBy(client, { kind: "index", reason: "rule-change", subjectId: BINDING }),
      ).toBe("job_queued_subject_key");
    });
  });

  it("admits the next job for a subject whose last one is over", async () => {
    await withWorkspace(async (client) => {
      const first = await insertJob(client, { kind: "index", reason: "bound", subjectId: BINDING });
      await client.query(
        `UPDATE job SET status = 'done', finished_at = now(), outcome = '{"chunks": 0}'::jsonb
           WHERE workspace_id = $1 AND id = $2`,
        [WS, first],
      );
      expect(
        await admitted(client, { kind: "index", reason: "rule-change", subjectId: BINDING }),
      ).toBe(`index · rule-change · ${BINDING}`);
    });
  });

  it("leaves the subjectless kinds alone, because a NULL subject is distinct from a NULL subject", async () => {
    await withWorkspace(async (client) => {
      const landed: string[] = [];
      for (const descriptor of DESCRIBED.filter((one) => !one.namesASubject)) {
        const row = { kind: descriptor.kind, reason: descriptor.reasons[0] ?? null };
        await insertJob(client, row);
        landed.push(await admitted(client, row));
      }
      expect(landed).toEqual([
        "nightly-audit · no reason · no subject",
        "full-rebuild · first-sync · no subject",
      ]);
    });
  });
});

describe("the claim's sibling check", () => {
  it("passes over a job whose subject already has a run under a live lease", async () => {
    await withWorkspace(async (client) => {
      await claimedJob(
        client,
        { kind: "index", reason: "bound", subjectId: BINDING, enqueuedAgoSeconds: 60 },
        120,
      );

      await insertJob(client, {
        kind: "index",
        reason: "restored",
        subjectId: BINDING,
        enqueuedAgoSeconds: 45,
      });
      const free = await insertJob(client, {
        kind: "index",
        reason: "bound",
        subjectId: ANOTHER_BINDING,
        enqueuedAgoSeconds: 10,
      });

      expect(await claimed(client, ["index"])).toEqual([free]);

      expect(await claimed(client, ["index"])).toEqual([]);
    });
  });

  it("hands a subject's work out again once the lease it was waiting on lapses", async () => {
    await withWorkspace(async (client) => {
      const running = await claimedJob(
        client,
        { kind: "index", reason: "bound", subjectId: BINDING, enqueuedAgoSeconds: 60 },
        120,
      );
      await insertJob(client, {
        kind: "index",
        reason: "rule-change",
        subjectId: BINDING,
        enqueuedAgoSeconds: 45,
      });

      expect(await claimed(client, ["index"])).toEqual([]);

      await lapseLeaseOf(client, running);
      expect(await claimed(client, ["index"])).toEqual([running]);

      expect(await claimed(client, ["index"])).toEqual([]);
    });
  });

  it("leaves the subjectless kinds alone, because a NULL subject is nobody's sibling", async () => {
    await withWorkspace(async (client) => {
      await claimedJob(client, { kind: "nightly-audit", enqueuedAgoSeconds: 60 }, 120);
      const second = await insertJob(client, {
        kind: "nightly-audit",
        enqueuedAgoSeconds: 45,
      });

      expect(await claimed(client, ["nightly-audit"])).toEqual([second]);
    });
  });
});
