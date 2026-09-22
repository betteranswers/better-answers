import { ulid } from "@better-answers/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { commit, type GitDoor } from "@better-answers/core/store/git";
import {
  getPlatformObject,
  listObjects,
  listPlatformObjects,
  openObjects,
} from "@better-answers/core/store/objects";
import { withScope } from "@better-answers/core/store/postgres";

import { open } from "../src/answering/index.ts";
import {
  contentHashOf,
  RECONCILER,
  reconcile,
  renderConceptFile,
  type Frontmatter,
} from "../src/concepts/index.ts";
import {
  ERASURE,
  ERASURE_FAMILIES,
  rederiveAfterErasure,
  runErasure,
  suppressTheDocuments,
  type ErasureMap,
  type ErasureRefusal,
  type ErasureRun,
} from "../src/erasure/index.ts";
import { actorIdOfPerson, type Result } from "../src/kernel/index.ts";
import { authorLinesOf, bundleHistory, everyObjectOf, objectPresent } from "./bundle.ts";
import { identityRowsFor, verificationCodeFor } from "./identity-rows.ts";
import { ledgerRowsOf } from "./sourced-concept.ts";
import { objectStoreForSuite, textOf } from "./suite-objects.ts";
import {
  addressOf,
  countWaitingOnLocks,
  readingAs,
  seedingWith,
  until,
  whileActsWaitAt,
} from "./suite-postgres.ts";
import {
  doorsOf,
  memberOf,
  principalFor,
  suiteWithBundles,
  type Scenario,
} from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const objects = objectStoreForSuite();

const LOCKED_AT = new Date("2026-06-01T12:00:00.000Z");

const RAN_AGAIN_AT = new Date("2026-06-08T09:30:00.000Z");

const BEYOND_USE = {
  hourly: "2026-06-03T12:00:00.000Z",
  daily: "2026-07-01T12:00:00.000Z",
  weekly: "2026-07-27T12:00:00.000Z",
  monthly: "2026-12-01T12:00:00.000Z",
} as const;

// This day tells a day count from a calendar interval: six months on is 28 February, 183
// days on 2 March.
const ANCHORED_ON_A_31ST = new Date("2026-08-31T12:00:00.000Z");

const BEYOND_USE_FROM_THE_31ST = {
  hourly: "2026-09-02T12:00:00.000Z",
  daily: "2026-09-30T12:00:00.000Z",
  weekly: "2026-10-26T12:00:00.000Z",
  monthly: "2027-02-28T12:00:00.000Z",
} as const;

const DUMP_LOCK = 41;

const ERASURE_ACTOR = "process:better-answers-erasure";

const COMPLETED = "people.erasure.completed";

const runningTheRoutine = (
  scenario: Scenario,
  subjectRequestId: string,
  at: Date = LOCKED_AT,
): Promise<Result<ErasureRun, ErasureRefusal | Error>> =>
  runErasure(
    ERASURE,
    {
      git: scenario.git,
      postgres: scenario.postgres,
      objects: objects().door,
      clock: { now: () => at },
    },
    { workspaceId: scenario.workspaceId, subjectRequestId },
  );

const completing = async (
  scenario: Scenario,
  subjectRequestId: string,
  at: Date = LOCKED_AT,
): Promise<ErasureRun> => {
  const run = await runningTheRoutine(scenario, subjectRequestId, at);
  if (!run.ok) throw new Error(`the routine refused: ${String(run.error)}`);
  return run.value;
};

const erasureRequestAbout = async (
  workspaceId: string,

  personId: string | null,

  email: string | null,

  alsoNamed: readonly string[] = [],
): Promise<string> => {
  const emails = email === null ? [...alsoNamed] : [email, ...alsoNamed];
  const seeded = await seedingWith(db().pool, (seed) =>
    seed.subjectRequest({
      workspaceId,
      kind: "erasure",
      personId,
      identifiers: { emails, names: emails.length === 0 ? [] : ["Priya Anand"], other: [] },
    }),
  );
  return seeded.id;
};

const workspaceWithAnErasureRequest = async (named: { readonly byIdAlone?: boolean } = {}) => {
  const scenario = await arrange();
  const email = addressOf("priya");
  const person = await memberOf(db().pool, scenario.workspaceId, email);
  return {
    scenario,
    email,
    person,
    subjectRequestId: await erasureRequestAbout(
      scenario.workspaceId,
      person.id,
      named.byIdAlone === true ? null : email,
    ),
  };
};

const filesNaming = (
  email: string,
): readonly {
  readonly path: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
}[] => [
  {
    path: "knowledge/expenses.md",
    frontmatter: { title: "Expenses", type: "Policy", generated: `human:${email}` },
    body: `Expenses are claimed within thirty days. Approved by human:${email}.`,
  },
  {
    path: "knowledge/travel.md",
    frontmatter: {
      title: "Travel",
      type: "Policy",
      generated: `human:${email}`,
      verified: [{ by: `human:${email}`, at: "2026-04-03" }],
    },
    body: "Travel is booked through the agent.",
  },
];

const bundleNamingThePerson = async (named: { readonly byIdAlone?: boolean } = {}) => {
  const { scenario, email, person, subjectRequestId } = await workspaceWithAnErasureRequest(named);
  const principal = await principalFor(db(), scenario.workspaceId, person.id);
  const author = { name: "Priya Anand", email };
  const files = filesNaming(email);

  const shas: string[] = [];
  for (const [at, file] of files.entries()) {
    const written = await commit(principal, scenario.git, {
      path: file.path,
      content: renderConceptFile(file.frontmatter, file.body),
      message: `Record a policy (${at + 1})`,
      author,
      trailers: { actor: actorIdOfPerson(principal.userId), audit: ulid() },
      expectedHead: shas[at - 1] ?? null,
      at: new Date(`2026-04-0${at + 2}T11:00:00.000Z`),
    });
    if (!written.ok) throw new Error(`the commit was refused: ${String(written.error)}`);
    shas.push(written.value.sha);
  }

  const landed = await seedingWith(db().pool, async (seed) => {
    for (const [at, sha] of shas.entries()) {
      await seed.bundleCommit({
        workspaceId: scenario.workspaceId,
        sha,
        parentSha: shas[at - 1] ?? null,
        actor: actorIdOfPerson(principal.userId),
        committedAt: new Date(`2026-04-0${at + 2}T11:00:00.000Z`),
      });
    }
    const rows: { readonly path: string; readonly iri: string }[] = [];
    for (const [at, file] of files.entries()) {
      const indexed = await seed.conceptIndex({
        workspaceId: scenario.workspaceId,
        path: file.path,
        commitSha: shas[at] ?? "",
        frontmatter: file.frontmatter,
        body: file.body,
        contentHash: contentHashOf(file.frontmatter, file.body, file.path),
      });

      await seed.conceptVerification({
        workspaceId: scenario.workspaceId,
        iri: indexed.iri,
        actor: actorIdOfPerson(principal.userId),
        contentHash: indexed.contentHash,
        checkedAt: new Date("2026-04-05T09:00:00.000Z"),
      });
      rows.push({ path: file.path, iri: indexed.iri });
    }
    return rows;
  });
  const [hashed, steady] = landed;
  return {
    scenario,
    email,
    person,

    iri: hashed?.iri ?? "",

    steadyIri: steady?.iri ?? "",
    before: shas,
    subjectRequestId,
  };
};

const checksIn = async (workspaceId: string) => {
  const read = await db().pool.query<{
    iri: string;
    actor: string;
    checked_at: Date;
    content_hash: string | null;
    origin: string;
  }>(
    `SELECT iri, actor, checked_at, content_hash, origin
       FROM concept_verification WHERE workspace_id = $1 ORDER BY iri`,
    [workspaceId],
  );
  return read.rows;
};

const indexedIn = async (workspaceId: string) => {
  const read = await db().pool.query<{ iri: string; content_hash: string; body: string }>(
    "SELECT iri, content_hash, body FROM concept_index WHERE workspace_id = $1 ORDER BY iri",
    [workspaceId],
  );
  return read.rows;
};

const READ_AT = new Date("2026-06-02T09:00:00.000Z");

const trustOf = async (scenario: Scenario, iri: string) => {
  const read = await readingAs(db().runtimePool, scenario.viewer, (principal, tx) =>
    open(principal, tx, { iri }, READ_AT),
  );
  return read.ok && read.value.found ? read.value.concept?.trust : undefined;
};

const bundleCommitRowsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{ sha: string; parent_sha: string | null }>(
    `SELECT sha, parent_sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha`,
    [workspaceId],
  );
  return read.rows;
};

const readingTheBundle = async (workspaceId: string, git: GitDoor) => ({
  objects: await everyObjectOf(git, workspaceId),
  authors: await authorLinesOf(git, workspaceId),
  history: await bundleHistory(git, workspaceId),
  rows: await bundleCommitRowsIn(workspaceId),
});

const rewritingTheBundleOnce = async () => {
  const arranged = await bundleNamingThePerson();
  const { scenario, subjectRequestId } = arranged;
  const before = await readingTheBundle(scenario.workspaceId, scenario.git);
  const checksBefore = await checksIn(scenario.workspaceId);
  const indexedBefore = await indexedIn(scenario.workspaceId);
  const trustBefore = [
    await trustOf(scenario, arranged.iri),
    await trustOf(scenario, arranged.steadyIri),
  ];

  const done = await completing(scenario, subjectRequestId);

  const after = await readingTheBundle(scenario.workspaceId, scenario.git);
  const [row] = await erasureRowsIn(scenario.workspaceId);
  return {
    ...arranged,
    before,
    after,
    done,
    checksBefore,
    checksAfter: await checksIn(scenario.workspaceId),
    indexedBefore,
    indexedAfter: await indexedIn(scenario.workspaceId),
    trustBefore,
    trustAfter: [
      await trustOf(scenario, arranged.iri),
      await trustOf(scenario, arranged.steadyIri),
    ],
    pseudonym: row?.pseudonym ?? "",
    actions: row?.actions ?? {},
    stillPresent: await Promise.all(
      arranged.before.map((sha) => objectPresent(scenario.git, scenario.workspaceId, sha)),
    ),
    commitOfTheConcept: await commitOfConcept(scenario.workspaceId, arranged.iri),
  };
};

let theOneRewrite: ReturnType<typeof rewritingTheBundleOnce> | undefined;

const theBundleRewritten = () => (theOneRewrite ??= rewritingTheBundleOnce());

const commitOfConcept = async (workspaceId: string, iri: string): Promise<string | undefined> => {
  const read = await db().pool.query<{ commit_sha: string }>(
    "SELECT commit_sha FROM concept_index WHERE workspace_id = $1 AND iri = $2",
    [workspaceId, iri],
  );
  return read.rows[0]?.commit_sha;
};

const erasureRowsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{
    id: string;
    subject_request_id: string;
    pseudonym: string;
    locked_at: Date;
    anchored_at: Date;
    beyond_use_hourly_at: Date;
    beyond_use_daily_at: Date;
    beyond_use_weekly_at: Date;
    beyond_use_monthly_at: Date;
    completed_at: Date | null;
    report: string | null;
    actions: Record<string, unknown>;
  }>(
    `SELECT id, subject_request_id, pseudonym, locked_at, anchored_at, beyond_use_hourly_at,
            beyond_use_daily_at, beyond_use_weekly_at, beyond_use_monthly_at, completed_at,
            report, actions
       FROM erasure_request WHERE workspace_id = $1 ORDER BY id`,
    [workspaceId],
  );
  return read.rows;
};

const rowTextIn = async (table: string, workspaceId: string) => {
  const read = await db().pool.query<{ id: string; row: string }>(
    `SELECT t.id, row_to_json(t)::text AS row FROM "${table}" t WHERE t.workspace_id = $1 ORDER BY t.id`,
    [workspaceId],
  );
  return read.rows;
};

const verificationsFor = async (identifier: string): Promise<number> => {
  const read = await db().pool.query<{ count: string }>(
    "SELECT count(*) AS count FROM verification WHERE lower(identifier) = $1",
    [identifier.toLowerCase()],
  );
  return Number(read.rows[0]?.count ?? -1);
};

const identityRowCountsFor = async (workspaceId: string, userId: string, email: string) => {
  const read = await db().pool.query<{
    sessions: string;
    accounts: string;
    verifications: string;
    invitations: string;
  }>(
    `SELECT (SELECT count(*) FROM session WHERE user_id = $1) AS sessions,
            (SELECT count(*) FROM account WHERE user_id = $1) AS accounts,
            (SELECT count(*) FROM verification WHERE lower(identifier) = $2) AS verifications,
            (SELECT count(*) FROM invitation WHERE workspace_id = $3 AND lower(email) = $2)
              AS invitations`,
    [userId, email.toLowerCase(), workspaceId],
  );
  const row = read.rows[0];
  return {
    sessions: Number(row?.sessions ?? -1),
    accounts: Number(row?.accounts ?? -1),
    verifications: Number(row?.verifications ?? -1),
    invitations: Number(row?.invitations ?? -1),
  };
};

const userRowOf = async (userId: string) => {
  const read = await db().pool.query<{
    id: string;
    name: string;
    email: string;
    email_verified: boolean;
    image: string | null;
  }>(`SELECT id, name, email, email_verified, image FROM "user" WHERE id = $1`, [userId]);
  return read.rows[0];
};

const workspacesMemberOf = async (userId: string): Promise<readonly string[]> => {
  const read = await db().pool.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM member WHERE user_id = $1 ORDER BY workspace_id",
    [userId],
  );
  return read.rows.map((row) => row.workspace_id);
};

const personNamedBy = async (workspaceId: string, auditEventId: string) => {
  const read = await db().pool.query<{ id: string }>(
    `SELECT u.id FROM audit_event a JOIN "user" u ON a.actor = 'human:' || u.id
      WHERE a.workspace_id = $1 AND a.id = $2`,
    [workspaceId, auditEventId],
  );
  return read.rows[0]?.id;
};

const theDumpCouldTakeItsLock = async (): Promise<boolean> => {
  const dump = await db().pool.connect();
  try {
    const tried = await dump.query<{ taken: boolean }>(
      `SELECT pg_try_advisory_lock(${DUMP_LOCK}) AS taken`,
    );
    const taken = tried.rows[0]?.taken === true;
    if (taken) await dump.query(`SELECT pg_advisory_unlock(${DUMP_LOCK})`);
    return taken;
  } finally {
    dump.release();
  }
};

describe("the erasure pseudonym", () => {
  it("mints one opaque id for a request, never the person's own, and finds the same one on a second run", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();

    await completing(scenario, subjectRequestId);
    const first = await erasureRowsIn(scenario.workspaceId);
    await completing(scenario, subjectRequestId, RAN_AGAIN_AT);
    const second = await erasureRowsIn(scenario.workspaceId);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]?.pseudonym).toEqual(first[0]?.pseudonym);

    expect(first[0]?.pseudonym).not.toEqual(person.id);
    expect(first[0]?.subject_request_id).toEqual(subjectRequestId);
  });

  it("mints a different pseudonym for one person in each workspace that erases them", async () => {
    const email = addressOf("priya");
    const person = await seedingWith(db().pool, (seed) =>
      seed.user({ name: "Priya Anand", email }),
    );
    const identifiers = { emails: [email], names: ["Priya Anand"], other: [] };
    const workspaces = [await arrange(), await arrange()];
    const pseudonyms: string[] = [];
    for (const scenario of workspaces) {
      await seedingWith(db().pool, (seed) =>
        seed.member({ workspaceId: scenario.workspaceId, userId: person.id, role: "Editor" }),
      );
      const seeded = await seedingWith(db().pool, (seed) =>
        seed.subjectRequest({
          workspaceId: scenario.workspaceId,
          kind: "erasure",
          personId: person.id,
          identifiers,
        }),
      );
      await completing(scenario, seeded.id);
      const [row] = await erasureRowsIn(scenario.workspaceId);
      pseudonyms.push(row?.pseudonym ?? "");
    }

    expect(pseudonyms[0]).not.toEqual(pseudonyms[1]);
    expect(pseudonyms.filter((minted) => minted === "")).toEqual([]);
  });
});

describe("the report", () => {
  beforeAll(async () => {
    await theBundleRewritten();
  });

  it("is ADR 0020's fixed wording, with the four beyond-use dates computed from the lock instant", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const done = await completing(scenario, subjectRequestId);

    expect(done.report).toContain(
      "Every actor identifier for this person has been rewritten across the repository's history, " +
        "the index, the evidence and the map, and in the backup copies listed below. Names this " +
        "person wrote or that were written about them inside concept bodies are listed for the " +
        "owner to edit; an edit is a new commit and does not remove the name from earlier commits, " +
        "from copies already exported, or from backup copies taken before 2026-06-01T12:00:00.000Z.",
    );
    expect(done.report).toContain(
      "Backup copies taken before 2026-06-01T12:00:00.000Z are beyond use: restored only in a " +
        "disaster, encrypted at rest, deletable only by the escrowed credential, expiring on " +
        `${BEYOND_USE.hourly} · ${BEYOND_USE.daily} · ${BEYOND_USE.weekly} · ${BEYOND_USE.monthly}. ` +
        "Should a restore from such a copy occur, this request is re-applied before the platform " +
        "serves reads.",
    );

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect({
      anchored: row?.anchored_at.toISOString(),
      locked: row?.locked_at.toISOString(),
      hourly: row?.beyond_use_hourly_at.toISOString(),
      daily: row?.beyond_use_daily_at.toISOString(),
      weekly: row?.beyond_use_weekly_at.toISOString(),
      monthly: row?.beyond_use_monthly_at.toISOString(),
    }).toEqual({
      anchored: "2026-06-01T12:00:00.000Z",
      locked: "2026-06-01T12:00:00.000Z",
      hourly: BEYOND_USE.hourly,
      daily: BEYOND_USE.daily,
      weekly: BEYOND_USE.weekly,
      monthly: BEYOND_USE.monthly,
    });
  });

  it("dates the beyond-use copies one interval on as Postgres does, never a count of days", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const done = await completing(scenario, subjectRequestId, ANCHORED_ON_A_31ST);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect({
      hourly: row?.beyond_use_hourly_at.toISOString(),
      daily: row?.beyond_use_daily_at.toISOString(),
      weekly: row?.beyond_use_weekly_at.toISOString(),
      monthly: row?.beyond_use_monthly_at.toISOString(),
    }).toEqual({
      hourly: BEYOND_USE_FROM_THE_31ST.hourly,
      daily: BEYOND_USE_FROM_THE_31ST.daily,
      weekly: BEYOND_USE_FROM_THE_31ST.weekly,

      monthly: BEYOND_USE_FROM_THE_31ST.monthly,
    });

    expect(done.report).toContain(
      `${BEYOND_USE_FROM_THE_31ST.hourly} · ${BEYOND_USE_FROM_THE_31ST.daily} · ` +
        `${BEYOND_USE_FROM_THE_31ST.weekly} · ${BEYOND_USE_FROM_THE_31ST.monthly}.`,
    );
  });

  it("names which anchor it used, so the reader is never left to guess between the lock and the last dump", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const done = await completing(scenario, subjectRequestId);

    expect(done.report).toContain(
      "The anchor above is the instant this routine took the erasure lock, not the stamp of the " +
        "last dump before it: no backup run is recorded, so the last dump precedes the anchor and " +
        "every date above is the latest a copy can expire.",
    );
  });

  it("says the object store is untouched and that no export is recalled, because none has been issued", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const done = await completing(scenario, subjectRequestId);

    expect(done.report).toContain(
      "The object store is untouched: a company document that mentions a person is suppressed " +
        "when it is next reprocessed, never deleted.",
    );
    expect(done.report).toContain(
      "Exports already issued are not recalled. None have been issued.",
    );
  });

  it("lists the concepts whose body names the person by IRI, for the owner to edit", async () => {
    const { iri, done } = await theBundleRewritten();

    expect(done.report).toContain("Names inside concept bodies, for the owner to edit:");
    expect(done.report).toContain(`- ${iri}`);
  });

  it("says so plainly when no concept body names the person", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const done = await completing(scenario, subjectRequestId);

    expect(done.report).toContain("None: no concept body names this person.");
  });
});

describe("the lock the hourly dump waits behind", () => {
  it("keeps pg_try_advisory_lock(41) refused for the whole routine and gives it back at the end", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();
    const tried: boolean[] = [];

    const done = await whileActsWaitAt(db().pool, "erasure_request", "INSERT", async (release) => {
      const routine = runningTheRoutine(scenario, subjectRequestId);

      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      tried.push(await theDumpCouldTakeItsLock());
      await release();
      return routine;
    });
    tried.push(await theDumpCouldTakeItsLock());

    expect(done.ok).toBe(true);

    expect(tried).toEqual([false, true]);
  });
});

describe("the ledger an erasure never rewrites", () => {
  it("books its completion to the platform's own actor and leaves every earlier row byte-identical", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();
    const before = await rowTextIn("audit_event", scenario.workspaceId);
    const earlier = new Set(before.map((row) => row.id));

    const done = await completing(scenario, subjectRequestId);

    const after = await rowTextIn("audit_event", scenario.workspaceId);
    expect(after.filter((row) => earlier.has(row.id))).toEqual(before);
    expect(after.filter((row) => !earlier.has(row.id))).toHaveLength(1);

    const completions = await ledgerRowsOf(db().pool, scenario.workspaceId, COMPLETED);
    expect(
      completions.map((row) => ({ id: row.id, actor: row.actor, subject: row.subject_id })),
    ).toEqual([{ id: done.auditEventId, actor: ERASURE_ACTOR, subject: done.erasureRequestId }]);

    const [completion] = completions;
    expect(Object.keys(completion?.detail ?? {}).sort()).toEqual([
      "locations",
      "personId",
      "subjectRequestId",
    ]);
  });

  it("names in its detail the person the map found, whether or not the request named one", async () => {
    const named = await workspaceWithAnErasureRequest();
    const byAddressAlone = await arrange();
    const email = addressOf("nadia");
    const person = await memberOf(db().pool, byAddressAlone.workspaceId, email);

    const anonymous = await seedingWith(db().pool, (seed) =>
      seed.subjectRequest({
        workspaceId: byAddressAlone.workspaceId,
        kind: "erasure",
        personId: null,
        identifiers: { emails: [email], names: [], other: [] },
      }),
    );

    const forTheNamed = await completing(named.scenario, named.subjectRequestId);
    const forTheAddress = await completing(byAddressAlone, anonymous.id);

    const [namedRow] = await ledgerRowsOf(db().pool, named.scenario.workspaceId, COMPLETED);
    const [foundRow] = await ledgerRowsOf(db().pool, byAddressAlone.workspaceId, COMPLETED);
    expect({ id: namedRow?.id, personId: namedRow?.detail["personId"] }).toEqual({
      id: forTheNamed.auditEventId,
      personId: named.person.id,
    });
    expect({ id: foundRow?.id, personId: foundRow?.detail["personId"] }).toEqual({
      id: forTheAddress.auditEventId,
      personId: person.id,
    });

    const request = await db().pool.query<{ person_id: string | null }>(
      "SELECT person_id FROM subject_request WHERE workspace_id = $1 AND id = $2",
      [byAddressAlone.workspaceId, anonymous.id],
    );
    expect(request.rows[0]?.person_id).toBeNull();
  });
});

describe("a second run of the routine", () => {
  it("writes one more ledger event and moves nothing else, which is what the replay relies on", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const first = await completing(scenario, subjectRequestId);
    const requests = await rowTextIn("erasure_request", scenario.workspaceId);
    const ledger = await rowTextIn("audit_event", scenario.workspaceId);

    const again = await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(await rowTextIn("erasure_request", scenario.workspaceId)).toEqual(requests);
    expect(again.report).toEqual(first.report);
    expect(again.completedAt).toEqual(first.completedAt);

    const after = await rowTextIn("audit_event", scenario.workspaceId);
    const earlier = new Set(ledger.map((row) => row.id));
    expect(after.filter((row) => earlier.has(row.id))).toEqual(ledger);
    expect(after.filter((row) => !earlier.has(row.id)).map((row) => row.id)).toEqual([
      again.auditEventId,
    ]);
    expect(again.auditEventId).not.toEqual(first.auditEventId);
  });
});

describe("the git step", () => {
  beforeAll(async () => {
    await theBundleRewritten();
  });

  it("leaves no object at any commit holding the address the files and the author lines carried", async () => {
    const { email, before, after } = await theBundleRewritten();

    expect(before.objects).toContain(`human:${email}`);

    expect(after.objects).not.toContain(email);
    expect(after.objects).toContain("human:");
  });

  it("mailmaps every author line in the bundle to the erasure pseudonym", async () => {
    const { email, before, after, pseudonym } = await theBundleRewritten();
    expect(before.authors).toEqual([`Priya Anand <${email}>`, `Priya Anand <${email}>`]);

    expect(after.authors).toEqual([
      `human:${pseudonym} <${pseudonym}@erased.better-answers.invalid>`,
      `human:${pseudonym} <${pseudonym}@erased.better-answers.invalid>`,
    ]);
  });

  it("prunes the pre-rewrite objects, so git cat-file -e fails on every hash the history held", async () => {
    const { before, after, stillPresent } = await theBundleRewritten();
    expect(before.history).toHaveLength(2);

    expect(stillPresent).toEqual([false, false]);

    expect(after.history).toHaveLength(2);
  });

  it("finds nothing to replace on a second run and moves the history no further", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();

    await completing(scenario, subjectRequestId);
    const rewritten = await bundleHistory(scenario.git, scenario.workspaceId);
    const authors = await authorLinesOf(scenario.git, scenario.workspaceId);
    const rows = await bundleCommitRowsIn(scenario.workspaceId);

    await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(rewritten);
    expect(await authorLinesOf(scenario.git, scenario.workspaceId)).toEqual(authors);

    expect(await bundleCommitRowsIn(scenario.workspaceId)).toEqual(rows);
  });

  it("rewrites the address the subject's own user row carries when the request names them by id alone", async () => {
    const { scenario, email, subjectRequestId } = await bundleNamingThePerson({ byIdAlone: true });
    const before = await everyObjectOf(scenario.git, scenario.workspaceId);
    expect(before).toContain(`human:${email}`);

    const done = await completing(scenario, subjectRequestId);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(await everyObjectOf(scenario.git, scenario.workspaceId)).not.toContain(email);
    expect(await authorLinesOf(scenario.git, scenario.workspaceId)).toEqual([
      `human:${row?.pseudonym} <${row?.pseudonym}@erased.better-answers.invalid>`,
      `human:${row?.pseudonym} <${row?.pseudonym}@erased.better-answers.invalid>`,
    ]);

    expect(done.report).toContain("bundle-commit: found 2, moved 2");
  });

  it("refuses when the bundle names the person only by an address already erased to", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();
    await completing(scenario, subjectRequestId);
    const [erased] = await erasureRowsIn(scenario.workspaceId);
    const rewritten = await bundleHistory(scenario.git, scenario.workspaceId);
    const tombstone = `${erased?.pseudonym ?? ""}@erased.better-answers.invalid`;
    const second = await erasureRequestAbout(scenario.workspaceId, null, tombstone);

    const run = await runningTheRoutine(scenario, second, RAN_AGAIN_AT);

    expect(run).toEqual({ ok: false, error: "no-address" });

    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(rewritten);
    const standing = await erasureRowsIn(scenario.workspaceId);
    expect({
      first: standing.find((row) => row.subject_request_id === subjectRequestId)?.completed_at,
      second: standing.find((row) => row.subject_request_id === second)?.completed_at,
    }).toEqual({ first: LOCKED_AT, second: null });
  });
});

describe("the bundle_commit rows the rewrite moves", () => {
  beforeAll(async () => {
    await theBundleRewritten();
  });

  it("names the rewritten hashes, parents and all, and carries the index row's key with them", async () => {
    const { before, after, commitOfTheConcept } = await theBundleRewritten();
    expect(before.rows.map((row) => row.sha)).toEqual(before.history);

    expect(after.rows.map((row) => row.sha)).toEqual(after.history);

    expect(after.rows.map((row) => row.parent_sha)).toEqual([null, after.history[0]]);

    expect(commitOfTheConcept).toEqual(after.history[0]);
  });

  it("leaves the reconciler nothing to replay, because the head and the watermark agree", async () => {
    const { scenario } = await theBundleRewritten();

    const swept = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    if (!swept.ok) throw new Error(`the reconciler refused: ${String(swept.error)}`);

    expect(swept.value.replayed).toEqual([]);
    expect(swept.value.skipped).toEqual([]);
    expect(swept.value.watermark).toEqual(swept.value.head);
  });

  it("records what the two families did in the report's actions, rather than reshaping them", async () => {
    const { actions } = await theBundleRewritten();

    expect(actions).toMatchObject({
      "concept-file": { rewritten: 2 },
      "bundle-commit": { moved: 2 },
    });

    expect(actions["concept-file"]).toHaveProperty("found");
  });
});

describe("the checks the rewrite moved", () => {
  beforeAll(async () => {
    await theBundleRewritten();
  });

  it("carries each one onto the new hash under origin erasure-rewrite, and the trust reading stands with the erased person named by id alone", async () => {
    const {
      email,
      person,
      iri,
      checksBefore,
      checksAfter,
      indexedBefore,
      indexedAfter,
      trustBefore,
      trustAfter,
    } = await theBundleRewritten();
    const before = checksBefore.find((check) => check.iri === iri);
    const indexBefore = indexedBefore.find((row) => row.iri === iri);

    expect(before?.content_hash).toEqual(indexBefore?.content_hash);
    expect(before?.origin).toEqual("platform");

    const after = checksAfter.find((check) => check.iri === iri);
    const indexAfter = indexedAfter.find((row) => row.iri === iri);

    expect(indexBefore?.body).toContain(email);
    expect(indexAfter?.content_hash).not.toEqual(indexBefore?.content_hash);
    expect(indexAfter?.body).not.toContain(email);
    expect({
      hash: after?.content_hash,
      origin: after?.origin,
      actor: after?.actor,
      at: after?.checked_at.toISOString(),
    }).toEqual({
      hash: indexAfter?.content_hash,

      origin: "erasure-rewrite",
      actor: before?.actor,
      at: before?.checked_at.toISOString(),
    });

    expect(trustBefore[0]).toMatchObject({ checkedBy: "Priya Anand" });
    expect(trustAfter[0]).toEqual({
      tier: "human-reviewed",
      status: "current",
      checkedBy: actorIdOfPerson(person.id),
      checkedAt: "2026-04-05T09:00:00.000Z",
      rider: null,
    });
  });

  it("leaves a check alone when the rewrite touched only the keys ADR 0019 keeps out of the hash, the reading naming the erased person by id alone", async () => {
    const { person, steadyIri, checksBefore, checksAfter, trustBefore, trustAfter } =
      await theBundleRewritten();

    expect(checksAfter.find((check) => check.iri === steadyIri)).toEqual(
      checksBefore.find((check) => check.iri === steadyIri),
    );
    expect(trustBefore[1]).toMatchObject({ checkedBy: "Priya Anand" });
    expect(trustAfter[1]).toEqual({
      tier: "human-reviewed",
      status: "current",
      checkedBy: actorIdOfPerson(person.id),
      checkedAt: "2026-04-05T09:00:00.000Z",
      rider: null,
    });
  });

  it("records what it moved in the report's actions, rather than reshaping them", async () => {
    const { actions } = await theBundleRewritten();

    expect(actions).toMatchObject({
      "concept-file": { reindexed: 1 },
      "concept-verification": { rehashed: 1 },
    });
  });
});

describe("the identity set on the person's last membership", () => {
  it("pseudonymises the user row with its id kept, so every ledger row still resolves to it", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const acted = await seedingWith(db().pool, (seed) =>
      seed.auditEvent({
        workspaceId: scenario.workspaceId,
        actor: actorIdOfPerson(person.id),
        subjectId: ulid(),
      }),
    );

    await completing(scenario, subjectRequestId);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    const after = await userRowOf(person.id);
    expect({ id: after?.id, name: after?.name, image: after?.image }).toEqual({
      id: person.id,
      name: "",
      image: null,
    });

    expect(after?.email).toEqual(`${row?.pseudonym}@erased.better-answers.invalid`);
    expect(after?.email_verified).toBe(false);
    expect(await personNamedBy(scenario.workspaceId, acted.id)).toEqual(person.id);
  });

  it("deletes the person's sessions, verification rows, invitations and linked accounts", async () => {
    const { scenario, person, email, subjectRequestId } = await workspaceWithAnErasureRequest();
    await identityRowsFor(db().pool, { userId: person.id, email });
    await seedingWith(db().pool, (seed) =>
      seed.invitation({ workspaceId: scenario.workspaceId, email }),
    );
    expect(await identityRowCountsFor(scenario.workspaceId, person.id, email)).toEqual({
      sessions: 1,
      accounts: 1,
      verifications: 1,
      invitations: 1,
    });

    await completing(scenario, subjectRequestId);

    expect(await identityRowCountsFor(scenario.workspaceId, person.id, email)).toEqual({
      sessions: 0,
      accounts: 0,
      verifications: 0,
      invitations: 0,
    });
  });

  it("deletes the codes the subject's own address holds and never one keyed by an address in the set that is not theirs", async () => {
    const scenario = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);

    const notTheirs = addressOf("a-client-contact");
    await verificationCodeFor(db().pool, email);
    await verificationCodeFor(db().pool, notTheirs);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email, [
      notTheirs,
    ]);

    await completing(scenario, subjectRequestId);

    expect({
      theirs: await verificationsFor(email),
      theStranger: await verificationsFor(notTheirs),
    }).toEqual({ theirs: 0, theStranger: 1 });
  });

  it("ends this workspace's membership alone when the person holds another, and leaves the identity set standing", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Editor" }),
    );
    await identityRowsFor(db().pool, { userId: person.id, email });
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);

    await completing(scenario, subjectRequestId);

    const after = await userRowOf(person.id);
    expect({ email: after?.email, name: after?.name }).toEqual({ email, name: "Priya Anand" });
    expect(await identityRowCountsFor(scenario.workspaceId, person.id, email)).toMatchObject({
      sessions: 1,
      accounts: 1,
    });

    expect(await workspacesMemberOf(person.id)).toEqual([elsewhere.workspaceId]);
  });

  it("deletes the invitations the address holds in every workspace on the last-membership arm, and never a stranger's", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);

    const notTheirs = addressOf("a-client-contact");
    for (const workspaceId of [scenario.workspaceId, elsewhere.workspaceId]) {
      await seedingWith(db().pool, (seed) => seed.invitation({ workspaceId, email }));
    }
    await seedingWith(db().pool, (seed) =>
      seed.invitation({ workspaceId: elsewhere.workspaceId, email: notTheirs }),
    );
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email, [
      notTheirs,
    ]);

    await completing(scenario, subjectRequestId);

    expect(await identityRowCountsFor(scenario.workspaceId, person.id, email)).toMatchObject({
      invitations: 0,
    });
    expect(await identityRowCountsFor(elsewhere.workspaceId, person.id, email)).toMatchObject({
      invitations: 0,
    });

    expect(await identityRowCountsFor(elsewhere.workspaceId, person.id, notTheirs)).toMatchObject({
      invitations: 1,
    });
  });

  it("leaves every invitation standing when another membership does, because the address is still theirs to be invited by", async () => {
    const staying = await arrange();
    const elsewhere = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, staying.workspaceId, email);
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Editor" }),
    );
    for (const workspaceId of [staying.workspaceId, elsewhere.workspaceId]) {
      await seedingWith(db().pool, (seed) => seed.invitation({ workspaceId, email }));
    }
    const subjectRequestId = await erasureRequestAbout(staying.workspaceId, person.id, email);

    await completing(staying, subjectRequestId);

    expect(await identityRowCountsFor(staying.workspaceId, person.id, email)).toMatchObject({
      invitations: 1,
    });
    expect(await identityRowCountsFor(elsewhere.workspaceId, person.id, email)).toMatchObject({
      invitations: 1,
    });
  });

  it("says which arm ran in the report, and never how many memberships it counted", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();
    const elsewhere = await arrange();
    const email = addressOf("nadia");
    const other = await memberOf(db().pool, scenario.workspaceId, email);
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: elsewhere.workspaceId, userId: other.id, role: "Editor" }),
    );
    const theirs = await erasureRequestAbout(scenario.workspaceId, other.id, email);

    const last = await completing(scenario, subjectRequestId);
    const held = await completing(scenario, theirs);

    expect(last.report).toContain("identity-user: arm last-membership");
    expect(held.report).toContain("identity-user: arm membership-ended");

    expect(held.report).not.toContain(elsewhere.workspaceId);
  });
});

const THE_SET = { emails: ["priya@example.invalid"], names: ["Priya Anand"], other: [] };

const mapNaming = (documents: readonly string[]): ErasureMap =>
  ERASURE_FAMILIES.map((family) => ({
    family,
    categories: [],
    locations: family === "source-document" ? [...documents] : [],
  }));

const suppressionsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{
    workspace_id: string;
    erasure_request_id: string;
    document_id: string;
    identifiers: Record<string, readonly string[]>;
  }>(
    `SELECT workspace_id, erasure_request_id, document_id, identifiers
       FROM suppression WHERE workspace_id = $1 ORDER BY document_id`,
    [workspaceId],
  );
  return read.rows;
};

const jobsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{ kind: string; reason: string | null; status: string }>(
    "SELECT kind, reason, status FROM job WHERE workspace_id = $1 ORDER BY id",
    [workspaceId],
  );
  return read.rows;
};

const anOpenErasure = (workspaceId: string) =>
  seedingWith(db().pool, async (seed) => {
    const request = await seed.subjectRequest({ workspaceId, kind: "erasure" });
    return seed.erasureRequest({ workspaceId, subjectRequestId: request.id });
  });

const documentIn = (workspaceId: string, bindingId: string) =>
  seedingWith(db().pool, (seed) => seed.sourceDocument({ workspaceId, bindingId }));

const bindingIn = (workspaceId: string) =>
  seedingWith(db().pool, (seed) => seed.sourceBinding({ workspaceId }));

const anErasureOverOneDocument = async () => {
  const scenario = await arrange();
  const erasure = await anOpenErasure(scenario.workspaceId);
  const binding = await bindingIn(scenario.workspaceId);
  const named = await documentIn(scenario.workspaceId, binding.id);
  return { scenario, erasure, binding, named };
};

describe("the suppression written for every document the map found", () => {
  it("writes one row per document, keyed by workspace, erasure request and document, carrying the request's set", async () => {
    const { scenario, erasure, binding, named } = await anErasureOverOneDocument();
    const alsoNamed = await documentIn(scenario.workspaceId, binding.id);

    const unnamed = await documentIn(scenario.workspaceId, binding.id);

    const written = await withScope(ERASURE, scenario.postgres, scenario.workspaceId, (tx) =>
      suppressTheDocuments(ERASURE, tx, {
        workspaceId: scenario.workspaceId,
        erasureRequestId: erasure.id,
        identifiers: THE_SET,
        map: mapNaming([named.id, alsoNamed.id]),
      }),
    );

    expect(written).toEqual({ suppressed: 2 });
    const rows = await suppressionsIn(scenario.workspaceId);
    expect(rows.map((row) => row.document_id).sort()).toEqual([named.id, alsoNamed.id].sort());
    expect(rows.map((row) => row.document_id)).not.toContain(unnamed.id);

    expect(rows.map((row) => [row.workspace_id, row.erasure_request_id]).sort()).toEqual(
      [
        [scenario.workspaceId, erasure.id],
        [scenario.workspaceId, erasure.id],
      ].sort(),
    );
    expect(rows.map((row) => row.identifiers)).toEqual([
      { emails: ["priya@example.invalid"], names: ["Priya Anand"], other: [] },
      { emails: ["priya@example.invalid"], names: ["Priya Anand"], other: [] },
    ]);
  });

  it("writes nothing for a set that names nobody, because a suppression that keeps nothing out is an erasure undone at the next conversion", async () => {
    const { scenario, erasure, named } = await anErasureOverOneDocument();

    const emptied = await withScope(ERASURE, scenario.postgres, scenario.workspaceId, (tx) =>
      suppressTheDocuments(ERASURE, tx, {
        workspaceId: scenario.workspaceId,
        erasureRequestId: erasure.id,
        identifiers: { emails: [], names: [], other: [] },
        map: mapNaming([named.id]),
      }),
    );
    const absent = await withScope(ERASURE, scenario.postgres, scenario.workspaceId, (tx) =>
      suppressTheDocuments(ERASURE, tx, {
        workspaceId: scenario.workspaceId,
        erasureRequestId: erasure.id,
        identifiers: null,
        map: mapNaming([named.id]),
      }),
    );

    expect([emptied, absent]).toEqual([{ suppressed: 0 }, { suppressed: 0 }]);
    expect(await suppressionsIn(scenario.workspaceId)).toEqual([]);
  });

  it("leaves the rows it already wrote exactly as they are when the arm runs a second time", async () => {
    const { scenario, erasure, named } = await anErasureOverOneDocument();
    const input = {
      workspaceId: scenario.workspaceId,
      erasureRequestId: erasure.id,
      identifiers: THE_SET,
      map: mapNaming([named.id]),
    };

    const first = await withScope(ERASURE, scenario.postgres, scenario.workspaceId, (tx) =>
      suppressTheDocuments(ERASURE, tx, input),
    );
    const before = await suppressionsIn(scenario.workspaceId);

    const again = await withScope(ERASURE, scenario.postgres, scenario.workspaceId, (tx) =>
      suppressTheDocuments(ERASURE, tx, {
        ...input,
        identifiers: { emails: ["someone-else@example.invalid"], names: [], other: [] },
      }),
    );

    expect([first, again]).toEqual([{ suppressed: 1 }, { suppressed: 1 }]);
    expect(await suppressionsIn(scenario.workspaceId)).toEqual(before);
  });

  it("writes none through the routine today, and the report says the documents arm found none", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const binding = await bindingIn(scenario.workspaceId);
    await documentIn(scenario.workspaceId, binding.id);

    const done = await completing(scenario, subjectRequestId);

    expect(await suppressionsIn(scenario.workspaceId)).toEqual([]);
    expect(done.report).toContain("source-document: bindings 0, found 0, suppressed 0");
  });
});

describe("the full-rebuild the erasure asks for", () => {
  it("puts one job on the queue with reason erasure, after the lock is taken and before it is given back", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    await completing(scenario, subjectRequestId);

    expect(await jobsIn(scenario.workspaceId)).toEqual([
      { kind: "full-rebuild", reason: "erasure", status: "queued" },
    ]);
  });

  it("puts no second one on the queue when the request is run again, because a replay writes a ledger event and nothing else", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    await completing(scenario, subjectRequestId);
    await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(await jobsIn(scenario.workspaceId)).toEqual([
      { kind: "full-rebuild", reason: "erasure", status: "queued" },
    ]);
  });

  it("names the bindings holding the documents the map found, once each, which is the list S1's reprocess runs over", async () => {
    const scenario = await arrange();
    const shared = await bindingIn(scenario.workspaceId);
    const apart = await bindingIn(scenario.workspaceId);
    const untouched = await bindingIn(scenario.workspaceId);
    const one = await documentIn(scenario.workspaceId, shared.id);
    const another = await documentIn(scenario.workspaceId, shared.id);
    const third = await documentIn(scenario.workspaceId, apart.id);
    await documentIn(scenario.workspaceId, untouched.id);

    const rederived = await rederiveAfterErasure(ERASURE, scenario.postgres, {
      workspaceId: scenario.workspaceId,
      map: mapNaming([one.id, another.id, third.id]),

      completedAt: LOCKED_AT,
    });

    expect(rederived.bindingsToReprocess).toEqual([shared.id, apart.id].sort());
    expect(rederived.rebuildJobId).toBeNull();
    expect(await jobsIn(scenario.workspaceId)).toEqual([]);
  });
});

const completedForASubjectWithNoUserRow = async () => {
  const scenario = await arrange();
  const seeded = await seedingWith(db().pool, (seed) =>
    seed.subjectRequest({
      workspaceId: scenario.workspaceId,
      kind: "erasure",
      personId: null,
      identifiers: THE_SET,
    }),
  );
  return { scenario, done: await completing(scenario, seeded.id) };
};

describe("a subject with no user row", () => {
  it("runs with its git and identity arms finding nothing and its suppression arm doing the erasure, and the report says which arms ran", async () => {
    const { scenario, done } = await completedForASubjectWithNoUserRow();

    expect(done.report).toContain("concept-file: found 0, reindexed 0, rewritten 0");
    expect(done.report).toContain("bundle-commit: found 0, moved 0");
    expect(done.report).toContain(
      "identity-user: arm no-person, found 0, membershipsEnded 0, pseudonymised 0",
    );
    expect(done.report).toContain("source-document: bindings 0, found 0, suppressed 0");

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row?.completed_at).not.toBeNull();
    expect(await jobsIn(scenario.workspaceId)).toEqual([
      { kind: "full-rebuild", reason: "erasure", status: "queued" },
    ]);
  });
});

const replayCopyOf = async (workspaceId: string, erasureRequestId: string): Promise<string> => {
  const got = await getPlatformObject(
    ERASURE,
    objects().door,
    `erasures/${workspaceId}/${erasureRequestId}.json`,
  );
  if (!got.ok) throw new Error(`the replay copy was not readable: ${got.error}`);
  return textOf(got.value);
};

// Strict, so a key the copy gained is refused here and never read past as a finder's own.
const copyAsRead = z.strictObject({
  workspaceId: z.string(),
  subjectRequestId: z.string(),
  erasureRequestId: z.string(),
  personId: z.string().optional(),
  pseudonym: z.string(),
  completedAt: z.string(),
  identifiers: z.object({
    emails: z.array(z.string()),
    names: z.array(z.string()),
    other: z.array(z.string()),
  }),
  map: z.array(z.object({ family: z.string(), locations: z.array(z.string()) })),
});

const readCopy = async (workspaceId: string, erasureRequestId: string) =>
  copyAsRead.parse(JSON.parse(await replayCopyOf(workspaceId, erasureRequestId)));

const replayCopiesIn = async (workspaceId: string): Promise<readonly string[]> => {
  const listed = await listPlatformObjects(ERASURE, objects().door, `erasures/${workspaceId}/`);
  if (!listed.ok) throw new Error(`the platform's prefix refused a listing: ${listed.error}`);
  return listed.value;
};

describe("the replay copy the restore reads", () => {
  it("lands under the platform's own prefix, where no workspace's principal can address it", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();

    const done = await completing(scenario, subjectRequestId);

    expect(await replayCopiesIn(scenario.workspaceId)).toEqual([
      `erasures/${scenario.workspaceId}/${done.erasureRequestId}.json`,
    ]);

    const theirs = await listObjects(scenario.admin, objects().door, "");
    expect(theirs).toEqual({ ok: true, value: [] });
  });

  it("carries what a re-run must have: the pseudonym, the identifier set and the map", async () => {
    const { scenario, email, person, subjectRequestId } = await bundleNamingThePerson();

    const done = await completing(scenario, subjectRequestId);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    const copy = await readCopy(scenario.workspaceId, done.erasureRequestId);
    expect(copy.workspaceId).toEqual(scenario.workspaceId);
    expect(copy.subjectRequestId).toEqual(subjectRequestId);
    expect(copy.erasureRequestId).toEqual(done.erasureRequestId);
    expect(copy.personId).toEqual(person.id);

    expect(copy.pseudonym).toEqual(row?.pseudonym);
    expect(copy.completedAt).toEqual("2026-06-01T12:00:00.000Z");

    expect(copy.identifiers).toEqual({ emails: [email], names: ["Priya Anand"], other: [] });

    expect(copy.map.map((entry) => entry.family)).toEqual([...ERASURE_FAMILIES]);

    const found = copy.map.find((entry) => entry.family === "concept-file")?.locations ?? [];
    const paths = found.filter((at) => at.includes(":")).map((at) => at.slice(at.indexOf(":") + 1));
    expect([...new Set(paths)].sort()).toEqual(["knowledge/expenses.md", "knowledge/travel.md"]);
    expect(found.filter((at) => at.endsWith("(author line)"))).toHaveLength(2);
  });

  it("carries nothing a finder does not need — not the report, not the counts, not a value a location names", async () => {
    const { scenario, email, subjectRequestId } = await bundleNamingThePerson();

    const done = await completing(scenario, subjectRequestId);

    const text = await replayCopyOf(scenario.workspaceId, done.erasureRequestId);
    const copy = copyAsRead.parse(JSON.parse(text));

    expect(Object.keys(copy).sort()).toEqual([
      "completedAt",
      "erasureRequestId",
      "identifiers",
      "map",
      "personId",
      "pseudonym",
      "subjectRequestId",
      "workspaceId",
    ]);

    expect(text).toContain(email);
    expect(text).toContain(done.erasureRequestId);

    expect(text).not.toContain("Every actor identifier for this person has been rewritten");
    expect(text).not.toContain("Backup copies taken before");

    expect(text).not.toContain("rehashed");

    expect(text).not.toContain("Expenses are claimed within thirty days");
  });

  it("names no person for a subject with no user row, because an absent login is not a null one", async () => {
    const { scenario, done } = await completedForASubjectWithNoUserRow();

    const copy = await readCopy(scenario.workspaceId, done.erasureRequestId);
    expect(Object.keys(copy)).not.toContain("personId");

    expect(copy.identifiers).toEqual({
      emails: ["priya@example.invalid"],
      names: ["Priya Anand"],
      other: [],
    });
  });

  it("refuses to complete a request whose copy the store would not take, so no completion stands without one", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();

    const shut = openObjects({
      endpoint: "http://127.0.0.1:1",
      region: "garage",
      bucket: "better-answers",
      accessKeyId: "unreachable",
      secretAccessKey: "unreachable",
    });
    if (!shut.ok) throw new Error(`the door refused its settings: ${shut.error}`);

    const run = await runErasure(
      ERASURE,
      {
        git: scenario.git,
        postgres: scenario.postgres,
        objects: shut.value,
        clock: { now: () => LOCKED_AT },
      },
      { workspaceId: scenario.workspaceId, subjectRequestId },
    );

    expect(run.ok).toEqual(false);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row?.completed_at).toBeNull();
    expect(await replayCopiesIn(scenario.workspaceId)).toEqual([]);
  });

  it("leaves one copy and not two on a second run, still dated the completion the first run wrote", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();

    const first = await completing(scenario, subjectRequestId);
    const again = await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(again.erasureRequestId).toEqual(first.erasureRequestId);
    expect(await replayCopiesIn(scenario.workspaceId)).toEqual([
      `erasures/${scenario.workspaceId}/${first.erasureRequestId}.json`,
    ]);
    const copy = await readCopy(scenario.workspaceId, first.erasureRequestId);

    expect(copy.completedAt).toEqual("2026-06-01T12:00:00.000Z");
  });
});

describe("a request the routine will not run", () => {
  it("refuses an access request, because an access request is answered and never erased", async () => {
    const scenario = await arrange();
    const seeded = await seedingWith(db().pool, (seed) =>
      seed.subjectRequest({ workspaceId: scenario.workspaceId, kind: "access" }),
    );

    const run = await runningTheRoutine(scenario, seeded.id);

    expect(run).toEqual({ ok: false, error: "not-an-erasure" });
    expect(await erasureRowsIn(scenario.workspaceId)).toEqual([]);
  });

  it("refuses a request this workspace does not hold", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const theirs = await seedingWith(db().pool, (seed) =>
      seed.subjectRequest({ workspaceId: elsewhere.workspaceId, kind: "erasure" }),
    );

    const run = await runningTheRoutine(scenario, theirs.id);

    expect(run).toEqual({ ok: false, error: "no-such-request" });
  });
});
