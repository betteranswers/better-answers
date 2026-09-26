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
import { boundarySchemas, ulid } from "@better-answers/schema";

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
  suppressInTheWorkspace,
  type ErasureLog,
  type ErasureLogLine,
  type ErasureMap,
  type ErasureRun,
  type IdentityArm,
  type RunErasureRefusal,
} from "../src/erasure/index.ts";
import { actorIdOfPerson, type Result, type UserPrincipal } from "../src/kernel/index.ts";
import { setDisplayName, setOperatorMark } from "../src/workspaces/index.ts";
import { authorLinesOf, bundleHistory, everyObjectOf, objectPresent } from "./bundle.ts";
import { erasureDoorsFor } from "./erasure-doors.ts";
import { identityRowsFor, verificationCodeFor } from "./identity-rows.ts";
import { bootstrap } from "./platform.ts";
import { auditEventRowsOf } from "./sourced-concept.ts";
import { objectStoreForSuite, textOf } from "./suite-objects.ts";
import {
  addressOf,
  countWaitingOnLocks,
  readingAs,
  seedingWith,
  until,
  whileActsWaitAt,
  whileWritesAreRefused,
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

/**
 * This day tells a day count from a calendar interval: six months on is 28 February, 183 days
 * on 2 March.
 */
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

const INVITATIONS_WHEREVER_SENT =
  "Invitations sent to the address a person signs in with are deleted wherever they were sent, " +
  "by the request that ends their last membership; the invitation line above counts this " +
  "workspace's alone.";

const SIGN_IN_IDENTITY_REMOVED =
  "A person's sign-in identity is removed from the platform by the request that ends their " +
  "last membership.";

const DOCUMENTS_WITHHELD =
  "The original files in the object store are untouched; the identifiers named in this request " +
  "are withheld from the text of every document in this workspace, those held now and those " +
  "bound later, each time a document is indexed; and the documents found above are indexed " +
  "again now.";

/** Every run in the file logs here, so a case reads back the lines of its own request alone. */
const operatorLines: ErasureLogLine[] = [];

const operatorLog: ErasureLog = {
  info: (line) => {
    operatorLines.push(line);
  },
};

const operatorLinesAbout = (erasureRequestId: string): readonly ErasureLogLine[] =>
  operatorLines.filter((line) => line.erasure_request_id === erasureRequestId);

const runningTheRoutine = (
  scenario: Scenario,
  subjectRequestId: string,
  at: Date = LOCKED_AT,
): Promise<Result<ErasureRun, RunErasureRefusal | Error>> =>
  runErasure(ERASURE, erasureDoorsFor(scenario, objects().door, at, operatorLog), {
    workspaceId: scenario.workspaceId,
    subjectRequestId,
  });

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

const erasedOnEachArm = async (): Promise<{
  readonly runs: Readonly<Record<IdentityArm, ErasureRun>>;
  readonly elsewhereId: string;
}> => {
  const scenario = await arrange();
  const elsewhere = await arrange();
  const onlyHere = addressOf("priya");
  const heldElsewhere = addressOf("nadia");
  const lastMember = await memberOf(db().pool, scenario.workspaceId, onlyHere);
  const stillMember = await memberOf(db().pool, scenario.workspaceId, heldElsewhere);
  await seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: elsewhere.workspaceId, userId: stillMember.id, role: "Editor" }),
  );
  // The same records held here for each person, so a line that differs between them can differ
  // only by the arm.
  for (const [person, email] of [
    [lastMember, onlyHere],
    [stillMember, heldElsewhere],
  ] as const) {
    await identityRowsFor(db().pool, { userId: person.id, email });
    await seedingWith(db().pool, (seed) =>
      seed.invitation({ workspaceId: scenario.workspaceId, email }),
    );
  }
  const erased = async (personId: string | null, email: string): Promise<ErasureRun> =>
    completing(scenario, await erasureRequestAbout(scenario.workspaceId, personId, email));
  return {
    runs: {
      "last-membership": await erased(lastMember.id, onlyHere),
      "membership-ended": await erased(stillMember.id, heldElsewhere),
      "no-person": await erased(null, addressOf("a-contact")),
    },
    elsewhereId: elsewhere.workspaceId,
  };
};

let theArmsErased: ReturnType<typeof erasedOnEachArm> | undefined;

const erasedOnEachArmOnce = () => (theArmsErased ??= erasedOnEachArm());

const armsWhoseReportSays = async (sentence: string): Promise<readonly string[]> =>
  Object.entries((await erasedOnEachArmOnce()).runs)
    .filter(([, done]) => done.report.includes(sentence))
    .map(([arm]) => arm);

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

const committingInTurn = async (
  principal: UserPrincipal,
  git: GitDoor,
  email: string,
  files: ReturnType<typeof filesNaming>,
): Promise<readonly string[]> => {
  const author = { name: "Priya Anand", email };
  const shas: string[] = [];
  for (const [at, file] of files.entries()) {
    const written = await commit(principal, git, {
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
  return shas;
};

const bundleNamingThePerson = async (named: { readonly byIdAlone?: boolean } = {}) => {
  const { scenario, email, person, subjectRequestId } = await workspaceWithAnErasureRequest(named);
  const principal = await principalFor(db(), scenario.workspaceId, person.id);
  const files = filesNaming(email);
  const shas = await committingInTurn(principal, scenario.git, email, files);

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
  const read = await db().pool.query<{
    iri: string;
    content_hash: string;
    body: string;
    frontmatter: string;
  }>(
    `SELECT iri, content_hash, body, frontmatter::text AS frontmatter
       FROM concept_index WHERE workspace_id = $1 ORDER BY iri`,
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

const NOT_COUNTED = { sessions: "-1", accounts: "-1", verifications: "-1", invitations: "-1" };

const identityRowCountsFor = async (workspaceId: string, userId: string, email: string) => {
  const read = await db().pool.query<typeof NOT_COUNTED>(
    `SELECT (SELECT count(*) FROM session WHERE user_id = $1) AS sessions,
            (SELECT count(*) FROM account WHERE user_id = $1) AS accounts,
            (SELECT count(*) FROM verification WHERE lower(identifier) = $2) AS verifications,
            (SELECT count(*) FROM invitation WHERE workspace_id = $3 AND lower(email) = $2)
              AS invitations`,
    [userId, email.toLowerCase(), workspaceId],
  );
  const row = read.rows[0] ?? NOT_COUNTED;
  return {
    sessions: Number(row.sessions),
    accounts: Number(row.accounts),
    verifications: Number(row.verifications),
    invitations: Number(row.invitations),
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

const operatorMarkOf = async (userId: string): Promise<boolean | undefined> => {
  const read = await db().pool.query<{ operator: boolean }>(
    'SELECT operator FROM "user" WHERE id = $1',
    [userId],
  );
  return read.rows[0]?.operator;
};

/** @throws when the platform refuses the mark. */
const theOperator = async (scenario: Scenario, email: string): Promise<void> => {
  const marked = await setOperatorMark(bootstrap, scenario.postgres, { email, change: "grant" });
  if (!marked.ok || !marked.value.changed) throw new Error(`the mark was not set on ${email}`);
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
  it("mints one opaque id per request, kept on rerun", async () => {
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

  it("mints a different one in each workspace erasing the person", async () => {
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

  it("states four beyond-use dates from the lock, in fixed words", async () => {
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

  it("dates beyond use by calendar interval, never by day count", async () => {
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

  it("says its anchor is the lock, not the last dump", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const done = await completing(scenario, subjectRequestId);

    expect(done.report).toContain(
      "The anchor above is the instant this routine took the erasure lock, not the stamp of the " +
        "last dump before it: no backup run is recorded, so the last dump precedes the anchor and " +
        "every date above is the latest a copy can expire.",
    );
  });

  it("says no export is recalled, since none was issued", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const done = await completing(scenario, subjectRequestId);

    expect(done.report).toContain(
      "Exports already issued are not recalled. None have been issued.",
    );
  });

  it("says on every arm the identifiers are withheld from documents", async () => {
    expect(await armsWhoseReportSays(DOCUMENTS_WITHHELD)).toEqual([
      "last-membership",
      "membership-ended",
      "no-person",
    ]);
    expect(await armsWhoseReportSays("The object store is untouched")).toEqual([]);
  });

  it("says on every arm that invitations are deleted wherever sent", async () => {
    expect(await armsWhoseReportSays(INVITATIONS_WHEREVER_SENT)).toEqual([
      "last-membership",
      "membership-ended",
      "no-person",
    ]);
  });

  it("says on every arm when a sign-in identity is removed", async () => {
    expect(await armsWhoseReportSays(SIGN_IN_IDENTITY_REMOVED)).toEqual([
      "last-membership",
      "membership-ended",
      "no-person",
    ]);
  });

  it("lists by IRI each concept whose body names the person", async () => {
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
  it("holds the dump's lock throughout the routine, then releases it", async () => {
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

describe("the audit log an erasure never rewrites", () => {
  it("books completion to the platform actor, leaving earlier rows unchanged", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();
    const before = await rowTextIn("audit_event", scenario.workspaceId);
    const earlier = new Set(before.map((row) => row.id));

    const done = await completing(scenario, subjectRequestId);

    const after = await rowTextIn("audit_event", scenario.workspaceId);
    expect(after.filter((row) => earlier.has(row.id))).toEqual(before);
    expect(after.filter((row) => !earlier.has(row.id))).toHaveLength(1);

    const completions = await auditEventRowsOf(db().pool, scenario.workspaceId, COMPLETED);
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

  it("leaves the identity-set audit events as they were", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const named = await setDisplayName(bootstrap, scenario.postgres, {
      personId: person.id,
      displayName: "Priya Anand",
    });
    expect(named.ok).toBe(true);
    const before = await db().pool.query<{ row: string }>(
      "SELECT row_to_json(e)::text AS row FROM identity_audit_event e WHERE e.subject_id = $1",
      [person.id],
    );

    await completing(scenario, subjectRequestId);

    const after = await db().pool.query<{ row: string }>(
      "SELECT row_to_json(e)::text AS row FROM identity_audit_event e WHERE e.subject_id = $1",
      [person.id],
    );
    expect(before.rows).toHaveLength(1);
    expect(after.rows).toEqual(before.rows);
    expect(await userRowOf(person.id)).toMatchObject({ id: person.id, name: "" });
  });

  it("names in its detail the person the map found", async () => {
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

    const [namedRow] = await auditEventRowsOf(db().pool, named.scenario.workspaceId, COMPLETED);
    const [foundRow] = await auditEventRowsOf(db().pool, byAddressAlone.workspaceId, COMPLETED);
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
  it("writes one more audit event and moves nothing else", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const first = await completing(scenario, subjectRequestId);
    const requests = await rowTextIn("erasure_request", scenario.workspaceId);
    const auditEvents = await rowTextIn("audit_event", scenario.workspaceId);

    const again = await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(await rowTextIn("erasure_request", scenario.workspaceId)).toEqual(requests);
    expect(again.report).toEqual(first.report);
    expect(again.completedAt).toEqual(first.completedAt);

    const after = await rowTextIn("audit_event", scenario.workspaceId);
    const earlier = new Set(auditEvents.map((row) => row.id));
    expect(after.filter((row) => earlier.has(row.id))).toEqual(auditEvents);
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

  it("leaves no object at any commit holding the address", async () => {
    const { email, before, after } = await theBundleRewritten();

    expect(before.objects).toContain(`human:${email}`);

    expect(after.objects).not.toContain(email);
    expect(after.objects).toContain("human:");
  });

  it("mailmaps every author line in the bundle to the pseudonym", async () => {
    const { email, before, after, pseudonym } = await theBundleRewritten();
    expect(before.authors).toEqual([`Priya Anand <${email}>`, `Priya Anand <${email}>`]);

    expect(after.authors).toEqual([
      `human:${pseudonym} <${pseudonym}@erased.better-answers.invalid>`,
      `human:${pseudonym} <${pseudonym}@erased.better-answers.invalid>`,
    ]);
  });

  it("prunes every object the history held before the rewrite", async () => {
    const { before, after, stillPresent } = await theBundleRewritten();
    expect(before.history).toHaveLength(2);

    expect(stillPresent).toEqual([false, false]);

    expect(after.history).toHaveLength(2);
  });

  it("moves the history no further on a second run", async () => {
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

  it("rewrites the sign-in address for a request by id alone", async () => {
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

  it("refuses a request naming only an address already erased to", async () => {
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

  it("names the rewritten hashes and parents, carrying the index's key", async () => {
    const { before, after, commitOfTheConcept } = await theBundleRewritten();
    expect(before.rows.map((row) => row.sha)).toEqual(before.history);

    expect(after.rows.map((row) => row.sha)).toEqual(after.history);

    expect(after.rows.map((row) => row.parent_sha)).toEqual([null, after.history[0]]);

    expect(commitOfTheConcept).toEqual(after.history[0]);
  });

  it("leaves the reconciler nothing to replay, head and watermark agreeing", async () => {
    const { scenario } = await theBundleRewritten();

    const swept = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    if (!swept.ok) throw new Error(`the reconciler refused: ${String(swept.error)}`);

    expect(swept.value.replayed).toEqual([]);
    expect(swept.value.skipped).toEqual([]);
    expect(swept.value.watermark).toEqual(swept.value.head);
  });

  it("records both families' work in the report's actions", async () => {
    const { actions } = await theBundleRewritten();

    expect(actions).toMatchObject({
      "concept-file": { rewritten: 2 },
      "bundle-commit": { moved: 2 },
    });

    expect(actions["concept-file"]).toHaveProperty("found");
  });
});

const checkOn = (checks: Awaited<ReturnType<typeof checksIn>>, iri: string) => {
  const check = checks.find((one) => one.iri === iri);
  return {
    hash: check?.content_hash,
    origin: check?.origin,
    actor: check?.actor,
    at: check?.checked_at.toISOString(),
  };
};

describe("the checks the rewrite moved", () => {
  beforeAll(async () => {
    await theBundleRewritten();
  });

  it("carries each onto the new hash under origin erasure-rewrite", async () => {
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
    const before = checkOn(checksBefore, iri);
    const indexBefore = indexedBefore.find((row) => row.iri === iri);

    expect(before.hash).toEqual(indexBefore?.content_hash);
    expect(before.origin).toEqual("platform");

    const indexAfter = indexedAfter.find((row) => row.iri === iri);

    expect(indexBefore?.body).toContain(email);
    expect(indexAfter?.content_hash).not.toEqual(indexBefore?.content_hash);
    expect(indexAfter?.body).not.toContain(email);
    expect(checkOn(checksAfter, iri)).toEqual({
      hash: indexAfter?.content_hash,

      origin: "erasure-rewrite",
      actor: before.actor,
      at: before.at,
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

  it("leaves a check alone when only unhashed keys were rewritten", async () => {
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

  it("reindexes a concept rewritten only in unhashed keys", async () => {
    const { email, steadyIri, indexedBefore, indexedAfter } = await theBundleRewritten();
    const steadyBefore = indexedBefore.find((row) => row.iri === steadyIri);
    const steadyAfter = indexedAfter.find((row) => row.iri === steadyIri);

    expect(steadyBefore?.frontmatter).toContain(email);
    expect(
      indexedAfter
        .filter((row) => row.frontmatter.includes(email) || row.body.includes(email))
        .map((row) => row.iri),
    ).toEqual([]);
    expect(steadyAfter?.content_hash).toEqual(steadyBefore?.content_hash);
  });

  it("records what it moved in the report's actions", async () => {
    const { actions } = await theBundleRewritten();

    expect(actions).toMatchObject({
      "concept-file": { reindexed: 2 },
      "concept-verification": { rehashed: 1 },
    });
  });
});

describe("the identity set on the person's last membership", () => {
  it("pseudonymises the user row, keeping its id for audit events", async () => {
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

  it("clears the operator mark with the rest of the identity", async () => {
    const { scenario, person, email, subjectRequestId } = await workspaceWithAnErasureRequest();
    await theOperator(scenario, email);

    await completing(scenario, subjectRequestId);

    expect(await operatorMarkOf(person.id)).toBe(false);
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

  it("deletes the subject's own codes, never a stranger's", async () => {
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

  it("ends this membership alone while the person holds another", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Editor" }),
    );
    await identityRowsFor(db().pool, { userId: person.id, email });
    await theOperator(scenario, email);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);

    await completing(scenario, subjectRequestId);

    const after = await userRowOf(person.id);
    expect({ email: after?.email, name: after?.name }).toEqual({ email, name: "Priya Anand" });
    expect(await operatorMarkOf(person.id)).toBe(true);
    expect(await identityRowCountsFor(scenario.workspaceId, person.id, email)).toMatchObject({
      sessions: 1,
      accounts: 1,
    });

    expect(await workspacesMemberOf(person.id)).toEqual([elsewhere.workspaceId]);
  });

  it("deletes the address's invitations in every workspace, never a stranger's", async () => {
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

  it("reports invitations found here, logging every deletion for the operator", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);
    for (const workspaceId of [scenario.workspaceId, elsewhere.workspaceId]) {
      await seedingWith(db().pool, (seed) => seed.invitation({ workspaceId, email }));
    }
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);

    const done = await completing(scenario, subjectRequestId);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row?.actions["identity-invitation"]).toEqual({ found: 1 });
    expect(done.report).toContain("- identity-invitation: found 1\n");
    expect(done.report).toContain(INVITATIONS_WHEREVER_SENT);
    expect(operatorLinesAbout(done.erasureRequestId)).toEqual([
      {
        actor: ERASURE_ACTOR,
        erasure_request_id: done.erasureRequestId,
        arm: "last-membership",
        pseudonymised: 1,
        sessions_deleted: 0,
        verifications_deleted: 0,
        accounts_deleted: 0,
        invitations_deleted_here: 1,
        invitations_deleted: 2,
      },
    ]);
  });

  it("logs one operator line per arm, never an address", async () => {
    const { runs } = await erasedOnEachArmOnce();
    const namingTheRequest = (done: ErasureRun) => ({
      actor: ERASURE_ACTOR,
      erasure_request_id: done.erasureRequestId,
    });

    expect({
      "last-membership": operatorLinesAbout(runs["last-membership"].erasureRequestId),
      "membership-ended": operatorLinesAbout(runs["membership-ended"].erasureRequestId),
      "no-person": operatorLinesAbout(runs["no-person"].erasureRequestId),
    }).toEqual({
      "last-membership": [
        {
          ...namingTheRequest(runs["last-membership"]),
          arm: "last-membership",
          pseudonymised: 1,
          sessions_deleted: 1,
          verifications_deleted: 1,
          accounts_deleted: 1,
          invitations_deleted_here: 1,
          invitations_deleted: 1,
        },
      ],
      "membership-ended": [
        {
          ...namingTheRequest(runs["membership-ended"]),
          arm: "membership-ended",
          pseudonymised: 0,
          sessions_deleted: 0,
          verifications_deleted: 0,
          accounts_deleted: 0,
          invitations_deleted_here: 0,
          invitations_deleted: 0,
        },
      ],
      "no-person": [
        {
          ...namingTheRequest(runs["no-person"]),
          arm: "no-person",
          pseudonymised: 0,
          sessions_deleted: 0,
          verifications_deleted: 0,
          accounts_deleted: 0,
          invitations_deleted_here: 0,
          invitations_deleted: 0,
        },
      ],
    });
  });

  it("leaves every invitation standing while another membership stands", async () => {
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

  it("stores identical identity lines on both arms, never naming elsewhere", async () => {
    const { runs, elsewhereId } = await erasedOnEachArmOnce();
    const identityLinesOf = async (done: ErasureRun) => {
      const row = (await erasureRowsIn(done.workspaceId)).find(
        (stored) => stored.id === done.erasureRequestId,
      );
      return {
        actions: Object.fromEntries(
          Object.entries(row?.actions ?? {}).filter(([family]) => family.startsWith("identity-")),
        ),
        report: (row?.report ?? "").split("\n").filter((line) => line.startsWith("- identity-")),
      };
    };

    const theSameLines = {
      actions: {
        "identity-user": { found: 1, membershipsEnded: 1 },
        "identity-session": { found: 1 },
        "identity-verification": { found: 1 },
        "identity-invitation": { found: 1 },
        "identity-account": { found: 1 },
      },
      report: [
        "- identity-user: found 1, membershipsEnded 1",
        "- identity-session: found 1",
        "- identity-verification: found 1",
        "- identity-invitation: found 1",
        "- identity-account: found 1",
      ],
    };
    expect({
      "last-membership": await identityLinesOf(runs["last-membership"]),
      "membership-ended": await identityLinesOf(runs["membership-ended"]),
    }).toEqual({ "last-membership": theSameLines, "membership-ended": theSameLines });

    expect(runs["membership-ended"].report).not.toContain(elsewhereId);
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
    identifiers: Record<string, readonly string[]>;
  }>(
    `SELECT workspace_id, erasure_request_id, identifiers
       FROM suppression WHERE workspace_id = $1 ORDER BY erasure_request_id`,
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

const chunksUnder = (
  workspaceId: string,
  documents: readonly { readonly id: string; readonly bindingId: string }[],
  content = "Priya Anand approves expenses.",
) =>
  seedingWith(db().pool, async (seed) => {
    for (const document of documents) {
      await seed.chunk({
        workspaceId,
        bindingId: document.bindingId,
        sourceDocumentId: document.id,
        content,
        locator: `${document.id}/chars:0-${content.length}`,
        ordinal: 0,
        charStart: 0,
        charEnd: content.length,
      });
    }
  });

const chunksIn = async (workspaceId: string) => {
  const read = await db().pool.query<{ binding_id: string; chunks: number }>(
    `SELECT binding_id, count(*)::int AS chunks FROM "index".chunk
      WHERE workspace_id = $1 GROUP BY binding_id ORDER BY binding_id`,
    [workspaceId],
  );
  return read.rows;
};

const queuedIn = async (workspaceId: string) => {
  const read = await db().pool.query<{
    kind: string;
    subject_id: string | null;
    reason: string | null;
    status: string;
  }>(
    `SELECT kind, subject_id, reason, status FROM job
      WHERE workspace_id = $1 ORDER BY kind, subject_id`,
    [workspaceId],
  );
  return read.rows;
};

const aMapOverTwoOfThreeBindings = async () => {
  const scenario = await arrange();
  const shared = await bindingIn(scenario.workspaceId);
  const apart = await bindingIn(scenario.workspaceId);
  const untouched = await bindingIn(scenario.workspaceId);
  const found = [
    await documentIn(scenario.workspaceId, shared.id),
    await documentIn(scenario.workspaceId, shared.id),
    await documentIn(scenario.workspaceId, apart.id),
  ];
  await chunksUnder(scenario.workspaceId, [
    ...found,
    await documentIn(scenario.workspaceId, untouched.id),
  ]);
  return { scenario, shared, apart, untouched, found };
};

const rederivingOver = (
  scenario: Scenario,
  found: readonly { readonly id: string }[],
  completedAt: Date | null,
) =>
  rederiveAfterErasure(ERASURE, scenario.postgres, {
    workspaceId: boundarySchemas.workspace.select.shape.id.parse(scenario.workspaceId),
    map: mapNaming(found.map((document) => document.id)),
    completedAt,
  });

const suppressingAs = (
  scenario: Scenario,
  input: Omit<Parameters<typeof suppressInTheWorkspace>[2], "workspaceId">,
) =>
  withScope(ERASURE, scenario.postgres, scenario.workspaceId, (tx) =>
    suppressInTheWorkspace(ERASURE, tx, { ...input, workspaceId: scenario.workspaceId }),
  );

const aMemberAskingUnder = async (asked: (signsInWith: string) => string) => {
  const scenario = await arrange();
  const signsInWith = addressOf("priya");
  const person = await memberOf(db().pool, scenario.workspaceId, signsInWith);
  const email = asked(signsInWith);
  const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);
  return { scenario, signsInWith, email, subjectRequestId };
};

const aHomeAddress = (): string => addressOf("priya-home");

const theRowHoldingTheAddressAlone = (done: ErasureRun, email: string) => [
  {
    workspace_id: done.workspaceId,
    erasure_request_id: done.erasureRequestId,
    identifiers: { emails: [email], names: [], other: [] },
  },
];

describe("the suppression the workspace keeps for the request", () => {
  it("writes a row adding the sign-in address, even without documents", async () => {
    const {
      scenario,
      signsInWith,
      email: atHome,
      subjectRequestId,
    } = await aMemberAskingUnder(aHomeAddress);

    const done = await completing(scenario, subjectRequestId);

    expect(done.map.find((entry) => entry.family === "source-document")?.locations).toEqual([]);
    expect(await suppressionsIn(scenario.workspaceId)).toEqual([
      {
        workspace_id: scenario.workspaceId,
        erasure_request_id: done.erasureRequestId,
        identifiers: { emails: [atHome, signsInWith], names: ["Priya Anand"], other: [] },
      },
    ]);
  });

  it("holds the sign-in address for a request by id alone", async () => {
    const { scenario, email, subjectRequestId } = await workspaceWithAnErasureRequest({
      byIdAlone: true,
    });

    const done = await completing(scenario, subjectRequestId);

    expect(await suppressionsIn(scenario.workspaceId)).toEqual(
      theRowHoldingTheAddressAlone(done, email),
    );
  });

  it("keeps the sign-in address when the first run's write failed", async () => {
    const { scenario, email, subjectRequestId } = await workspaceWithAnErasureRequest({
      byIdAlone: true,
    });

    const died = await whileWritesAreRefused(db().pool, "suppression", () =>
      runningTheRoutine(scenario, subjectRequestId),
    );
    const done = await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(died.ok).toBe(false);
    expect(await suppressionsIn(scenario.workspaceId)).toEqual(
      theRowHoldingTheAddressAlone(done, email),
    );
  });

  it("skips a sign-in address the request names in other capitals", async () => {
    const {
      scenario,
      email: asGiven,
      subjectRequestId,
    } = await aMemberAskingUnder((signsInWith) => signsInWith.toUpperCase());

    await completing(scenario, subjectRequestId);

    expect((await suppressionsIn(scenario.workspaceId)).map((row) => row.identifiers)).toEqual([
      { emails: [asGiven], names: ["Priya Anand"], other: [] },
    ]);
  });

  it("writes a row the boundary admits from fifty-two emails", async () => {
    const scenario = await arrange();
    const erasure = await anOpenErasure(scenario.workspaceId);
    const fifty = Array.from({ length: 50 }, (_, at) => `person-${at}@example.invalid`);

    await suppressingAs(scenario, {
      erasureRequestId: erasure.id,
      identifiers: { emails: fifty, names: [], other: [] },
      signInAddresses: ["priya@example.invalid", "priya.anand@example.invalid"],
    });
    const [row] = await suppressionsIn(scenario.workspaceId);

    expect(row?.identifiers["emails"]).toHaveLength(52);
    expect(
      boundarySchemas.suppression.select.safeParse({
        workspaceId: row?.workspace_id,
        erasureRequestId: row?.erasure_request_id,
        identifiers: row?.identifiers,
      }).success,
    ).toBe(true);
  });

  it("writes nothing for an empty set and no sign-in address", async () => {
    const scenario = await arrange();
    const erasure = await anOpenErasure(scenario.workspaceId);

    const emptied = await suppressingAs(scenario, {
      erasureRequestId: erasure.id,
      identifiers: { emails: [], names: [], other: [] },
      signInAddresses: [],
    });
    const absent = await suppressingAs(scenario, {
      erasureRequestId: erasure.id,
      identifiers: null,
      signInAddresses: [],
    });

    expect([emptied, absent]).toEqual([{ identifiersWithheld: 0 }, { identifiersWithheld: 0 }]);
    expect(await suppressionsIn(scenario.workspaceId)).toEqual([]);
  });

  it("leaves the row it wrote unchanged on a second run", async () => {
    const scenario = await arrange();
    const erasure = await anOpenErasure(scenario.workspaceId);

    const first = await suppressingAs(scenario, {
      erasureRequestId: erasure.id,
      identifiers: THE_SET,
      signInAddresses: [],
    });
    const before = await suppressionsIn(scenario.workspaceId);
    const again = await suppressingAs(scenario, {
      erasureRequestId: erasure.id,
      identifiers: { emails: ["someone-else@example.invalid"], names: [], other: [] },
      signInAddresses: ["another@example.invalid"],
    });

    expect([first, again]).toEqual([{ identifiersWithheld: 2 }, { identifiersWithheld: 2 }]);
    expect(await suppressionsIn(scenario.workspaceId)).toEqual(before);
  });

  it("counts documents, bindings and identifiers on the report, naming none", async () => {
    const {
      scenario,
      signsInWith,
      email: atHome,
      subjectRequestId,
    } = await aMemberAskingUnder(aHomeAddress);
    const binding = await bindingIn(scenario.workspaceId);
    await documentIn(scenario.workspaceId, binding.id);

    const done = await completing(scenario, subjectRequestId);

    expect(done.report).toContain(
      "\n- source-document: bindingsReindexed 0, found 0, identifiersWithheld 3\n",
    );
    for (const named of [atHome, signsInWith, "Priya Anand"]) {
      expect(done.report).not.toContain(named);
    }
  });
});

describe("the full-rebuild the erasure asks for", () => {
  it("queues one job with reason erasure", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    await completing(scenario, subjectRequestId);

    expect(await jobsIn(scenario.workspaceId)).toEqual([
      { kind: "full-rebuild", reason: "erasure", status: "queued" },
    ]);
  });

  it("queues no second one when the request runs again", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    await completing(scenario, subjectRequestId);
    await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(await jobsIn(scenario.workspaceId)).toEqual([
      { kind: "full-rebuild", reason: "erasure", status: "queued" },
    ]);
  });

  it("names each binding holding a found document once", async () => {
    const { scenario, shared, apart, found } = await aMapOverTwoOfThreeBindings();

    const rederived = await rederivingOver(scenario, found, LOCKED_AT);

    expect(rederived.bindingsToReprocess).toEqual([shared.id, apart.id].sort());
    expect(rederived.rebuildJobId).toBeNull();
  });
});

const THE_REBUILD = { kind: "full-rebuild", subject_id: null, reason: "erasure", status: "queued" };

const wipesOf = (bindings: readonly { readonly id: string }[]) =>
  bindings
    .map((binding) => binding.id)
    .sort()
    .map((subject_id) => ({ kind: "index", subject_id, reason: "wiped", status: "queued" }));

const whatTheWipeLeft = async (workspaceId: string) => ({
  chunks: await chunksIn(workspaceId),
  queued: await queuedIn(workspaceId),
});

const everyBindingWiped = (arranged: Awaited<ReturnType<typeof aMapOverTwoOfThreeBindings>>) => ({
  chunks: [{ binding_id: arranged.untouched.id, chunks: 1 }],
  queued: [THE_REBUILD, ...wipesOf([arranged.shared, arranged.apart])],
});

describe("the wipe of every binding the map found", () => {
  it("deletes each binding's chunks, queueing its index run as wiped", async () => {
    const arranged = await aMapOverTwoOfThreeBindings();

    const rederived = await rederivingOver(arranged.scenario, arranged.found, null);

    expect(rederived.rebuildJobId).not.toBeNull();
    expect(await whatTheWipeLeft(arranged.scenario.workspaceId)).toEqual(
      everyBindingWiped(arranged),
    );
  });

  it("wipes a binding naming the subject when the routine runs", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();
    const workspaceId = scenario.workspaceId;
    const naming = await bindingIn(workspaceId);
    const elsewhere = await bindingIn(workspaceId);
    const named = await documentIn(workspaceId, naming.id);
    const unnamed = await documentIn(workspaceId, elsewhere.id);
    await chunksUnder(workspaceId, [named]);
    await chunksUnder(workspaceId, [unnamed], "Expenses are claimed within thirty days.");

    const done = await completing(scenario, subjectRequestId);

    expect(done.map.find((entry) => entry.family === "source-document")?.locations).toEqual([
      named.id,
    ]);
    expect(await whatTheWipeLeft(workspaceId)).toEqual({
      chunks: [{ binding_id: elsewhere.id, chunks: 1 }],
      queued: [THE_REBUILD, ...wipesOf([naming])],
    });
    expect(done.report).toContain(
      "\n- source-document: bindingsReindexed 1, found 1, identifiersWithheld 2\n",
    );
  });

  it("wipes restored rows on a replay, queueing no second run", async () => {
    const arranged = await aMapOverTwoOfThreeBindings();

    await rederivingOver(arranged.scenario, arranged.found, null);
    await chunksUnder(arranged.scenario.workspaceId, arranged.found);
    const replayed = await rederivingOver(arranged.scenario, arranged.found, LOCKED_AT);

    expect(replayed.rebuildJobId).toBeNull();
    expect(await whatTheWipeLeft(arranged.scenario.workspaceId)).toEqual(
      everyBindingWiped(arranged),
    );
  });

  it.each([
    ["restored", "wiped"],
    ["rule-change", "rule-change"],
  ] as const)("queues nothing behind one queued as %s, leaving it %s", async (queuedAs, left) => {
    const { scenario, shared, apart, found } = await aMapOverTwoOfThreeBindings();
    await seedingWith(db().pool, (seed) =>
      seed.job({
        workspaceId: scenario.workspaceId,
        kind: "index",
        subjectId: shared.id,
        reason: queuedAs,
      }),
    );

    await rederivingOver(scenario, found, LOCKED_AT);

    expect(await queuedIn(scenario.workspaceId)).toEqual(
      wipesOf([shared, apart]).map((run) =>
        run.subject_id === shared.id ? { ...run, reason: left } : run,
      ),
    );
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
  it("erases by suppression alone and reports what each arm did", async () => {
    const { scenario, done } = await completedForASubjectWithNoUserRow();

    expect(done.report).toContain("concept-file: found 0, reindexed 0, rewritten 0");
    expect(done.report).toContain("bundle-commit: found 0, moved 0");
    expect(done.report).toContain("- identity-user: found 0, membershipsEnded 0\n");
    expect(done.report).toContain(
      "source-document: bindingsReindexed 0, found 0, identifiersWithheld 2",
    );

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

/** Strict, so a key the copy gained is refused here and never read past as a finder's own. */
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
  it("lands under the platform's prefix, beyond any workspace's principal", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();

    const done = await completing(scenario, subjectRequestId);

    expect(await replayCopiesIn(scenario.workspaceId)).toEqual([
      `erasures/${scenario.workspaceId}/${done.erasureRequestId}.json`,
    ]);

    const theirs = await listObjects(scenario.admin, objects().door, "");
    expect(theirs).toEqual({ ok: true, value: [] });
  });

  it("carries the pseudonym, the identifier set and the map", async () => {
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

  it("carries nothing a finder does not need", async () => {
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

  it("names no person for a subject with no user row", async () => {
    const { scenario, done } = await completedForASubjectWithNoUserRow();

    const copy = await readCopy(scenario.workspaceId, done.erasureRequestId);
    expect(Object.keys(copy)).not.toContain("personId");

    expect(copy.identifiers).toEqual({
      emails: ["priya@example.invalid"],
      names: ["Priya Anand"],
      other: [],
    });
  });

  it("refuses to complete when the store refuses the copy", async () => {
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
      erasureDoorsFor(scenario, shut.value, LOCKED_AT, operatorLog),
      { workspaceId: scenario.workspaceId, subjectRequestId },
    );

    expect(run.ok).toEqual(false);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row?.completed_at).toBeNull();
    expect(await replayCopiesIn(scenario.workspaceId)).toEqual([]);
  });

  it("leaves one copy dated the first completion on a rerun", async () => {
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
  it("refuses an access request, which is answered and never erased", async () => {
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
