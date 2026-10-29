import { randomBytes } from "node:crypto";

import { assert, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { commit, type GitDoor } from "@better-answers/core/store/git";
import {
  getPlatformObject,
  listObjects,
  listPlatformObjects,
  openObjects,
} from "@better-answers/core/store/objects";
import {
  openPostgres,
  withHeldPrincipal,
  withScope,
  type Tx,
} from "@better-answers/core/store/postgres";
import { boundarySchemas, IDENTITY_SET, ulid, type ConceptIri } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import {
  completeRecord,
  giveFeedback,
  open,
  openRecord,
  trustWords,
} from "../../../src/answering/index.ts";
import {
  contentHashOf,
  RECONCILER,
  reconcile,
  renderConceptFile,
  writeConcept,
  type Frontmatter,
} from "../../../src/concepts/index.ts";
import {
  beyondUseFrom,
  ERASURE,
  ERASURE_FAMILIES,
  rederiveAfterErasure,
  runErasure,
  suppressInTheWorkspace,
  type ErasureLog,
  type ErasureLogLine,
  type QuestionsLogLine,
  type ErasureMap,
  type ErasureRun,
  type IdentityArm,
  type RunErasureRefusal,
} from "../../../src/erasure/index.ts";
import { seedGuide } from "../../../src/guides/index.ts";
import { actorIdOfPerson, type Result, type UserPrincipal } from "../../../src/kernel/index.ts";
import {
  acceptInvitation,
  approveRequest,
  endEverySignInAndTokenHere,
} from "../../../src/members/index.ts";
import { setDisplayName, setOperatorMark } from "../../../src/workspaces/index.ts";
import { asAnotherProcess } from "../../concepts/bundle-fence.ts";
import {
  authorLinesOf,
  bundleHistory,
  commitFacts,
  everyObjectOf,
  gatingRefUpdates,
  objectPresent,
} from "../../fixtures/bundle.ts";
import { auditEventRowsOf } from "../../fixtures/sourced-concept.ts";
import {
  doorsOf,
  EDITORS_COLLECTIONS,
  memberOf,
  principalFor,
  suiteWithBundles,
  type Scenario,
} from "../../fixtures/workspace-with-bundle.ts";
import {
  identityRowsFor,
  lastActiveIn,
  otherCodesFor,
  parkedSecretFor,
  passkeyChallengeFor,
  restoreCodeFor,
  secondFactorRowsFor,
  signInLinkFor,
  verificationCodeFor,
} from "../../support/identity-rows.ts";
import { bootstrap } from "../../support/platform.ts";
import { rowsFrom } from "../../support/rows.ts";
import { objectStoreForSuite, textOf } from "../../support/suite-objects.ts";
import {
  addressOf,
  answered,
  countWaitingOnLocks,
  holdingTable,
  isBlockedOnTable,
  readingAs,
  seedingWith,
  statementsWaitingOnALock,
  until,
  whileActionsWaitAt,
  whileWritesAreRefused,
} from "../../support/suite-postgres.ts";
import { erasureDoorsFor } from "../erasure-doors.ts";
import {
  asAsked,
  asErased,
  askedAMicrosecondFiner,
  flagGivenBy,
  flagsOn,
  flagStanding,
  questionRowsOf,
  recordAskedBy,
} from "../question-rows.ts";

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

const ANCHORED_ON_A_31ST = new Date("2026-08-31T12:00:00.000Z");

const DUMP_LOCK = 41;

const ERASURE_ACTOR = "process:better-answers-erasure";

const COMPLETED = "people.erasure.completed";

const INVITATIONS_WHEREVER_SENT =
  "Invitations sent to the address a person signs in with are deleted wherever they were sent, " +
  "by the request that erases them from their last workspace; the invitation line above counts this " +
  "workspace's alone.";

const operatorLines: ErasureLogLine[] = [];

const questionsLines: QuestionsLogLine[] = [];

const saidWith = new Map<QuestionsLogLine, string>();

const operatorLog: ErasureLog = {
  info: (line, message) => {
    if ("arm" in line) operatorLines.push(line);
    else {
      questionsLines.push(line);
      saidWith.set(line, message);
    }
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
  for (const [person, email] of [
    [lastMember, onlyHere],
    [stillMember, heldElsewhere],
  ] as const) {
    await identityRowsFor(db().pool, { userId: person.id, email });
    await secondFactorRowsFor(db().pool, person.id);
    await lastActiveIn(db().pool, scenario.workspaceId, person.id);
    await seedingWith(db().pool, (seed) =>
      seed.invitation({ workspaceId: scenario.workspaceId, email }),
    );
  }
  const erased = async (personId: string | null, email: string): Promise<ErasureRun> =>
    completing(scenario, await erasureRequestAbout(scenario.workspaceId, personId, email));
  return {
    runs: {
      "last-workspace": await erased(lastMember.id, onlyHere),
      "held-elsewhere": await erased(stillMember.id, heldElsewhere),
      "no-person": await erased(null, addressOf("a-contact")),
    },
    elsewhereId: elsewhere.workspaceId,
  };
};

let theArmsErased: ReturnType<typeof erasedOnEachArm> | undefined;

const erasedOnEachArmOnce = () => (theArmsErased ??= erasedOnEachArm());

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
    const rows: { readonly path: string; readonly iri: ConceptIri }[] = [];
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
        verifiedAt: new Date("2026-04-05T09:00:00.000Z"),
      });
      rows.push({ path: file.path, iri: indexed.iri });
    }
    return rows;
  });
  const [hashed, steady] = landed;
  if (hashed === undefined || steady === undefined) throw new Error("two concepts did not land");
  return {
    scenario,
    email,
    person,

    iri: hashed.iri,

    steadyIri: steady.iri,
    before: shas,
    subjectRequestId,
  };
};

const verificationsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{
    iri: string;
    actor: string;
    verified_at: Date;
    content_hash: string | null;
    origin: string;
  }>(
    `SELECT iri, actor, verified_at, content_hash, origin
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

const trustOf = async (scenario: Scenario, iri: ConceptIri) => {
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

const actorsIn = async (
  table: "bundle_commit" | "concept_verification" | "guide_definition_version" | "usage",
  workspaceId: string,
): Promise<readonly string[]> => {
  const read = await db().pool.query<{ actor: string }>(
    `SELECT actor FROM ${table} WHERE workspace_id = $1 ORDER BY actor`,
    [workspaceId],
  );
  return read.rows.map((row) => row.actor);
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
  const verificationsBefore = await verificationsIn(scenario.workspaceId);
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
    verificationsBefore,
    verificationsAfter: await verificationsIn(scenario.workspaceId),
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

const grantsEndedRowsAbout = async (personId: string) => {
  const read = await db().pool.query<{ row: string }>(
    `SELECT row_to_json(e)::text AS row FROM identity_audit_event e
      WHERE e.subject_id = $1 AND e.action = 'people.person.grants_ended'`,
    [personId],
  );
  return read.rows.map((each) => each.row);
};

const verificationsOfAnAddress = (parameter: string): string => `SELECT count(*) FROM verification
  WHERE lower(identifier) IN ('sign-in-otp-' || ${parameter}, 'sign-in-link-' || ${parameter},
                              'email-verification-otp-' || ${parameter},
                              'forget-password-otp-' || ${parameter})`;

const verificationsFor = async (email: string): Promise<number> => {
  const read = await db().pool.query<{ count: string }>(verificationsOfAnAddress("$1"), [
    email.toLowerCase(),
  ]);
  return Number(read.rows[0]?.count ?? -1);
};

const NOT_COUNTED = { sessions: "-1", accounts: "-1", verifications: "-1", invitations: "-1" };

const identityRowCountsFor = async (workspaceId: string, userId: string, email: string) => {
  const read = await db().pool.query<typeof NOT_COUNTED>(
    `SELECT (SELECT count(*) FROM session WHERE user_id = $1) AS sessions,
            (SELECT count(*) FROM account WHERE user_id = $1) AS accounts,
            (${verificationsOfAnAddress("$2")}) AS verifications,
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

const secondFactorHeldBy = async (userId: string, passkeyId: string) => {
  const read = await db().pool.query(
    `SELECT (SELECT count(*)::int FROM passkey WHERE user_id = $1) AS passkeys,
            (SELECT count(*)::int FROM passkey_last_use WHERE passkey_id = $2) AS passkey_uses,
            (SELECT count(*)::int FROM authenticator WHERE user_id = $1) AS authenticators,
            (SELECT count(*)::int FROM recovery_code WHERE user_id = $1) AS recovery_codes,
            (SELECT count(*)::int FROM second_factor_throttle WHERE user_id = $1)
              AS confirm_failures,
            u.authenticator_enabled,
            u.passkey_offer_dismissed_at IS NOT NULL AS offer_dismissed,
            u.recovery_codes_acknowledged,
            u.restore_required_at IS NOT NULL AS restore_required,
            u.promoted_at IS NOT NULL AS promoted
       FROM "user" u WHERE u.id = $1`,
    [userId, passkeyId],
  );
  return rowsFrom(read)[0];
};

const SECOND_FACTOR_HELD = {
  passkeys: 1,
  passkey_uses: 1,
  authenticators: 1,
  recovery_codes: 2,
  confirm_failures: 2,
  authenticator_enabled: true,
  offer_dismissed: true,
  recovery_codes_acknowledged: true,
  restore_required: true,
  promoted: true,
};

const memberHereAndElsewhere = async () => {
  const scenario = await arrange();
  const elsewhere = await arrange();
  const email = addressOf("priya");
  const person = await memberOf(db().pool, scenario.workspaceId, email);
  await seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Editor" }),
  );
  return { scenario, elsewhere, email, person };
};

const SWEPT_BY_PERSON = [
  "public.account",
  "public.authenticator",
  "public.member",
  "public.passkey",
  "public.recovery_code",
  "public.second_factor_throttle",
  "public.session",
];

const BEYOND_THE_SWEEP = [
  "public.oauth_access_token",
  "public.oauth_client",
  "public.oauth_consent",
  "public.oauth_refresh_token",
];

const identityTablesNamingAPerson = async (): Promise<readonly string[]> => {
  const read = await db().pool.query<{ qualified: string }>(
    `SELECT table_schema || '.' || table_name AS qualified FROM information_schema.columns
      WHERE column_name = 'user_id' AND table_schema || '.' || table_name = ANY($1)`,
    [[...IDENTITY_SET]],
  );
  return read.rows.map((row) => row.qualified).toSorted();
};

const sweptTablesHolding = async (userId: string): Promise<readonly string[]> => {
  const holding: string[] = [];
  for (const qualified of SWEPT_BY_PERSON) {
    const read = await db().pool.query(`SELECT 1 FROM ${qualified} WHERE user_id = $1 LIMIT 1`, [
      userId,
    ]);
    if (read.rowCount !== 0) holding.push(qualified);
  }
  return holding;
};

const NO_SECOND_FACTOR_DELETED = {
  passkeys_deleted: 0,
  authenticators_deleted: 0,
  recovery_codes_deleted: 0,
  confirm_failures_deleted: 0,
  last_active_deleted: 0,
};

const lastActiveWorkspacesOf = async (userId: string): Promise<readonly string[]> => {
  const read = await db().pool.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM workspace_last_active WHERE user_id = $1 ORDER BY workspace_id",
    [userId],
  );
  return read.rows.map((row) => row.workspace_id);
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
      assert(row !== undefined, "the erasure row was written");
      pseudonyms.push(row.pseudonym);
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
        "from copies already exported, or from any backup copy taken before 2026-06-01T12:00:00.000Z.",
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

  it("lists by IRI each concept whose body names the person", async () => {
    const { iri, done } = await theBundleRewritten();

    expect(done.report).toContain("Names inside concept bodies, for the owner to edit:");
    expect(done.report).toContain(`- ${iri}`);
  });
});

describe("the factory's erasure request", () => {
  it("dates beyond use as the routine does", async () => {
    const scenario = await arrange();

    const seeded = await seedingWith(db().pool, (seed) =>
      seed.erasureRequest({ workspaceId: scenario.workspaceId, anchoredAt: ANCHORED_ON_A_31ST }),
    );

    expect({
      hourly: seeded.beyondUseHourlyAt,
      daily: seeded.beyondUseDailyAt,
      weekly: seeded.beyondUseWeeklyAt,
      monthly: seeded.beyondUseMonthlyAt,
    }).toEqual(beyondUseFrom(ANCHORED_ON_A_31ST));
  });
});

describe("the lock the hourly dump waits behind", () => {
  it("holds the dump's lock throughout the routine, then releases it", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();
    const tried: boolean[] = [];

    const done = await whileActionsWaitAt(
      db().pool,
      "erasure_request",
      "INSERT",
      async (release) => {
        const routine = runningTheRoutine(scenario, subjectRequestId);

        await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
        tried.push(await theDumpCouldTakeItsLock());
        await release();
        return routine;
      },
    );
    tried.push(await theDumpCouldTakeItsLock());

    expect(done.ok).toBe(true);

    expect(tried).toEqual([false, true]);
  });

  it("releases the dump's lock when the routine's work throws", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();
    const doors = erasureDoorsFor(scenario, objects().door, LOCKED_AT, operatorLog);

    const run = runErasure(
      ERASURE,
      {
        ...doors,
        clock: {
          now: () => {
            throw new Error("the clock failed");
          },
        },
      },
      { workspaceId: scenario.workspaceId, subjectRequestId },
    );

    await expect(run).rejects.toThrow("the clock failed");
    expect(await theDumpCouldTakeItsLock()).toBe(true);
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
    assert(completion !== undefined, "the completion was recorded");
    expect(Object.keys(completion.detail).sort()).toEqual([
      "locations",
      "personId",
      "subjectRequestId",
    ]);
  });

  it("keeps a revocation's ended grants as recorded, naming no one", async () => {
    const { scenario, email, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const issuedAt = new Date("2026-05-01T09:00:00.000Z");
    const clientId = await seedingWith(db().pool, async (seed) => {
      const client = await seed.oauthClient({ name: "Claude" });
      await seed.oauthRefreshToken({
        clientId: client.clientId,
        userId: person.id,
        referenceId: scenario.workspaceId,
        createdAt: issuedAt,
      });
      return client.clientId;
    });
    const admin = await principalFor(db(), scenario.workspaceId, scenario.admin.userId, true);
    const revoked = await withScope(bootstrap, scenario.postgres, scenario.workspaceId, (tx) =>
      endEverySignInAndTokenHere(admin, tx, { personId: person.id, at: new Date() }),
    );
    expect(revoked.ok).toBe(true);
    const before = await rowTextIn("audit_event", scenario.workspaceId);
    const endedBefore = await grantsEndedRowsAbout(person.id);

    await completing(scenario, subjectRequestId);

    const [revocation] = await auditEventRowsOf(
      db().pool,
      scenario.workspaceId,
      "people.member.credentials_revoked",
    );
    expect(revocation?.detail).toEqual({
      grants: [{ clientId, workspaceId: scenario.workspaceId, issuedAt: issuedAt.toISOString() }],
    });
    const after = await rowTextIn("audit_event", scenario.workspaceId);
    const revocationRow = after.find((row) => row.id === revocation?.id);
    expect(before).toContainEqual(revocationRow);
    expect(revocationRow?.row).not.toContain(email);
    expect(revocationRow?.row).not.toContain("Priya");
    expect(endedBefore).toHaveLength(1);
    expect(await grantsEndedRowsAbout(person.id)).toEqual(endedBefore);
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

    expect(done.report).toContain("bundle-commit: actorsRewritten 2, found 2, moved 2");
  });

  it("refuses a request naming only an address already erased to", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();
    await completing(scenario, subjectRequestId);
    const [erased] = await erasureRowsIn(scenario.workspaceId);
    const rewritten = await bundleHistory(scenario.git, scenario.workspaceId);
    assert(erased !== undefined, "the first erasure was recorded");
    const tombstone = `${erased.pseudonym}@erased.better-answers.invalid`;
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

describe("a skeleton commit the person caused", () => {
  it("rewrites the author line of a skeleton commit", async () => {
    const scenario = await arrange();
    const { workspaceId, git } = scenario;
    const email = addressOf("priya");
    const person = await seedingWith(db().pool, async (seed) => {
      const seeded = await seed.user({ name: "Priya Anand", email });
      await seed.member({ workspaceId, userId: seeded.id, role: "Admin" });
      return seeded;
    });
    const subjectRequestId = await erasureRequestAbout(workspaceId, person.id, email);
    const seeder = await principalFor(db(), workspaceId, person.id);
    const { guideId } = answered(
      await seedGuide(seeder, doorsOf(scenario), {
        templateId: "bid-library",
        collection: "company",
        subjectIri: null,
      }),
    );
    expect(await authorLinesOf(git, workspaceId)).toEqual([`Priya Anand <${email}>`]);

    await completing(scenario, subjectRequestId);

    const pseudonym = await pseudonymIn(workspaceId);
    expect(await authorLinesOf(git, workspaceId)).toEqual([
      `human:${pseudonym} <${pseudonym}@erased.better-answers.invalid>`,
    ]);
    const [rewritten = ""] = await bundleHistory(git, workspaceId);
    expect((await commitFacts(git, workspaceId, rewritten)).files).toEqual([
      `guides/${guideId}.yaml`,
    ]);
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

  it("names the pseudonym on each commit row, the person nowhere", async () => {
    const { scenario, person, pseudonym, after } = await theBundleRewritten();

    expect(await actorsIn("bundle_commit", scenario.workspaceId)).toEqual([
      `human:${pseudonym}`,
      `human:${pseudonym}`,
    ]);
    expect(after.objects).not.toContain(person.id);
  });

  it("leaves the reconciler nothing to replay, head and watermark agreeing", async () => {
    const { scenario } = await theBundleRewritten();

    const swept = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    assert(swept.ok, "the reconciler refused");

    expect(swept.value.replayed).toEqual([]);
    expect(swept.value.skipped).toEqual([]);
    expect(swept.value.watermark).toEqual(swept.value.head);
  });

  it("records both families' work in the report's actions", async () => {
    const { actions } = await theBundleRewritten();

    expect(actions).toMatchObject({
      "concept-file": { rewritten: 2 },
      "bundle-commit": { moved: 2, actorsRewritten: 2 },
      "concept-verification": { actorsRewritten: 2 },
    });

    expect(actions["concept-file"]).toHaveProperty("found");
  });
});

const verificationOn = (
  verifications: Awaited<ReturnType<typeof verificationsIn>>,
  iri: string,
) => {
  const verification = verifications.find((one) => one.iri === iri);
  return {
    hash: verification?.content_hash,
    origin: verification?.origin,
    actor: verification?.actor,
    at: verification?.verified_at.toISOString(),
  };
};

describe("the verifications the rewrite moved", () => {
  beforeAll(async () => {
    await theBundleRewritten();
  });

  it("carries each onto the new hash under origin erasure-rewrite", async () => {
    const {
      email,
      pseudonym,
      iri,
      verificationsBefore,
      verificationsAfter,
      indexedBefore,
      indexedAfter,
      trustBefore,
      trustAfter,
    } = await theBundleRewritten();
    const before = verificationOn(verificationsBefore, iri);
    const indexBefore = indexedBefore.find((row) => row.iri === iri);

    expect(before.hash).toEqual(indexBefore?.content_hash);
    expect(before.origin).toEqual("platform");

    const indexAfter = indexedAfter.find((row) => row.iri === iri);

    expect(indexBefore?.body).toContain(email);
    expect(indexAfter?.content_hash).not.toEqual(indexBefore?.content_hash);
    expect(indexAfter?.body).not.toContain(email);
    expect(verificationOn(verificationsAfter, iri)).toEqual({
      hash: indexAfter?.content_hash,

      origin: "erasure-rewrite",
      actor: `human:${pseudonym}`,
      at: before.at,
    });

    expect(trustBefore[0]).toMatchObject({ verifiedBy: "Priya Anand" });
    expect(trustAfter[0]).toEqual({
      tier: "human-reviewed",
      status: "current",
      verifiedBy: `human:${pseudonym}`,
      verifiedAt: "2026-04-05T09:00:00.000Z",
      rider: null,
    });
    assert(trustAfter[0]);
    expect(trustWords(trustAfter[0])).toBe("Verified by a former member · 5 April 2026");
  });

  it("keeps a verification's hash when only unhashed keys were rewritten", async () => {
    const {
      pseudonym,
      steadyIri,
      verificationsBefore,
      verificationsAfter,
      trustBefore,
      trustAfter,
    } = await theBundleRewritten();

    expect(verificationsAfter.find((verification) => verification.iri === steadyIri)).toEqual({
      ...verificationsBefore.find((verification) => verification.iri === steadyIri),
      actor: `human:${pseudonym}`,
    });
    expect(trustBefore[1]).toMatchObject({ verifiedBy: "Priya Anand" });
    expect(trustAfter[1]).toEqual({
      tier: "human-reviewed",
      status: "current",
      verifiedBy: `human:${pseudonym}`,
      verifiedAt: "2026-04-05T09:00:00.000Z",
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
        .filter((row) => `${row.frontmatter}\n${row.body}`.includes(email))
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

const ASKED_FOR_ACCESS = "I have joined the bids team and need the answer library.";

const approvedRequestOf = async (scenario: Scenario, requesterId: string) => {
  const request = await seedingWith(db().pool, (seed) =>
    seed.accessRequest({
      workspaceId: scenario.workspaceId,
      requesterId,
      reason: ASKED_FOR_ACCESS,
    }),
  );
  const approved = await readingAs(db().pool, scenario.admin, (principal, tx) =>
    approveRequest(principal, tx, { requestId: request.id, now: LOCKED_AT }),
  );
  if (!approved.ok) throw new Error(`the approval refused: ${String(approved.error)}`);
  return { requestId: request.id, invitationId: approved.value.invitationId };
};

const accessRequestsOf = async (requesterId: string) =>
  rowsFrom(
    await db().pool.query(
      `SELECT id, workspace_id, reason, invitation_id FROM access_request
        WHERE requester_id = $1`,
      [requesterId],
    ),
  );

describe("the identity set on the person's last workspace", () => {
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
    await signInLinkFor(db().pool, email);
    await seedingWith(db().pool, (seed) =>
      seed.invitation({ workspaceId: scenario.workspaceId, email }),
    );
    expect(await identityRowCountsFor(scenario.workspaceId, person.id, email)).toEqual({
      sessions: 1,
      accounts: 1,
      verifications: 2,
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

  it("deletes the restore code and session-keyed rows, never a stranger's", async () => {
    const { scenario, person, email, subjectRequestId } = await workspaceWithAnErasureRequest();
    const { sessionId } = await identityRowsFor(db().pool, { userId: person.id, email });
    const strangersEmail = addressOf("someone");
    const stranger = await memberOf(db().pool, scenario.workspaceId, strangersEmail);
    const strangers = await identityRowsFor(db().pool, {
      userId: stranger.id,
      email: strangersEmail,
    });
    const theirs = [
      await restoreCodeFor(db().pool, email, {
        hash: "a".repeat(64),
        expiresAt: new Date("2026-10-03T12:00:00.000Z"),
      }),
      await parkedSecretFor(db().pool, sessionId),
      await passkeyChallengeFor(db().pool, sessionId),
    ];
    const notTheirs = [
      await parkedSecretFor(db().pool, strangers.sessionId),
      await passkeyChallengeFor(db().pool, strangers.sessionId),
    ];

    await completing(scenario, subjectRequestId);

    const left = await db().pool.query<{ id: string }>(
      "SELECT id FROM verification WHERE id = ANY($1)",
      [[...theirs, ...notTheirs]],
    );
    expect(left.rows.map((row) => row.id).toSorted()).toEqual(notTheirs.toSorted());
  });

  it("empties every identity-set table that names the person", async () => {
    expect(await identityTablesNamingAPerson()).toEqual(
      [...SWEPT_BY_PERSON, ...BEYOND_THE_SWEEP].toSorted(),
    );
    const { scenario, person, email, subjectRequestId } = await workspaceWithAnErasureRequest();
    await identityRowsFor(db().pool, { userId: person.id, email });
    await secondFactorRowsFor(db().pool, person.id);
    await lastActiveIn(db().pool, scenario.workspaceId, person.id);
    expect(await sweptTablesHolding(person.id)).toEqual(SWEPT_BY_PERSON);

    await completing(scenario, subjectRequestId);

    expect(await sweptTablesHolding(person.id)).toEqual([]);
  });

  it("deletes the person's second factor, last activity and their flags", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const held = await secondFactorRowsFor(db().pool, person.id);
    await lastActiveIn(db().pool, scenario.workspaceId, person.id);
    expect(await secondFactorHeldBy(person.id, held.passkeyId)).toEqual(SECOND_FACTOR_HELD);

    const done = await completing(scenario, subjectRequestId);

    expect(await secondFactorHeldBy(person.id, held.passkeyId)).toEqual({
      passkeys: 0,
      passkey_uses: 0,
      authenticators: 0,
      recovery_codes: 0,
      confirm_failures: 0,
      authenticator_enabled: false,
      offer_dismissed: false,
      recovery_codes_acknowledged: false,
      restore_required: false,
      promoted: false,
    });
    expect(await lastActiveWorkspacesOf(person.id)).toEqual([]);
    expect(operatorLinesAbout(done.erasureRequestId)).toEqual([
      matching.objectContaining({
        passkeys_deleted: 1,
        authenticators_deleted: 1,
        recovery_codes_deleted: 2,
        confirm_failures_deleted: 2,
        last_active_deleted: 1,
      }),
    ]);
  });

  it("keeps the second factor, ending only this workspace's last activity", async () => {
    const { scenario, elsewhere, email, person } = await memberHereAndElsewhere();
    const held = await secondFactorRowsFor(db().pool, person.id);
    await lastActiveIn(db().pool, scenario.workspaceId, person.id);
    await lastActiveIn(db().pool, elsewhere.workspaceId, person.id);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);

    const done = await completing(scenario, subjectRequestId);

    expect(await secondFactorHeldBy(person.id, held.passkeyId)).toEqual(SECOND_FACTOR_HELD);
    expect(await lastActiveWorkspacesOf(person.id)).toEqual([elsewhere.workspaceId]);
    expect(operatorLinesAbout(done.erasureRequestId)).toEqual([
      matching.objectContaining({
        arm: "held-elsewhere",
        passkeys_deleted: 0,
        last_active_deleted: 1,
      }),
    ]);
  });

  it("deletes the subject's own codes, never a stranger's", async () => {
    const scenario = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);

    const notTheirs = addressOf("a-customer-contact");
    for (const address of [email, notTheirs]) {
      await verificationCodeFor(db().pool, address);
      await signInLinkFor(db().pool, address);
      await otherCodesFor(db().pool, address);
    }
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email, [
      notTheirs,
    ]);

    await completing(scenario, subjectRequestId);

    expect({
      theirs: await verificationsFor(email),
      theStranger: await verificationsFor(notTheirs),
    }).toEqual({ theirs: 0, theStranger: 4 });
  });

  it("keeps a stranger's code whose key holds the subject's address", async () => {
    const scenario = await arrange();
    const stranger = addressOf("priya");
    const lookalike = `sign-in-otp-${stranger}`;
    const person = await memberOf(db().pool, scenario.workspaceId, lookalike);
    await verificationCodeFor(db().pool, stranger);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, lookalike);

    await completing(scenario, subjectRequestId);

    expect(await verificationsFor(stranger)).toBe(1);
  });

  it("ends only this member while the person holds another workspace", async () => {
    const { scenario, elsewhere, email, person } = await memberHereAndElsewhere();
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

  it("keeps restore codes and parked secrets for another workspace", async () => {
    const { scenario, email, person } = await memberHereAndElsewhere();
    const { sessionId } = await identityRowsFor(db().pool, { userId: person.id, email });
    const kept = [
      await parkedSecretFor(db().pool, sessionId),
      await restoreCodeFor(db().pool, email, {
        hash: "b".repeat(64),
        expiresAt: new Date("2026-10-04T09:00:00.000Z"),
      }),
    ];
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);

    await completing(scenario, subjectRequestId);

    const left = await db().pool.query<{ id: string }>(
      "SELECT id FROM verification WHERE id = ANY($1)",
      [kept],
    );
    expect(left.rows.map((row) => row.id).toSorted()).toEqual(kept.toSorted());
  });

  it("deletes the address's invitations in every workspace, never a stranger's", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);

    const notTheirs = addressOf("a-customer-contact");
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
        arm: "last-workspace",
        pseudonymised: 1,
        sessions_deleted: 0,
        verifications_deleted: 0,
        accounts_deleted: 0,
        invitations_deleted_here: 1,
        invitations_deleted: 2,
        ...NO_SECOND_FACTOR_DELETED,
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
      "last-workspace": operatorLinesAbout(runs["last-workspace"].erasureRequestId),
      "held-elsewhere": operatorLinesAbout(runs["held-elsewhere"].erasureRequestId),
      "no-person": operatorLinesAbout(runs["no-person"].erasureRequestId),
    }).toEqual({
      "last-workspace": [
        {
          ...namingTheRequest(runs["last-workspace"]),
          arm: "last-workspace",
          pseudonymised: 1,
          sessions_deleted: 1,
          verifications_deleted: 1,
          accounts_deleted: 1,
          invitations_deleted_here: 1,
          invitations_deleted: 1,
          passkeys_deleted: 1,
          authenticators_deleted: 1,
          recovery_codes_deleted: 2,
          confirm_failures_deleted: 2,
          last_active_deleted: 1,
        },
      ],
      "held-elsewhere": [
        {
          ...namingTheRequest(runs["held-elsewhere"]),
          arm: "held-elsewhere",
          pseudonymised: 0,
          sessions_deleted: 0,
          verifications_deleted: 0,
          accounts_deleted: 0,
          invitations_deleted_here: 0,
          invitations_deleted: 0,
          ...NO_SECOND_FACTOR_DELETED,
          last_active_deleted: 1,
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
          ...NO_SECOND_FACTOR_DELETED,
        },
      ],
    });
  });

  it("leaves every invitation standing while the person holds another workspace", async () => {
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

  it("keeps an approved requester's request, its invitation and reason cleared", async () => {
    const scenario = await arrange();
    const email = addressOf("priya");
    const requester = await seedingWith(db().pool, (seed) =>
      seed.user({ name: "Priya Anand", email, emailVerified: true }),
    );
    const { requestId, invitationId } = await approvedRequestOf(scenario, requester.id);
    const joined = await acceptInvitation(bootstrap, scenario.postgres, {
      invitationId,
      personId: requester.id,
      sessionId: ulid(),
      now: LOCKED_AT,
    });
    expect(joined.ok).toBe(true);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, requester.id, email);

    await completing(scenario, subjectRequestId);

    expect(await accessRequestsOf(requester.id)).toEqual([
      { id: requestId, workspace_id: scenario.workspaceId, reason: "", invitation_id: null },
    ]);
  });

  it("clears the request's reason while the person holds another workspace", async () => {
    const { scenario, email, person } = await memberHereAndElsewhere();
    const { requestId } = await approvedRequestOf(scenario, person.id);

    await completing(scenario, await erasureRequestAbout(scenario.workspaceId, person.id, email));

    expect(await accessRequestsOf(person.id)).toEqual([
      { id: requestId, workspace_id: scenario.workspaceId, reason: "", invitation_id: null },
    ]);
    expect(await identityRowCountsFor(scenario.workspaceId, person.id, email)).toMatchObject({
      invitations: 1,
    });
  });

  it("unlinks a request approved elsewhere whose invitation it deletes", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const elsewhere = await arrange();
    const { requestId } = await approvedRequestOf(elsewhere, person.id);

    await completing(scenario, subjectRequestId);

    expect(await accessRequestsOf(person.id)).toEqual([
      {
        id: requestId,
        workspace_id: elsewhere.workspaceId,
        reason: ASKED_FOR_ACCESS,
        invitation_id: null,
      },
    ]);
  });

  it("deletes an erased person's owner rows", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    await seedingWith(db().pool, (seed) =>
      seed.conceptOwner({
        workspaceId: scenario.workspaceId,
        collection: "expenses-desk",
        personId: person.id,
      }),
    );
    const ownersOf = async (personId: string) =>
      (
        await db().pool.query(
          "SELECT collection FROM concept_owner WHERE workspace_id = $1 AND person_id = $2",
          [scenario.workspaceId, personId],
        )
      ).rowCount;

    const done = await completing(scenario, subjectRequestId);

    expect(await ownersOf(person.id)).toBe(0);
    expect(await ownersOf(scenario.editor.userId)).toBe(EDITORS_COLLECTIONS.length);
    expect(done.report).toContain("- concept-owner: deleted 1, found 1\n");
  });

  it("stores identical identity lines on both arms, never naming elsewhere", async () => {
    const { runs, elsewhereId } = await erasedOnEachArmOnce();
    const identityLinesOf = async (done: ErasureRun) => {
      const row = (await erasureRowsIn(done.workspaceId)).find(
        (stored) => stored.id === done.erasureRequestId,
      );
      assert(row !== undefined, "the arm's erasure row was written");
      assert(row.report !== null, "the arm's run wrote its report");
      return {
        actions: Object.fromEntries(
          Object.entries(row.actions).filter(([family]) => family.startsWith("identity-")),
        ),
        report: row.report.split("\n").filter((line) => line.startsWith("- identity-")),
      };
    };

    const theSameLines = {
      actions: {
        "identity-user": { found: 1, membershipsEnded: 1 },
        "identity-session": { found: 1 },
        "identity-verification": { found: 1 },
        "identity-invitation": { found: 1 },
        "identity-account": { found: 1 },
        "identity-passkey": { found: 2 },
        "identity-authenticator": { found: 1 },
        "identity-recovery-code": { found: 2 },
        "identity-confirm-failures": { found: 2 },
        "identity-last-active": { found: 1 },
      },
      report: [
        "- identity-user: found 1, membershipsEnded 1",
        "- identity-session: found 1",
        "- identity-verification: found 1",
        "- identity-invitation: found 1",
        "- identity-account: found 1",
        "- identity-passkey: found 2",
        "- identity-authenticator: found 1",
        "- identity-recovery-code: found 2",
        "- identity-confirm-failures: found 2",
        "- identity-last-active: found 1",
      ],
    };
    expect({
      "last-workspace": await identityLinesOf(runs["last-workspace"]),
      "held-elsewhere": await identityLinesOf(runs["held-elsewhere"]),
    }).toEqual({ "last-workspace": theSameLines, "held-elsewhere": theSameLines });

    expect(runs["held-elsewhere"].report).not.toContain(elsewhereId);
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

const documentIn = (workspaceId: string, connectedSourceId: string) =>
  seedingWith(db().pool, (seed) => seed.sourceDocument({ workspaceId, connectedSourceId }));

const connectedSourceIn = (workspaceId: string) =>
  seedingWith(db().pool, (seed) => seed.connectedSource({ workspaceId }));

const passagesUnder = (
  workspaceId: string,
  documents: readonly { readonly id: string; readonly connectedSourceId: string }[],
  content = "Priya Anand approves expenses.",
) =>
  seedingWith(db().pool, async (seed) => {
    for (const document of documents) {
      await seed.passage({
        workspaceId,
        connectedSourceId: document.connectedSourceId,
        sourceDocumentId: document.id,
        content,
        locator: `${document.id}/chars:0-${content.length}`,
        ordinal: 0,
        charStart: 0,
        charEnd: content.length,
      });
    }
  });

const passagesIn = async (workspaceId: string) => {
  const read = await db().pool.query<{ connected_source_id: string; passages: number }>(
    `SELECT connected_source_id, count(*)::int AS passages FROM "index".passage
      WHERE workspace_id = $1 GROUP BY connected_source_id ORDER BY connected_source_id`,
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

const aMapOverTwoOfThreeConnectedSources = async () => {
  const scenario = await arrange();
  const shared = await connectedSourceIn(scenario.workspaceId);
  const apart = await connectedSourceIn(scenario.workspaceId);
  const untouched = await connectedSourceIn(scenario.workspaceId);
  const found = [
    await documentIn(scenario.workspaceId, shared.id),
    await documentIn(scenario.workspaceId, shared.id),
    await documentIn(scenario.workspaceId, apart.id),
  ];
  await passagesUnder(scenario.workspaceId, [
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

  it("counts documents, sources and identifiers on the report, naming none", async () => {
    const {
      scenario,
      signsInWith,
      email: atHome,
      subjectRequestId,
    } = await aMemberAskingUnder(aHomeAddress);
    const connectedSource = await connectedSourceIn(scenario.workspaceId);
    await documentIn(scenario.workspaceId, connectedSource.id);

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

  it("names each connected source holding a found document once", async () => {
    const { scenario, shared, apart, found } = await aMapOverTwoOfThreeConnectedSources();

    const rederived = await rederivingOver(scenario, found, LOCKED_AT);

    expect(rederived.connectedSourcesToReprocess).toEqual([shared.id, apart.id].sort());
    expect(rederived.rebuildJobId).toBeNull();
  });
});

const THE_REBUILD = { kind: "full-rebuild", subject_id: null, reason: "erasure", status: "queued" };

const wipesOf = (connectedSources: readonly { readonly id: string }[]) =>
  connectedSources
    .map((connectedSource) => connectedSource.id)
    .sort()
    .map((subject_id) => ({ kind: "index", subject_id, reason: "wiped", status: "queued" }));

const whatTheWipeLeft = async (workspaceId: string) => ({
  passages: await passagesIn(workspaceId),
  queued: await queuedIn(workspaceId),
});

const everyConnectedSourceWiped = (
  arranged: Awaited<ReturnType<typeof aMapOverTwoOfThreeConnectedSources>>,
) => ({
  passages: [{ connected_source_id: arranged.untouched.id, passages: 1 }],
  queued: [THE_REBUILD, ...wipesOf([arranged.shared, arranged.apart])],
});

describe("the wipe of every connected source the map found", () => {
  it("deletes each source's passages, queueing its sync as wiped", async () => {
    const arranged = await aMapOverTwoOfThreeConnectedSources();

    const rederived = await rederivingOver(arranged.scenario, arranged.found, null);

    expect(rederived.rebuildJobId).not.toBeNull();
    expect(await whatTheWipeLeft(arranged.scenario.workspaceId)).toEqual(
      everyConnectedSourceWiped(arranged),
    );
  });

  it("wipes a source naming the subject when the routine runs", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();
    const workspaceId = scenario.workspaceId;
    const naming = await connectedSourceIn(workspaceId);
    const elsewhere = await connectedSourceIn(workspaceId);
    const named = await documentIn(workspaceId, naming.id);
    const unnamed = await documentIn(workspaceId, elsewhere.id);
    await passagesUnder(workspaceId, [named]);
    await passagesUnder(workspaceId, [unnamed], "Expenses are claimed within thirty days.");

    const done = await completing(scenario, subjectRequestId);

    expect(done.map.find((entry) => entry.family === "source-document")?.locations).toEqual([
      named.id,
    ]);
    expect(await whatTheWipeLeft(workspaceId)).toEqual({
      passages: [{ connected_source_id: elsewhere.id, passages: 1 }],
      queued: [THE_REBUILD, ...wipesOf([naming])],
    });
    expect(done.report).toContain(
      "\n- source-document: bindingsReindexed 1, found 1, identifiersWithheld 2\n",
    );
  });

  it("wipes restored rows on a replay, queueing no second sync", async () => {
    const arranged = await aMapOverTwoOfThreeConnectedSources();

    await rederivingOver(arranged.scenario, arranged.found, null);
    await passagesUnder(arranged.scenario.workspaceId, arranged.found);
    const replayed = await rederivingOver(arranged.scenario, arranged.found, LOCKED_AT);

    expect(replayed.rebuildJobId).toBeNull();
    expect(await whatTheWipeLeft(arranged.scenario.workspaceId)).toEqual(
      everyConnectedSourceWiped(arranged),
    );
  });

  it.each([
    ["restored", "wiped"],
    ["rule-change", "rule-change"],
  ] as const)("queues nothing behind one queued as %s, leaving it %s", async (queuedAs, left) => {
    const { scenario, shared, apart, found } = await aMapOverTwoOfThreeConnectedSources();
    await seedingWith(db().pool, (seed) =>
      seed.job({
        workspaceId: scenario.workspaceId,
        kind: "index",
        subjectId: shared.id,
        reason: queuedAs,
      }),
    );

    await rederivingOver(scenario, found, LOCKED_AT);

    const reasonOf: Record<string, string> = { [shared.id]: left, [apart.id]: "wiped" };
    expect(await queuedIn(scenario.workspaceId)).toEqual(
      wipesOf([shared, apart]).map((run) => ({ ...run, reason: reasonOf[run.subject_id] })),
    );
  });
});

const settledOrWaitingTwo = (settled: readonly unknown[]) => async () =>
  settled.length > 0 || (await countWaitingOnLocks(db().pool)) === 2;

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

type Member = { readonly workspaceId: string; readonly userId: string };

const aMemberHere = async () => {
  const scenario = await arrange();
  const email = addressOf("priya");
  const person = await memberOf(db().pool, scenario.workspaceId, email);
  return {
    scenario,
    email,
    person,
    member: { workspaceId: scenario.workspaceId, userId: person.id },
  };
};

const heldAheadOfTheMembersEnd = async <T>(
  scenario: Scenario,
  subjectRequestId: string,
  member: Member,
  meanwhile: (resume: () => Promise<unknown>) => Promise<T>,
) => {
  await lastActiveIn(db().pool, member.workspaceId, member.userId);
  return whileActionsWaitAt(db().pool, "workspace_last_active", "DELETE", async (release) => {
    const erasing = runningTheRoutine(scenario, subjectRequestId);
    await until(async () => (await countWaitingOnLocks(db().pool)) === 1);
    const met = await meanwhile(async () => {
      await release();
      return erasing;
    });
    await release();
    return { done: await erasing, met };
  });
};

const pseudonymIn = async (workspaceId: string): Promise<string> =>
  (await erasureRowsIn(workspaceId))[0]?.pseudonym ?? "no erasure ran";

describe("the questions a person asked", () => {
  const rowsOf = (recordId: string) => questionRowsOf(db().pool, recordId);

  it("rewrites the asker, removes the question, note and disputed sentence", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const theirs = await recordAskedBy(db().pool, scenario.workspaceId, person.id);
    expect(await rowsOf(theirs.recordId)).toEqual(asAsked(theirs.asker));

    await completing(scenario, subjectRequestId);

    const pseudonym = await pseudonymIn(scenario.workspaceId);
    expect(pseudonym).not.toEqual(person.id);
    expect(await rowsOf(theirs.recordId)).toEqual(asErased(pseudonym));
  });

  it("removes a question asked at a microsecond's precision", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const theirs = await recordAskedBy(db().pool, scenario.workspaceId, person.id);
    await askedAMicrosecondFiner(db().pool, theirs.recordId);

    await completing(scenario, subjectRequestId);

    expect((await rowsOf(theirs.recordId)).content).toEqual([]);
  });

  it("leaves another member's question and note as they were", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    await recordAskedBy(db().pool, scenario.workspaceId, person.id);
    const anothers = await recordAskedBy(db().pool, scenario.workspaceId, scenario.viewer.userId);

    await completing(scenario, subjectRequestId);

    expect(await rowsOf(anothers.recordId)).toEqual(asAsked(anothers.asker));
  });

  it("reaches this workspace's records alone, whichever arm runs", async () => {
    const { scenario, elsewhere, email, person } = await memberHereAndElsewhere();
    const here = await recordAskedBy(db().pool, scenario.workspaceId, person.id);
    const there = await recordAskedBy(db().pool, elsewhere.workspaceId, person.id);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);

    await completing(scenario, subjectRequestId);

    expect(await rowsOf(here.recordId)).toEqual(asErased(await pseudonymIn(scenario.workspaceId)));
    expect(await rowsOf(there.recordId)).toEqual(asAsked(there.asker));
  });

  it("reaches a former member's questions by their person id", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest({
      byIdAlone: true,
    });
    const theirs = await recordAskedBy(db().pool, scenario.workspaceId, person.id);
    await db().pool.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      scenario.workspaceId,
      person.id,
    ]);

    await completing(scenario, subjectRequestId);

    expect(await rowsOf(theirs.recordId)).toEqual(
      asErased(await pseudonymIn(scenario.workspaceId)),
    );
  });

  it("renames the person's flags alone, on anyone's record", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const { workspaceId, viewer } = scenario;
    const theirs = await recordAskedBy(db().pool, workspaceId, person.id);
    const anothers = await recordAskedBy(db().pool, workspaceId, viewer.userId);
    await flagGivenBy(db().pool, workspaceId, anothers.recordId, person.id);
    await flagGivenBy(db().pool, workspaceId, theirs.recordId, viewer.userId);

    await completing(scenario, subjectRequestId);

    const erased = { given_by: `human:${await pseudonymIn(workspaceId)}`, note: null };
    expect(await flagsOn(db().pool, anothers.recordId)).toEqual([
      erased,
      flagStanding(anothers.asker),
    ]);
    expect(await flagsOn(db().pool, theirs.recordId)).toEqual([
      erased,
      flagStanding(anothers.asker),
    ]);
  });

  it("renames a flag its giver stored while erasure ran", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const { workspaceId } = scenario;
    const theirs = await recordAskedBy(db().pool, workspaceId, person.id);
    const flag = { recordId: theirs.recordId, verdict: "flag", reason: "incomplete" } as const;
    const ended: string[] = [];

    await whileActionsWaitAt(db().pool, "question_feedback", "INSERT", async (release) => {
      const giving = withHeldPrincipal(
        openPostgres(db().runtimePool),
        { workspaceId, userId: person.id, issuedAt: LOCKED_AT },
        (giver, tx) => giveFeedback(giver, tx, { ...flag, note: "Still wrong." }, LOCKED_AT),
      );
      await until(async () => (await countWaitingOnLocks(db().pool)) === 1);
      const erasing = completing(scenario, subjectRequestId).then(() => ended.push("erasure"));
      await until(settledOrWaitingTwo(ended));
      await release();
      await giving;
      await erasing;
    });

    const erased = { given_by: `human:${await pseudonymIn(workspaceId)}`, note: null };
    expect(await flagsOn(db().pool, theirs.recordId)).toEqual([erased, erased]);
  });

  const asTheMember = async <T>(
    member: Member,
    work: (principal: UserPrincipal, tx: Tx) => Promise<Result<T, unknown>>,
  ): Promise<T> =>
    answered(
      answered(
        await withHeldPrincipal(
          openPostgres(db().runtimePool),
          { ...member, issuedAt: LOCKED_AT },
          work,
        ),
      ),
    );

  const A_LATE_QUESTION = "Who signs off the Leeds lease?";

  const A_LATE_NOTE = "It left out the Leeds office.";

  const opening = (asker: UserPrincipal, tx: Tx) =>
    openRecord(asker, tx, {
      question: A_LATE_QUESTION,
      collections: [],
      transport: "mcp",
      askedAt: new Date(),
    });

  const openingARecord = (member: Member): Promise<{ readonly recordId: string }> =>
    asTheMember(member, opening);

  const completingTheRecord = (member: Member, recordId: string): Promise<void> =>
    asTheMember(member, (asker, tx) =>
      completeRecord(asker, tx, {
        recordId,
        completedAt: new Date(),
        verdict: "refuse",
        judgeState: "not-judged",
        concepts: [],
        unmappedPassages: [],
        map: { state: "live" },
        drafted: [{ sentence: "The landlord signs off the Leeds lease.", concepts: [] }],
      }),
    );

  const flaggingTheRecord = async (member: Member, recordId: string): Promise<void> => {
    await asTheMember(member, (giver, tx) =>
      giveFeedback(
        giver,
        tx,
        { recordId, verdict: "flag", reason: "incomplete", note: A_LATE_NOTE },
        new Date(),
      ),
    );
  };

  const askingThenFlagging = async (member: Member): Promise<string> => {
    const { recordId } = await openingARecord(member);
    await completingTheRecord(member, recordId);
    await flaggingTheRecord(member, recordId);
    return recordId;
  };

  const asAskedMidRun = (asker: string) => ({
    skeleton: [{ asked_by: asker, verdict: "refuse" }],
    content: [{ question: A_LATE_QUESTION }],
    feedback: [
      {
        given_by: asker,
        reason: "incomplete",
        note: A_LATE_NOTE,
        disputed_sentence: null,
        rests_on_a_concept: false,
      },
    ],
  });

  const asErasedMidRun = (pseudonym: string) => ({
    skeleton: [{ asked_by: `human:${pseudonym}`, verdict: "refuse" }],
    content: [],
    feedback: [
      {
        given_by: `human:${pseudonym}`,
        reason: "incomplete",
        note: null,
        disputed_sentence: null,
        rests_on_a_concept: false,
      },
    ],
  });

  it("erases a question asked and flagged after its questions step", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const member = { workspaceId: scenario.workspaceId, userId: person.id };
    const before = await recordAskedBy(db().pool, member.workspaceId, member.userId);

    const { done, met } = await heldAheadOfTheMembersEnd(
      scenario,
      subjectRequestId,
      member,
      async () => ({
        stoodAt: await rowsOf(before.recordId),
        recordId: await askingThenFlagging(member),
      }),
    );

    const pseudonym = await pseudonymIn(member.workspaceId);
    expect(done.ok).toBe(true);
    expect(met.stoodAt).toEqual(asErased(pseudonym));
    expect(await rowsOf(met.recordId)).toEqual(asErasedMidRun(pseudonym));
  });

  it("erases by address after a run died ending the member", async () => {
    const { scenario, email, member } = await aMemberHere();
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, null, email);

    const { done: died, met: recordId } = await heldAheadOfTheMembersEnd(
      scenario,
      subjectRequestId,
      member,
      async (resume) => {
        const asked = await askingThenFlagging(member);
        await whileWritesAreRefused(db().pool, "question_content", resume);
        return asked;
      },
    );
    await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(died.ok).toBe(false);
    expect(await rowsOf(recordId)).toEqual(asErasedMidRun(await pseudonymIn(member.workspaceId)));
  });

  it("counts and logs what it erased as the member ended", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const member = { workspaceId: scenario.workspaceId, userId: person.id };
    await recordAskedBy(db().pool, member.workspaceId, member.userId);

    await heldAheadOfTheMembersEnd(scenario, subjectRequestId, member, () =>
      askingThenFlagging(member),
    );

    const [row] = await erasureRowsIn(member.workspaceId);
    expect(row?.actions["question-asked"]).toEqual({
      found: 1,
      rewritten: 2,
      questionsRemoved: 2,
      feedbackRewritten: 2,
    });
    const sweep = {
      actor: ERASURE_ACTOR,
      erasure_request_id: row?.id,
      records_rewritten: 1,
      questions_removed: 1,
      feedback_rewritten: 1,
    };
    const logged = questionsLines.filter((line) => line.erasure_request_id === row?.id);
    expect(logged).toEqual([sweep, sweep]);
    expect(logged.map((line) => saidWith.get(line))).toEqual([
      "erasure: what the questions step rewrote and removed",
      "erasure: what was asked or flagged after the questions step, rewritten and removed as the member ended",
    ]);
  });

  it("erases late questions here alone for a member held elsewhere", async () => {
    const { scenario, elsewhere, email, person } = await memberHereAndElsewhere();
    const here = { workspaceId: scenario.workspaceId, userId: person.id };
    const there = { workspaceId: elsewhere.workspaceId, userId: person.id };
    const subjectRequestId = await erasureRequestAbout(here.workspaceId, person.id, email);

    const { done, met } = await heldAheadOfTheMembersEnd(
      scenario,
      subjectRequestId,
      here,
      async () => ({
        here: await askingThenFlagging(here),
        there: await askingThenFlagging(there),
      }),
    );

    expect(done.ok).toBe(true);
    expect(await rowsOf(met.here)).toEqual(asErasedMidRun(await pseudonymIn(here.workspaceId)));
    expect(await rowsOf(met.there)).toEqual(asAskedMidRun(`human:${person.id}`));
  });

  const stillOpenAtTheMembersEnd = async (
    table: string,
    resume: () => Promise<unknown>,
    write: () => Promise<unknown>,
  ): Promise<void> => {
    // Wrapped, or the lock would be held until the write it blocks had ended.
    const parked = await holdingTable(db().pool, table, async () => {
      const writing = write();
      await until(() => isBlockedOnTable(db().pool, table));
      const ending = resume();
      await until(async () => (await countWaitingOnLocks(db().pool)) === 2);
      return { writing, ending };
    });
    await parked.writing;
    await parked.ending;
  };

  it.each([
    {
      late: "completion",
      table: "question_asked",
      first: [],
      write: completingTheRecord,
      flags: 0,
    },
    {
      late: "flag",
      table: "question_feedback",
      first: [completingTheRecord],
      write: flaggingTheRecord,
      flags: 1,
    },
  ])(
    "erases a late question whose $late was still to commit",
    async ({ table, first, write, flags }) => {
      const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
      const member = { workspaceId: scenario.workspaceId, userId: person.id };

      const { done, met: recordId } = await heldAheadOfTheMembersEnd(
        scenario,
        subjectRequestId,
        member,
        async (resume) => {
          const opened = await openingARecord(member);
          for (const step of first) await step(member, opened.recordId);
          await stillOpenAtTheMembersEnd(table, resume, () => write(member, opened.recordId));
          return opened.recordId;
        },
      );

      const erased = asErasedMidRun(await pseudonymIn(member.workspaceId));
      expect(done.ok).toBe(true);
      expect(await rowsOf(recordId)).toEqual({
        ...erased,
        feedback: erased.feedback.slice(0, flags),
      });
    },
  );

  it("refuses a question that starts once the member is ended", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const member = { workspaceId: scenario.workspaceId, userId: person.id };

    const answers: unknown[] = [];

    const { done, asked } = await whileActionsWaitAt(
      db().pool,
      "user",
      "UPDATE",
      async (release) => {
        const erasing = runningTheRoutine(scenario, subjectRequestId);
        await until(async () => (await countWaitingOnLocks(db().pool)) === 1);
        const asking = withHeldPrincipal(
          openPostgres(db().runtimePool),
          { ...member, issuedAt: LOCKED_AT },
          opening,
        ).then((answer) => {
          answers.push(answer);
          return answer;
        });
        await until(settledOrWaitingTwo(answers));
        await release();
        return { done: await erasing, asked: await asking };
      },
    );

    const theirs = await db().pool.query(
      "SELECT id FROM question_asked WHERE workspace_id = $1 AND asked_by = $2",
      [member.workspaceId, `human:${person.id}`],
    );
    expect(done.ok).toBe(true);
    expect(asked).toEqual({ ok: false, error: "not-a-member" });
    expect(theirs.rows).toEqual([]);
  });

  it("erases a question whose opening commits after its questions step", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const member = { workspaceId: scenario.workspaceId, userId: person.id };

    const { done, recordId } = await whileActionsWaitAt(
      db().pool,
      "question_asked",
      "INSERT",
      async (release) => {
        const openingRecord = openingARecord(member);
        await until(async () => (await countWaitingOnLocks(db().pool)) === 1);
        const erasing = runningTheRoutine(scenario, subjectRequestId);
        await until(async () => (await countWaitingOnLocks(db().pool)) === 2);
        await release();
        return { done: await erasing, ...(await openingRecord) };
      },
    );

    expect(done.ok).toBe(true);
    expect(await rowsOf(recordId)).toEqual({
      skeleton: [{ asked_by: `human:${await pseudonymIn(member.workspaceId)}`, verdict: null }],
      content: [],
      feedback: [],
    });
  });

  it("erases a member named by address after a failed run", async () => {
    const scenario = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, null, email);
    const theirs = await recordAskedBy(db().pool, scenario.workspaceId, person.id);

    const died = await whileWritesAreRefused(db().pool, "question_asked", () =>
      runningTheRoutine(scenario, subjectRequestId),
    );
    await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(died.ok).toBe(false);
    expect(await rowsOf(theirs.recordId)).toEqual(
      asErased(await pseudonymIn(scenario.workspaceId)),
    );
  });

  it("logs its counts as it commits, kept past a rerun", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    await recordAskedBy(db().pool, scenario.workspaceId, person.id);

    const died = await whileWritesAreRefused(db().pool, "member", () =>
      runningTheRoutine(scenario, subjectRequestId),
    );
    const done = await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(died.ok).toBe(false);
    const line = { actor: ERASURE_ACTOR, erasure_request_id: done.erasureRequestId };
    expect(
      questionsLines.filter((logged) => logged.erasure_request_id === done.erasureRequestId),
    ).toEqual([{ ...line, records_rewritten: 1, questions_removed: 1, feedback_rewritten: 1 }]);
  });

  it("counts what it did on the request's row and report", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    await recordAskedBy(db().pool, scenario.workspaceId, person.id);
    await recordAskedBy(db().pool, scenario.workspaceId, person.id);

    const done = await completing(scenario, subjectRequestId);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row?.actions["question-asked"]).toEqual({
      found: 2,
      rewritten: 2,
      questionsRemoved: 2,
      feedbackRewritten: 2,
    });
    expect(done.report).toContain(
      "\n- question-asked: feedbackRewritten 2, found 2, questionsRemoved 2, rewritten 2\n",
    );
  });

  it("rewrites again when run over rows a restore brought back", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const theirs = await recordAskedBy(db().pool, scenario.workspaceId, person.id);
    await completing(scenario, subjectRequestId);
    const restored = await recordAskedBy(db().pool, scenario.workspaceId, person.id);

    await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    const pseudonym = await pseudonymIn(scenario.workspaceId);
    expect(await rowsOf(restored.recordId)).toEqual(asErased(pseudonym));
    expect(await rowsOf(theirs.recordId)).toEqual(asErased(pseudonym));
  });
});

describe("a subject with no user row", () => {
  it("erases by suppression alone and reports what each arm did", async () => {
    const { scenario, done } = await completedForASubjectWithNoUserRow();

    expect(done.report).toContain("concept-file: found 0, reindexed 0, rewritten 0");
    expect(done.report).toContain("bundle-commit: actorsRewritten 0, found 0, moved 0");
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

    const conceptFiles = copy.map.find((entry) => entry.family === "concept-file");
    assert(conceptFiles !== undefined, "the copy maps the concept files");
    const found = conceptFiles.locations;
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
    assert(shut.ok, "the door refused its settings");

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

const conceptVerifiedBy = async (workspaceId: string, verifier: string): Promise<ConceptIri> =>
  seedingWith(db().pool, async (seed) => {
    const sha = randomBytes(20).toString("hex");
    const actor = `human:${verifier}`;
    await seed.bundleCommit({ workspaceId, sha, parentSha: null, actor });
    const conceptPath = `knowledge/mileage-${sha.slice(0, 8)}.md`;
    const frontmatter = { title: "Mileage", type: "Policy" };
    const body = "Mileage is claimed at the published rate.";
    const indexed = await seed.conceptIndex({
      workspaceId,
      path: conceptPath,
      commitSha: sha,
      frontmatter,
      body,
      contentHash: contentHashOf(frontmatter, body, conceptPath),
    });
    await seed.conceptVerification({
      workspaceId,
      iri: indexed.iri,
      actor,
      contentHash: indexed.contentHash,
      verifiedAt: new Date("2026-04-05T09:00:00.000Z"),
    });
    return indexed.iri;
  });

describe("the arm the identity step takes", () => {
  it("takes the last workspace for a person removed elsewhere meanwhile", async () => {
    const { scenario, elsewhere, email, person } = await memberHereAndElsewhere();
    const member = { workspaceId: scenario.workspaceId, userId: person.id };
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);

    const { done } = await heldAheadOfTheMembersEnd(scenario, subjectRequestId, member, () =>
      db().pool.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
        elsewhere.workspaceId,
        person.id,
      ]),
    );

    assert(done.ok, "the routine refused");
    expect(operatorLinesAbout(done.value.erasureRequestId).map((line) => line.arm)).toEqual([
      "last-workspace",
    ]);
    expect((await userRowOf(person.id))?.email).toMatch(/@erased\.better-answers\.invalid$/);
  });
});

describe("the person's actor id on the platform's records", () => {
  it("rewrites both families for a request by address alone", async () => {
    const { scenario, email } = await bundleNamingThePerson();
    const byAddress = await erasureRequestAbout(scenario.workspaceId, null, email);

    const done = await completing(scenario, byAddress);

    const pseudonym = (await erasureRowsIn(scenario.workspaceId)).find(
      (row) => row.subject_request_id === byAddress,
    )?.pseudonym;
    const erased = `human:${pseudonym}`;
    expect(await actorsIn("bundle_commit", scenario.workspaceId)).toEqual([erased, erased]);
    expect(await actorsIn("concept_verification", scenario.workspaceId)).toEqual([erased, erased]);
    expect(done.report).toContain("bundle-commit: actorsRewritten 2, found 2, moved 2");
    expect(done.report).toContain("concept-verification: actorsRewritten 2, found 2, rehashed 1");
  });

  it("leaves another member's commit and verification as they were", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();
    await conceptVerifiedBy(scenario.workspaceId, scenario.editor.userId);

    await completing(scenario, subjectRequestId);

    const theirs = actorIdOfPerson(scenario.editor.userId);
    expect(await actorsIn("bundle_commit", scenario.workspaceId)).toContain(theirs);
    expect(await actorsIn("concept_verification", scenario.workspaceId)).toContain(theirs);
  });

  it("names no verifier held elsewhere, saying a former member verified", async () => {
    const { scenario, email, person } = await memberHereAndElsewhere();
    const iri = await conceptVerifiedBy(scenario.workspaceId, person.id);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);
    expect(await trustOf(scenario, iri)).toMatchObject({ verifiedBy: "Priya Anand" });

    await completing(scenario, subjectRequestId);

    const trust = await trustOf(scenario, iri);
    expect(trust).toMatchObject({ verifiedBy: `human:${await pseudonymIn(scenario.workspaceId)}` });
    assert(trust);
    expect(trustWords(trust)).toBe("Verified by a former member · 5 April 2026");
  });

  it("rewrites rows the person lands before the member ends", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const member = { workspaceId: scenario.workspaceId, userId: person.id };

    const { done } = await heldAheadOfTheMembersEnd(scenario, subjectRequestId, member, () =>
      conceptVerifiedBy(scenario.workspaceId, person.id),
    );

    const erased = `human:${await pseudonymIn(scenario.workspaceId)}`;
    expect(done.ok).toBe(true);
    expect(await actorsIn("bundle_commit", scenario.workspaceId)).toEqual([erased]);
    expect(await actorsIn("concept_verification", scenario.workspaceId)).toEqual([erased]);
  });

  it("rewrites a version's actor and keeps its prose", async () => {
    const { scenario, person, subjectRequestId } = await workspaceWithAnErasureRequest();
    const { workspaceId } = scenario;
    const actor = actorIdOfPerson(person.id);
    await seedingWith(db().pool, async (seed) => {
      const first = await seed.writeUpVersion({ workspaceId, actor, markdown: "Cover of £5m." });
      await seed.writeUpVersion({
        workspaceId,
        writeUpId: first.writeUpId,
        version: 2,
        actor,
        markdown: "Cover of £10m.",
      });
      await seed.usage({ workspaceId, actor, writeUpId: first.writeUpId, writeUpVersion: 2 });
      await seed.guideDefinitionVersion({ workspaceId, actor });
    });

    const done = await completing(scenario, subjectRequestId);

    const erased = `human:${await pseudonymIn(workspaceId)}`;
    expect(await recordActorsIn(workspaceId)).toEqual({
      versions: [
        { actor: erased, markdown: "Cover of £5m." },
        { actor: erased, markdown: "Cover of £10m." },
      ],
      guides: [erased],
      usage: [erased],
    });
    expect(done.report).toContain("write-up-version: actorsRewritten 2, found 2");
    expect(done.report).toContain("guide-definition-version: actorsRewritten 1, found 1");
    expect(done.report).toContain("usage: actorsRewritten 1, found 1");
  });
});

const recordActorsIn = async (workspaceId: string) => {
  const versions = await db().pool.query<{ actor: string; markdown: string }>(
    "SELECT actor, markdown FROM write_up_version WHERE workspace_id = $1 ORDER BY version",
    [workspaceId],
  );
  return {
    versions: versions.rows,
    guides: await actorsIn("guide_definition_version", workspaceId),
    usage: await actorsIn("usage", workspaceId),
  };
};

const A_LATE_CONCEPT = {
  mergeKey: "guideline:late-claims",
  path: "knowledge/late-claims/late-claims.md",
  kind: "Guideline",
  title: "Late claims",
  frontmatter: { title: "Late claims", type: "Guideline" },
  body: "# Late claims\n\nA claim after thirty days needs a manager's note.",
  message: "Record the late claims guideline",
  status: "stable",
  sensitivity: "Internal",
} as const;

const owningTheLateClaims = async (scenario: Scenario, personId: string): Promise<void> => {
  const { workspaceId } = scenario;
  const held = await db().pool.query(
    "SELECT 1 FROM concept_owner WHERE workspace_id = $1 AND collection = 'late-claims'",
    [workspaceId],
  );
  if (held.rowCount !== 0) return;
  await seedingWith(db().pool, (seed) =>
    seed.conceptOwner({ workspaceId, collection: "late-claims", personId }),
  );
};

const writingAsThePerson = async (
  scenario: Scenario,
  person: { readonly id: string },
  email: string,
) => {
  const writer = await principalFor(db(), scenario.workspaceId, person.id);
  await owningTheLateClaims(scenario, person.id);
  const history = await bundleHistory(scenario.git, scenario.workspaceId);
  return writeConcept(writer, doorsOf(scenario), {
    ...A_LATE_CONCEPT,
    frontmatter: { ...A_LATE_CONCEPT.frontmatter },
    author: { name: "Priya Anand", email },
    expects: { head: history.at(-1) ?? null },
  });
};

const thePersonIn = async (scenario: Scenario, person: { readonly id: string }, email: string) => {
  const stored = await everyObjectOf(scenario.git, scenario.workspaceId);
  return {
    address: stored.includes(email),
    personId: stored.includes(person.id),
    authors: (await authorLinesOf(scenario.git, scenario.workspaceId)).filter((line) =>
      line.includes(email),
    ),
  };
};

const NOWHERE = { address: false, personId: false, authors: [] };

const theMemberRowIsFree = async (scenario: Scenario, person: { readonly id: string }) => {
  const probe = await db().pool.connect();
  try {
    await probe.query("BEGIN");
    await probe.query(
      "SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE NOWAIT",
      [scenario.workspaceId, person.id],
    );
    return true;
  } catch {
    return false;
  } finally {
    await probe.query("ROLLBACK");
    probe.release();
  }
};

describe("a commit made as the person while the routine runs", () => {
  it("rewrites a concept the person writes after the git step", async () => {
    const { scenario, email, person, subjectRequestId } = await bundleNamingThePerson();
    const member = { workspaceId: scenario.workspaceId, userId: person.id };

    const { done, met } = await heldAheadOfTheMembersEnd(scenario, subjectRequestId, member, () =>
      writingAsThePerson(scenario, person, email),
    );

    expect(met.ok).toBe(true);
    expect(done.ok).toBe(true);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(3);
    expect(await thePersonIn(scenario, person, email)).toEqual(NOWHERE);
  });

  it("ends the member once a commit underway lands, then rewrites", async () => {
    const { scenario, email, person, subjectRequestId } = await bundleNamingThePerson();
    const member = { workspaceId: scenario.workspaceId, userId: person.id };
    const gate = await gatingRefUpdates(scenario.git, scenario.workspaceId);

    const { done, met } = await heldAheadOfTheMembersEnd(
      scenario,
      subjectRequestId,
      member,
      async (resume) => {
        await gate.park();
        const writing = writingAsThePerson(scenario, person, email);
        await until(gate.parked);
        const ending = resume();
        await until(async () => (await countWaitingOnLocks(db().pool)) === 1);
        await gate.unpark();
        await ending;
        return writing;
      },
    );

    expect(done.ok).toBe(true);
    expect(met).toMatchObject({ ok: true });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(3);
    expect(await thePersonIn(scenario, person, email)).toEqual(NOWHERE);

    const swept = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });
    assert(swept.ok);
    expect(swept.value.replayed).toHaveLength(0);
    const erased = `human:${await pseudonymIn(scenario.workspaceId)}`;
    expect(await actorsIn("bundle_commit", scenario.workspaceId)).toEqual([erased, erased, erased]);
  });

  it("stops a hung commit and frees the member row", async () => {
    const { scenario, email, person } = await bundleNamingThePerson();
    const gate = await gatingRefUpdates(scenario.git, scenario.workspaceId);
    const before = await bundleHistory(scenario.git, scenario.workspaceId);
    const writer = await principalFor(db(), scenario.workspaceId, person.id);
    await owningTheLateClaims(scenario, person.id);
    const impatient = { ...doorsOf(scenario), git: { ...scenario.git, commitBudgetMs: 500 } };
    const tip = before.at(-1);
    assert(tip !== undefined, "the bundle has a head");

    await gate.park();
    const written = await writeConcept(writer, impatient, {
      ...A_LATE_CONCEPT,
      frontmatter: { ...A_LATE_CONCEPT.frontmatter },
      author: { name: "Priya Anand", email },
      expects: { head: tip },
    });
    const freeWhileGitHangs = await theMemberRowIsFree(scenario, person);
    await gate.unpark();

    expect(written).toMatchObject({
      ok: false,
      error: { message: matching.stringContaining("ran past its 500 ms budget") },
    });
    expect(freeWhileGitHangs).toBe(true);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(before);
    expect(await writingAsThePerson(scenario, person, email)).toMatchObject({ ok: true });
  });

  it("holds the rewrite until another process's write lands", async () => {
    const { scenario, email, person, subjectRequestId } = await bundleNamingThePerson();
    const gate = await gatingRefUpdates(scenario.git, scenario.workspaceId);
    const elsewhere = await asAnotherProcess(scenario.git);
    const before = await bundleHistory(scenario.git, scenario.workspaceId);
    await owningTheLateClaims(scenario, scenario.editor.userId);
    const tip = before.at(-1);
    assert(tip !== undefined, "the bundle has a head");

    await gate.park();
    const writing = writeConcept(
      scenario.editor,
      { ...doorsOf(scenario), git: elsewhere },
      {
        ...A_LATE_CONCEPT,
        frontmatter: { ...A_LATE_CONCEPT.frontmatter },
        author: { name: "Eli Editor", email: "eli@editor.example" },
        expects: { head: tip },
      },
    );
    await until(gate.parked);
    const erasing = completing(scenario, subjectRequestId);
    await until(async () =>
      (await statementsWaitingOnALock(db().pool)).some((query) =>
        query.includes("pg_advisory_lock(hashtext('bundle')"),
      ),
    );
    await gate.unpark();

    expect(await writing).toMatchObject({ ok: true });
    expect((await erasing).completedAt).toEqual(LOCKED_AT);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(3);
    expect(await thePersonIn(scenario, person, email)).toEqual(NOWHERE);
    const caughtUp = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });
    expect(caughtUp).toMatchObject({ ok: true, value: { replayed: [], stopped: undefined } });
  });

  it.each([
    { named: "address", naming: (_id: string, email: string) => ({ id: null, email }) },
    { named: "id", naming: (id: string) => ({ id, email: null }) },
  ])("reaches a late commit by $named after a failed run", async ({ naming }) => {
    const { scenario, email, person, member } = await aMemberHere();
    const named = naming(person.id, email);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, named.id, named.email);
    const gate = await gatingRefUpdates(scenario.git, scenario.workspaceId);

    const { done: died } = await heldAheadOfTheMembersEnd(
      scenario,
      subjectRequestId,
      member,
      async () => {
        const written = await writingAsThePerson(scenario, person, email);
        await gate.refuse();
        return written;
      },
    );
    await gate.allow();
    const done = await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    expect(died.ok).toBe(false);
    expect(done.completedAt).toEqual(RAN_AGAIN_AT);
    expect(await thePersonIn(scenario, person, email)).toEqual(NOWHERE);
  });

  const heldElsewhereNamedByAddress = async () => {
    const { scenario, email, person } = await bundleNamingThePerson();
    const elsewhere = await arrange();
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Editor" }),
    );
    return {
      scenario,
      email,
      person,
      member: { workspaceId: scenario.workspaceId, userId: person.id },
      byAddress: await erasureRequestAbout(scenario.workspaceId, null, email),
      gate: await gatingRefUpdates(scenario.git, scenario.workspaceId),
    };
  };

  it("rewrites rows landed before a failed run, held elsewhere", async () => {
    const { scenario, email, person, member, byAddress, gate } =
      await heldElsewhereNamedByAddress();

    const { done: died } = await heldAheadOfTheMembersEnd(scenario, byAddress, member, async () => {
      await conceptVerifiedBy(scenario.workspaceId, person.id);
      await writingAsThePerson(scenario, person, email);
      await gate.refuse();
    });
    await gate.allow();
    await completing(scenario, byAddress, RAN_AGAIN_AT);

    const erased = `human:${await pseudonymIn(scenario.workspaceId)}`;
    expect(died.ok).toBe(false);
    expect(new Set(await actorsIn("bundle_commit", scenario.workspaceId))).toEqual(
      new Set([erased]),
    );
    expect(new Set(await actorsIn("concept_verification", scenario.workspaceId))).toEqual(
      new Set([erased]),
    );
  });

  it("rewrites a replayed trailer held elsewhere after a failed run", async () => {
    const { scenario, email, person, member, byAddress, gate } =
      await heldElsewhereNamedByAddress();

    const { done: died, met: lost } = await heldAheadOfTheMembersEnd(
      scenario,
      byAddress,
      member,
      async () => {
        const written = await whileWritesAreRefused(db().pool, "bundle_commit", () =>
          writingAsThePerson(scenario, person, email),
        );
        await gate.refuse();
        return written;
      },
    );
    await gate.allow();
    await completing(scenario, byAddress, RAN_AGAIN_AT);
    const swept = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    expect(died.ok).toBe(false);
    expect(lost.ok).toBe(false);
    expect(await thePersonIn(scenario, person, email)).toEqual(NOWHERE);
    assert(swept.ok);
    expect(swept.value.replayed).toHaveLength(1);
    const erased = `human:${await pseudonymIn(scenario.workspaceId)}`;
    expect(new Set(await actorsIn("bundle_commit", scenario.workspaceId))).toEqual(
      new Set([erased]),
    );
  });

  it("rewrites a former member's trailers for a request by address", async () => {
    const { scenario, email, person } = await bundleNamingThePerson();
    await db().pool.query("DELETE FROM member WHERE user_id = $1 AND workspace_id = $2", [
      person.id,
      scenario.workspaceId,
    ]);
    const byAddress = await erasureRequestAbout(scenario.workspaceId, null, email);

    await completing(scenario, byAddress);

    const erased = `human:${await pseudonymIn(scenario.workspaceId)}`;
    expect(await thePersonIn(scenario, person, email)).toEqual(NOWHERE);
    expect(await actorsIn("bundle_commit", scenario.workspaceId)).toEqual([erased, erased]);
  });

  it("rewrites a history naming the person in a trailer alone", async () => {
    const { scenario, email, person, subjectRequestId } = await workspaceWithAnErasureRequest({
      byIdAlone: true,
    });
    const principal = await principalFor(db(), scenario.workspaceId, person.id);
    const made = await commit(principal, scenario.git, {
      path: "knowledge/parking.md",
      content: renderConceptFile({ title: "Parking", type: "Policy" }, "Park at the station."),
      message: "Record the parking policy",
      author: { name: "Acme Bot", email: "bot@acme.invalid" },
      trailers: { actor: actorIdOfPerson(principal.userId), audit: ulid() },
      expectedHead: null,
      at: new Date("2026-04-02T11:00:00.000Z"),
    });
    expect(made.ok).toBe(true);
    expect((await thePersonIn(scenario, person, email)).personId).toBe(true);

    await completing(scenario, subjectRequestId);

    expect(await thePersonIn(scenario, person, email)).toEqual(NOWHERE);
  });

  it("refuses a write the person starts after the erasure", async () => {
    const { scenario, email, person, subjectRequestId } = await bundleNamingThePerson();
    const writer = await principalFor(db(), scenario.workspaceId, person.id);
    await completing(scenario, subjectRequestId);
    const before = await bundleHistory(scenario.git, scenario.workspaceId);
    const tip = before.at(-1);
    assert(tip !== undefined, "the bundle has a head");

    const refused = await writeConcept(writer, doorsOf(scenario), {
      ...A_LATE_CONCEPT,
      frontmatter: { ...A_LATE_CONCEPT.frontmatter },
      author: { name: "Priya Anand", email },
      expects: { head: tip },
    });

    expect(refused).toEqual({ ok: false, error: "not-a-member" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(before);
  });
});
