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
import { openMigratedPostgres } from "./warm-postgres.ts";

/**
 * The queue's **kind descriptors** held to what the row admits.
 *
 * One record per kind declares the whole of what that kind is — who claims it, whether the
 * row names a subject, which reasons it may carry, who may enqueue it — and the kind, the
 * subject and the reason CHECKs are written from that list rather than by hand. So the
 * proof has two halves: the list itself is written down here as a literal (`[TEST9]`), and
 * every insert below is driven *off* the list, so a descriptor that lands without the
 * migration its CHECKs need fails here rather than in production.
 *
 * Each CHECK and the run key's partial unique index is a new constraint on a table both
 * tiers write, so each arrives with the insert it **refuses** beside the insert it admits
 * (`[SEC3]`). The inserts are plain SQL aimed at the table: the row is the subject under
 * test, and a boundary schema that happened to refuse first would hide what the database
 * does.
 */

let db: MigratedPostgres;

// The teardown rides back from the hook that opened the database, so the copy this suite
// runs against cannot outlive the run that made it by way of an `afterAll` somebody moved.
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
  /**
   * How long ago the job was enqueued. The claim hands out the oldest first, so a test
   * about *which* job is taken says how old each one is rather than trusting the order two
   * inserts happened to land in — inside one transaction `now()` does not move.
   */
  readonly enqueuedAgoSeconds?: number;
};

/**
 * The list every probe below is driven off, read at its declared width rather than at the
 * literal types the const assertion gives it: a probe asks whether *this* kind admits
 * *that* reason, which is a question about two words and not about two types.
 */
const DESCRIBED: readonly JobKindDescriptor[] = JOB_KIND_DESCRIPTORS;

/** Every reason any kind may carry — the pool an alien reason is drawn from. */
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

/**
 * A job already claimed over a subject, under a lease that either stands or has gone: the
 * row the claim's sibling check reads. Written as SQL rather than through a claim, because
 * what is under test below is what the *next* claim does about it.
 */
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

/**
 * One claim, under the role and the scope a worker actually claims with — the function is
 * SECURITY INVOKER, so the policy is what it sees through and a superuser's claim would
 * prove the filter over rows no worker can reach.
 */
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

/** Take a lease away without waiting for it to lapse. */
const lapseLeaseOf = async (client: pg.PoolClient, jobId: string) => {
  await client.query(
    `UPDATE job SET lease_expires_at = now() - interval '30 seconds'
       WHERE workspace_id = $1 AND id = $2`,
    [WS, jobId],
  );
};

/**
 * The Postgres error's own `constraint`, which is the name the migration wrote — so a
 * refusal is asserted against the rule that refused it and not merely against "it threw".
 */
const constraintOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "constraint" in error
    ? String(error.constraint)
    : `nothing named a constraint: ${String(error)}`;

/**
 * One insert the row must refuse, answered with the constraint that refused it. A failed
 * statement aborts the transaction it happened in, so every probe runs against a savepoint
 * it can come back to — which is what lets one test try a whole descriptor list.
 */
const refusedBy = async (client: pg.PoolClient, row: ProbeRow): Promise<string> => {
  await client.query("SAVEPOINT probe");
  try {
    await insertJob(client, row);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT probe");
    return constraintOf(error);
  }
  await client.query("ROLLBACK TO SAVEPOINT probe");
  return `admitted: ${JSON.stringify(row)}`;
};

/**
 * One insert the row must admit, answered with the three columns under test as the table
 * stored them, and rolled back so the next probe starts from the same table. The row is
 * read back rather than assumed: a CHECK that admitted the insert and a column that kept
 * what it was given are two facts, and a queue that dropped its subject would pass the
 * first without the second.
 */
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

/** The row a descriptor describes: its first reason if it has one, its subject if it names one. */
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
    // Written out rather than derived: this literal is the oracle the CHECKs below are
    // held to, and the three kinds are the spec's own (S1 adds `index`; `bind` and `prune`
    // are S4's records, one each).
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
        // The row the descriptor describes is admitted with its subject exactly as given;
        // the row that says the opposite about its subject is refused — the biconditional
        // refuses in both directions, so an `index` job about nothing and a nightly audit
        // about a binding are both gone.
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
      // ADR 0023's six names on the rebuild, and S1's five on the index run.
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
      // A rebuild with no reason cannot say why the map was thrown away and made again, and
      // an index run with none cannot say what put the binding back through the seam; the
      // nightly audit has nothing to say, and says nothing.
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
      // The nightly audit and the rebuild name no subject, so the index over
      // `(workspace_id, kind, subject_id)` never holds two of either against each other —
      // the queue kept its two original kinds exactly as it had them.
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

/**
 * The queued side of *one run per subject* is the run key above; the claimed side is the
 * claim's own sibling check, and the two together are what stop a binding being indexed by
 * two runs at once. It lives in the claim rather than in a constraint because the rule is
 * about a lease that is still standing, which is a fact about an instant and not about a
 * row, and it ships here with the claim it refuses beside the claim it serves (`[SEC3]`).
 */
describe("the claim's sibling check", () => {
  it("passes over a job whose subject already has a run under a live lease", async () => {
    await withWorkspace(async (client) => {
      await claimedJob(
        client,
        { kind: "index", reason: "bound", subjectId: BINDING, enqueuedAgoSeconds: 60 },
        120,
      );
      // Older than the job below and still passed over, which is what makes this the
      // sibling check and not an empty queue: the claim reaches past it for a binding
      // nothing is running.
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
      // And now that binding has a run too, so there is nothing left to give out.
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

      // The lease is the whole of what was holding the binding: take it away and the
      // binding's work is claimable again, and it goes to the row that lost it — the older
      // of the two, and the run that was part-way through.
      await lapseLeaseOf(client, running);
      expect(await claimed(client, ["index"])).toEqual([running]);

      // The claim just made is itself a live lease on that binding, so the job waiting
      // behind it waits: one run per subject holds from either end.
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
