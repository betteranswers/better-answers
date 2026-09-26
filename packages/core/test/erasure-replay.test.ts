import { describe, expect, it } from "vitest";

import { closeObjects, openObjects } from "@better-answers/core/store/objects";

import {
  ERASURE,
  replayableErasures,
  replayCopiesSince,
  replayErasures,
  runErasure,
  type ReplayedErasure,
} from "../src/erasure/index.ts";
import { erasureDoorsFor } from "./erasure-doors.ts";
import { auditEventRowsOf } from "./sourced-concept.ts";
import { objectStoreForSuite } from "./suite-objects.ts";
import { addressOf, seedingWith } from "./suite-postgres.ts";
import { memberOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const objects = objectStoreForSuite();

const BEHIND_THE_WINDOW = new Date("2026-06-01T00:00:00.000Z");
const NOTHING_AFTER = new Date("2026-06-02T00:00:00.000Z");

const FROM_THE_ROWS_SINCE = new Date("2026-06-03T00:00:00.000Z");
const FROM_THE_ROWS_AT = new Date("2026-06-04T00:00:00.000Z");

const IN_ORDER_SINCE = new Date("2026-06-05T00:00:00.000Z");
const IN_ORDER_FIRST_AT = new Date("2026-06-06T00:00:00.000Z");
const IN_ORDER_SECOND_AT = new Date("2026-06-07T00:00:00.000Z");

const IN_BOTH_SINCE = new Date("2026-06-08T00:00:00.000Z");
const IN_BOTH_AT = new Date("2026-06-09T00:00:00.000Z");

const FROM_THE_COPY_SINCE = new Date("2026-06-10T00:00:00.000Z");
const FROM_THE_COPY_AT = new Date("2026-06-11T00:00:00.000Z");

const NO_LOGIN_SINCE = new Date("2026-06-12T00:00:00.000Z");
const NO_LOGIN_AT = new Date("2026-06-13T00:00:00.000Z");

const UNREACHABLE_SINCE = new Date("2026-06-14T00:00:00.000Z");
const UNREACHABLE_AT = new Date("2026-06-15T00:00:00.000Z");

const TWICE_SINCE = new Date("2026-06-16T00:00:00.000Z");
const TWICE_AT = new Date("2026-06-17T00:00:00.000Z");

const STOPS_SINCE = new Date("2026-06-18T00:00:00.000Z");
const STOPS_AT = new Date("2026-06-19T00:00:00.000Z");
const AFTER_THE_STOP_AT = new Date("2026-06-20T00:00:00.000Z");

const BY_ADDRESS_SINCE = new Date("2026-06-21T00:00:00.000Z");
const BY_ADDRESS_AT = new Date("2026-06-22T00:00:00.000Z");

const INDEX_RESTORED_SINCE = new Date("2026-06-23T00:00:00.000Z");
const INDEX_RESTORED_AT = new Date("2026-06-24T00:00:00.000Z");

const ERASURE_ACTOR = "process:better-answers-erasure";

const REPLAYED = "platform.erasure.replayed";

const FIRST_ID = "01K0000000000000000000000A";
const SECOND_ID = "01K0000000000000000000000B";

const doorsFor = (scenario: Scenario, at: Date) => erasureDoorsFor(scenario, objects().door, at);

type Erased = {
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  readonly pseudonym: string;
  readonly email: string;
};

type Subject = {
  readonly name: string;
  readonly other: readonly string[];
  readonly holdsALogin: boolean;
};

const A_MEMBER: Subject = { name: "Priya Anand", other: [], holdsALogin: true };
const NEVER_SIGNED_IN: Subject = {
  name: "Sam Okafor",
  other: ["contractor 4471"],
  holdsALogin: false,
};

const completedInTheRows = async (
  workspaceId: string,
  completedAt: Date,
  named?: { readonly subject?: Subject; readonly erasureRequestId?: string },
): Promise<Erased> => {
  const subject = named?.subject ?? A_MEMBER;
  const email = addressOf(subject.name.slice(0, subject.name.indexOf(" ")).toLowerCase());
  return seedingWith(db().pool, async (seed) => {
    const person = subject.holdsALogin ? await seed.user({ name: subject.name, email }) : undefined;
    const request = await seed.subjectRequest({
      workspaceId,
      kind: "erasure",

      personId: person?.id ?? null,
      identifiers: { emails: [email], names: [subject.name], other: [...subject.other] },
    });
    const erasure = await seed.erasureRequest({
      workspaceId,
      ...(named?.erasureRequestId === undefined ? {} : { id: named.erasureRequestId }),
      subjectRequestId: request.id,
      anchoredAt: completedAt,
      completedAt,
      report: "the first run's report, as the dump carries it",
    });
    return {
      subjectRequestId: request.id,
      erasureRequestId: erasure.id,
      pseudonym: erasure.pseudonym,
      email,
    };
  });
};

const replaying = async (
  scenario: Scenario,
  at: Date,
  since: Date,
): Promise<readonly ReplayedErasure[]> => {
  const replayed = await replayErasures(ERASURE, doorsFor(scenario, at), { since });
  if (!replayed.ok) throw new Error(`the replay refused: ${String(replayed.error)}`);
  return replayed.value;
};

const leavingAReplayCopy = async (scenario: Scenario, erased: Erased, at: Date): Promise<void> => {
  const run = await runErasure(ERASURE, doorsFor(scenario, at), {
    workspaceId: scenario.workspaceId,
    subjectRequestId: erased.subjectRequestId,
  });
  if (!run.ok) throw new Error(`the arrangement's routine refused: ${String(run.error)}`);
};

const asIfTheDumpPredatedIt = async (workspaceId: string, erased: Erased): Promise<void> => {
  await db().pool.query("DELETE FROM subject_request WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    erased.subjectRequestId,
  ]);
};

const erasureRowsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{
    id: string;
    subject_request_id: string;
    pseudonym: string;
    anchored_at: Date;
    completed_at: Date | null;
    report: string | null;
  }>(
    `SELECT id, subject_request_id, pseudonym, anchored_at, completed_at, report
       FROM erasure_request WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  return read.rows;
};

const subjectRowsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{
    id: string;
    person_id: string | null;
    identifiers: unknown;
    kind: string;
    received_at: Date;
    clock_started_at: Date;
    due_at: Date;
    answered_at: Date | null;
  }>(
    `SELECT id, person_id, identifiers, kind, received_at, clock_started_at, due_at, answered_at
       FROM subject_request WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  return read.rows;
};

const idsFor = (
  set: readonly { readonly workspaceId: string; readonly erasureRequestId: string }[],
  workspaceId: string,
): readonly string[] =>
  set.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.erasureRequestId);

describe("the set of erasures a restore must replay", () => {
  it("names and replays none when every completion predates the window", async () => {
    const scenario = await arrange();
    await completedInTheRows(scenario.workspaceId, BEHIND_THE_WINDOW);

    const set = await replayableErasures(ERASURE, doorsFor(scenario, NOTHING_AFTER), {
      since: NOTHING_AFTER,
    });
    const replayed = await replayErasures(ERASURE, doorsFor(scenario, NOTHING_AFTER), {
      since: NOTHING_AFTER,
    });

    if (!set.ok) throw new Error(`the set refused: ${String(set.error)}`);
    expect(idsFor(set.value, scenario.workspaceId)).toEqual([]);
    expect(replayed).toEqual({ ok: true, value: [] });

    expect(await auditEventRowsOf(db().pool, scenario.workspaceId, REPLAYED)).toEqual([]);
  });

  it("replays one the restored rows hold under the platform actor", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, FROM_THE_ROWS_AT);

    const replayed = await replaying(scenario, FROM_THE_ROWS_AT, FROM_THE_ROWS_SINCE);

    expect(replayed).toEqual([
      {
        workspaceId: scenario.workspaceId,
        subjectRequestId: erased.subjectRequestId,
        erasureRequestId: erased.erasureRequestId,

        completedAt: FROM_THE_ROWS_AT,

        fromReplayCopy: false,
        auditEventId: replayed[0]?.auditEventId ?? "",
      },
    ]);

    const auditEvents = await auditEventRowsOf(db().pool, scenario.workspaceId, REPLAYED);
    expect(auditEvents).toEqual([
      {
        id: replayed[0]?.auditEventId,
        actor: ERASURE_ACTOR,
        subject_id: erased.erasureRequestId,
        detail: {
          erasureRequestId: erased.erasureRequestId,
          subjectRequestId: erased.subjectRequestId,
          fromReplayCopy: false,
        },
      },
    ]);
  });

  it("answers oldest completion first, then by id on a tie", async () => {
    const scenario = await arrange();

    await completedInTheRows(scenario.workspaceId, IN_ORDER_SECOND_AT);
    await completedInTheRows(scenario.workspaceId, IN_ORDER_FIRST_AT, {
      erasureRequestId: SECOND_ID,
    });
    await completedInTheRows(scenario.workspaceId, IN_ORDER_FIRST_AT, {
      erasureRequestId: FIRST_ID,
    });

    const set = await replayableErasures(ERASURE, doorsFor(scenario, IN_ORDER_SECOND_AT), {
      since: IN_ORDER_SINCE,
    });

    if (!set.ok) throw new Error(`the set refused: ${String(set.error)}`);
    const named = idsFor(set.value, scenario.workspaceId);
    expect(named.slice(0, 2)).toEqual([FIRST_ID, SECOND_ID]);
    expect(named).toHaveLength(3);
  });

  it("counts once a request both the rows and copies name", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, IN_BOTH_AT);
    await leavingAReplayCopy(scenario, erased, IN_BOTH_AT);

    const copies = await replayCopiesSince(ERASURE, objects().door, IN_BOTH_SINCE);
    const set = await replayableErasures(ERASURE, doorsFor(scenario, IN_BOTH_AT), {
      since: IN_BOTH_SINCE,
    });

    if (!copies.ok) throw new Error(`the copies refused: ${String(copies.error)}`);
    if (!set.ok) throw new Error(`the set refused: ${String(set.error)}`);

    expect(idsFor(copies.value, scenario.workspaceId)).toEqual([erased.erasureRequestId]);
    expect(idsFor(set.value, scenario.workspaceId)).toEqual([erased.erasureRequestId]);
  });
});

describe("a request whose rows the dump predates", () => {
  it("is re-created from the copy with its own pseudonym", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, FROM_THE_COPY_AT);
    await leavingAReplayCopy(scenario, erased, FROM_THE_COPY_AT);
    await asIfTheDumpPredatedIt(scenario.workspaceId, erased);
    expect(await erasureRowsIn(scenario.workspaceId)).toEqual([]);

    const replayed = await replaying(scenario, FROM_THE_COPY_AT, FROM_THE_COPY_SINCE);

    expect(replayed.map((one) => one.erasureRequestId)).toEqual([erased.erasureRequestId]);
    expect(replayed[0]?.fromReplayCopy).toBe(true);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row).toMatchObject({
      id: erased.erasureRequestId,
      subject_request_id: erased.subjectRequestId,
      pseudonym: erased.pseudonym,
    });
    expect(row?.completed_at).not.toBeNull();
    const [subject] = await subjectRowsIn(scenario.workspaceId);
    expect(subject).toMatchObject({ id: erased.subjectRequestId, kind: "erasure" });
    expect(subject?.identifiers).toEqual({
      emails: [erased.email],
      names: ["Priya Anand"],
      other: [],
    });

    expect(subject).toMatchObject({ answered_at: null, received_at: FROM_THE_COPY_AT });
  });

  it("is re-created with no person id for a never-signed-in subject", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, NO_LOGIN_AT, {
      subject: NEVER_SIGNED_IN,
    });
    await leavingAReplayCopy(scenario, erased, NO_LOGIN_AT);
    await asIfTheDumpPredatedIt(scenario.workspaceId, erased);

    const replayed = await replaying(scenario, NO_LOGIN_AT, NO_LOGIN_SINCE);

    expect(replayed.map((one) => one.erasureRequestId)).toEqual([erased.erasureRequestId]);
    const [subject] = await subjectRowsIn(scenario.workspaceId);

    expect(subject?.person_id).toBeNull();
    expect(subject?.identifiers).toEqual({
      emails: [erased.email],
      names: ["Sam Okafor"],
      other: ["contractor 4471"],
    });
    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row?.pseudonym).toEqual(erased.pseudonym);
  });
});

describe("an object store a restore cannot read", () => {
  it("refuses rather than answering that no erasure is owed", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, UNREACHABLE_AT);
    await leavingAReplayCopy(scenario, erased, UNREACHABLE_AT);

    const unreachable = openObjects({
      endpoint: "http://127.0.0.1:1",
      region: "garage",
      bucket: "better-answers",
      accessKeyId: "unreachable",
      secretAccessKey: "unreachable",
    });
    if (!unreachable.ok) throw new Error(`the door refused its settings: ${unreachable.error}`);

    try {
      const copies = await replayCopiesSince(ERASURE, unreachable.value, UNREACHABLE_SINCE);
      const replayed = await replayErasures(
        ERASURE,
        erasureDoorsFor(scenario, unreachable.value, UNREACHABLE_AT),
        { since: UNREACHABLE_SINCE },
      );

      expect(copies.ok).toBe(false);
      expect(replayed.ok).toBe(false);

      expect(await auditEventRowsOf(db().pool, scenario.workspaceId, REPLAYED)).toEqual([]);
    } finally {
      closeObjects(unreachable.value);
    }

    const found = await replayCopiesSince(ERASURE, objects().door, UNREACHABLE_SINCE);
    if (!found.ok) throw new Error(`the copies refused: ${String(found.error)}`);
    expect(idsFor(found.value, scenario.workspaceId)).toEqual([erased.erasureRequestId]);
  });
});

describe("a second replay of the same request", () => {
  it("changes nothing but the audit log", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, TWICE_AT);

    const first = await replaying(scenario, TWICE_AT, TWICE_SINCE);
    const after = await erasureRowsIn(scenario.workspaceId);
    const subjects = await subjectRowsIn(scenario.workspaceId);
    const second = await replaying(scenario, TWICE_AT, TWICE_SINCE);

    expect(second.map((one) => one.erasureRequestId)).toEqual([erased.erasureRequestId]);

    expect(await erasureRowsIn(scenario.workspaceId)).toEqual(after);

    expect(await subjectRowsIn(scenario.workspaceId)).toEqual(subjects);
    const auditEvents = await auditEventRowsOf(db().pool, scenario.workspaceId, REPLAYED);

    expect(auditEvents.map((row) => row.subject_id)).toEqual([
      erased.erasureRequestId,
      erased.erasureRequestId,
    ]);
    expect(auditEvents.map((row) => row.id)).toEqual([
      first[0]?.auditEventId,
      second[0]?.auditEventId,
    ]);
  });
});

describe("a request whose routine will not run", () => {
  it("stops the replay there, not carrying on to those behind", async () => {
    const scenario = await arrange();

    const stranded = await seedingWith(db().pool, (seed) => seed.workspace());
    const first = await completedInTheRows(stranded.id, STOPS_AT);
    const second = await completedInTheRows(scenario.workspaceId, AFTER_THE_STOP_AT);

    const replayed = await replayErasures(ERASURE, doorsFor(scenario, AFTER_THE_STOP_AT), {
      since: STOPS_SINCE,
    });

    expect(replayed.ok).toBe(false);

    if (replayed.ok) throw new Error("the replay did not stop");
    expect(String(replayed.error)).toContain(first.erasureRequestId);
    expect(String(replayed.error)).toContain("after replaying 0");

    expect(String(replayed.error)).toContain("not a git repository");

    expect(await auditEventRowsOf(db().pool, scenario.workspaceId, REPLAYED)).toEqual([]);
    expect(await auditEventRowsOf(db().pool, stranded.id, REPLAYED)).toEqual([]);
    expect(second.erasureRequestId).not.toEqual(first.erasureRequestId);
  });
});

describe("the replay copy for a request named by address alone", () => {
  it("carries the person the map found, not the request's null", async () => {
    const scenario = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);
    const seeded = await seedingWith(db().pool, (seed) =>
      seed.subjectRequest({
        workspaceId: scenario.workspaceId,
        kind: "erasure",

        personId: null,
        identifiers: { emails: [email], names: ["Priya Anand"], other: [] },
      }),
    );

    const run = await runErasure(ERASURE, doorsFor(scenario, BY_ADDRESS_AT), {
      workspaceId: scenario.workspaceId,
      subjectRequestId: seeded.id,
    });
    if (!run.ok) throw new Error(`the routine refused: ${String(run.error)}`);

    const copies = await replayCopiesSince(ERASURE, objects().door, BY_ADDRESS_SINCE);
    if (!copies.ok) throw new Error(`the copies did not read back: ${String(copies.error)}`);
    expect(
      copies.value
        .filter((copy) => copy.workspaceId === scenario.workspaceId)
        .map((copy) => copy.personId),
    ).toEqual([person.id]);
  });
});

type IndexedBinding = {
  readonly id: string;
  readonly documentId: string;
  readonly content: string;
};

const aBindingIndexing = (workspaceId: string, content: string): Promise<IndexedBinding> =>
  seedingWith(db().pool, async (seed) => {
    const binding = await seed.sourceBinding({ workspaceId });
    const document = await seed.sourceDocument({ workspaceId, bindingId: binding.id });
    return { id: binding.id, documentId: document.id, content };
  });

const theIndexRestored = (workspaceId: string, bindings: readonly IndexedBinding[]) =>
  seedingWith(db().pool, async (seed) => {
    for (const binding of bindings) {
      await seed.chunk({
        workspaceId,
        bindingId: binding.id,
        sourceDocumentId: binding.documentId,
        content: binding.content,
        locator: `${binding.documentId}/chars:0-${binding.content.length}`,
        ordinal: 0,
        charStart: 0,
        charEnd: binding.content.length,
      });
    }
  });

const asIfRestoredFromADumpOlderThanIt = async (
  workspaceId: string,
  erased: Erased,
  bindings: readonly IndexedBinding[],
): Promise<void> => {
  await asIfTheDumpPredatedIt(workspaceId, erased);
  await db().pool.query("DELETE FROM job WHERE workspace_id = $1", [workspaceId]);
  await theIndexRestored(workspaceId, bindings);
};

const whatTheReplayLeft = async (workspaceId: string) => ({
  suppressions: (
    await db().pool.query<{ erasure_request_id: string; identifiers: unknown }>(
      "SELECT erasure_request_id, identifiers FROM suppression WHERE workspace_id = $1",
      [workspaceId],
    )
  ).rows,
  indexed: (
    await db().pool.query<{ binding_id: string }>(
      `SELECT binding_id FROM "index".chunk WHERE workspace_id = $1 ORDER BY binding_id`,
      [workspaceId],
    )
  ).rows.map((row) => row.binding_id),
  queued: (
    await db().pool.query<{ kind: string; subject_id: string | null; reason: string | null }>(
      "SELECT kind, subject_id, reason FROM job WHERE workspace_id = $1 AND status = 'queued' ORDER BY kind",
      [workspaceId],
    )
  ).rows,
});

describe("a restore from a dump older than the request", () => {
  it("re-creates the suppression, wiping only the binding naming the subject", async () => {
    const scenario = await arrange();
    const workspaceId = scenario.workspaceId;
    const naming = await aBindingIndexing(
      workspaceId,
      "Expense claims go to Priya Anand for approval.",
    );
    const beside = await aBindingIndexing(workspaceId, "Expenses are claimed within thirty days.");
    await theIndexRestored(workspaceId, [naming, beside]);
    const erased = await completedInTheRows(workspaceId, INDEX_RESTORED_AT);
    await leavingAReplayCopy(scenario, erased, INDEX_RESTORED_AT);
    // The chunk beside it was never wiped, so the restore brings back the one the wipe took.
    await asIfRestoredFromADumpOlderThanIt(workspaceId, erased, [naming]);
    const restored = await whatTheReplayLeft(workspaceId);

    const replayed = await replaying(scenario, INDEX_RESTORED_AT, INDEX_RESTORED_SINCE);

    expect(restored).toEqual({
      suppressions: [],
      indexed: [naming.id, beside.id].sort(),
      queued: [],
    });
    expect(replayed.map((one) => [one.erasureRequestId, one.fromReplayCopy])).toEqual([
      [erased.erasureRequestId, true],
    ]);
    expect(await whatTheReplayLeft(workspaceId)).toEqual({
      suppressions: [
        {
          erasure_request_id: erased.erasureRequestId,
          identifiers: { emails: [erased.email], names: ["Priya Anand"], other: [] },
        },
      ],
      indexed: [beside.id],
      queued: [
        { kind: "full-rebuild", subject_id: null, reason: "erasure" },
        { kind: "index", subject_id: naming.id, reason: "wiped" },
      ],
    });
  });
});
