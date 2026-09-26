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
import type { PrincipalRefusal, Result, UserPrincipal } from "../src/kernel/index.ts";
import { auditEventRowsOf } from "./sourced-concept.ts";
import { readingAs, seedingWith, whileWritesAreRefused } from "./suite-postgres.ts";
import { suiteWithBundles } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const RECEIVED_AT = new Date("2026-03-31T09:15:00.000Z");
const CONFIRMED_AT = new Date("2026-04-02T11:00:00.000Z");

const DUE_AT = new Date("2026-05-02T11:00:00.000Z");

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

const recordingAs = (
  person: UserPrincipal,
  input: RecordSubjectRequestInput,
): Promise<Result<SubjectRequestRecorded, RecordSubjectRequestRefusal | PrincipalRefusal>> =>
  readingAs(db().pool, person, (principal, tx) => recordSubjectRequest(principal, tx, input));

const readingRequestAs = (
  person: UserPrincipal,
  id: string,
): Promise<Result<SubjectRequest, ReadSubjectRequestRefusal | PrincipalRefusal>> =>
  readingAs(db().pool, person, (principal, tx) => subjectRequestFor(principal, tx, id));

const requestRowsIn = async (workspaceId: string) => {
  const read = await db().pool.query(
    `SELECT id, person_id, identifiers, kind, received_at, clock_started_at, due_at,
            extended_to, answered_at, answer
       FROM subject_request WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  return read.rows;
};

const personWithALogin = (): Promise<string> =>
  seedingWith(db().pool, async (seed) => (await seed.user()).id);

const workspaceWithARequest = async () => {
  const scenario = await arrange();
  const subject = await personWithALogin();
  const recorded = await recordingAs(scenario.admin, requestOf({ personId: subject }));
  return { scenario, subject, recorded, requestId: recorded.ok ? recorded.value.requestId : "" };
};

describe("recording a subject request", () => {
  it("lands the request and its audit event, counting the identifiers", async () => {
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

    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "people.subject_request.received"),
    ).toEqual([
      {
        id: auditEventId,
        actor: `human:${scenario.admin.userId}`,
        subject_id: requestId,
        detail: { personId: subject, identifierCount: 3 },
      },
    ]);
  });

  it("records a request for someone who never signed in", async () => {
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
      await auditEventRowsOf(db().pool, scenario.workspaceId, "people.subject_request.received"),
    ).toMatchObject([{ detail: { identifierCount: 2 } }]);
  });

  it("writes the identifier set the boundary parsed, trimmed of spaces", async () => {
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

    expect(await requestRowsIn(scenario.workspaceId)).toMatchObject([
      { identifiers: { emails: ["priya@example.invalid"], names: ["Priya Anand"], other: [] } },
    ]);
  });

  it("leaves no request when the audit log refuses the event", async () => {
    const scenario = await arrange();

    await whileWritesAreRefused(db().pool, "audit_event", async () => {
      await expect(recordingAs(scenario.admin, requestOf())).rejects.toThrow(
        /the store refused a write to audit_event/,
      );
    });

    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "people.subject_request.received"),
    ).toEqual([]);
  });

  it("refuses an Editor and a Viewer before a row exists", async () => {
    const scenario = await arrange();

    for (const person of [scenario.editor, scenario.viewer]) {
      expect(await recordingAs(person, requestOf())).toEqual({ ok: false, error: "role-forbids" });
    }

    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
  });

  it("refuses an unknown kind before a row exists", async () => {
    const scenario = await arrange();

    expect(await recordingAs(scenario.admin, requestOf({ kind: "portability" }))).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a one-word name as too broad, recording nothing", async () => {
    const scenario = await arrange();

    const recorded = await recordingAs(
      scenario.admin,
      requestOf({
        kind: "erasure",
        identifiers: { emails: ["will@example.invalid"], names: ["  Will "], other: [] },
      }),
    );

    expect(recorded).toEqual({
      ok: false,
      error: {
        word: "identifier-too-broad",
        said:
          'The name "Will" is too broad to withhold: a name of one word would withhold that ' +
          "word in every document of the workspace.",
      },
    });
    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
  });

  it.each([
    ["an email", { emails: ["x@"], names: [], other: [] }, "x@"],
    ["a name", { emails: [], names: ["Al"], other: [] }, "Al"],
    ["another identifier", { emails: [], names: [], other: ["7\n "] }, "7"],
  ])(
    "refuses %s under three characters, trimmed, recording nothing",
    async (_kind, identifiers, refused) => {
      const scenario = await arrange();

      const recorded = await recordingAs(
        scenario.admin,
        requestOf({ kind: "erasure", identifiers: { ...IDENTIFIERS, ...identifiers } }),
      );

      expect(recorded).toEqual({
        ok: false,
        error: {
          word: "identifier-too-broad",
          said:
            `The identifier "${refused}" is too broad to withhold: one under 3 characters ` +
            "would withhold those characters in every document of the workspace.",
        },
      });
      expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
    },
  );

  it("records a two-word name and a three-character identifier", async () => {
    const scenario = await arrange();
    const identifiers = { emails: [], names: ["Jo Li"], other: ["A 1"] };

    const recorded = await recordingAs(scenario.admin, requestOf({ kind: "erasure", identifiers }));

    expect(recorded.ok).toBe(true);
    expect(await requestRowsIn(scenario.workspaceId)).toMatchObject([{ identifiers }]);
  });

  it("answers an error, landing nothing, for a clock started early", async () => {
    const scenario = await arrange();

    const recorded = await recordingAs(
      scenario.admin,
      requestOf({ receivedAt: CONFIRMED_AT, clockStartedAt: RECEIVED_AT }),
    );

    expect(recorded.ok).toBe(false);
    if (recorded.ok) return;
    expect(recorded.error).toBeInstanceOf(Error);
    expect(await requestRowsIn(scenario.workspaceId)).toEqual([]);
  });
});

describe("the clock", () => {
  it("is one month on across month and year ends", () => {
    expect(dueDateOf(new Date("2026-04-02T11:00:00.000Z"))).toEqual(
      new Date("2026-05-02T11:00:00.000Z"),
    );
    expect(dueDateOf(new Date("2026-12-15T08:30:00.000Z"))).toEqual(
      new Date("2027-01-15T08:30:00.000Z"),
    );
  });

  it("clamps to the target month's last day", () => {
    expect(dueDateOf(new Date("2026-01-31T09:00:00.000Z"))).toEqual(
      new Date("2026-02-28T09:00:00.000Z"),
    );
    expect(dueDateOf(new Date("2026-01-30T09:00:00.000Z"))).toEqual(
      new Date("2026-02-28T09:00:00.000Z"),
    );

    expect(dueDateOf(new Date("2026-08-31T09:00:00.000Z"))).toEqual(
      new Date("2026-09-30T09:00:00.000Z"),
    );
  });

  it("answers the 29th in a leap February", () => {
    expect(dueDateOf(new Date("2028-01-31T09:00:00.000Z"))).toEqual(
      new Date("2028-02-29T09:00:00.000Z"),
    );
    expect(dueDateOf(new Date("2028-01-30T09:00:00.000Z"))).toEqual(
      new Date("2028-02-29T09:00:00.000Z"),
    );
  });

  it("answers the extension once taken, and the month before", async () => {
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
  it("hands the Admin the row, refusing an Editor and Viewer", async () => {
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

    for (const person of [scenario.editor, scenario.viewer]) {
      expect(await readingRequestAs(person, requestId)).toEqual({
        ok: false,
        error: "role-forbids",
      });
    }
  });

  it("finds no request held elsewhere and refuses a malformed id", async () => {
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
