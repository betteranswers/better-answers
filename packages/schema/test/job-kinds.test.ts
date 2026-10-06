import { readFileSync } from "node:fs";
import path from "node:path";

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  INDEX_REASONS,
  JOB_KIND_DESCRIPTORS,
  type JobKindDescriptor,
  JOB_KINDS,
  REASONS_EMPTYING_THE_CONNECTED_SOURCE,
} from "../src/index.ts";
import { journalMetaFolder } from "../src/journal.ts";
import {
  type JobProbeRow,
  seedConnectedSourceIn,
  seedConnectedSourceOfAConnectorAlone,
  seedConnectedSourceTo,
  seedClaimedJob,
  seedFinishedJob,
  seedQueuedJob,
} from "./catalogue-statements.ts";
import { testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import {
  asTheMigrationOwnerOf,
  migrationStatements,
  migrationStatementSaying,
} from "./journal-statements.ts";
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
const ANOTHER_WS = "01J6JKKKKKKKKKKKKKKKKKKKKK";
const CONNECTED_SOURCE = "01J6BNNNNNNNNNNNNNNNNNNNNN";
const ANOTHER_CONNECTED_SOURCE = "01J6BMMMMMMMMMMMMMMMMMMMMM";
const A_THIRD_CONNECTED_SOURCE = "01J6BLLLLLLLLLLLLLLLLLLLLL";

const RETIRED_REASON = "narrowed";

const THE_RETIRING_MIGRATION = "0048_the-retired-run-reason.sql";

const THE_MIGRATION_IT_REPLACED = "0034_the-job-subject-and-the-run-key.sql";

const ADDS_THE_REASON_CHECK = 'ADD CONSTRAINT "job_reason_check"';

/**
 * Replayed from the journal rather than copied, so the rows seeded under it are ones a real
 * database held.
 */
const theCheckItReplaced = (): string =>
  migrationStatementSaying(THE_MIGRATION_IT_REPLACED, ADDS_THE_REASON_CHECK);

const jobsStandingIn = async (
  client: pg.PoolClient,
  workspaceId: string,
): Promise<readonly string[]> =>
  (
    await client.query<{ id: string }>(
      "SELECT id FROM job WHERE workspace_id = $1 ORDER BY enqueued_at",
      [workspaceId],
    )
  ).rows.map((row) => row.id);

const DESCRIBED: readonly JobKindDescriptor[] = JOB_KIND_DESCRIPTORS;

const everyReason = DESCRIBED.flatMap((descriptor) => [...descriptor.reasons]);

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

const refusedBy = async (client: pg.PoolClient, row: JobProbeRow): Promise<string> => {
  const answer = await refusalOf(client, () => seedQueuedJob(client, WS, row));
  return answer === ADMITTED ? `admitted: ${JSON.stringify(row)}` : answer;
};

const admitted = async (client: pg.PoolClient, row: JobProbeRow): Promise<string> => {
  await client.query("SAVEPOINT probe");
  const id = await seedQueuedJob(client, WS, row);
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

const rowFor = (descriptor: JobKindDescriptor): JobProbeRow => ({
  kind: descriptor.kind,
  reason: descriptor.reasons[0] ?? null,
  subjectId: descriptor.namesASubject ? CONNECTED_SOURCE : null,
});

const withWorkspace = async (fn: (client: pg.PoolClient) => Promise<void>): Promise<void> => {
  await withRollback(db.pool, async (client) => {
    await testData(client).workspace({ id: WS, name: "The queue's workspace" });
    await fn(client);
  });
};

describe("the job kind descriptors", () => {
  it("declares nightly-audit, full-rebuild and index, with what each is", () => {
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
        reasons: [
          "first-build",
          "model-choice-change",
          "reconciler",
          "erasure",
          "upgrade",
          "drill",
        ],
        enqueuedBy: "Admin",
      },
      {
        kind: "index",
        claimingTier: "worker",
        namesASubject: true,
        reasons: ["connected", "restored", "dismissed", "rule-change", "wiped"],
        enqueuedBy: "Admin",
      },
    ]);
  });

  it("is where the kind list comes from", () => {
    expect([...JOB_KINDS]).toEqual(["nightly-audit", "full-rebuild", "index"]);
  });

  it("names the connected-source-emptying reasons, each an index reason", () => {
    expect([...REASONS_EMPTYING_THE_CONNECTED_SOURCE]).toEqual(["rule-change", "wiped"]);
    const emptying: readonly string[] = REASONS_EMPTYING_THE_CONNECTED_SOURCE;
    expect(INDEX_REASONS.filter((reason) => emptying.includes(reason))).toEqual([
      "rule-change",
      "wiped",
    ]);
  });
});

describe("the kind CHECK", () => {
  it("admits every kind a descriptor declares", async () => {
    await withWorkspace(async (client) => {
      const landed: string[] = [];
      for (const descriptor of DESCRIBED) landed.push(await admitted(client, rowFor(descriptor)));
      expect(landed).toEqual([
        "nightly-audit · no reason · no subject",
        "full-rebuild · first-build · no subject",
        `index · connected · ${CONNECTED_SOURCE}`,
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
  it("requires a subject exactly where the descriptor names one", async () => {
    await withWorkspace(async (client) => {
      for (const descriptor of DESCRIBED) {
        expect(await admitted(client, rowFor(descriptor))).toContain(
          descriptor.namesASubject ? CONNECTED_SOURCE : "no subject",
        );
        expect(
          await refusedBy(client, {
            kind: descriptor.kind,
            reason: descriptor.reasons[0] ?? null,
            subjectId: descriptor.namesASubject ? null : CONNECTED_SOURCE,
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
              subjectId: descriptor.namesASubject ? CONNECTED_SOURCE : null,
            }),
          );
        }
      }

      expect(landed).toEqual([
        "full-rebuild · first-build · no subject",
        "full-rebuild · model-choice-change · no subject",
        "full-rebuild · reconciler · no subject",
        "full-rebuild · erasure · no subject",
        "full-rebuild · upgrade · no subject",
        "full-rebuild · drill · no subject",
        `index · connected · ${CONNECTED_SOURCE}`,
        `index · restored · ${CONNECTED_SOURCE}`,
        `index · dismissed · ${CONNECTED_SOURCE}`,
        `index · rule-change · ${CONNECTED_SOURCE}`,
        `index · wiped · ${CONNECTED_SOURCE}`,
      ]);
    });
  });

  it("refuses another kind's reason, since the rule is the pair", async () => {
    await withWorkspace(async (client) => {
      for (const descriptor of DESCRIBED) {
        const alien = everyReason.filter((reason) => !descriptor.reasons.includes(reason));
        for (const reason of alien) {
          expect(
            await refusedBy(client, {
              kind: descriptor.kind,
              reason,
              subjectId: descriptor.namesASubject ? CONNECTED_SOURCE : null,
            }),
          ).toBe("job_reason_check");
        }
      }
    });
  });

  it("refuses the retired word, which no descriptor declares", async () => {
    await withWorkspace(async (client) => {
      expect(
        await refusedBy(client, {
          kind: "index",
          reason: RETIRED_REASON,
          subjectId: CONNECTED_SOURCE,
        }),
      ).toBe("job_reason_check");
    });
  });

  it("refuses a reasonless row only where the kind has reasons", async () => {
    await withWorkspace(async (client) => {
      const outcomes: string[] = [];
      for (const descriptor of DESCRIBED) {
        const row = {
          kind: descriptor.kind,
          reason: null,
          subjectId: descriptor.namesASubject ? CONNECTED_SOURCE : null,
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
      await seedQueuedJob(client, WS, {
        kind: "index",
        reason: "connected",
        subjectId: CONNECTED_SOURCE,
      });
      expect(
        await refusedBy(client, {
          kind: "index",
          reason: "rule-change",
          subjectId: CONNECTED_SOURCE,
        }),
      ).toBe("job_queued_subject_key");
    });
  });

  it("admits the next job once the subject's last is over", async () => {
    await withWorkspace(async (client) => {
      const first = await seedQueuedJob(client, WS, {
        kind: "index",
        reason: "connected",
        subjectId: CONNECTED_SOURCE,
      });
      await client.query(
        `UPDATE job SET status = 'done', finished_at = now(), outcome = '{"chunks": 0}'::jsonb
           WHERE workspace_id = $1 AND id = $2`,
        [WS, first],
      );
      expect(
        await admitted(client, {
          kind: "index",
          reason: "rule-change",
          subjectId: CONNECTED_SOURCE,
        }),
      ).toBe(`index · rule-change · ${CONNECTED_SOURCE}`);
    });
  });

  it("leaves subjectless kinds alone, as NULL subjects are distinct", async () => {
    await withWorkspace(async (client) => {
      const landed: string[] = [];
      for (const descriptor of DESCRIBED.filter((one) => !one.namesASubject)) {
        const row = { kind: descriptor.kind, reason: descriptor.reasons[0] ?? null };
        await seedQueuedJob(client, WS, row);
        landed.push(await admitted(client, row));
      }
      expect(landed).toEqual([
        "nightly-audit · no reason · no subject",
        "full-rebuild · first-build · no subject",
      ]);
    });
  });
});

describe("the claim's sibling check", () => {
  it("skips a job whose subject runs under a live lease", async () => {
    await withWorkspace(async (client) => {
      await seedClaimedJob(
        client,
        WS,
        { kind: "index", reason: "connected", subjectId: CONNECTED_SOURCE, enqueuedAgoSeconds: 60 },
        120,
      );

      await seedQueuedJob(client, WS, {
        kind: "index",
        reason: "restored",
        subjectId: CONNECTED_SOURCE,
        enqueuedAgoSeconds: 45,
      });
      const free = await seedQueuedJob(client, WS, {
        kind: "index",
        reason: "connected",
        subjectId: ANOTHER_CONNECTED_SOURCE,
        enqueuedAgoSeconds: 10,
      });

      expect(await claimed(client, ["index"])).toEqual([free]);

      expect(await claimed(client, ["index"])).toEqual([]);
    });
  });

  it("hands the subject's work out once the lease lapses", async () => {
    await withWorkspace(async (client) => {
      const running = await seedClaimedJob(
        client,
        WS,
        { kind: "index", reason: "connected", subjectId: CONNECTED_SOURCE, enqueuedAgoSeconds: 60 },
        120,
      );
      await seedQueuedJob(client, WS, {
        kind: "index",
        reason: "rule-change",
        subjectId: CONNECTED_SOURCE,
        enqueuedAgoSeconds: 45,
      });

      expect(await claimed(client, ["index"])).toEqual([]);

      await lapseLeaseOf(client, running);
      expect(await claimed(client, ["index"])).toEqual([running]);

      expect(await claimed(client, ["index"])).toEqual([]);
    });
  });

  it("leaves subjectless kinds alone, as NULL is nobody's sibling", async () => {
    await withWorkspace(async (client) => {
      await seedClaimedJob(client, WS, { kind: "nightly-audit", enqueuedAgoSeconds: 60 }, 120);
      const second = await seedQueuedJob(client, WS, {
        kind: "nightly-audit",
        enqueuedAgoSeconds: 45,
      });

      expect(await claimed(client, ["nightly-audit"])).toEqual([second]);
    });
  });
});

const asTheMigrationOwner = <T>(client: pg.PoolClient, work: () => Promise<T>): Promise<T> =>
  asTheMigrationOwnerOf(client, ["TABLE public.job"], work);

const RETIRED = { kind: "index", reason: RETIRED_REASON } as const;

const withTheRetiredWordAdmitted = async (
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> => {
  await withWorkspace(async (client) => {
    await client.query('ALTER TABLE "job" DROP CONSTRAINT "job_reason_check"');
    await client.query(theCheckItReplaced());
    await testData(client).workspace({ id: ANOTHER_WS, name: "The queue's other workspace" });
    await fn(client);
  });
};

describe("the migration that retired a run reason", () => {
  it("deletes every row with the word, any status, any workspace", async () => {
    await withTheRetiredWordAdmitted(async (client) => {
      await seedQueuedJob(client, WS, { ...RETIRED, subjectId: CONNECTED_SOURCE });
      await seedClaimedJob(client, WS, { ...RETIRED, subjectId: ANOTHER_CONNECTED_SOURCE }, 120);
      await seedFinishedJob(client, WS, { ...RETIRED, subjectId: A_THIRD_CONNECTED_SOURCE });
      await seedQueuedJob(client, ANOTHER_WS, { ...RETIRED, subjectId: CONNECTED_SOURCE });
      const standing = await seedQueuedJob(client, WS, {
        kind: "index",
        reason: "rule-change",
        subjectId: A_THIRD_CONNECTED_SOURCE,
      });

      await asTheMigrationOwner(client, async () => {
        for (const statement of migrationStatements(THE_RETIRING_MIGRATION)) {
          await client.query(statement);
        }
      });

      expect(await jobsStandingIn(client, ANOTHER_WS)).toEqual([]);
      expect(await jobsStandingIn(client, WS)).toEqual([standing]);
      expect(
        await refusedBy(client, {
          kind: "index",
          reason: RETIRED_REASON,
          subjectId: CONNECTED_SOURCE,
        }),
      ).toBe("job_reason_check");
    });
  });

  it("needs its workspace loop: a bare DELETE reaches no row", async () => {
    await withTheRetiredWordAdmitted(async (client) => {
      const inOne = await seedQueuedJob(client, WS, { ...RETIRED, subjectId: CONNECTED_SOURCE });
      const inTheOther = await seedQueuedJob(client, ANOTHER_WS, {
        ...RETIRED,
        subjectId: CONNECTED_SOURCE,
      });

      const deleted = await asTheMigrationOwner(
        client,
        async () =>
          (
            await client.query("DELETE FROM public.job WHERE kind = 'index' AND reason = $1", [
              RETIRED_REASON,
            ])
          ).rowCount,
      );

      expect(deleted).toBe(0);
      expect(await jobsStandingIn(client, WS)).toEqual([inOne]);
      expect(await jobsStandingIn(client, ANOTHER_WS)).toEqual([inTheOther]);
    });
  });
});

const THE_RENAMING_MIGRATION = "0066_the-model-choice.sql";

const THE_CHECK_BEFORE_THE_RENAME = "0051_the-dismissal.sql";

const OLD_REASON = "route-change";

const NEW_REASON = "model-choice-change";

const OLD_REBUILD = { kind: "full-rebuild", reason: OLD_REASON, subjectId: null } as const;

/** The migration's statements on `job`; the table renames before them ran when the database did. */
const itsStatementsOnTheJobTable = (): readonly string[] =>
  migrationStatements(THE_RENAMING_MIGRATION).filter(
    (statement) => statement.includes('"job"') || statement.includes("public.job"),
  );

/** Under the reason CHECK `tag` added, with `before` run ahead of the second workspace's making. */
const withTheReasonCheckOf = async (
  tag: string,
  fn: (client: pg.PoolClient) => Promise<void>,
  before: (client: pg.PoolClient) => Promise<unknown> = async () => undefined,
): Promise<void> => {
  await withWorkspace(async (client) => {
    await client.query('ALTER TABLE "job" DROP CONSTRAINT "job_reason_check"');
    await client.query(migrationStatementSaying(tag, ADDS_THE_REASON_CHECK));
    await before(client);
    await testData(client).workspace({ id: ANOTHER_WS, name: "The queue's other workspace" });
    await fn(client);
  });
};

const withTheOldReasonAdmitted = (fn: (client: pg.PoolClient) => Promise<void>): Promise<void> =>
  withTheReasonCheckOf(THE_CHECK_BEFORE_THE_RENAME, fn);

const reasonsStandingIn = async (
  client: pg.PoolClient,
  workspaceId: string,
): Promise<readonly string[]> =>
  (
    await client.query<{ reason: string }>(
      "SELECT reason FROM job WHERE workspace_id = $1 ORDER BY enqueued_at",
      [workspaceId],
    )
  ).rows.map((row) => row.reason);

describe("the migration that named the model choice", () => {
  it("moves every workspace's queued old reason to the new one", async () => {
    await withTheOldReasonAdmitted(async (client) => {
      const queued = await seedQueuedJob(client, WS, OLD_REBUILD);
      await seedQueuedJob(client, ANOTHER_WS, OLD_REBUILD);

      await asTheMigrationOwner(client, async () => {
        for (const statement of itsStatementsOnTheJobTable()) await client.query(statement);
      });

      expect(await reasonsStandingIn(client, WS)).toEqual([NEW_REASON]);
      expect(await reasonsStandingIn(client, ANOTHER_WS)).toEqual([NEW_REASON]);
      expect(await claimed(client, ["full-rebuild"])).toEqual([queued]);
      expect(await refusedBy(client, OLD_REBUILD)).toBe("job_reason_check");
    });
  });
});

const THE_MAP_MIGRATION = "0067_the-map.sql";

const OLD_FIRST_REASON = "first-sync";

const NEW_FIRST_REASON = "first-build";

const OLD_FIRST_REBUILD = {
  kind: "full-rebuild",
  reason: OLD_FIRST_REASON,
  subjectId: null,
} as const;

const THE_OLD_DESTINATION = ["chunk-index", "graph"] as const;

/** The map's table for connected sources, as migration 0067 and the snapshots before 0068 name it. */
const THE_TABLE_THE_MAP_NAMED = "source_binding";

/**
 * The migration's statements on `job` and the connected sources' table, under that table's name
 * today; its table renames ran when the database did.
 */
const itsStatementsOnTheValuesItRewrites = (): readonly string[] =>
  migrationStatements(THE_MAP_MIGRATION)
    .filter((statement) =>
      [
        '"job"',
        "public.job",
        `"${THE_TABLE_THE_MAP_NAMED}"`,
        `public.${THE_TABLE_THE_MAP_NAMED}`,
      ].some((table) => statement.includes(table)),
    )
    .map((statement) => statement.replaceAll(THE_TABLE_THE_MAP_NAMED, "connected_source"));

const SNAPSHOT_CHECKS = z.object({
  tables: z.record(
    z.string(),
    z.object({ checkConstraints: z.record(z.string(), z.object({ value: z.string() })) }),
  ),
});

/** A CHECK declared inside its CREATE TABLE has no statement to replay, so a snapshot holds it. */
const aCheckFrom = (snapshot: string, suffix: string, addedAs: string): string => {
  const check = `${THE_TABLE_THE_MAP_NAMED}_${suffix}`;
  const value = SNAPSHOT_CHECKS.parse(
    JSON.parse(readFileSync(path.join(journalMetaFolder, snapshot), "utf8")),
  ).tables[`public.${THE_TABLE_THE_MAP_NAMED}`]?.checkConstraints[check]?.value;
  if (value === undefined) throw new Error(`${snapshot} holds no ${check}`);
  return `ALTER TABLE "connected_source" ADD CONSTRAINT "${addedAs}" CHECK (${value})`;
};

/** 0036 declared the CHECK, so the snapshot before the map holds it alone. */
const theDestinationCheckBeforeTheMap = (): string =>
  aCheckFrom("0066_snapshot.json", "destination_check", "connected_source_destination_check");

const withTheOldMapValuesAdmitted = (fn: (client: pg.PoolClient) => Promise<void>): Promise<void> =>
  withTheReasonCheckOf(THE_RENAMING_MIGRATION, fn, async (client) => {
    await client.query(
      'ALTER TABLE "connected_source" DROP CONSTRAINT "connected_source_destination_check"',
    );
    await client.query(theDestinationCheckBeforeTheMap());
  });

const replaying = (client: pg.PoolClient, statements: readonly string[]): Promise<void> =>
  asTheMigrationOwnerOf(client, ["TABLE public.job", "TABLE public.connected_source"], async () => {
    for (const statement of statements) await client.query(statement);
  });

const replayingItsRewrites = (client: pg.PoolClient): Promise<void> =>
  replaying(client, itsStatementsOnTheValuesItRewrites());

const destinationsStandingIn = async (
  client: pg.PoolClient,
  workspaceId: string,
): Promise<readonly (readonly string[])[]> =>
  (
    await client.query<{ destination: string[] }>(
      "SELECT destination FROM connected_source WHERE workspace_id = $1",
      [workspaceId],
    )
  ).rows.map((row) => row.destination);

describe("the migration that named the map", () => {
  it("moves every workspace's queued first-sync to first-build", async () => {
    await withTheOldMapValuesAdmitted(async (client) => {
      const queued = await seedQueuedJob(client, WS, OLD_FIRST_REBUILD);
      await seedQueuedJob(client, ANOTHER_WS, OLD_FIRST_REBUILD);

      await replayingItsRewrites(client);

      expect(await reasonsStandingIn(client, WS)).toEqual([NEW_FIRST_REASON]);
      expect(await reasonsStandingIn(client, ANOTHER_WS)).toEqual([NEW_FIRST_REASON]);
      expect(await claimed(client, ["full-rebuild"])).toEqual([queued]);
      expect(await refusedBy(client, OLD_FIRST_REBUILD)).toBe("job_reason_check");
    });
  });

  it("moves every workspace's 'graph' destination to 'map'", async () => {
    await withTheOldMapValuesAdmitted(async (client) => {
      await seedConnectedSourceTo(client, WS, CONNECTED_SOURCE, THE_OLD_DESTINATION);
      await seedConnectedSourceTo(client, ANOTHER_WS, CONNECTED_SOURCE, THE_OLD_DESTINATION);

      await replayingItsRewrites(client);

      expect(await destinationsStandingIn(client, WS)).toEqual([["chunk-index", "map"]]);
      expect(await destinationsStandingIn(client, ANOTHER_WS)).toEqual([["chunk-index", "map"]]);
      expect(
        await refusalOf(client, () =>
          seedConnectedSourceTo(client, WS, ANOTHER_CONNECTED_SOURCE, THE_OLD_DESTINATION),
        ),
      ).toBe("connected_source_destination_check");
    });
  });
});

const THE_CONNECTED_SOURCE_MIGRATION = "0068_the-connected-source.sql";

const OLD_INDEX_REASON = "bound";

const NEW_INDEX_REASON = "connected";

const OLD_STATE = "landed";

const NEW_STATE = "received";

const AN_OLD_RUN = { kind: "index", reason: OLD_INDEX_REASON } as const;

/** Its statements that rewrite a value; the renames before them ran when the database did. */
const itsValueRewrites = (): readonly string[] =>
  migrationStatements(THE_CONNECTED_SOURCE_MIGRATION).filter(
    (statement) =>
      !statement.includes("RENAME") &&
      ['"job"', "public.job", '"connected_source"', "public.connected_source"].some((table) =>
        statement.includes(table),
      ),
  );

/** Added by its old name, which 0068's DROP names: the table's other renames ran with the database. */
const theStateCheckBeforeTheRename = (): string =>
  aCheckFrom("0067_snapshot.json", "state_check", `${THE_TABLE_THE_MAP_NAMED}_state_check`);

const withTheOldConnectedSourceValuesAdmitted = (
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> =>
  withTheReasonCheckOf(THE_MAP_MIGRATION, fn, async (client) => {
    await client.query(
      'ALTER TABLE "connected_source" DROP CONSTRAINT "connected_source_state_check"',
    );
    await client.query(theStateCheckBeforeTheRename());
  });

const replayingItsValueRewrites = (client: pg.PoolClient): Promise<void> =>
  replaying(client, itsValueRewrites());

const statesStandingIn = async (
  client: pg.PoolClient,
  workspaceId: string,
): Promise<readonly string[]> =>
  (
    await client.query<{ state: string }>(
      "SELECT state FROM connected_source WHERE workspace_id = $1 ORDER BY id",
      [workspaceId],
    )
  ).rows.map((row) => row.state);

describe("the migration that named the connected source", () => {
  it("moves every workspace's bound runs to connected, finished ones too", async () => {
    await withTheOldConnectedSourceValuesAdmitted(async (client) => {
      const queued = await seedQueuedJob(client, WS, {
        ...AN_OLD_RUN,
        subjectId: CONNECTED_SOURCE,
      });
      await seedFinishedJob(client, WS, { ...AN_OLD_RUN, subjectId: ANOTHER_CONNECTED_SOURCE });
      await seedQueuedJob(client, ANOTHER_WS, { ...AN_OLD_RUN, subjectId: CONNECTED_SOURCE });

      await replayingItsValueRewrites(client);

      expect(await reasonsStandingIn(client, WS)).toEqual([NEW_INDEX_REASON, NEW_INDEX_REASON]);
      expect(await reasonsStandingIn(client, ANOTHER_WS)).toEqual([NEW_INDEX_REASON]);
      expect(await claimed(client, ["index"])).toEqual([queued]);
      expect(await refusedBy(client, { ...AN_OLD_RUN, subjectId: A_THIRD_CONNECTED_SOURCE })).toBe(
        "job_reason_check",
      );
    });
  });

  it("moves every workspace's landed connected source to received", async () => {
    await withTheOldConnectedSourceValuesAdmitted(async (client) => {
      await seedConnectedSourceIn(client, WS, CONNECTED_SOURCE, OLD_STATE);
      await seedConnectedSourceIn(client, ANOTHER_WS, CONNECTED_SOURCE, OLD_STATE);

      await replayingItsValueRewrites(client);
      await seedConnectedSourceOfAConnectorAlone(client, WS, ANOTHER_CONNECTED_SOURCE);

      expect(await statesStandingIn(client, WS)).toEqual([NEW_STATE, NEW_STATE]);
      expect(await statesStandingIn(client, ANOTHER_WS)).toEqual([NEW_STATE]);
      expect(
        await refusalOf(client, () =>
          seedConnectedSourceIn(client, WS, A_THIRD_CONNECTED_SOURCE, OLD_STATE),
        ),
      ).toBe("connected_source_state_check");
    });
  });
});
