import { setTimeout as sleep } from "node:timers/promises";

import type pg from "pg";
import { assert, describe, expect, it } from "vitest";

import { ulid } from "../../src/index.ts";
import { type TestData, testData } from "../support/factory.ts";
import { withRollback } from "../support/harness.ts";
import { postgresForSuite, privilegesHeld, refusalOf, refusesEach } from "../support/probes.ts";
import {
  A_CLOSED_QUESTION_FEEDBACK,
  A_COMPLETED_QUESTION_RECORD,
  A_QUESTION,
  A_QUESTION_RECORD,
  A_QUESTION_WITH_A_DRAFT,
  SOME_QUESTION_FEEDBACK,
} from "../support/rls-probes.ts";
import { contentPartitionOf, contentPartitions, inTheMonth } from "./question-months.ts";

const db = postgresForSuite();

const WS_A = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const THE_THREE = ["question_asked", "question_content", "question_feedback"] as const;

const A_MONTH_NOT_MADE = inTheMonth(2);
const ITS_PARTITION = contentPartitionOf(A_MONTH_NOT_MADE);

const MAKE_THE_MONTH = "SELECT create_question_content_partition($1)";

const AN_ASKER = `human:${ulid()}`;

const A_CONCEPT = "https://better-answers.com/c/01J6MMMMMMMMMMMMMMMMMMMMMM";

const HELPFUL = ["helpful", null, null, null, null] as const;

type Record = Awaited<ReturnType<TestData["questionAsked"]>>;

const aRecordIn = async (seed: TestData, workspaceId: string): Promise<Record> => {
  const record = await seed.questionAsked({ workspaceId });
  await seed.questionContent({ workspaceId, recordId: record.id, askedAt: record.askedAt });
  await seed.questionFeedback({ workspaceId, recordId: record.id });
  return record;
};

const twoWorkspacesEachWithARecord = async (client: pg.PoolClient) => {
  const seed = testData(client);
  await seed.workspace({ id: WS_A, name: "A" });
  await seed.workspace({ id: WS_B, name: "B" });
  return { seed, inA: await aRecordIn(seed, WS_A), inB: await aRecordIn(seed, WS_B) };
};

const as = async (
  client: pg.PoolClient,
  role: "app_rt" | "worker_rt",
  workspaceId: string,
): Promise<void> => {
  await client.query(`SET LOCAL ROLE ${role}`);
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
};

const aRecordInAMonthNotMade = async (client: pg.PoolClient): Promise<Record> => {
  const record = await testData(client).questionAsked({
    workspaceId: WS_A,
    askedAt: A_MONTH_NOT_MADE,
  });
  await as(client, "app_rt", WS_A);
  return record;
};

const rowsOfEach = async (client: pg.PoolClient) => {
  const counted: { table: string; workspaces: readonly string[] }[] = [];
  for (const table of THE_THREE) {
    const read = await client.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM ${table} ORDER BY workspace_id`,
    );
    counted.push({ table, workspaces: read.rows.map((row) => row.workspace_id) });
  }
  return counted;
};

const eachHolding = (workspaces: readonly string[]) =>
  THE_THREE.map((table) => ({ table, workspaces }));

const untilASessionWaits = async (): Promise<void> => {
  for (let turn = 0; turn < 500; turn += 1) {
    const waiting = await db().pool.query(
      "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if ((waiting.rowCount ?? 0) > 0) return;
    await sleep(20);
  }
  throw new Error("no session ever waited on a lock");
};

const NO_PRIVILEGE = {
  SELECT: false,
  INSERT: false,
  UPDATE: false,
  DELETE: false,
  TRUNCATE: false,
  REFERENCES: false,
  TRIGGER: false,
  MAINTAIN: false,
};

const aWriteOfEach = (inA: Record) =>
  [
    [A_QUESTION_RECORD, "a record", [WS_A, ulid(), new Date(), AN_ASKER]],
    [A_QUESTION, "a question", [WS_A, inA.id, inA.askedAt]],
    [SOME_QUESTION_FEEDBACK, "feedback", [WS_A, ulid(), inA.id, AN_ASKER, ...HELPFUL]],
  ] as const;

describe("the question record's three tables under app_rt", () => {
  it("reads no other workspace's rows, and none when unscoped", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspacesEachWithARecord(client);
      await client.query("SET LOCAL ROLE app_rt");

      expect(await rowsOfEach(client)).toEqual(eachHolding([]));

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      expect(await rowsOfEach(client)).toEqual(eachHolding([WS_B]));
    });
  });

  it("refuses a row written into another workspace", async () => {
    await withRollback(db().pool, async (client) => {
      const { inA } = await twoWorkspacesEachWithARecord(client);
      await as(client, "app_rt", WS_B);

      await refusesEach(
        client,
        aWriteOfEach(inA).map(
          ([statement, why, values]) => [statement, why, values, /row-level security/] as const,
        ),
      );

      expect(await rowsOfEach(client)).toEqual(eachHolding([WS_B]));
    });
  });

  it("changes and deletes no other workspace's rows", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspacesEachWithARecord(client);
      await as(client, "app_rt", WS_B);

      const rewritten = await client.query("UPDATE question_asked SET asked_by = $1", [AN_ASKER]);
      const cleared = await client.query("UPDATE question_feedback SET note = NULL");
      const removed = await client.query("DELETE FROM question_content");
      expect([rewritten.rowCount, cleared.rowCount, removed.rowCount]).toEqual([1, 1, 1]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const kept = await client.query("SELECT asked_by FROM question_asked");
      expect(kept.rows).not.toEqual([{ asked_by: AN_ASKER }]);
      expect(await rowsOfEach(client)).toEqual(eachHolding([WS_A]));
    });
  });

  it("refuses the api a delete of a record or feedback", async () => {
    await withRollback(db().pool, async (client) => {
      await twoWorkspacesEachWithARecord(client);
      const kept = { ...NO_PRIVILEGE, SELECT: true, INSERT: true, UPDATE: true };
      expect(await privilegesHeld(client, "app_rt", "question_asked")).toEqual(kept);
      expect(await privilegesHeld(client, "app_rt", "question_feedback")).toEqual(kept);
      expect(await privilegesHeld(client, "app_rt", "question_content")).toEqual({
        ...kept,
        DELETE: true,
      });
      await as(client, "app_rt", WS_A);

      await refusesEach(client, [
        [
          "DELETE FROM question_asked",
          "app_rt deleting a question record, which is kept permanently",
        ],
        [
          "DELETE FROM question_feedback",
          "app_rt deleting question feedback, which is kept permanently",
        ],
      ]);
    });
  });
});

describe("the question record's three tables under worker_rt", () => {
  it("refuses the worker any read or write of each", async () => {
    await withRollback(db().pool, async (client) => {
      const { inA } = await twoWorkspacesEachWithARecord(client);
      for (const table of THE_THREE) {
        expect({ table, ...(await privilegesHeld(client, "worker_rt", table)) }).toEqual({
          table,
          ...NO_PRIVILEGE,
        });
      }
      await as(client, "worker_rt", WS_A);

      await refusesEach(client, [
        ...THE_THREE.map(
          (table) => [`SELECT 1 FROM ${table} LIMIT 1`, `the worker reading ${table}`] as const,
        ),
        ...aWriteOfEach(inA),
      ]);
    });
  });
});

describe("the question record's checks", () => {
  const completedAs = (client: pg.PoolClient, values: readonly unknown[]) =>
    refusalOf(client, () =>
      client.query(A_COMPLETED_QUESTION_RECORD, [WS_A, ulid(), AN_ASKER, ...values]),
    );

  it("accepts only the four verdicts and three judge states", async () => {
    await withRollback(db().pool, async (client) => {
      const now = new Date();

      expect(await completedAs(client, [now, "related", "not-judged"])).toBe("admitted");
      expect(await completedAs(client, [now, "evidence", "not-judged"])).toBe(
        "question_asked_verdict_check",
      );
      expect(await completedAs(client, [now, "ok", "failed"])).toBe(
        "question_asked_judge_state_check",
      );
    });
  });

  it("is open, or completed with a verdict and judge state", async () => {
    await withRollback(db().pool, async (client) => {
      const halfDone = "question_asked_completion_check";

      expect(await completedAs(client, [null, null, null])).toBe("admitted");
      expect(await completedAs(client, [new Date(), null, null])).toBe(halfDone);
      expect(await completedAs(client, [null, "refuse", "not-judged"])).toBe(halfDone);
      expect(await completedAs(client, [new Date(), "refuse", null])).toBe(halfDone);
    });
  });

  it("stores its concepts and drafted sentences as JSON arrays", async () => {
    await withRollback(db().pool, async (client) => {
      const record = await testData(client).questionAsked({ workspaceId: WS_A });
      const concepts = (value: string) =>
        refusalOf(client, () =>
          client.query(
            "UPDATE question_asked SET concepts = $1 WHERE workspace_id = $2 AND id = $3",
            [value, WS_A, record.id],
          ),
        );
      const drafted = (value: string) =>
        refusalOf(client, () => client.query(A_QUESTION_WITH_A_DRAFT, [WS_A, record.id, value]));

      expect(await concepts("[]")).toBe("admitted");
      expect(await concepts("null")).toBe("question_asked_concepts_check");
      expect(await concepts("{}")).toBe("question_asked_concepts_check");
      expect(await drafted("[]")).toBe("admitted");
      expect(await drafted('"A sentence."')).toBe("question_content_drafted_check");
    });
  });

  it("accepts a listed map state only on a completed record", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = testData(client);
      const completed = await seed.questionAsked({
        workspaceId: WS_A,
        completedAt: new Date(),
        verdict: "related",
        judgeState: "not-judged",
      });
      const open = await seed.questionAsked({ workspaceId: WS_A });
      const kept = (record: Record, value: string) =>
        refusalOf(client, () =>
          client.query(
            "UPDATE question_asked SET map_state = $1 WHERE workspace_id = $2 AND id = $3",
            [value, WS_A, record.id],
          ),
        );

      const refused = "question_asked_map_state_check";
      const since = (value: string) => `{"state":"unavailable_since","since":${value}}`;

      expect(await kept(completed, '{"state":"live"}')).toBe("admitted");
      expect(await kept(completed, since('"2026-10-21T09:00:00.000Z"'))).toBe("admitted");
      expect(await kept(completed, '{"state":"stale"}')).toBe(refused);
      expect(await kept(completed, "{}")).toBe(refused);
      expect(await kept(completed, "null")).toBe(refused);
      expect(await kept(completed, '{"state":"live","since":"2026-10-21"}')).toBe(refused);
      expect(await kept(completed, since("12"))).toBe(refused);
      expect(await kept(completed, '{"state":"unavailable_since"}')).toBe(refused);
      expect(await kept(open, '{"state":"live"}')).toBe(refused);
    });
  });

  it("limits the asker's role to the three member roles", async () => {
    await withRollback(db().pool, async (client) => {
      const record = await testData(client).questionAsked({ workspaceId: WS_A });

      const refusal = await refusalOf(client, () =>
        client.query(
          "UPDATE question_asked SET predicate_role = 'Owner' WHERE workspace_id = $1 AND id = $2",
          [WS_A, record.id],
        ),
      );

      expect(refusal).toBe("question_asked_predicate_role_check");
    });
  });

  it("names its asker and its feedback's giver by actor id", async () => {
    await withRollback(db().pool, async (client) => {
      const record = await testData(client).questionAsked({ workspaceId: WS_A });
      const aPersonId = ulid();
      const anAddress = "priya@example.invalid";

      expect(
        await refusalOf(client, () =>
          client.query(A_QUESTION_RECORD, [WS_A, ulid(), new Date(), aPersonId]),
        ),
      ).toBe("question_asked_asked_by_check");
      expect(
        await refusalOf(client, () =>
          client.query(SOME_QUESTION_FEEDBACK, [WS_A, ulid(), record.id, anAddress, ...HELPFUL]),
        ),
      ).toBe("question_feedback_given_by_check");
    });
  });

  it("refuses a question or feedback for a missing record", async () => {
    await withRollback(db().pool, async (client) => {
      const noSuchRecord = ulid();

      expect(
        await refusalOf(client, () => client.query(A_QUESTION, [WS_A, noSuchRecord, new Date()])),
      ).toBe("question_content_record_fk");
      expect(
        await refusalOf(client, () =>
          client.query(SOME_QUESTION_FEEDBACK, [WS_A, ulid(), noSuchRecord, AN_ASKER, ...HELPFUL]),
        ),
      ).toBe("question_feedback_record_fk");
    });
  });
});

describe("the question feedback's checks", () => {
  const given = async (client: pg.PoolClient, recordId: string, values: readonly unknown[]) =>
    refusalOf(client, () =>
      client.query(SOME_QUESTION_FEEDBACK, [WS_A, ulid(), recordId, AN_ASKER, ...values]),
    );

  it("requires a listed reason on a flag, none on helpful", async () => {
    await withRollback(db().pool, async (client) => {
      const { id } = await testData(client).questionAsked({ workspaceId: WS_A });
      const shape = "question_feedback_flag_check";

      expect(await given(client, id, HELPFUL)).toBe("admitted");
      expect(await given(client, id, ["flag", "out-of-date", "Changed.", null, null])).toBe(
        "admitted",
      );
      expect(await given(client, id, ["unhelpful", null, null, null, null])).toBe(
        "question_feedback_verdict_check",
      );
      expect(await given(client, id, ["flag", "rude", null, null, null])).toBe(
        "question_feedback_reason_check",
      );
      expect(await given(client, id, ["flag", null, null, null, null])).toBe(shape);
      expect(await given(client, id, ["helpful", "wrong", null, null, null])).toBe(shape);
      expect(await given(client, id, ["helpful", null, "A note.", null, null])).toBe(shape);
    });
  });

  it("pairs a disputed sentence with its concept, on flags only", async () => {
    await withRollback(db().pool, async (client) => {
      const { id } = await testData(client).questionAsked({ workspaceId: WS_A });
      const shape = "question_feedback_flag_check";
      const sentence = "Audit logs are kept for a year.";

      expect(await given(client, id, ["flag", "wrong", null, sentence, A_CONCEPT])).toBe(
        "admitted",
      );
      expect(await given(client, id, ["flag", "wrong", null, sentence, null])).toBe(shape);
      expect(await given(client, id, ["helpful", null, null, sentence, A_CONCEPT])).toBe(shape);
    });
  });

  it("keeps a flag's concept after an erasure clears its sentence", async () => {
    await withRollback(db().pool, async (client) => {
      const { id } = await testData(client).questionAsked({ workspaceId: WS_A });

      expect(await given(client, id, ["flag", "wrong", null, null, A_CONCEPT])).toBe("admitted");
      expect(await given(client, id, ["helpful", null, null, null, A_CONCEPT])).toBe(
        "question_feedback_flag_check",
      );
    });
  });

  it("closes only a flag, with a listed outcome and time", async () => {
    await withRollback(db().pool, async (client) => {
      const { id } = await testData(client).questionAsked({ workspaceId: WS_A });
      const closed = async (values: readonly unknown[]) =>
        refusalOf(client, () =>
          client.query(A_CLOSED_QUESTION_FEEDBACK, [WS_A, ulid(), id, AN_ASKER, ...values]),
        );
      const shape = "question_feedback_closed_check";
      const at = new Date();

      expect(await closed(["flag", "wrong", "fixed-in-the-knowledge", at])).toBe("admitted");
      expect(await closed(["flag", "wrong", "no-fault-in-the-knowledge", at])).toBe("admitted");
      expect(await closed(["flag", "wrong", null, null])).toBe("admitted");
      expect(await closed(["helpful", null, "no-fault-in-the-knowledge", at])).toBe(shape);
      expect(await closed(["flag", "wrong", "fixed", at])).toBe(shape);
      expect(await closed(["flag", "wrong", "fixed-in-the-knowledge", null])).toBe(shape);
      expect(await closed(["flag", "wrong", null, at])).toBe(shape);
    });
  });
});

describe("a monthly partition of question_content", () => {
  it("exists for the migration's month and the next", async () => {
    const made = (await contentPartitions(db().pool)).map((partition) => partition.name);

    expect(made).toEqual([contentPartitionOf(inTheMonth(0)), contentPartitionOf(inTheMonth(1))]);
  });

  it("refuses a question in a month with no partition", async () => {
    await withRollback(db().pool, async (client) => {
      const record = await aRecordInAMonthNotMade(client);

      await expect(client.query(A_QUESTION, [WS_A, record.id, record.askedAt])).rejects.toThrow(
        /no partition of relation "question_content" found for row/,
      );
    });
  });

  it("stores a question once the api creates its month's partition", async () => {
    await withRollback(db().pool, async (client) => {
      const record = await aRecordInAMonthNotMade(client);

      await client.query(MAKE_THE_MONTH, [inTheMonth(2, 19)]);
      await client.query(A_QUESTION, [WS_A, record.id, record.askedAt]);

      const stored = await client.query("SELECT record_id, question FROM question_content");
      expect(stored.rows).toEqual([
        { record_id: record.id, question: "How long are audit logs kept?" },
      ]);
    });
  });

  it("is created once, however often its month is requested", async () => {
    await withRollback(db().pool, async (client) => {
      const before = (await contentPartitions(client)).map((partition) => partition.name);
      await client.query("SET LOCAL ROLE app_rt");

      for (const day of [1, 28, 1]) {
        await client.query(MAKE_THE_MONTH, [inTheMonth(2, day)]);
      }

      const made = (await contentPartitions(client)).map((partition) => partition.name);
      expect(made).toEqual([...before, ITS_PARTITION]);
    });
  });

  it("is created by the api role and no other", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query("SET LOCAL ROLE worker_rt");

      await expect(client.query(MAKE_THE_MONTH, [A_MONTH_NOT_MADE])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("is created only for the months a sweep asks for", async () => {
    await withRollback(db().pool, async (client) => {
      const before = await contentPartitions(client);
      await client.query("SET LOCAL ROLE app_rt");

      await refusesEach(
        client,
        [inTheMonth(3), inTheMonth(-2), new Date("2099-01-01T00:00:00.000Z")].map(
          (month) =>
            [
              MAKE_THE_MONTH,
              `app_rt making the month ${month.toISOString()}, too far from now for a sweep`,
              [month],
              /is not a month a sweep makes/,
            ] as const,
        ),
      );

      await client.query(MAKE_THE_MONTH, [inTheMonth(-1)]);
      expect(await contentPartitions(client)).toHaveLength(before.length + 1);
    });
  });

  it("is created once when two sessions ask at once", async () => {
    const month = inTheMonth(-1);
    const first = await db().pool.connect();
    const second = await db().pool.connect();
    try {
      await first.query("BEGIN");
      await first.query(MAKE_THE_MONTH, [month]);
      const asked = second.query(MAKE_THE_MONTH, [month]).then(
        () => "made",
        (cause: unknown) => String(cause),
      );
      await untilASessionWaits();
      await first.query("COMMIT");

      expect(await asked).toBe("made");
      const made = (await contentPartitions(db().pool)).map((partition) => partition.name);
      expect(made.filter((name) => name === contentPartitionOf(month))).toHaveLength(1);
    } finally {
      first.release();
      second.release();
      await db().pool.query(`DROP TABLE IF EXISTS "${contentPartitionOf(month)}"`);
    }
  });

  it("is reached through the parent, never by its own name", async () => {
    await withRollback(db().pool, async (client) => {
      const seed = testData(client);
      await seed.questionContent({ workspaceId: WS_A });
      const [current] = await contentPartitions(client);
      assert(current !== undefined, "the seed made no partition for this month");
      await as(client, "app_rt", WS_A);

      const throughTheParent = await client.query("SELECT workspace_id FROM question_content");
      expect(throughTheParent.rows).toEqual([{ workspace_id: WS_A }]);
      await refusesEach(client, [
        [
          `SELECT 1 FROM "${current.name}"`,
          "app_rt reading a partition directly, which has no policy to scope the read",
        ],
        [
          `DELETE FROM "${current.name}"`,
          "app_rt deleting from a partition directly, which has no policy to scope the write",
        ],
      ]);
    });
  });

  it("has forced row security and no runtime grants per partition", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query(MAKE_THE_MONTH, [A_MONTH_NOT_MADE]);

      const partitions = await contentPartitions(client);
      expect(partitions).toHaveLength(3);
      for (const { name, rls, forced } of partitions) {
        const policies = await client.query(
          "SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = $1",
          [name],
        );
        expect({
          name,
          rls,
          forced,
          policies: policies.rowCount,
          api: await privilegesHeld(client, "app_rt", name),
          worker: await privilegesHeld(client, "worker_rt", name),
        }).toEqual({
          name,
          rls: true,
          forced: true,
          policies: 0,
          api: NO_PRIVILEGE,
          worker: NO_PRIVILEGE,
        });
      }
    });
  });
});
