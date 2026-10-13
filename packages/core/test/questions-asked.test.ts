import { describe, expect, it } from "vitest";

import { boundarySchemas, conceptIriOf, ulid } from "@better-answers/schema";
import { contentPartitionOf, contentPartitions, inTheMonth } from "@better-answers/schema/testing";

import { completeRecord, openRecord } from "../src/answering/index.ts";
import type { Trust } from "../src/concepts/index.ts";
import { actorIdOfPerson, type Result, type UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { makeQuestionMonths } from "../src/sweeps/index.ts";
import { provisionedWorkspace } from "./platform.ts";
import { answered, postgresForSuite, readingAs, seedingWith } from "./suite-postgres.ts";
import { principalFor } from "./workspace-with-bundle.ts";

const db = postgresForSuite();

const QUESTION = "How long are audit logs kept?";

const VERIFIED_BY_PRIYA: Trust = {
  tier: "human-reviewed",
  status: "current",
  verifiedBy: "Priya Anand",
  verifiedAt: "2026-05-02T09:00:00.000Z",
  rider: null,
};

const UNVERIFIED: Trust = {
  tier: "unverified",
  status: "draft",
  verifiedBy: null,
  verifiedAt: null,
  rider: "imported",
};

const HASH_OF = { retention: "a".repeat(64), backups: "b".repeat(64) } as const;

const anAsker = async (): Promise<UserPrincipal> => {
  const workspace = await provisionedWorkspace(db(), "Acme");
  return principalFor(db(), workspace.workspaceId, workspace.adminUserId);
};

/** As `app_rt`, under the asker's scope: the grants and the policy are part of what is stored. */
const opening = (
  asker: UserPrincipal,
  askedAt: Date = new Date(),
): Promise<Result<{ readonly recordId: string }, unknown>> =>
  readingAs(db().runtimePool, asker, (principal, tx) =>
    openRecord(principal, tx, {
      question: QUESTION,
      collections: ["audits"],
      transport: "mcp",
      askedAt,
    }),
  );

type Completion = Omit<Parameters<typeof completeRecord>[2], "recordId" | "completedAt">;

const completing = (
  asker: UserPrincipal,
  recordId: string,
  completion: Completion,
  completedAt: Date = new Date(),
) =>
  readingAs(db().runtimePool, asker, (principal, tx) =>
    completeRecord(principal, tx, { recordId, completedAt, ...completion }),
  );

const REFUSED: Completion = {
  verdict: "refuse",
  judgeState: "not-judged",
  concepts: [],
  unmappedPassages: [],
};

const skeletonOf = async (recordId: string) => {
  const read = await db().pool.query(
    `SELECT workspace_id, asked_at, asked_by, transport, collections, predicate_role,
            predicate_groups, completed_at, verdict, judge_state, concepts, unmapped_passages
       FROM question_asked WHERE id = $1`,
    [recordId],
  );
  return read.rows;
};

const contentOf = async (recordId: string) => {
  const read = await db().pool.query(
    "SELECT asked_at, question, drafted FROM question_content WHERE record_id = $1",
    [recordId],
  );
  return read.rows;
};

describe("opening a record", () => {
  it("reads back with its id, its skeleton and its content", async () => {
    const asker = await anAsker();
    const askedAt = new Date();

    const { recordId } = answered(await opening(asker, askedAt));

    expect(boundarySchemas.questionAsked.select.shape.id.safeParse(recordId).success).toBe(true);
    expect(await skeletonOf(recordId)).toEqual([
      {
        workspace_id: asker.workspaceId,
        asked_at: askedAt,
        asked_by: actorIdOfPerson(asker.userId),
        transport: "mcp",
        collections: ["audits"],
        predicate_role: "Admin",
        predicate_groups: [],
        completed_at: null,
        verdict: null,
        judge_state: null,
        concepts: [],
        unmapped_passages: [],
      },
    ]);
    expect(await contentOf(recordId)).toEqual([
      { asked_at: askedAt, question: QUESTION, drafted: null },
    ]);
  });

  it("records the groups the asker read under", async () => {
    const asker = await anAsker();
    const group = await seedingWith(db().pool, (seed) =>
      seed.group({ workspaceId: asker.workspaceId }),
    );
    await seedingWith(db().pool, (seed) =>
      seed.groupMember({
        workspaceId: asker.workspaceId,
        groupId: group.id,
        userId: asker.userId,
      }),
    );
    const inTheGroup = await principalFor(db(), asker.workspaceId, asker.userId);

    const { recordId } = answered(await opening(inTheGroup));

    expect(await skeletonOf(recordId)).toEqual([
      expect.objectContaining({ predicate_role: "Admin", predicate_groups: [group.id] }),
    ]);
  });

  it("is refused in a month no sweep has made", async () => {
    const asker = await anAsker();

    const opened = await opening(asker, new Date("2032-07-01T00:00:00.000Z"));

    expect(opened).toEqual({
      ok: false,
      error: expect.objectContaining({
        message: expect.stringContaining('no partition of relation "question_content"'),
      }),
    });
  });

  /** The sweep's clock is stopped at `sweptAt`, and the question is asked at `askedAt`. */
  const askedAfterASweep = async (sweptAt: Date, askedAt: Date) => {
    const asker = await anAsker();
    answered(await makeQuestionMonths(openPostgres(db().runtimePool), { now: sweptAt }));
    const { recordId } = answered(await opening(asker, askedAt));
    return contentOf(recordId);
  };

  it("is stored on the first day of a swept month", async () => {
    const theMonthBefore = inTheMonth(1, 27);
    const firstOfTheMonth = inTheMonth(2);

    const stored = await askedAfterASweep(theMonthBefore, firstOfTheMonth);

    expect(stored).toEqual([{ asked_at: firstOfTheMonth, question: QUESTION, drafted: null }]);
  });

  it("is stored in a month a restore left unmade", async () => {
    const now = new Date();
    await db().pool.query(`DROP TABLE "${contentPartitionOf(now)}"`);

    const stored = await askedAfterASweep(now, now);

    expect(stored).toEqual([{ asked_at: now, question: QUESTION, drafted: null }]);
  });

  it("is made a month once, however many sweeps pass", async () => {
    const door = openPostgres(db().runtimePool);
    const days = [26, 27, 28].map((day) => inTheMonth(1, day));

    const passes = [];
    for (const now of days) passes.push(await makeQuestionMonths(door, { now }));

    expect(passes).toEqual(days.map(() => ({ ok: true, value: undefined })));
    const made = (await contentPartitions(db().pool)).map((partition) => partition.name);
    expect(made).toEqual([0, 1, 2].map((monthsOn) => contentPartitionOf(inTheMonth(monthsOn))));
  });
});

describe("completing a record", () => {
  it("keeps the verdict, each concept and each drafted sentence", async () => {
    const asker = await anAsker();
    const [retention, backups] = [conceptIriOf(ulid()), conceptIriOf(ulid())];
    const { recordId } = answered(await opening(asker));
    const completedAt = new Date();

    const completed = await completing(
      asker,
      recordId,
      {
        verdict: "related",
        judgeState: "judged",
        concepts: [
          {
            iri: retention,
            contentHash: HASH_OF.retention,
            trust: VERIFIED_BY_PRIYA,
            judged: "no",
          },
          { iri: backups, contentHash: HASH_OF.backups, trust: UNVERIFIED },
        ],
        unmappedPassages: [],
        drafted: [{ sentence: "Audit logs are kept for a year.", concepts: [retention] }],
      },
      completedAt,
    );

    expect(completed).toEqual({ ok: true, value: undefined });
    expect(await skeletonOf(recordId)).toEqual([
      expect.objectContaining({
        completed_at: completedAt,
        verdict: "related",
        judge_state: "judged",
        concepts: [
          {
            iri: retention,
            contentHash: HASH_OF.retention,
            trust: {
              tier: "human-reviewed",
              status: "current",
              verifiedAt: VERIFIED_BY_PRIYA.verifiedAt,
              rider: null,
            },
            judged: "no",
          },
          {
            iri: backups,
            contentHash: HASH_OF.backups,
            trust: { tier: "unverified", status: "draft", verifiedAt: null, rider: "imported" },
          },
        ],
      }),
    ]);
    expect(await contentOf(recordId)).toEqual([
      expect.objectContaining({
        question: QUESTION,
        drafted: [{ sentence: "Audit logs are kept for a year.", concepts: [retention] }],
      }),
    ]);
  });

  it("keeps an unmapped passage's locator and none of its text", async () => {
    const asker = await anAsker();
    const { recordId } = answered(await opening(asker));
    const shown = {
      locator: `${ulid()}/chars:120-480`,
      source: "Security handbook",
      text: "Audit logs are retained for twelve months in the primary region.",
      sensitivity: "Internal",
    };

    answered(await completing(asker, recordId, { ...REFUSED, unmappedPassages: [shown] }));

    const [skeleton] = await skeletonOf(recordId);
    expect(skeleton).toEqual(expect.objectContaining({ unmapped_passages: [shown.locator] }));
    const kept = JSON.stringify([skeleton, await contentOf(recordId)]);
    expect([shown.text, shown.source].filter((words) => kept.includes(words))).toEqual([]);
  });

  it("keeps its row and citations once a concept goes", async () => {
    const asker = await anAsker();
    const { workspaceId } = asker;
    const [gone, staying] = await seedingWith(db().pool, async (seed) => [
      await seed.conceptIndex({ workspaceId }),
      await seed.conceptIndex({ workspaceId }),
    ]);
    const cited = [gone, staying].map(({ iri, contentHash }) => ({
      iri,
      contentHash,
      trust: UNVERIFIED,
    }));
    const { recordId } = answered(await opening(asker));
    answered(
      await completing(asker, recordId, { ...REFUSED, verdict: "related", concepts: cited }),
    );

    for (const table of ["concept_index", "concept_identity"]) {
      await db().pool.query(`DELETE FROM ${table} WHERE workspace_id = $1 AND iri = $2`, [
        workspaceId,
        gone.iri,
      ]);
    }

    const [skeleton] = await skeletonOf(recordId);
    const kept: unknown = skeleton?.concepts;
    expect(kept).toEqual([
      expect.objectContaining({ iri: gone.iri }),
      expect.objectContaining({ iri: staying.iri }),
    ]);
  });

  it("answers an error for a record already completed", async () => {
    const asker = await anAsker();
    const { recordId } = answered(await opening(asker));
    answered(await completing(asker, recordId, REFUSED));

    const again = await completing(asker, recordId, { ...REFUSED, verdict: "ok" });

    expect(again).toEqual({ ok: false, error: expect.any(Error) });
    expect(await skeletonOf(recordId)).toEqual([expect.objectContaining({ verdict: "refuse" })]);
  });
});
