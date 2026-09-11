import { ulid } from "@better-answers/schema";
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
import { ledgerRowsOf } from "./sourced-concept.ts";
import { objectStoreForSuite } from "./suite-objects.ts";
import { seedingWith } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * **The replay's reading half** (ADR 0022; the S0 spec, *The two ops commands*): what
 * `replay-erasures --since` has to know before it can run anything — which erasures completed
 * after the dump the estate has just restored, read from the restored rows **and** from the
 * replay copies in a store the dump is not part of, and the re-creation of a request whose
 * rows the dump predates.
 *
 * Four sentences this suite is here to hold.
 *
 * A request is found **whichever of the two holds it**, and a request both hold is one
 * request: the union is de-duplicated by erasure request id and ordered by completion so a
 * command's lines are the same lines on every run.
 *
 * A restore from a dump older than the request re-creates the pair from the copy **with the
 * copy's own pseudonym**, so the routine that runs next finds the id this workspace's history
 * was already rewritten to. A second pseudonym would leave one person with two names for one
 * erasure and a history rewritten twice.
 *
 * An object store that cannot be listed is an **error**, never an empty set: an estate whose
 * copies are unreachable knows nothing about the erasures owed, and answering *none* would let
 * `api` turn healthy over every one of them.
 *
 * And a second replay of the same request **changes nothing but the ledger**, which is the
 * idempotence the whole of ADR 0022's replay rests on.
 */

const { db, arrange } = suiteWithBundles();

/**
 * A real Garage, because the copies this reads are objects under the platform's own prefix and
 * `[TEST3]` refuses a stand-in for a store as it refuses one for Postgres: what a restore has
 * to do is list a bucket it has just synced back and read what it finds there.
 */
const objects = objectStoreForSuite();

/**
 * **The suite's one timeline.** Every test shares one Postgres, and the union this reads is the
 * *platform's* — every workspace's rows, because a replay is the estate's act and not one
 * tenant's. So a test that asserted on the whole union would be asserting on the rows its
 * neighbours seeded.
 *
 * The instants below are what makes each test's window its own: they run forward in declaration
 * order, and each test's `since` is later than every completion the tests before it left behind.
 * A leftover from an earlier test is therefore behind the window rather than inside it, which is
 * exactly what `--since` is for. Literals throughout (`[TEST9]`), never a reading of the clock.
 */
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

/** The one actor every act of a replay is booked to (`[AUDIT4]`, the platform's own id). */
const ERASURE_ACTOR = "process:better-answers-erasure";

/** The act a replayed erasure writes, spelled out here rather than read off the module. */
const REPLAYED = "platform.erasure.replayed";

/**
 * Two ids written down rather than minted, so the tie-break the union promises — completion
 * first, then id — is assertable at all. Crockford's base32, as `ULID` requires.
 */
const FIRST_ID = "01K0000000000000000000000A";
const SECOND_ID = "01K0000000000000000000000B";

/**
 * A fresh address per arrangement, because `user.email` is unique and this suite seeds a
 * subject a dozen times over one Postgres.
 */
const addressOf = (person: string): string => `${person}-${ulid().toLowerCase()}@example.invalid`;

/** The doors a replay takes, with its clock pinned to a literal instant (ADR 0040). */
const doorsFor = (scenario: Scenario, at: Date) => ({
  git: scenario.git,
  postgres: scenario.postgres,
  objects: objects().door,
  clock: { now: () => at },
});

/** What an arrangement hands back: the two ids the replay is keyed by, and the first run's id. */
type Erased = {
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  readonly pseudonym: string;
  readonly email: string;
};

/**
 * Who one seeded erasure is about. The two the spec names: a member, who holds a login and a
 * person id, and a person the company's files name who never signed in and is named by the
 * identifier set alone (`CONTEXT.md`, *subject request*).
 */
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

/**
 * One erasure the restored **rows** hold: the pair of rows a dump taken after the request
 * carries, seeded through the factory (`[TEST4]`) rather than by running the routine, because
 * what this arranges is a dump's contents and not a run.
 */
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
      // `null` is a whole answer here and not an absence: the subject who never signed in.
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

/** The replay as the command reaches it; a refusal here is the arrangement failing, not the answer. */
const replaying = async (
  scenario: Scenario,
  at: Date,
  since: Date,
): Promise<readonly ReplayedErasure[]> => {
  const replayed = await replayErasures(ERASURE, doorsFor(scenario, at), { since });
  if (!replayed.ok) throw new Error(`the replay refused: ${String(replayed.error)}`);
  return replayed.value;
};

/**
 * The routine run once for real, so the store holds the copy it writes. The rows are already
 * completed when it runs, so the copy carries that completion and not this run's clock — which
 * is what makes every instant in this suite a literal.
 */
const leavingAReplayCopy = async (scenario: Scenario, erased: Erased, at: Date): Promise<void> => {
  const run = await runErasure(ERASURE, doorsFor(scenario, at), {
    workspaceId: scenario.workspaceId,
    subjectRequestId: erased.subjectRequestId,
  });
  if (!run.ok) throw new Error(`the arrangement's routine refused: ${String(run.error)}`);
};

/**
 * The dump taken **before** the request: the subject request goes and the erasure request with
 * it (the key cascades), so the only trace of the erasure left in the estate is the copy.
 */
const asIfTheDumpPredatedIt = async (workspaceId: string, erased: Erased): Promise<void> => {
  await db().pool.query("DELETE FROM subject_request WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    erased.subjectRequestId,
  ]);
};

/** The erasure request rows this workspace holds, as the superuser, oldest id first. */
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

/** The subject request rows this workspace holds, as the superuser. */
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

/** The ids the union names in this workspace, in the order it answered them. */
const idsFor = (
  set: readonly { readonly workspaceId: string; readonly erasureRequestId: string }[],
  workspaceId: string,
): readonly string[] =>
  set.filter((entry) => entry.workspaceId === workspaceId).map((entry) => entry.erasureRequestId);

describe("the set of erasures a restore must replay", () => {
  it("names none when every completion is behind the window, and the replay answers nothing", async () => {
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
    // Nothing ran, so nothing is on the ledger: a replay of nothing is not an act.
    expect(await ledgerRowsOf(db().pool, scenario.workspaceId, REPLAYED)).toEqual([]);
  });

  it("names one the restored rows hold, and runs it under the platform's own actor", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, FROM_THE_ROWS_AT);

    const replayed = await replaying(scenario, FROM_THE_ROWS_AT, FROM_THE_ROWS_SINCE);

    expect(replayed).toEqual([
      {
        workspaceId: scenario.workspaceId,
        subjectRequestId: erased.subjectRequestId,
        erasureRequestId: erased.erasureRequestId,
        // The completion the dump carried, which a replay never moves.
        completedAt: FROM_THE_ROWS_AT,
        // The rows carried it, so nothing was re-created from a copy.
        fromReplayCopy: false,
        auditEventId: replayed[0]?.auditEventId ?? "",
      },
    ]);
    const ledger = await ledgerRowsOf(db().pool, scenario.workspaceId, REPLAYED);
    expect(ledger).toEqual([
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

  it("answers oldest completion first, and by id where two completed at one instant", async () => {
    const scenario = await arrange();
    // The later completion is seeded first, so the order below is the union's and not the
    // order the rows happen to have been written in.
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

  it("counts a request the rows and the copies both name once", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, IN_BOTH_AT);
    await leavingAReplayCopy(scenario, erased, IN_BOTH_AT);

    const copies = await replayCopiesSince(ERASURE, objects().door, IN_BOTH_SINCE);
    const set = await replayableErasures(ERASURE, doorsFor(scenario, IN_BOTH_AT), {
      since: IN_BOTH_SINCE,
    });

    if (!copies.ok) throw new Error(`the copies refused: ${String(copies.error)}`);
    if (!set.ok) throw new Error(`the set refused: ${String(set.error)}`);
    // Both halves name it — the store's copy and the restored row — and the union names it once.
    expect(idsFor(copies.value, scenario.workspaceId)).toEqual([erased.erasureRequestId]);
    expect(idsFor(set.value, scenario.workspaceId)).toEqual([erased.erasureRequestId]);
  });
});

describe("a request whose rows the dump predates", () => {
  it("is re-created from the copy alone, with the copy's own pseudonym", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, FROM_THE_COPY_AT);
    await leavingAReplayCopy(scenario, erased, FROM_THE_COPY_AT);
    await asIfTheDumpPredatedIt(scenario.workspaceId, erased);
    expect(await erasureRowsIn(scenario.workspaceId)).toEqual([]);

    const replayed = await replaying(scenario, FROM_THE_COPY_AT, FROM_THE_COPY_SINCE);

    expect(replayed.map((one) => one.erasureRequestId)).toEqual([erased.erasureRequestId]);
    expect(replayed[0]?.fromReplayCopy).toBe(true);
    // The pair is back, keyed as the copy names it and carrying the pseudonym this workspace's
    // history was already rewritten to — a second one would be a second name for one person.
    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row?.id).toEqual(erased.erasureRequestId);
    expect(row?.subject_request_id).toEqual(erased.subjectRequestId);
    expect(row?.pseudonym).toEqual(erased.pseudonym);
    expect(row?.completed_at).not.toBeNull();
    const [subject] = await subjectRowsIn(scenario.workspaceId);
    expect(subject?.id).toEqual(erased.subjectRequestId);
    expect(subject?.kind).toEqual("erasure");
    expect(subject?.identifiers).toEqual({
      emails: [erased.email],
      names: ["Priya Anand"],
      other: [],
    });
    // The request is open again rather than answered: the routine completes it, and the clock
    // the dump carried is gone with the row, so the copy's own completion is what dates it.
    expect(subject?.answered_at).toBeNull();
    expect(subject?.received_at).toEqual(FROM_THE_COPY_AT);
  });

  it("re-creates a request for a subject who never signed in with no person id", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, NO_LOGIN_AT, {
      subject: NEVER_SIGNED_IN,
    });
    await leavingAReplayCopy(scenario, erased, NO_LOGIN_AT);
    await asIfTheDumpPredatedIt(scenario.workspaceId, erased);

    const replayed = await replaying(scenario, NO_LOGIN_AT, NO_LOGIN_SINCE);

    expect(replayed.map((one) => one.erasureRequestId)).toEqual([erased.erasureRequestId]);
    const [subject] = await subjectRowsIn(scenario.workspaceId);
    // The copy leaves the person id out where the subject holds none, so the row it re-creates
    // names nobody either — and the identifier set is the whole of who the request is about.
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
    // A door onto a store nothing is listening at: the estate's bucket has not been synced back
    // yet, or the store is down, and either way the copies cannot be listed.
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
        { ...doorsFor(scenario, UNREACHABLE_AT), objects: unreachable.value },
        { since: UNREACHABLE_SINCE },
      );

      expect(copies.ok).toBe(false);
      expect(replayed.ok).toBe(false);
      // Nothing ran: a store that cannot be listed stops the restore before the first routine.
      expect(await ledgerRowsOf(db().pool, scenario.workspaceId, REPLAYED)).toEqual([]);
    } finally {
      closeObjects(unreachable.value);
    }

    // The other way round (`[TEST7]`): the same request, over the store that answers, is found.
    const found = await replayCopiesSince(ERASURE, objects().door, UNREACHABLE_SINCE);
    if (!found.ok) throw new Error(`the copies refused: ${String(found.error)}`);
    expect(idsFor(found.value, scenario.workspaceId)).toEqual([erased.erasureRequestId]);
  });
});

describe("a second replay of the same request", () => {
  it("changes nothing but the ledger", async () => {
    const scenario = await arrange();
    const erased = await completedInTheRows(scenario.workspaceId, TWICE_AT);

    const first = await replaying(scenario, TWICE_AT, TWICE_SINCE);
    const after = await erasureRowsIn(scenario.workspaceId);
    const second = await replaying(scenario, TWICE_AT, TWICE_SINCE);

    expect(second.map((one) => one.erasureRequestId)).toEqual([erased.erasureRequestId]);
    // The row the first replay left, unmoved: the same pseudonym, the same completion, the same
    // report — which is what makes a restore that is run twice a restore run once.
    expect(await erasureRowsIn(scenario.workspaceId)).toEqual(after);
    const ledger = await ledgerRowsOf(db().pool, scenario.workspaceId, REPLAYED);
    expect(ledger.map((row) => row.subject_id)).toEqual([
      erased.erasureRequestId,
      erased.erasureRequestId,
    ]);
    expect(ledger.map((row) => row.id)).toEqual([first[0]?.auditEventId, second[0]?.auditEventId]);
  });
});

describe("a request whose routine will not run", () => {
  it("stops the replay where it stands, rather than carrying on to the ones behind it", async () => {
    const scenario = await arrange();
    // A workspace whose rows a dump carries and whose **repository** the restore has not put
    // back: the erasure routine rewrites a history that is not there, and fails. This is what
    // the estate looks like when the git store is restored after the replay instead of before
    // it, which is the ordering ADR 0022 gains this ticket's amendment for.
    const stranded = await seedingWith(db().pool, (seed) => seed.workspace());
    const first = await completedInTheRows(stranded.id, STOPS_AT);
    const second = await completedInTheRows(scenario.workspaceId, AFTER_THE_STOP_AT);

    const replayed = await replayErasures(ERASURE, doorsFor(scenario, AFTER_THE_STOP_AT), {
      since: STOPS_SINCE,
    });

    expect(replayed.ok).toBe(false);
    // The refusal names the request it stopped at, because an operator reads it halfway through
    // a restore and has to know where the estate stands.
    if (replayed.ok) throw new Error("the replay did not stop");
    expect(String(replayed.error)).toContain(first.erasureRequestId);
    expect(String(replayed.error)).toContain("after replaying 0");
    // It stopped where the routine met the missing history, not at the boundary: an id this
    // slice refused to read would be the arrangement failing and not the sentence under test.
    expect(String(replayed.error)).toContain("not a git repository");
    // And the one behind it did not run: a restore that skipped a failure and carried on would
    // hand `api` a healthy estate with one erasure undone.
    expect(await ledgerRowsOf(db().pool, scenario.workspaceId, REPLAYED)).toEqual([]);
    expect(await ledgerRowsOf(db().pool, stranded.id, REPLAYED)).toEqual([]);
    expect(second.erasureRequestId).not.toEqual(first.erasureRequestId);
  });
});
