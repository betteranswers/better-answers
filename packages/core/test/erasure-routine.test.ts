import { ulid } from "@better-answers/schema";
import { describe, expect, it } from "vitest";

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
import { ledgerRowsOf } from "./sourced-concept.ts";
import { objectStoreForSuite, textOf } from "./suite-objects.ts";
import {
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

/**
 * The **erasure routine's spine** through the slice's own face (`[TEST1]`), against real
 * Postgres and a real bare repository: the lock the hourly dump waits behind, the pseudonym
 * a rewritten history is joined on, the row the four beyond-use dates are computed onto, the
 * report in ADR 0020's fixed words, and the sentence that makes a second run safe.
 *
 * Four sentences this suite is here to hold. The pseudonym is minted once and is never the
 * person id, so a second run finds the first run's and two workspaces never find each
 * other's. `pg_advisory_lock(41)` is held on a session of its own from the first step to the
 * last, so a dump taken mid-routine is a thing that cannot happen rather than a thing that
 * usually does not. Every pre-existing ledger row is byte-identical afterwards, because the
 * ledger is the one record an erasure never rewrites. And a second run writes one more ledger
 * event and moves nothing else, which is what the restore's replay relies on.
 */

const { db, arrange } = suiteWithBundles();

/**
 * A real Garage for this suite, because step 10 writes to the object store and `[TEST3]`
 * refuses a stand-in for it as it refuses one for Postgres: what the copy has to be is
 * addressable under the platform's own prefix and readable back by a restore, which is a
 * claim about an S3 store and not about a map kept in this process.
 */
const objects = objectStoreForSuite();

/**
 * The instant the routine's clock hands back, so the anchor and the four dates below are a
 * literal rather than a reading of the wall clock (ADR 0040; `[TEST9]`).
 */
const LOCKED_AT = new Date("2026-06-01T12:00:00.000Z");

/** A later instant, for the second run: the anchor must stay where the first run put it. */
const RAN_AGAIN_AT = new Date("2026-06-08T09:30:00.000Z");

/**
 * The four beyond-use dates the report quotes, worked out by hand from `LOCKED_AT` and the
 * retention schedule `docs/operations/BACKUPS.md` states: 48 hours, 30 days, 8 weeks and six
 * months. June has thirty days, so 30 days on from the first of June is the first of July;
 * 56 days on is the 27th of July; and 183 days on from the 152nd day of a year that is not a
 * leap year is its 335th, the first of December.
 */
const BEYOND_USE = {
  hourly: "2026-06-03T12:00:00.000Z",
  daily: "2026-07-01T12:00:00.000Z",
  weekly: "2026-07-27T12:00:00.000Z",
  monthly: "2026-12-01T12:00:00.000Z",
} as const;

/**
 * A second anchor, on a day that tells a day count from a calendar interval. `deploy/backup.sh`
 * writes each dump's `backup_run.expires_at` as `now() + interval '6 months'`, and Postgres
 * lands a month on the same day of the month or on that month's last day — so the 31st of
 * August is beyond use on the **28th of February**, February 2027 having no 31st and no 29th.
 * A report counting 183 days would say the 2nd of March and disagree with the platform's own
 * row for the same copy by two days.
 */
const ANCHORED_ON_A_31ST = new Date("2026-08-31T12:00:00.000Z");

/** The four dates from that anchor, worked out by hand as Postgres computes each interval. */
const BEYOND_USE_FROM_THE_31ST = {
  hourly: "2026-09-02T12:00:00.000Z",
  daily: "2026-09-30T12:00:00.000Z",
  weekly: "2026-10-26T12:00:00.000Z",
  monthly: "2027-02-28T12:00:00.000Z",
} as const;

/** The advisory lock ADR 0022 fixes, which `deploy/backup.sh` try-locks before every dump. */
const DUMP_LOCK = 41;

/** The one actor every act of this routine is booked to (`[AUDIT4]`, the platform's own id). */
const ERASURE_ACTOR = "process:better-answers-erasure";

/** The act the routine's last step writes. */
const COMPLETED = "people.erasure.completed";

/**
 * A fresh address per arrange block, because `user.email` is unique and this suite seeds a
 * subject several times over one Postgres.
 */
const addressOf = (person: string): string => `${person}-${ulid().toLowerCase()}@example.invalid`;

/** The routine as a caller reaches it: the platform's own principal, both doors and a clock. */
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

/** The same, for the cases where a refusal would be the arrangement failing rather than the answer. */
const completing = async (
  scenario: Scenario,
  subjectRequestId: string,
  at: Date = LOCKED_AT,
): Promise<ErasureRun> => {
  const run = await runningTheRoutine(scenario, subjectRequestId, at);
  if (!run.ok) throw new Error(`the routine refused: ${String(run.error)}`);
  return run.value;
};

/**
 * The request every arrangement here ends with: an erasure, about a person who holds a login,
 * naming the one address the bundle and the identity set both know them by.
 */
const erasureRequestAbout = async (
  workspaceId: string,
  personId: string,
  email: string,
): Promise<string> => {
  const seeded = await seedingWith(db().pool, (seed) =>
    seed.subjectRequest({
      workspaceId,
      kind: "erasure",
      personId,
      identifiers: { emails: [email], names: ["Priya Anand"], other: [] },
    }),
  );
  return seeded.id;
};

/** An erasure request about a person who holds a login and a membership in this workspace. */
const workspaceWithAnErasureRequest = async () => {
  const scenario = await arrange();
  const email = addressOf("priya");
  const person = await memberOf(db().pool, scenario.workspaceId, email);
  return {
    scenario,
    email,
    person,
    subjectRequestId: await erasureRequestAbout(scenario.workspaceId, person.id, email),
  };
};

/**
 * The two concept files the bundle carries, both naming the person and **only one of them in
 * the text a content hash is taken over**.
 *
 * That difference is the whole of step 4. ADR 0019 keeps `generated` and `verified` out of the
 * content hash — a check must not move its own file's hash — so the ordinary way a bundle names
 * a person is a way a rewrite cannot disturb, and every check over the travel policy stands
 * exactly as it was. The expenses policy quotes the same actor id in its **body**, which is
 * hashed: once the rewrite lands, that file's canonical text is different text, and without
 * step 4 every standing check over it would read *Changed since checked* for a change nobody
 * made to the fact.
 */
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

/**
 * The arrangement the git step is proved against: a bundle whose **whole** history names the
 * person, so every commit's hash moves and the claim about pre-rewrite hashes is a claim
 * about all of them rather than about the tail. Two commits, both written by Priya and both
 * carrying `human:<address>` in the file, with the `bundle_commit` rows a governed write
 * would have landed beside them — the second naming the first as its parent — and, for each
 * file, the `concept_index` row a landing would have written with the file's real hash and a
 * check over exactly that hash. Those rows' keys into `bundle_commit` have to travel with the
 * rewrite or the routine's own transaction cannot commit.
 */
const bundleNamingThePerson = async () => {
  const { scenario, email, person, subjectRequestId } = await workspaceWithAnErasureRequest();
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
      // A check over exactly what the commit wrote, by the person the request is about: the
      // record keeps `human:<person id>` and is never rewritten (ADR 0035), so what step 4
      // moves is the hash and nothing else.
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
    /** The concept whose body quoted the actor id: the one file whose hash the rewrite moves. */
    iri: hashed?.iri ?? "",
    /** The concept named only in the keys ADR 0019 leaves unhashed: its hash cannot move. */
    steadyIri: steady?.iri ?? "",
    before: shas,
    subjectRequestId,
  };
};

/** Every check in a workspace, as the superuser: the columns the trust projection reads. */
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

/** What each concept's index row says its file is, by IRI: the hash a check is read against. */
const indexedIn = async (workspaceId: string) => {
  const read = await db().pool.query<{ iri: string; content_hash: string; body: string }>(
    "SELECT iri, content_hash, body FROM concept_index WHERE workspace_id = $1 ORDER BY iri",
    [workspaceId],
  );
  return read.rows;
};

/** A literal instant (`[TEST9]`, ADR 0040): nothing the trust projection reads turns on today. */
const READ_AT = new Date("2026-06-02T09:00:00.000Z");

/** The trust a reader is shown for one concept, through the read the surface will make. */
const trustOf = async (scenario: Scenario, iri: string) => {
  const read = await readingAs(db().runtimePool, scenario.viewer, (principal, tx) =>
    open(principal, tx, { iri }, READ_AT),
  );
  return read.ok && read.value.found ? read.value.concept?.trust : undefined;
};

/** The `bundle_commit` rows of a workspace, oldest first: the chain the reconciler reads. */
const bundleCommitRowsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{ sha: string; parent_sha: string | null }>(
    `SELECT sha, parent_sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at, sha`,
    [workspaceId],
  );
  return read.rows;
};

/**
 * **One rewrite, read from both ends, shared by every claim made about it below.**
 *
 * The git step is by a distance the most expensive thing this suite does: it spawns
 * `filter-repo`, which is a Python process that rewrites and then repacks a real repository.
 * Every claim in the two blocks below — what the objects hold, what the author lines say, what
 * the old hashes answer to, where the rows point, what the report recorded — is a claim about
 * **the same single run**, so it is run once and read once rather than eight times over eight
 * identical arrangements. A run of its own is kept for the second-pass case, which is about
 * what a *second* run does and cannot share one.
 *
 * Lazy rather than a `beforeAll`, so a `-t` filter that selects none of these cases pays
 * nothing for them.
 */
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

/** The commit a concept's index row was written at — the key that travels with the rewrite. */
const commitOfConcept = async (workspaceId: string, iri: string): Promise<string | undefined> => {
  const read = await db().pool.query<{ commit_sha: string }>(
    "SELECT commit_sha FROM concept_index WHERE workspace_id = $1 AND iri = $2",
    [workspaceId, iri],
  );
  return read.rows[0]?.commit_sha;
};

/** Every erasure request in the workspace, as the superuser: the columns the routine writes. */
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

/**
 * Every row of a table in this workspace as one JSON text per row — what *byte-identical*
 * means when the claim is that nothing moved, including a column no assertion names.
 */
const rowTextIn = async (table: string, workspaceId: string) => {
  const read = await db().pool.query<{ id: string; row: string }>(
    `SELECT t.id, row_to_json(t)::text AS row FROM "${table}" t WHERE t.workspace_id = $1 ORDER BY t.id`,
    [workspaceId],
  );
  return read.rows;
};

/**
 * Sessions, linked accounts and verification codes are Better Auth's own writes, so the test
 * factory holds none — `erasure-map.test.ts` and `workspaces.test.ts` seed them the same way.
 * Everything else in this suite is built through the factory (`[TEST4]`).
 */
const identityRowsFor = async (userId: string, email: string): Promise<void> => {
  const superuser = await db().pool.connect();
  try {
    const id = ulid();
    await superuser.query(
      `INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
       VALUES ($1, now(), $2, now(), now(), '203.0.113.7', 'Mozilla/5.0', $3)`,
      [`s-${id}`, `token-${id}`, userId],
    );
    await superuser.query(
      `INSERT INTO account (id, issuer, account_id, provider_id, user_id, created_at, updated_at)
       VALUES ($1, 'https://accounts.example.invalid', $2, 'google', $3, now(), now())`,
      [`a-${id}`, `google-${id}`, userId],
    );
    await superuser.query(
      `INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
       VALUES ($1, $2, 'code', now(), now(), now())`,
      [`v-${id}`, email],
    );
  } finally {
    superuser.release();
  }
};

/** The four identity families the routine's step 5 prunes, counted where it would find them. */
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

/** The user row as the identity set holds it, whatever a routine has done to it. */
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

/** Which workspaces this person is a member of, so an ended membership is visible as one. */
const workspacesMemberOf = async (userId: string): Promise<readonly string[]> => {
  const read = await db().pool.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM member WHERE user_id = $1 ORDER BY workspace_id",
    [userId],
  );
  return read.rows.map((row) => row.workspace_id);
};

/**
 * The person a ledger row's actor resolves to — the join `[AUDIT3]` exists to keep working, and
 * the whole reason the user row's id survives its pseudonymisation.
 */
const personNamedBy = async (workspaceId: string, auditEventId: string) => {
  const read = await db().pool.query<{ id: string }>(
    `SELECT u.id FROM audit_event a JOIN "user" u ON a.actor = 'human:' || u.id
      WHERE a.workspace_id = $1 AND a.id = $2`,
    [workspaceId, auditEventId],
  );
  return read.rows[0]?.id;
};

/**
 * What the hourly dump does before it runs: try the lock, give it straight back if it came.
 * A dedicated connection, because a session-scoped lock outlives a pooled connection's
 * return and would be held by whoever borrowed it next.
 */
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
    // Never the person id (ADR 0035): a pseudonym that was the id would join the rewritten
    // history straight back to the person the rewrite was for.
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

    // Two workspaces, one person, two pseudonyms: the property ADR 0035 exists for, which a
    // pseudonym derived from the person rather than minted would break.
    expect(pseudonyms[0]).not.toEqual(pseudonyms[1]);
    expect(pseudonyms.filter((minted) => minted === "")).toEqual([]);
  });
});

describe("the report", () => {
  it("is ADR 0020's fixed wording, with the four beyond-use dates computed from the lock instant", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const done = await completing(scenario, subjectRequestId);

    // Written out here, never interpolated from the constant the source uses (`[TEST9]`):
    // blanking that constant has to change one side of this comparison and not both.
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
    // The row the dates were written onto agrees with the document that quotes them.
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
      // 183 days on is the 2nd of March: a day count fails here and nowhere else, which is
      // why this case is anchored on a 31st rather than on the suite's usual first of June.
      monthly: BEYOND_USE_FROM_THE_31ST.monthly,
    });
    // And the document a person is handed quotes the row it was written from.
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
      // Parked at its first write, which is past the lock: what the dump would meet.
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);
      tried.push(await theDumpCouldTakeItsLock());
      await release();
      return routine;
    });
    tried.push(await theDumpCouldTakeItsLock());

    expect(done.ok).toBe(true);
    // Refused while the routine ran, free once it had finished. A transaction-scoped lock
    // would answer `true` here, because the routine's first transaction had already
    // committed and the dump could have run between two of its steps.
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
    // `[AUDIT5]`: ids and counts, never the address or the name the request was made about.
    const [completion] = completions;
    expect(Object.keys(completion?.detail ?? {}).sort()).toEqual([
      "locations",
      "personId",
      "subjectRequestId",
    ]);
  });
});

describe("a second run of the routine", () => {
  it("writes one more ledger event and moves nothing else, which is what the replay relies on", async () => {
    const { scenario, subjectRequestId } = await workspaceWithAnErasureRequest();

    const first = await completing(scenario, subjectRequestId);
    const requests = await rowTextIn("erasure_request", scenario.workspaceId);
    const ledger = await rowTextIn("audit_event", scenario.workspaceId);

    const again = await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    // The row is the first run's, to the byte: the same pseudonym, the same anchor, the same
    // four dates, the same completion instant and the same report — no branch, just an update
    // that no longer matches a completed request.
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
  it("leaves no object at any commit holding the address the files and the author lines carried", async () => {
    const { email, before, after } = await theBundleRewritten();
    // The arrangement is only worth its assertions if the history really named them first.
    expect(before.objects).toContain(`human:${email}`);

    // Every object the history reaches, not the head's tree: a rewrite that moved the tip and
    // left an earlier commit's blob behind would pass a check on the head and fail here.
    expect(after.objects).not.toContain(email);
    expect(after.objects).toContain("human:");
  });

  it("mailmaps every author line in the bundle to the erasure pseudonym", async () => {
    const { email, before, after, pseudonym } = await theBundleRewritten();
    expect(before.authors).toEqual([`Priya Anand <${email}>`, `Priya Anand <${email}>`]);

    // The name the display line carried is gone with the address, and what stands in its place
    // is the one id the rewrite named the person by — never the person id (ADR 0035).
    expect(after.authors).toEqual([
      `human:${pseudonym} <${pseudonym}@erased.better-answers.invalid>`,
      `human:${pseudonym} <${pseudonym}@erased.better-answers.invalid>`,
    ]);
  });

  it("prunes the pre-rewrite objects, so git cat-file -e fails on every hash the history held", async () => {
    const { before, after, stillPresent } = await theBundleRewritten();
    expect(before.history).toHaveLength(2);

    expect(stillPresent).toEqual([false, false]);
    // And the history is the same length it was: a prune is not a way of losing a commit.
    expect(after.history).toHaveLength(2);
  });

  it("finds nothing to replace on a second run and moves the history no further", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();

    await completing(scenario, subjectRequestId);
    const rewritten = await bundleHistory(scenario.git, scenario.workspaceId);
    const authors = await authorLinesOf(scenario.git, scenario.workspaceId);
    const rows = await bundleCommitRowsIn(scenario.workspaceId);

    await completing(scenario, subjectRequestId, RAN_AGAIN_AT);

    // The replay runs the routine again over every completed request and has no branch that
    // says "this one already ran": what makes that safe is that the second pass finds no
    // address in the history and therefore never rewrites it.
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(rewritten);
    expect(await authorLinesOf(scenario.git, scenario.workspaceId)).toEqual(authors);
    // And the rows stay where the first run put them. `filter-repo`'s commit map is
    // cumulative — a second run would still read the first run's pairs out of it — so a step
    // that trusted that file without asking what this run started from would try to move a
    // row onto a hash it already holds.
    expect(await bundleCommitRowsIn(scenario.workspaceId)).toEqual(rows);
  });
});

describe("the bundle_commit rows the rewrite moves", () => {
  it("names the rewritten hashes, parents and all, and carries the index row's key with them", async () => {
    const { before, after, commitOfTheConcept } = await theBundleRewritten();
    expect(before.rows.map((row) => row.sha)).toEqual(before.history);

    expect(after.rows.map((row) => row.sha)).toEqual(after.history);
    // The chain moved with the rows: a parent naming a hash the repository no longer holds
    // would be a prefix invariant the database still believed and git had forgotten.
    expect(after.rows.map((row) => row.parent_sha)).toEqual([null, after.history[0]]);
    // The expenses policy was the first of the two commits, and its index row names it still.
    expect(commitOfTheConcept).toEqual(after.history[0]);
  });

  it("leaves the reconciler nothing to replay, because the head and the watermark agree", async () => {
    const { scenario } = await theBundleRewritten();

    const swept = await reconcile(RECONCILER, doorsOf(scenario), {
      workspaceId: scenario.workspaceId,
    });

    if (!swept.ok) throw new Error(`the reconciler refused: ${String(swept.error)}`);
    // Nothing replayed and nothing skipped: the rows name the head, so the scan finds no
    // commit past the watermark at all. A rewrite that left the rows behind would answer
    // `history-diverged` here, because the watermark would name a commit git had pruned.
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
    // The spine's own line for each family stands beside what this step added.
    expect(actions["concept-file"]).toHaveProperty("found");
  });
});

describe("the checks the rewrite moved", () => {
  it("carries each one onto the new hash under origin erasure-rewrite, and the trust reading is unchanged", async () => {
    const {
      email,
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
    // The arrangement is only worth its assertions if the check really confirmed the file.
    expect(before?.content_hash).toEqual(indexBefore?.content_hash);
    expect(before?.origin).toEqual("platform");

    const after = checksAfter.find((check) => check.iri === iri);
    const indexAfter = indexedAfter.find((row) => row.iri === iri);
    // The hash moved, because the body it is taken over no longer names the address — and the
    // index row moved with it, a row still holding the address being the erasure missing a
    // store rather than a check left behind.
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
      // The one origin ADR 0019 declares for this, and the reason the row can still be read
      // as a check: who checked and when stand, and the row says a routine moved its hash.
      origin: "erasure-rewrite",
      actor: before?.actor,
      at: before?.checked_at.toISOString(),
    });

    // The whole point of the step, read the way a person reads it: *Checked by Priya* before,
    // *Checked by Priya* after — never *Changed since checked* because of an erasure.
    expect(trustAfter[0]).toEqual(trustBefore[0]);
    expect(trustAfter[0]).toMatchObject({ status: "current", tier: "human-reviewed" });
  });

  it("leaves a check alone when the rewrite touched only the keys ADR 0019 keeps out of the hash", async () => {
    const { steadyIri, checksBefore, checksAfter, trustBefore, trustAfter } =
      await theBundleRewritten();

    // `generated` and `verified` are where a bundle names a person, and neither reaches the
    // content hash — so the ordinary erasure moves no hash at all and marks no check. A step
    // that re-hashed every file it touched would have written `erasure-rewrite` here too, and
    // the row would say a routine moved a hash that never moved.
    expect(checksAfter.find((check) => check.iri === steadyIri)).toEqual(
      checksBefore.find((check) => check.iri === steadyIri),
    );
    expect(trustAfter[1]).toEqual(trustBefore[1]);
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
      // The id stands, because the ledger names it and a ledger an erasure rewrote would be a
      // record nobody could rely on (`[AUDIT3]`).
      id: person.id,
      name: "",
      image: null,
    });
    // The address is the pseudonym's own, which is unique by construction — `user.email` is
    // unique, so a constant tombstone would refuse the second erasure this platform ran.
    expect(after?.email).toEqual(`${row?.pseudonym}@erased.better-answers.invalid`);
    expect(after?.email_verified).toBe(false);
    expect(await personNamedBy(scenario.workspaceId, acted.id)).toEqual(person.id);
  });

  it("deletes the person's sessions, verification rows, invitations and linked accounts", async () => {
    const { scenario, person, email, subjectRequestId } = await workspaceWithAnErasureRequest();
    await identityRowsFor(person.id, email);
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

  it("ends this workspace's membership alone when the person holds another, and leaves the identity set standing", async () => {
    const scenario = await arrange();
    const elsewhere = await arrange();
    const email = addressOf("priya");
    const person = await memberOf(db().pool, scenario.workspaceId, email);
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: elsewhere.workspaceId, userId: person.id, role: "Editor" }),
    );
    await identityRowsFor(person.id, email);
    const subjectRequestId = await erasureRequestAbout(scenario.workspaceId, person.id, email);

    await completing(scenario, subjectRequestId);

    // The other company's records still name this person, and one controller's request is not
    // a reason to end their access to another's.
    const after = await userRowOf(person.id);
    expect({ email: after?.email, name: after?.name }).toEqual({ email, name: "Priya Anand" });
    expect(await identityRowCountsFor(scenario.workspaceId, person.id, email)).toMatchObject({
      sessions: 1,
      accounts: 1,
    });
    // What did end is the membership here — and nothing about the membership there.
    expect(await workspacesMemberOf(person.id)).toEqual([elsewhere.workspaceId]);
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
    // Which arm ran, and not a word about the other tenant: a document this workspace is
    // handed is not where a judgement about another company's memberships is published
    // (ADR 0035's rejected oracle).
    expect(held.report).not.toContain(elsewhere.workspaceId);
  });
});

/**
 * The identifier set every suppression below is written from, spelled here rather than read
 * off the request the arm was handed (`[TEST9]`).
 */
const THE_SET = { emails: ["priya@example.invalid"], names: ["Priya Anand"], other: [] };

/**
 * An erasure map that names documents — a value of the slice's own published type, built here
 * rather than read out of a store. `[TEST3]` bans mocking our code; constructing the value a
 * function takes is not mocking it, and it is the only way to exercise the suppression arm
 * before S1 writes the finder that fills this family.
 */
const mapNaming = (documents: readonly string[]): ErasureMap =>
  ERASURE_FAMILIES.map((family) => ({
    family,
    categories: [],
    locations: family === "source-document" ? [...documents] : [],
  }));

/** Every suppression in a workspace, as the superuser: the key and the set it carries. */
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

/** The queue of a workspace, as the superuser: what step 7 put on it. */
const jobsIn = async (workspaceId: string) => {
  const read = await db().pool.query<{ kind: string; reason: string | null; status: string }>(
    "SELECT kind, reason, status FROM job WHERE workspace_id = $1 ORDER BY id",
    [workspaceId],
  );
  return read.rows;
};

/** An erasure request with nothing done to it yet, for the arms proved on their own. */
const anOpenErasure = (workspaceId: string) =>
  seedingWith(db().pool, async (seed) => {
    const request = await seed.subjectRequest({ workspaceId, kind: "erasure" });
    return seed.erasureRequest({ workspaceId, subjectRequestId: request.id });
  });

/** One document under a binding the caller holds the id of, so a test can group them. */
const documentIn = (workspaceId: string, bindingId: string) =>
  seedingWith(db().pool, (seed) => seed.sourceDocument({ workspaceId, bindingId }));

const bindingIn = (workspaceId: string) =>
  seedingWith(db().pool, (seed) => seed.sourceBinding({ workspaceId }));

/**
 * The footing every case below the suppression arm stands on: a workspace, an erasure with
 * nothing done to it, and one binding with one document under it that the map will name.
 *
 * Arrangement only — it seeds rows and asserts nothing, so what each case claims is still
 * written out in the case. The binding comes back too because a second document under the
 * same one is what the first case needs to show the arm writes per document and not per
 * binding.
 */
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
    // A document the map never named: the other direction of the pair (`[TEST7]`).
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
    // The key is the triple and the payload is the set, copied and not referenced.
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

    // Both answer zero rather than aborting the routine on `suppression_identifiers_check`.
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
    // The second run's set differs, which is what proves the first copy stands: a request
    // edited after the routine ran does not rewrite what a reprocess was already told.
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
    // A document in the workspace the routine could reach, if anything named it.
    const binding = await bindingIn(scenario.workspaceId);
    await documentIn(scenario.workspaceId, binding.id);

    const done = await completing(scenario, subjectRequestId);

    // Zero because the map's `source-document` finder is S1's and answers none until then —
    // said out loud on the report's own line, so the number is a fact about the finder rather
    // than an arm that does nothing.
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
      // Already completed, so the read is the only thing this case exercises.
      completedAt: LOCKED_AT,
    });

    // Two bindings for three documents, and the binding nobody's document named is absent:
    // the wipe is per binding where the suppression is per document.
    expect(rederived.bindingsToReprocess).toEqual([shared.id, apart.id].sort());
    expect(rederived.rebuildJobId).toBeNull();
    expect(await jobsIn(scenario.workspaceId)).toEqual([]);
  });
});

/**
 * The routine run to completion for the person a company's files name and who never signed
 * in — no user row, so the identifier set is the whole of what the platform knows them by
 * (`CONTEXT.md`, *subject request*).
 *
 * The run is inside the helper because both cases that use it are about what the run *left*:
 * one reads the report, the other the replay copy. Neither asserts anything here.
 */
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

    // Every arm ran and said what it found, which is what a person with no login is owed:
    // the stores that hold nothing about them say so rather than staying silent.
    expect(done.report).toContain("concept-file: found 0, reindexed 0, rewritten 0");
    expect(done.report).toContain("bundle-commit: found 0, moved 0");
    expect(done.report).toContain(
      "identity-user: arm no-person, found 0, membershipsEnded 0, pseudonymised 0",
    );
    expect(done.report).toContain("source-document: bindings 0, found 0, suppressed 0");
    // The request completed rather than refusing for want of a person to act on.
    const [row] = await erasureRowsIn(scenario.workspaceId);
    expect(row?.completed_at).not.toBeNull();
    expect(await jobsIn(scenario.workspaceId)).toEqual([
      { kind: "full-rebuild", reason: "erasure", status: "queued" },
    ]);
  });
});

/**
 * The replay copy as a restore reaches it: the platform's own prefix and the key spelled out
 * here rather than read off the module that writes it (`[TEST9]`), because the key is the
 * whole of what `replay-erasures` has to know to find a copy in a bucket it just synced back.
 */
const replayCopyOf = async (workspaceId: string, erasureRequestId: string): Promise<string> => {
  const got = await getPlatformObject(
    ERASURE,
    objects().door,
    `erasures/${workspaceId}/${erasureRequestId}.json`,
  );
  if (!got.ok) throw new Error(`the replay copy was not readable: ${got.error}`);
  return textOf(got.value);
};

/**
 * The copy's shape as a restore reads it, spelled out here rather than imported from the
 * module that writes it (`[TEST9]`): what this suite holds the writer to is the document
 * `replay-erasures` will parse, and a suite that read the shape off the writer would agree
 * with whatever the writer did.
 */
type CopyAsRead = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  readonly personId?: string;
  readonly pseudonym: string;
  readonly completedAt: string;
  readonly identifiers: unknown;
  readonly map: readonly { readonly family: string; readonly locations: readonly string[] }[];
};

/** Every copy this workspace's erasures have left in the store. */
const replayCopiesIn = async (workspaceId: string): Promise<readonly string[]> => {
  const listed = await listPlatformObjects(ERASURE, objects().door, `erasures/${workspaceId}/`);
  if (!listed.ok) throw new Error(`the platform's prefix refused a listing: ${listed.error}`);
  return listed.value;
};

/**
 * **Step 10 — the replay copy**, the one write of this routine that leaves Postgres and the
 * one trace of a completed erasure that survives a restore from a dump taken before the
 * request arrived. A copy the store does not hold is an erasure silently undone by a restore,
 * which is the failure the whole of ADR 0022's replay exists to prevent.
 *
 * Two sentences shape every case below. The copy carries exactly what a **re-run** needs —
 * the workspace and the two ids, the person where they hold a login, the pseudonym the
 * history was rewritten to, the completion it stands on, the identifier set the suppressions
 * were written from and the map — and it carries **nothing else about the person**, which is
 * asserted in both directions (`[TEST7]`) because it is restricted personal data of the same
 * class as the `suppression` table and outlives the dump that holds that table.
 *
 * It is deliberately not the report's twin: the report is a document handed to a person and
 * is starved of the identifier set and the pseudonym (ADR 0035), while this is the input to a
 * routine and carries both. Neither shape is the other's mistake.
 */
describe("the replay copy the restore reads", () => {
  it("lands under the platform's own prefix, where no workspace's principal can address it", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();

    const done = await completing(scenario, subjectRequestId);

    expect(await replayCopiesIn(scenario.workspaceId)).toEqual([
      `erasures/${scenario.workspaceId}/${done.erasureRequestId}.json`,
    ]);
    // The other direction: an Admin of the very workspace the erasure ran in reaches nothing,
    // because the copy is the platform's and a workspace's prefix is all a person's key can
    // address. A restore reads it as the platform or it does not read it at all.
    const theirs = await listObjects(scenario.admin, objects().door, "");
    expect(theirs).toEqual({ ok: true, value: [] });
  });

  it("carries what a re-run must have: the pseudonym, the identifier set and the map", async () => {
    const { scenario, email, person, subjectRequestId } = await bundleNamingThePerson();

    const done = await completing(scenario, subjectRequestId);

    const [row] = await erasureRowsIn(scenario.workspaceId);
    const copy = JSON.parse(
      await replayCopyOf(scenario.workspaceId, done.erasureRequestId),
    ) as CopyAsRead;
    expect(copy.workspaceId).toEqual(scenario.workspaceId);
    expect(copy.subjectRequestId).toEqual(subjectRequestId);
    expect(copy.erasureRequestId).toEqual(done.erasureRequestId);
    expect(copy.personId).toEqual(person.id);
    // The pseudonym on the row, which is what `human:<address>` became across the history: a
    // replay that minted a second one would rewrite a history the first run already rewrote
    // and leave two ids for one person.
    expect(copy.pseudonym).toEqual(row?.pseudonym);
    expect(copy.completedAt).toEqual("2026-06-01T12:00:00.000Z");
    // The set the suppressions were written from, whole: a restore older than the request has
    // no `subject_request` row to read it off, so the copy is where it survives.
    expect(copy.identifiers).toEqual({ emails: [email], names: ["Priya Anand"], other: [] });

    expect(copy.map.map((entry) => entry.family)).toEqual([...ERASURE_FAMILIES]);
    // The files the person was named in, by path, and the commits their address signed — the
    // two arms the concept-file family answers with, both carried across (`git.test.ts`).
    // Every family is answered, so a store that held nothing about the person says so in the
    // copy as it does in the report.
    const found = copy.map.find((entry) => entry.family === "concept-file")?.locations ?? [];
    const paths = found.filter((at) => at.includes(":")).map((at) => at.slice(at.indexOf(":") + 1));
    expect([...new Set(paths)].sort()).toEqual(["knowledge/expenses.md", "knowledge/travel.md"]);
    expect(found.filter((at) => at.endsWith("(author line)"))).toHaveLength(2);
  });

  it("carries nothing a finder does not need — not the report, not the counts, not a value a location names", async () => {
    const { scenario, email, subjectRequestId } = await bundleNamingThePerson();

    const done = await completing(scenario, subjectRequestId);

    const text = await replayCopyOf(scenario.workspaceId, done.erasureRequestId);
    const copy = JSON.parse(text) as CopyAsRead;
    // The whole of it, as a literal: a field added to this copy is a field of a person's data
    // kept in a bucket that outlives the dump, and it fails here before it is written.
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
    // The control for the four absences below: the text really does hold this person, so a
    // `not.toContain` here is a claim about what was left out and not about an empty file.
    expect(text).toContain(email);
    expect(text).toContain(done.erasureRequestId);
    // Not the report — that document is written for the owner, and a copy of it here would
    // put ADR 0020's wording where nobody reads it and a person's data where it is not needed.
    expect(text).not.toContain("Every actor identifier for this person has been rewritten");
    expect(text).not.toContain("Backup copies taken before");
    // Not the counts: `actions` is the row's record of what was done and no input to a re-run.
    expect(text).not.toContain("rehashed");
    // Not a value the map merely locates. The map names a commit and a path; the sentence at
    // that path is the thing a location exists to avoid copying (`erasure map`, `CONTEXT.md`).
    expect(text).not.toContain("Expenses are claimed within thirty days");
  });

  it("names no person for a subject with no user row, because an absent login is not a null one", async () => {
    const { scenario, done } = await completedForASubjectWithNoUserRow();

    const copy = JSON.parse(
      await replayCopyOf(scenario.workspaceId, done.erasureRequestId),
    ) as CopyAsRead;
    expect(Object.keys(copy)).not.toContain("personId");
    // And the set is still there, because for this subject the set is the whole erasure: it
    // is what the suppressions were written from and what a re-run would write them from.
    expect(copy.identifiers).toEqual({
      emails: ["priya@example.invalid"],
      names: ["Priya Anand"],
      other: [],
    });
  });

  it("refuses to complete a request whose copy the store would not take, so no completion stands without one", async () => {
    const { scenario, subjectRequestId } = await bundleNamingThePerson();
    // A door onto nothing: the settings parse, so the refusal happens where it matters — at
    // the put — and not at the open. Port 1 refuses a connection rather than hanging on one.
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
    // The whole of the ordering, as a fact rather than as a comment: the request is still
    // open, so the operator's re-run is the routine's ordinary second pass and no restore can
    // meet a completed erasure that left nothing behind to replay it from.
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
    const copy = JSON.parse(
      await replayCopyOf(scenario.workspaceId, first.erasureRequestId),
    ) as CopyAsRead;
    // The completion the row stands at, which a second run does not move: a copy re-dated by
    // a replay would tell the next `replay-erasures --since` that the erasure happened a week
    // after it did.
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
