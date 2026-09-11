import { ulid } from "@better-answers/schema";
import { describe, expect, it } from "vitest";

import { commit, type GitDoor } from "@better-answers/core/store/git";

import { RECONCILER, reconcile } from "../src/concepts/index.ts";
import { ERASURE, runErasure, type ErasureRefusal, type ErasureRun } from "../src/erasure/index.ts";
import { actorIdOfPerson, type Result } from "../src/kernel/index.ts";
import { authorLinesOf, bundleHistory, everyObjectOf, objectPresent } from "./bundle.ts";
import { ledgerRowsOf } from "./sourced-concept.ts";
import { countWaitingOnLocks, seedingWith, until, whileActsWaitAt } from "./suite-postgres.ts";
import { doorsOf, principalFor, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

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

/** A person on the identity set with a membership in this workspace, through the factory. */
const memberOf = (workspaceId: string, email: string) =>
  seedingWith(db().pool, async (seed) => {
    const person = await seed.user({ name: "Priya Anand", email });
    await seed.member({ workspaceId, userId: person.id, role: "Editor" });
    return person;
  });

/** The routine as a caller reaches it: the platform's own principal, both doors and a clock. */
const runningTheRoutine = (
  scenario: Scenario,
  subjectRequestId: string,
  at: Date = LOCKED_AT,
): Promise<Result<ErasureRun, ErasureRefusal | Error>> =>
  runErasure(
    ERASURE,
    { git: scenario.git, postgres: scenario.postgres, clock: { now: () => at } },
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
  const person = await memberOf(scenario.workspaceId, email);
  return {
    scenario,
    email,
    person,
    subjectRequestId: await erasureRequestAbout(scenario.workspaceId, person.id, email),
  };
};

/**
 * The arrangement the git step is proved against: a bundle whose **whole** history names the
 * person, so every commit's hash moves and the claim about pre-rewrite hashes is a claim
 * about all of them rather than about the tail. Two commits, both written by Priya and both
 * carrying `human:<address>` in the file, with the `bundle_commit` rows a governed write
 * would have landed beside them — the second naming the first as its parent — and a
 * `concept_index` row on the head, because that row's key into `bundle_commit` has to travel
 * with the rewrite or the routine's own transaction cannot commit.
 */
const bundleNamingThePerson = async () => {
  const { scenario, email, person, subjectRequestId } = await workspaceWithAnErasureRequest();
  const principal = await principalFor(db(), scenario.workspaceId, person.id);
  const author = { name: "Priya Anand", email };
  const path = "knowledge/expenses.md";

  const shas: string[] = [];
  for (const [at, body] of ["claimed within thirty days", "claimed within sixty days"].entries()) {
    const written = await commit(principal, scenario.git, {
      path,
      content: `---\ngenerated:\n  by: human:${email}\nverified:\n  - by: human:${email}\n---\n\nExpenses are ${body}.\n`,
      message: `Record the expenses policy (${at + 1})`,
      author,
      trailers: { actor: actorIdOfPerson(principal.userId), audit: ulid() },
      expectedHead: shas[at - 1] ?? null,
      at: new Date(`2026-04-0${at + 2}T11:00:00.000Z`),
    });
    if (!written.ok) throw new Error(`the commit was refused: ${String(written.error)}`);
    shas.push(written.value.sha);
  }

  const iri = await seedingWith(db().pool, async (seed) => {
    for (const [at, sha] of shas.entries()) {
      await seed.bundleCommit({
        workspaceId: scenario.workspaceId,
        sha,
        parentSha: shas[at - 1] ?? null,
        actor: actorIdOfPerson(principal.userId),
        committedAt: new Date(`2026-04-0${at + 2}T11:00:00.000Z`),
      });
    }
    const indexed = await seed.conceptIndex({
      workspaceId: scenario.workspaceId,
      path,
      commitSha: shas.at(-1) ?? "",
    });
    return indexed.iri;
  });
  return { scenario, email, person, iri, before: shas, subjectRequestId };
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

  const done = await completing(scenario, subjectRequestId);

  const after = await readingTheBundle(scenario.workspaceId, scenario.git);
  const [row] = await erasureRowsIn(scenario.workspaceId);
  return {
    ...arranged,
    before,
    after,
    done,
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
    expect(commitOfTheConcept).toEqual(after.history[1]);
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
