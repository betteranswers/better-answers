import { setTimeout as sleep } from "node:timers/promises";

import type pg from "pg";
import { describe, expect, it } from "vitest";

import { ulid } from "../src/index.ts";
import { type TestData, testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { postgresForSuite, privilegesHeld, refusalOf, refusesEach } from "./probes.ts";
import { contentPartitionOf, contentPartitions, inTheMonth } from "./question-months.ts";
import {
  A_COMPLETED_QUESTION_RECORD,
  A_QUESTION,
  A_QUESTION_RECORD,
  A_QUESTION_WITH_A_DRAFT,
  SOME_QUESTION_FEEDBACK,
} from "./rls-probes.ts";

const db = postgresForSuite();

const WS_A = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const THE_THREE = ["question_asked", "question_content", "question_feedback"] as const;

/** The month after the two the migration made: the furthest a sweep ever asks for. */
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

/** A record asked in a month with no partition, read as the api in its workspace. */
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

/** Resolves once some session of this database waits on a lock. */
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

/** One write of each table into workspace A, for a role or a scope that may not make it. */
const aWriteOfEach = (inA: Record) =>
  [
    [A_QUESTION_RECORD, "a record", [WS_A, ulid(), new Date(), AN_ASKER]],
    [A_QUESTION, "a question", [WS_A, inA.id, inA.askedAt]],
    [SOME_QUESTION_FEEDBACK, "feedback", [WS_A, ulid(), inA.id, AN_ASKER, ...HELPFUL]],
  ] as const;

describe("the record's three tables under app_rt", () => {
  it("reads no row of another workspace, and none unscoped", async () => {
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

  it("changes and removes none of another workspace's rows", async () => {
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

  it("keeps a record and its feedback from the api's delete", async () => {
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
        ["DELETE FROM question_asked", "a record's skeleton is kept for good"],
        ["DELETE FROM question_feedback", "and so is the feedback it received"],
      ]);
    });
  });
});

describe("the record's three tables under worker_rt", () => {
  it("refuses the worker a read or a write of each", async () => {
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
          (table) => [`SELECT 1 FROM ${table} LIMIT 1`, `a read of ${table}`] as const,
        ),
        ...aWriteOfEach(inA),
      ]);
    });
  });
});

describe("what a record refuses", () => {
  const completedAs = (client: pg.PoolClient, values: readonly unknown[]) =>
    refusalOf(client, () =>
      client.query(A_COMPLETED_QUESTION_RECORD, [WS_A, ulid(), AN_ASKER, ...values]),
    );

  it("takes the four verdicts and the three judge states only", async () => {
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

  it("is open with no verdict, or completed with both", async () => {
    await withRollback(db().pool, async (client) => {
      const halfDone = "question_asked_completion_check";

      expect(await completedAs(client, [null, null, null])).toBe("admitted");
      expect(await completedAs(client, [new Date(), null, null])).toBe(halfDone);
      expect(await completedAs(client, [null, "refuse", "not-judged"])).toBe(halfDone);
      expect(await completedAs(client, [new Date(), "refuse", null])).toBe(halfDone);
    });
  });

  it("holds its concepts and its drafted sentences as lists", async () => {
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

  it("takes the asker's role from the three a member holds", async () => {
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

  it("holds a question and feedback to a record that exists", async () => {
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

describe("what feedback refuses", () => {
  const given = async (client: pg.PoolClient, recordId: string, values: readonly unknown[]) =>
    refusalOf(client, () =>
      client.query(SOME_QUESTION_FEEDBACK, [WS_A, ulid(), recordId, AN_ASKER, ...values]),
    );

  it("takes a flag with a listed reason, helpful with none", async () => {
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

  it("pairs a disputed sentence with its concept, on a flag", async () => {
    await withRollback(db().pool, async (client) => {
      const { id } = await testData(client).questionAsked({ workspaceId: WS_A });
      const shape = "question_feedback_flag_check";
      const sentence = "Audit logs are kept for a year.";

      expect(await given(client, id, ["flag", "wrong", null, sentence, A_CONCEPT])).toBe(
        "admitted",
      );
      expect(await given(client, id, ["flag", "wrong", null, sentence, null])).toBe(shape);
      expect(await given(client, id, ["flag", "wrong", null, null, A_CONCEPT])).toBe(shape);
      expect(await given(client, id, ["helpful", null, null, sentence, A_CONCEPT])).toBe(shape);
    });
  });
});

describe("a month's partition of the content", () => {
  it("stands for the journal's month and the next", async () => {
    const made = (await contentPartitions(db().pool)).map((partition) => partition.name);

    expect(made).toEqual([contentPartitionOf(inTheMonth(0)), contentPartitionOf(inTheMonth(1))]);
  });

  it("refuses a question whose month has no partition", async () => {
    await withRollback(db().pool, async (client) => {
      const record = await aRecordInAMonthNotMade(client);

      // A request never makes its own partition, so the row has nowhere to go.
      await expect(client.query(A_QUESTION, [WS_A, record.id, record.askedAt])).rejects.toThrow(
        /no partition of relation "question_content" found for row/,
      );
    });
  });

  it("stores a question once the api has made its month", async () => {
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

  it("is made once, however often its month is asked for", async () => {
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

  it("is made by the api's role and no other", async () => {
    await withRollback(db().pool, async (client) => {
      await client.query("SET LOCAL ROLE worker_rt");

      await expect(client.query(MAKE_THE_MONTH, [A_MONTH_NOT_MADE])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("is made only for the months a sweep asks for", async () => {
    await withRollback(db().pool, async (client) => {
      const before = await contentPartitions(client);
      await client.query("SET LOCAL ROLE app_rt");

      await refusesEach(
        client,
        [inTheMonth(3), inTheMonth(-2), new Date("2099-01-01T00:00:00.000Z")].map(
          (month) =>
            [
              MAKE_THE_MONTH,
              `no workspace scopes a month, so ${month.toISOString()} is refused by its distance`,
              [month],
              /is not a month a sweep makes/,
            ] as const,
        ),
      );

      await client.query(MAKE_THE_MONTH, [inTheMonth(-1)]);
      expect(await contentPartitions(client)).toHaveLength(before.length + 1);
    });
  });

  it("is made once by two sessions asking at once", async () => {
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
      await as(client, "app_rt", WS_A);

      const throughTheParent = await client.query("SELECT workspace_id FROM question_content");
      expect(throughTheParent.rows).toEqual([{ workspace_id: WS_A }]);
      await refusesEach(client, [
        [`SELECT 1 FROM "${current?.name ?? ""}"`, "a partition carries no policy to scope a read"],
        [`DELETE FROM "${current?.name ?? ""}"`, "nor a write"],
      ]);
    });
  });

  // `every tenant table` in rls.test.ts reads the declared parent alone; no partition is declared,
  // so this is what holds each one.
  it("is forced and granted to no runtime role, each one", async () => {
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
