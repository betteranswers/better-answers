import { describe, expect, it } from "vitest";

import {
  boundarySchemas,
  conceptIriOf,
  ulid,
  type ConceptIri,
  type FlagClosing,
} from "@better-answers/schema";
import { contentPartitionOf, contentPartitions, inTheMonth } from "@better-answers/schema/testing";

import {
  closeFlag,
  completeRecord,
  openRecord,
  questionsAskedInput,
  readQuestionsAsked,
  readYourQuestions,
  readYourRecord,
  yourQuestionsInput,
  type QuestionsAskedInput,
  type YourQuestionsInput,
} from "../src/answering/index.ts";
import type { Trust } from "../src/concepts/index.ts";
import { actorIdOfPerson, type Result, type UserPrincipal } from "../src/kernel/index.ts";
import { changeRole, changeRoleInput } from "../src/members/index.ts";
import { openPostgres } from "../src/store/postgres/index.ts";
import { makeQuestionMonths } from "../src/sweeps/index.ts";
import { heldAs } from "./members-suite.ts";
import { provisionedWorkspace } from "./platform.ts";
import { askedAMicrosecondFiner } from "./question-rows.ts";
import { inputOf } from "./suite-input.ts";
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

const A_CONCEPT = conceptIriOf(ulid());

const HASH_OF = { retention: "a".repeat(64), backups: "b".repeat(64) } as const;

const anAsker = async (): Promise<UserPrincipal> => {
  const workspace = await provisionedWorkspace(db(), "Acme");
  return principalFor(db(), workspace.workspaceId, workspace.adminUserId);
};

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
  map: { state: "live" },
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
        map: { state: "live" },
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

  it("keeps a draft for a record asked at microsecond precision", async () => {
    const asker = await anAsker();
    const { recordId } = answered(await opening(asker));
    await askedAMicrosecondFiner(db().pool, recordId);
    const drafted = [{ sentence: "Audit logs are kept for a year.", concepts: [A_CONCEPT] }];

    answered(await completing(asker, recordId, { ...REFUSED, verdict: "related", drafted }));

    expect(await contentOf(recordId)).toEqual([expect.objectContaining({ drafted })]);
  });

  it("leaves drafted null when the platform drafts nothing", async () => {
    const asker = await anAsker();
    const { recordId } = answered(await opening(asker));

    answered(await completing(asker, recordId, REFUSED));

    expect(await contentOf(recordId)).toEqual([expect.objectContaining({ drafted: null })]);
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

const KEPT_TRUST = { tier: "unverified", status: "current", verifiedAt: null, rider: null };

const asked = (
  reader: UserPrincipal,
  input: Partial<QuestionsAskedInput> = {},
  now: Date = new Date(),
) =>
  readingAs(db().runtimePool, reader, (principal, tx) =>
    readQuestionsAsked(principal, tx, questionsAskedInput.parse(input), now),
  );

const yours = (
  reader: UserPrincipal,
  input: Partial<YourQuestionsInput> = {},
  now: Date = new Date(),
) =>
  readingAs(db().runtimePool, reader, (principal, tx) =>
    readYourQuestions(principal, tx, yourQuestionsInput.parse(input), now),
  );

const yourRecord = (reader: UserPrincipal, id: string) =>
  readingAs(db().runtimePool, reader, (principal, tx) =>
    readYourRecord(principal, tx, { id }, new Date()),
  );

const closing = (closer: UserPrincipal, feedbackId: string, closedAs: FlagClosing) =>
  readingAs(db().runtimePool, closer, (principal, tx) =>
    closeFlag(principal, tx, { feedbackId, closedAs }, new Date()),
  );

type Seeded = { readonly iri: ConceptIri; readonly contentHash: string };

type RecordShape = {
  readonly by?: UserPrincipal;
  readonly askedAt?: Date;
  readonly verdict?: "related" | "refuse";
  readonly answers?: readonly Seeded[];
  readonly rejected?: readonly Seeded[];
  readonly cited?: readonly Seeded[];
  readonly drafted?: readonly { sentence: string; concepts: readonly Seeded[] }[];
};

const keptAs =
  (judged?: "yes" | "no") =>
  ({ iri, contentHash }: Seeded) => {
    const kept = { iri, contentHash, trust: KEPT_TRUST };
    return judged === undefined ? kept : { ...kept, judged };
  };

const draftedOf = (drafted: RecordShape["drafted"]) =>
  drafted?.map(({ sentence, concepts }) => ({
    sentence,
    concepts: concepts.map(({ iri }) => iri),
  }));

const aRecord = (admin: UserPrincipal, { by: asker = admin, ...shape }: RecordShape = {}) =>
  seedingWith(db().pool, async (seed) => {
    const record = await seed.questionAsked({
      workspaceId: admin.workspaceId,
      askedAt: shape.askedAt ?? new Date(),
      askedBy: actorIdOfPerson(asker.userId),
      predicateRole: asker.role,
      completedAt: new Date(),
      verdict: shape.verdict ?? "related",
      judgeState: "not-judged",
      concepts: [
        ...(shape.answers ?? []).map(keptAs("yes")),
        ...(shape.rejected ?? []).map(keptAs("no")),
        ...(shape.cited ?? []).map(keptAs()),
      ],
    });
    await seed.questionContent({
      workspaceId: admin.workspaceId,
      recordId: record.id,
      askedAt: record.askedAt,
      question: QUESTION,
      drafted: draftedOf(shape.drafted) ?? null,
    });
    return record;
  });

const aFlagOn = (
  admin: UserPrincipal,
  recordId: string,
  disputed?: { readonly sentence: string; readonly concept: Seeded },
) =>
  seedingWith(db().pool, (seed) =>
    seed.questionFeedback({
      workspaceId: admin.workspaceId,
      recordId,
      givenBy: actorIdOfPerson(admin.userId),
      verdict: "flag",
      reason: "wrong",
      disputedSentence: disputed?.sentence ?? null,
      disputedConcept: disputed?.concept.iri ?? null,
    }),
  );

const aConceptIn = (admin: UserPrincipal, collection: string) =>
  seedingWith(db().pool, (seed) =>
    seed.conceptIndex({
      workspaceId: admin.workspaceId,
      path: `knowledge/${collection}/${ulid().toLowerCase()}.md`,
    }),
  );

const aConceptNarrowedIn = (admin: UserPrincipal, collection: string) =>
  seedingWith(db().pool, async (seed) => {
    const group = await seed.group({ workspaceId: admin.workspaceId });
    return seed.conceptIndex({
      workspaceId: admin.workspaceId,
      path: `knowledge/${collection}/${ulid().toLowerCase()}.md`,
      audience: "groups",
      audienceGroups: [group.id],
    });
  });

const STALE_AFTER = "2026-06-01";

const BEFORE_STALE = new Date("2026-05-01T12:00:00Z");

const AFTER_STALE = new Date("2026-07-01T12:00:00Z");

const aConceptStaleAfter = (admin: UserPrincipal, day: string) =>
  seedingWith(db().pool, (seed) =>
    seed.conceptIndex({
      workspaceId: admin.workspaceId,
      frontmatter: { title: "Expenses", type: "Policy", stale_after: day },
    }),
  );

type RecordsRead = (
  reader: UserPrincipal,
  now: Date,
) => Promise<readonly { readonly concepts: readonly { readonly trustWords: string }[] }[]>;

const staleWordsOf = async (read: RecordsRead) => {
  const admin = await anAsker();
  await aRecord(admin, { cited: [await aConceptStaleAfter(admin, STALE_AFTER)] });
  const wordsAt = async (now: Date) => (await read(admin, now))[0]?.concepts[0]?.trustWords;
  return [await wordsAt(BEFORE_STALE), await wordsAt(AFTER_STALE)];
};

const aMemberOf = async (admin: UserPrincipal, role: "Editor" | "Viewer") => {
  const member = await seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: admin.workspaceId, role }),
  );
  return principalFor(db(), admin.workspaceId, member.userId);
};

const pagesOfOne = async (admin: UserPrincipal) => {
  const first = answered(await asked(admin, { limit: 1 }));
  const next = answered(await asked(admin, { limit: 1, cursor: first.nextCursor ?? undefined }));
  return [first, next];
};

const anOpenFlag = async () => {
  const admin = await anAsker();
  const record = await aRecord(admin);
  const flag = await aFlagOn(admin, record.id);
  return { admin, record, flag };
};

const closingOf = async (feedbackId: string) => {
  const read = await db().pool.query(
    "SELECT closed_as, closed_at IS NOT NULL AS stamped FROM question_feedback WHERE id = $1",
    [feedbackId],
  );
  return read.rows;
};

const eventsOn = async (feedbackId: string) => {
  const read = await db().pool.query(
    "SELECT action, actor, subject_kind, detail FROM audit_event WHERE subject_id = $1",
    [feedbackId],
  );
  return read.rows;
};

describe("reading the questions asked", () => {
  it.each(["Editor", "Viewer"] as const)("refuses an %s the read", async (role) => {
    const admin = await anAsker();
    await aRecord(admin);

    expect(await asked(await aMemberOf(admin, role))).toEqual({ ok: false, error: "role-forbids" });
  });

  it("puts a flagged record before an unflagged newer one", async () => {
    const admin = await anAsker();
    const flagged = await aRecord(admin, { askedAt: new Date(Date.now() - 60_000) });
    const newer = await aRecord(admin);
    await aFlagOn(admin, flagged.id);

    const { records } = answered(await asked(admin));

    expect(records.map((record) => [record.id, record.flagged])).toEqual([
      [flagged.id, true],
      [newer.id, false],
    ]);
  });

  it("names the next page only when another follows", async () => {
    const admin = await anAsker();
    const older = await aRecord(admin, { askedAt: new Date(Date.now() - 60_000) });
    const newer = await aRecord(admin);

    const pages = await pagesOfOne(admin);

    expect(pages.map((page) => [page.records.map(({ id }) => id), page.nextCursor])).toEqual([
      [[newer.id], { id: newer.id, flagged: false }],
      [[older.id], null],
    ]);
  });

  it("pages from the last flagged record into the unflagged", async () => {
    const admin = await anAsker();
    const unflagged = await aRecord(admin);
    const flagged = await aRecord(admin, { askedAt: new Date(Date.now() - 60_000) });
    await aFlagOn(admin, flagged.id);

    const pages = await pagesOfOne(admin);

    expect(pages.map((page) => page.records.map(({ id }) => id))).toEqual([
      [flagged.id],
      [unflagged.id],
    ]);
  });

  it("keeps its place when the cut record's flag closes", async () => {
    const admin = await anAsker();
    const [earlier, later] = [
      await aRecord(admin, { askedAt: new Date(Date.now() - 60_000) }),
      await aRecord(admin),
    ];
    await aFlagOn(admin, earlier.id);
    const laterFlag = await aFlagOn(admin, later.id);
    const first = answered(await asked(admin, { limit: 1 }));
    answered(await closing(admin, laterFlag.id, "no-fault-in-the-knowledge"));

    const next = answered(await asked(admin, { limit: 1, cursor: first.nextCursor ?? undefined }));

    expect([first, next].map((page) => page.records.map(({ id }) => id))).toEqual([
      [later.id],
      [earlier.id],
    ]);
  });

  it("shows a record as asked, with its asker and question", async () => {
    const admin = await anAsker();
    const cited = await aConceptIn(admin, "audits");
    const record = await aRecord(admin, { cited: [cited] });

    const { records } = answered(await asked(admin));

    expect(records).toEqual([
      {
        id: record.id,
        askedAt: record.askedAt.toISOString(),
        askedBy: expect.objectContaining({ kind: "person" }),
        transport: "mcp",
        collectionsNamed: [],
        question: QUESTION,
        verdict: "related",
        judgeState: "not-judged",
        map: { state: "unknown" },
        flagged: false,
        concepts: [
          {
            iri: cited.iri,
            kind: "Policy",
            title: "Expenses",
            collection: "audits",
            trustWords: "Unverified",
          },
        ],
        drafted: null,
        feedback: [],
      },
    ]);
  });

  it("reads the map's state the record kept", async () => {
    const admin = await anAsker();
    const { recordId } = answered(await opening(admin));
    const map = { state: "unavailable_since", since: "2026-10-21T09:00:00.000Z" } as const;
    answered(await completing(admin, recordId, { ...REFUSED, map }));

    const { records } = answered(await asked(admin));

    expect(records.map((record) => record.map)).toEqual([map]);
  });

  it("reads a record kept before the map's state as unknown", async () => {
    const admin = await anAsker();
    await aRecord(admin);

    const { records } = answered(await asked(admin));

    expect(records.map((record) => record.map)).toEqual([{ state: "unknown" }]);
  });

  it("words trust at the moment the Admin's read is given", async () => {
    const read = async (reader: UserPrincipal, now: Date) =>
      answered(await asked(reader, {}, now)).records;

    expect(await staleWordsOf(read)).toEqual(["Unverified", "Out of date"]);
  });

  it("leaves out an unreadable concept, with no hint", async () => {
    const admin = await anAsker();
    const readable = await aConceptIn(admin, "audits");
    const narrowed = await aConceptNarrowedIn(admin, "board");
    await aRecord(admin, {
      cited: [narrowed, readable],
      drafted: [
        { sentence: "The board meets monthly.", concepts: [narrowed] },
        { sentence: "Audit logs are kept for a year.", concepts: [readable] },
        { sentence: "Both say so.", concepts: [readable, narrowed] },
      ],
    });

    const [record] = answered(await asked(admin)).records;

    expect(record?.concepts.map(({ iri }) => iri)).toEqual([readable.iri]);
    expect(record?.drafted).toEqual([
      { sentence: "Audit logs are kept for a year.", concepts: [readable.iri] },
    ]);
    expect(JSON.stringify(record)).not.toContain(narrowed.iri);
  });

  it("shows a flag without its sentence on an unreadable concept", async () => {
    const admin = await anAsker();
    const narrowed = await aConceptNarrowedIn(admin, "board");
    const record = await aRecord(admin, { cited: [narrowed] });
    const flag = await aFlagOn(admin, record.id, {
      sentence: "The board meets monthly.",
      concept: narrowed,
    });

    const [read] = answered(await asked(admin)).records;

    expect(read?.feedback).toEqual([
      {
        id: flag.id,
        givenAt: flag.givenAt.toISOString(),
        verdict: "flag",
        reason: "wrong",
        note: null,
        closedAs: null,
        closedAt: null,
      },
    ]);
  });
});

const idsOf = async (reader: UserPrincipal, input: Partial<YourQuestionsInput> = {}) =>
  answered(await yours(reader, input)).records.map(({ id }) => id);

describe("reading your questions", () => {
  it("shows each member only the questions they asked", async () => {
    const admin = await anAsker();
    const [editor, viewer] = [await aMemberOf(admin, "Editor"), await aMemberOf(admin, "Viewer")];
    const editors = await aRecord(admin, { by: editor });
    const viewers = await aRecord(admin, { by: viewer });

    expect([await idsOf(editor), await idsOf(viewer)]).toEqual([[editors.id], [viewers.id]]);
  });

  it("lists newest first, with a cursor only when more follow", async () => {
    const admin = await anAsker();
    const older = await aRecord(admin, { askedAt: new Date(Date.now() - 60_000) });
    const newer = await aRecord(admin);

    const first = answered(await yours(admin, { limit: 1 }));
    const next = answered(await yours(admin, { limit: 1, cursor: first.nextCursor ?? undefined }));

    expect(
      [first, next].map((page) => [page.records.map(({ id }) => id), page.nextCursor]),
    ).toEqual([
      [[newer.id], newer.id],
      [[older.id], null],
    ]);
  });

  it("pages nothing from a cursor at another person's record", async () => {
    const admin = await anAsker();
    const editor = await aMemberOf(admin, "Editor");
    await aRecord(admin, { by: editor, askedAt: new Date(Date.now() - 60_000) });
    const theirs = await aRecord(admin);

    expect(await idsOf(editor, { cursor: theirs.id })).toEqual([]);
  });

  it("reads another person's record as not found", async () => {
    const admin = await anAsker();
    const editor = await aMemberOf(admin, "Editor");
    const record = await aRecord(admin, { by: editor });

    const [own, other] = [await yourRecord(editor, record.id), await yourRecord(admin, record.id)];

    expect(own).toMatchObject({ ok: true, value: { id: record.id } });
    expect(other).toEqual({ ok: false, error: "not-found" });
  });

  it("leaves out an Answer the reader can no longer read", async () => {
    const admin = await anAsker();
    const narrowed = await aConceptNarrowedIn(admin, "board");
    const readable = await aConceptIn(admin, "audits");
    const record = await aRecord(admin, { answers: [narrowed], cited: [readable] });

    const read = answered(await yourRecord(admin, record.id));

    expect(read.concepts.map(({ iri }) => iri)).toEqual([readable.iri]);
    expect(JSON.stringify(read)).not.toContain(narrowed.iri);
  });

  it("drops a sentence citing an unreadable concept, keeping its neighbours", async () => {
    const admin = await anAsker();
    const readable = await aConceptIn(admin, "audits");
    const narrowed = await aConceptNarrowedIn(admin, "board");
    const record = await aRecord(admin, {
      cited: [readable, narrowed],
      drafted: [
        { sentence: "Audit logs are kept for a year.", concepts: [readable] },
        { sentence: "The board meets monthly.", concepts: [narrowed] },
        { sentence: "Each audit is filed.", concepts: [readable] },
      ],
    });

    const read = answered(await yourRecord(admin, record.id));

    expect(read.drafted?.map(({ sentence }) => sentence)).toEqual([
      "Audit logs are kept for a year.",
      "Each audit is filed.",
    ]);
  });

  it("still lists a member's questions after their role changes", async () => {
    const workspace = await provisionedWorkspace(db(), "Acme");
    const admin = await principalFor(db(), workspace.workspaceId, workspace.adminUserId);
    const editor = await aMemberOf(admin, "Editor");
    const record = await aRecord(admin, { by: editor });
    answered(
      await heldAs(workspace, workspace.adminUserId, (principal, tx) =>
        changeRole(principal, tx, {
          ...inputOf(changeRoleInput, { personId: editor.userId, role: "Viewer" }),
          at: new Date(),
        }),
      ),
    );

    expect(await idsOf(editor)).toEqual([record.id]);
  });

  it("words trust at the moment the reader's read is given", async () => {
    const read = async (reader: UserPrincipal, now: Date) =>
      answered(await yours(reader, {}, now)).records;

    expect(await staleWordsOf(read)).toEqual(["Unverified", "Out of date"]);
  });

  it("carries the words of a concept the judge passed alone", async () => {
    const admin = await anAsker();
    const [answer, rejected, related] = [
      await aConceptIn(admin, "audits"),
      await aConceptIn(admin, "audits"),
      await aConceptIn(admin, "audits"),
    ];
    const record = await aRecord(admin, {
      answers: [answer],
      rejected: [rejected],
      cited: [related],
    });

    const { concepts } = answered(await yourRecord(admin, record.id));

    expect(concepts.map((concept) => [concept.iri, "body" in concept])).toEqual([
      [answer.iri, true],
      [rejected.iri, false],
      [related.iri, false],
    ]);
    expect(concepts[0]?.body).toBe("Expenses are claimed within thirty days.");
  });
});

describe("closing a flag", () => {
  it("stores no fault, audits it once, and unflags the record", async () => {
    const { admin, record, flag } = await anOpenFlag();

    const closed = await closing(admin, flag.id, "no-fault-in-the-knowledge");

    expect(closed).toEqual({
      ok: true,
      value: { feedbackId: flag.id, recordId: record.id, closedAs: "no-fault-in-the-knowledge" },
    });
    expect(await closingOf(flag.id)).toEqual([
      { closed_as: "no-fault-in-the-knowledge", stamped: true },
    ]);
    expect(await eventsOn(flag.id)).toEqual([
      {
        action: "knowledge.feedback.closed",
        actor: actorIdOfPerson(admin.userId),
        subject_kind: "feedback",
        detail: { recordId: record.id, closedAs: "no-fault-in-the-knowledge" },
      },
    ]);
    const [read] = answered(await asked(admin)).records;
    expect(read?.flagged).toBe(false);
  });

  it("stores fixed in the knowledge as its outcome", async () => {
    const { admin, flag } = await anOpenFlag();

    answered(await closing(admin, flag.id, "fixed-in-the-knowledge"));

    expect(await closingOf(flag.id)).toEqual([
      { closed_as: "fixed-in-the-knowledge", stamped: true },
    ]);
  });

  it("refuses a flag already closed, changing nothing", async () => {
    const { admin, flag } = await anOpenFlag();
    answered(await closing(admin, flag.id, "fixed-in-the-knowledge"));

    const again = await closing(admin, flag.id, "no-fault-in-the-knowledge");

    expect(again).toEqual({ ok: false, error: "already-decided" });
    expect(await closingOf(flag.id)).toEqual([
      { closed_as: "fixed-in-the-knowledge", stamped: true },
    ]);
    expect(await eventsOn(flag.id)).toHaveLength(1);
  });

  it("answers not-found for helpful feedback and an unknown id", async () => {
    const admin = await anAsker();
    const record = await aRecord(admin);
    const helpful = await seedingWith(db().pool, (seed) =>
      seed.questionFeedback({ workspaceId: admin.workspaceId, recordId: record.id }),
    );

    const refused = [
      await closing(admin, helpful.id, "fixed-in-the-knowledge"),
      await closing(admin, ulid(), "fixed-in-the-knowledge"),
    ];

    expect(refused).toEqual([
      { ok: false, error: "not-found" },
      { ok: false, error: "not-found" },
    ]);
  });

  it.each(["Editor", "Viewer"] as const)("refuses an %s the closing", async (role) => {
    const { admin, flag } = await anOpenFlag();

    const refused = await closing(await aMemberOf(admin, role), flag.id, "fixed-in-the-knowledge");

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await closingOf(flag.id)).toEqual([{ closed_as: null, stamped: false }]);
  });
});
