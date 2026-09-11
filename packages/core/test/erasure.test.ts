import { describe, expect, it } from "vitest";

import {
  deadlineOf,
  dueDateOf,
  recordSubjectRequest,
  subjectRequestFor,
  type ReadSubjectRequestRefusal,
  type RecordSubjectRequestInput,
  type RecordSubjectRequestRefusal,
  type SubjectIdentifiers,
  type SubjectRequest,
  type SubjectRequestRecorded,
} from "../src/erasure/index.ts";
import type { Result, UserPrincipal } from "../src/kernel/index.ts";
import { ledgerRowsOf } from "./sourced-concept.ts";
import { readingAs, seedingWith, whileWritesAreRefused } from "./suite-postgres.ts";
import { suiteWithBundles } from "./workspace-with-bundle.ts";

/**
 * The erasure slice's first act, through the slice's own face (`[TEST1]`) against real
 * Postgres: an Admin records a *subject request* on a person's behalf, its row and its
 * ledger row land together or not at all, the identifier set is the Admin's to read, and
 * the one-month clock runs from the instant the Admin gives it.
 */

const { db, arrange } = suiteWithBundles();

/** Receipt, and the later instant identity was confirmed — the ICO's pause, in literals. */
const RECEIVED_AT = new Date("2026-03-31T09:15:00.000Z");
const CONFIRMED_AT = new Date("2026-04-02T11:00:00.000Z");
/** One month on from the clock's start, not from receipt: the whole point of the pause. */
const DUE_AT = new Date("2026-05-02T11:00:00.000Z");

/** What a subject gave: three identifiers across the set's three kinds. */
const IDENTIFIERS: SubjectIdentifiers = {
  emails: ["priya@example.invalid"],
  names: ["Priya Anand"],
  other: ["ACME-4471"],
};

const requestOf = (
  overrides: Partial<RecordSubjectRequestInput> = {},
): RecordSubjectRequestInput => ({
  kind: "access",
  identifiers: IDENTIFIERS,
  personId: null,
  receivedAt: RECEIVED_AT,
  clockStartedAt: CONFIRMED_AT,
  ...overrides,
});

/** Record the request as this person, the way a transport would — one transaction, one act. */
const recordingAs = (
  person: UserPrincipal,
  input: RecordSubjectRequestInput,
): Promise<Result<SubjectRequestRecorded, RecordSubjectRequestRefusal>> =>
  readingAs(db().pool, person, (principal, tx) => recordSubjectRequest(principal, tx, input));

const readingRequestAs = (
  person: UserPrincipal,
  id: string,
): Promise<Result<SubjectRequest, ReadSubjectRequestRefusal>> =>
  readingAs(db().pool, person, (principal, tx) => subjectRequestFor(principal, tx, id));

/** Every subject request in the workspace, as the superuser: the columns the act writes. */
const requestRowsIn = async (workspaceId: string) => {
  const read = await db().pool.query(
    `SELECT id, person_id, identifiers, kind, received_at, clock_started_at, due_at,
            extended_to, answered_at, answer
       FROM subject_request WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  return read.rows;
};

/** A person who holds a login, so a request may name them by the one person id (ADR 0035). */
const personWithALogin = (): Promise<string> =>
  seedingWith(db().pool, async (seed) => (await seed.user()).id);

/**
 * A workspace whose Admin has recorded one request about a person who holds a login — the
 * arrange both the write and the read are read against, so neither says it twice.
 */
const workspaceWithARequest = async () => {
  const scenario = await arrange();
  const subject = await personWithALogin();
  const recorded = await recordingAs(scenario.admin, requestOf({ personId: subject }));
  return { scenario, subject, recorded, requestId: recorded.ok ? recorded.value.requestId : "" };
};

describe("recording a subject request", () => {
  it("lands the request and its ledger row together, the detail naming the person and how many identifiers, never one of them", async () => {
    const { scenario, subject, recorded, requestId } = await workspaceWithARequest();

    const auditEventId = recorded.ok ? recorded.value.auditEventId : "";
    expect(recorded).toEqual({ ok: true, value: { requestId, auditEventId, dueAt: DUE_AT } });
    expect(await requestRowsIn(scenario.workspaceId)).toEqual([
      {
        id: requestId,
        person_id: subject,
        identifiers: IDENTIFIERS,
        kind: "access",
        received_at: RECEIVED_AT,
        clock_started_at: CONFIRMED_AT,
        due_at: DUE_AT,
        extended_to: null,
        answered_at: null,
        answer: null,
      },
    ]);
    // The detail says who and how many, and nothing a subject wrote down (`[AUDIT5]`): the
    // three identifiers above are counted here and named nowhere.
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "people.subject_request.received"),
    ).toEqual([
      {
        id: auditEventId,
        actor: `human:${scenario.admin.userId}`,
        subject_id: requestId,
        detail: { personId: subject, identifierCount: 3 },
      },
    ]);
  });

  it("records a request for a person the company's files name who never signed in, the detail carrying no person id", async () => {
    const scenario = await arrange();

    const recorded = await recordingAs(
      scenario.admin,
      requestOf({
        kind: "erasure",
        identifiers: { emails: ["contact@client.invalid"], names: ["Dan Okoro"], other: [] },
      }),
    );

    expect(recorded.ok).toBe(true);
    expect(await requestRowsIn(scenario.workspaceId)).toMatchObject([
      { person_id: null, kind: "erasure" },
    ]);
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "people.subject_request.received"),
    ).toMatchObject([{ detail: { identifierCount: 2 } }]);
  });

  it("writes the identifier set the boundary parsed, so one given with spaces around it is the one every finder matches", async () => {
    const scenario = await arrange();

    const recorded = await recordingAs(
      scenario.admin,
      requestOf({
        kind: "erasure",
        identifiers: {
          emails: ["  priya@example.invalid  "],
          names: ["\tPriya Anand "],
          other: [],
        },
      }),
    );

    expect(recorded.ok).toBe(true);
    // The column and not the answer: the row is what the erasure map's finders match on, what
    // a suppression is written from and what the replay copy carries into a restore, so an
    // identifier that kept its spaces here is a subject whose own identifier finds nothing.
    expect(await requestRowsIn(scenario.workspaceId)).toMatchObject([
      { identifiers: { emails: ["priya@example.invalid"], names: ["Priya Anand"], other: [] } },
    ]);
  });

  it("leaves no request when the ledger refuses the act's event", async () => {
    const scenario = await arrange();

    // The ledger door rejects rather than answering a value, and the act calls it bare, so
    // the rejection aborts the transaction the request row landed in (`[AUDIT1]`).
    await whileWritesAreRefused(db().pool, "audit_event", async () => {
      await expect(recordingAs(scenario.admin, requestOf())).rejects.toThrow(
        /the store refused a write to audit_event/,
      );
    });

    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "people.subject_request.received"),
    ).toEqual([]);
  });

  it("refuses an Editor and a Viewer before a row exists", async () => {
    const scenario = await arrange();

    for (const person of [scenario.editor, scenario.viewer]) {
      expect(await recordingAs(person, requestOf())).toEqual({ ok: false, error: "role-forbids" });
    }

    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a kind the closed pair does not name, before a row exists", async () => {
    const scenario = await arrange();

    expect(await recordingAs(scenario.admin, requestOf({ kind: "portability" }))).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
  });

  it("lets the table refuse a clock started before the request arrived, and lands nothing", async () => {
    const scenario = await arrange();

    // The order is the table's own `subject_request_clock_check`, and the act lets it speak
    // rather than second-guessing it; the aborted transaction is what the opener reports
    // (`[TEST8]`), so the value the act returned is not the thing to assert here.
    await expect(
      recordingAs(
        scenario.admin,
        requestOf({ receivedAt: CONFIRMED_AT, clockStartedAt: RECEIVED_AT }),
      ),
    ).rejects.toThrow(/did not commit/);
    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
  });
});

describe("the clock", () => {
  it("is one month from its start, across a month's end and a year's", () => {
    expect(dueDateOf(new Date("2026-04-02T11:00:00.000Z"))).toEqual(
      new Date("2026-05-02T11:00:00.000Z"),
    );
    expect(dueDateOf(new Date("2026-12-15T08:30:00.000Z"))).toEqual(
      new Date("2027-01-15T08:30:00.000Z"),
    );
  });

  it("answers the target month's last day where that month has no such day", () => {
    // A day February does not have would otherwise land in March — three days late on a
    // statutory deadline, in the one direction the clock must never move.
    expect(dueDateOf(new Date("2026-01-31T09:00:00.000Z"))).toEqual(
      new Date("2026-02-28T09:00:00.000Z"),
    );
    expect(dueDateOf(new Date("2026-01-30T09:00:00.000Z"))).toEqual(
      new Date("2026-02-28T09:00:00.000Z"),
    );
    // A 31st into a 30-day month, so the rule is not read as being about February.
    expect(dueDateOf(new Date("2026-08-31T09:00:00.000Z"))).toEqual(
      new Date("2026-09-30T09:00:00.000Z"),
    );
  });

  it("answers the 29th in a leap February, which a clamp written against 28 would miss", () => {
    expect(dueDateOf(new Date("2028-01-31T09:00:00.000Z"))).toEqual(
      new Date("2028-02-29T09:00:00.000Z"),
    );
    expect(dueDateOf(new Date("2028-01-30T09:00:00.000Z"))).toEqual(
      new Date("2028-02-29T09:00:00.000Z"),
    );
  });

  it("answers the month until an extension is taken, and the extension once it is", async () => {
    const scenario = await arrange();
    const extended = new Date("2026-07-02T11:00:00.000Z");

    const [plain, withExtension] = await seedingWith(db().pool, (seed) =>
      Promise.all([
        seed.subjectRequest({
          workspaceId: scenario.workspaceId,
          receivedAt: RECEIVED_AT,
          clockStartedAt: CONFIRMED_AT,
        }),
        seed.subjectRequest({
          workspaceId: scenario.workspaceId,
          receivedAt: RECEIVED_AT,
          clockStartedAt: CONFIRMED_AT,
          extendedTo: extended,
        }),
      ]),
    );

    expect(plain.dueAt).toEqual(DUE_AT);
    expect(deadlineOf(plain)).toEqual(DUE_AT);
    expect(deadlineOf(withExtension)).toEqual(extended);
  });
});

describe("reading a subject request", () => {
  it("hands the Admin the row with its identifier set, and refuses an Editor and a Viewer", async () => {
    const { scenario, subject, requestId } = await workspaceWithARequest();

    expect(await readingRequestAs(scenario.admin, requestId)).toEqual({
      ok: true,
      value: {
        workspaceId: scenario.workspaceId,
        id: requestId,
        personId: subject,
        identifiers: IDENTIFIERS,
        kind: "access",
        receivedAt: RECEIVED_AT,
        clockStartedAt: CONFIRMED_AT,
        dueAt: DUE_AT,
        extendedTo: null,
        answeredAt: null,
        answer: null,
      },
    });
    // Restricted personal data of a suppression's class: no other role reaches the set.
    for (const person of [scenario.editor, scenario.viewer]) {
      expect(await readingRequestAs(person, requestId)).toEqual({
        ok: false,
        error: "role-forbids",
      });
    }
  });

  it("says so when no request of that id is held here, and refuses an id that is not the minter's", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const theirs = await recordingAs(elsewhere.admin, requestOf());
    const theirRequestId = theirs.ok ? theirs.value.requestId : "";

    expect(await readingRequestAs(scenario.admin, theirRequestId)).toEqual({
      ok: false,
      error: "no-such-request",
    });
    expect(await readingRequestAs(scenario.admin, "request-1")).toEqual({
      ok: false,
      error: "malformed",
    });
  });
});
