import { boundarySchemas } from "@better-answers/schema";

import { act, declareActs, record, type DetailOf } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  ulid,
  type Clock,
  type PlatformPrincipal,
  type Result,
} from "../kernel/index.ts";
import { carryChecksOntoRewrite, moveBundleCommits } from "../concepts/index.ts";
import { rewriteHistory, withRepositoryLockAs, type GitDoor } from "../store/git/index.ts";
import { withScope, withSessionLock, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { eraseFromTheIdentitySet, type IdentitySwept } from "./identity.ts";
import { erasureMapOf, type ErasureFamily, type ErasureMap } from "./map.ts";
import { rederiveAfterErasure, type Rederived } from "./rederive.ts";
import {
  erasureReportOf,
  type ErasureAction,
  type ErasureActions,
  type ErasureRecord,
} from "./report.ts";
import { monthsOn, type SubjectRequest } from "./requests.ts";
import { suppressTheDocuments, type Suppressed } from "./suppressions.ts";

/**
 * The **erasure routine** (ADR 0020; ADR 0022; the S0 spec, *The routine — the erasure slice,
 * app tier*): one valid erasure request run end to end under the platform's own principal.
 *
 * This file holds the routine's spine — the lock, the pseudonym, the map, the row the four
 * beyond-use dates are computed onto, the report and the completion. The steps that act on a
 * store each fill their own family's line in `actions` as they land; none of them changes the
 * shape of this function or of the report, which is why the spine is built first.
 *
 * **It takes the Postgres door and not a `Tx`, and that is the whole reason it exists as a
 * face rather than as an act.** `pg_advisory_lock(41)` is session-scoped, and the routine is
 * several transactions: the request is opened in one, the stores are searched in another, the
 * completion lands in a third. A transaction-scoped lock would be given back at the first
 * commit, and the hourly dump — which try-locks the same key before it runs
 * (`deploy/backup.sh`) — could take a copy between two of the routine's steps, of a database
 * halfway through an erasure. So the lock is held on a session of its own from the first step
 * to the last, and the door is what lets the routine ask for one.
 *
 * **Idempotent by construction, with no branch that says so.** A second run over the same
 * request mints nothing: its insert conflicts with the first run's row and does nothing, so it
 * reads back the same pseudonym and the same anchor, and its completion update names
 * `completed_at IS NULL` and therefore matches no row. Its suppressions conflict on the key
 * the table already has. What is left is one more ledger event — which is what the routine
 * did, so the ledger is right to record it. The restore's replay runs every completed request
 * through here again and relies on exactly that.
 *
 * **The one write with no key to conflict on is the rebuild job**, because the queue in S0
 * carries none. So step 7 is handed the completion the row already stood at when this run
 * opened it under the lock — the same fact step 11's update names, read once rather than asked
 * for — and enqueues for the run that completes the request and for no other. It is the only
 * place the routine looks at what an earlier run did, and it looks because the store cannot.
 */

/** The routine's actor id — the platform principal's one form (`CONTEXT.md`, *actor id*). */
const ERASURE_ACTOR = "process:better-answers-erasure";

/**
 * The routine's principal, narrowed to its own actor, as the reconciler's is: the type is what
 * holds "under `process:better-answers-erasure`" at compile time, so no other platform act can
 * complete an erasure request under its own name.
 */
export type ErasurePrincipal = PlatformPrincipal & {
  readonly actorId: typeof ERASURE_ACTOR;
};

export const ERASURE: ErasurePrincipal = { kind: "platform", actorId: ERASURE_ACTOR };

/**
 * The advisory lock ADR 0022 fixes for this routine. The other end of it is in
 * `deploy/backup.sh`, which try-locks the same key and waits when it is taken, so no dump is
 * ever of a database part-way through an erasure. One number, two places, and both of them
 * name the other.
 */
const DUMP_LOCK = 41;

/**
 * The routine's one act on the ledger. Its subject is the erasure request, and its detail is
 * the request it answers, the person id where the subject holds a login, and how many places
 * the map named — never one of those places, and never an address or a name, because a detail
 * carries ids, counts and role words and nothing else. The ledger is the one record an erasure
 * does not rewrite (ADR 0035), so a detail that held a name here would be a name this routine
 * had just promised to remove.
 */
const ERASURE_ACTS = declareActs("people", {
  completed: act("people.erasure.completed", {
    subjectRequestId: "id",
    personId: "id?",
    locations: "count",
  }),
});

type CompletedDetail = DetailOf<(typeof ERASURE_ACTS)["completed"]["detail"]>;

/**
 * Why the routine would not run. `not-an-erasure` is an access request: it is answered under
 * Article 15 and never erased, and running this over one would rewrite a history nobody asked
 * to have rewritten.
 */
export type ErasureRefusal = "malformed" | "no-such-request" | "not-an-erasure";

/** What one run comes to, as the row stands after it. */
export type ErasureRun = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;
  /** The instant the four beyond-use dates were computed from — the first run's, always. */
  readonly anchoredAt: Date;
  readonly completedAt: Date;
  readonly report: string;
  /**
   * Where this run found the person. A second run's map is that run's own reading of the
   * stores, while `report` and `completedAt` above are the first run's and stay so.
   */
  readonly map: ErasureMap;
  /** This run's own event, so two runs of one request are two ids and never one. */
  readonly auditEventId: string;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The four tiers of `docs/operations/BACKUPS.md`'s retention schedule, out from the anchor in
 * order: the hourly copies within 48 hours, the daily within 30 days, the weekly within 8
 * weeks and every copy within six months.
 *
 * **Computed as Postgres computes an interval, months included**, because the date this report
 * promises is a promise the platform's own row already made: `deploy/backup.sh` writes each
 * dump's `backup_run.expires_at` as `now() + interval '<life>'` with these four lifetimes
 * spelled out, so six months is a calendar six months and a report counting 183 days would
 * disagree with the row for the same copy by up to three days — and the day O1 anchors the
 * report on `backup_run`, it would print a date that is not the row's. The report's date is
 * the row's promise; the bucket's lifecycle rule, which is set by hand in days and knows
 * nothing of a calendar, is configured **no shorter than it**.
 *
 * Its pair is `erasureRequest` in `packages/schema/test/factory.ts`, which states the same
 * four lifetimes and the same month rule in its own lines because the schema's tests cannot
 * import this package; change one and change the other in the same commit.
 */
const BEYOND_USE = { hourlyHours: 48, dailyDays: 30, weeklyWeeks: 8, monthlyMonths: 6 } as const;

const beyondUseFrom = (anchoredAt: Date) => ({
  hourly: new Date(anchoredAt.getTime() + BEYOND_USE.hourlyHours * HOUR_MS),
  daily: new Date(anchoredAt.getTime() + BEYOND_USE.dailyDays * DAY_MS),
  weekly: new Date(anchoredAt.getTime() + BEYOND_USE.weeklyWeeks * 7 * DAY_MS),
  // The one tier a count of days gets wrong: the same day of the month six months on, or that
  // month's last day, which is the rule `monthsOn` states and the platform's one copy of it.
  monthly: monthsOn(anchoredAt, BEYOND_USE.monthlyMonths),
});

/** The row as the routine reads it back, whichever run wrote it. */
type ErasureRow = {
  readonly id: string;
  /**
   * The erasure pseudonym, which the report is never handed (ADR 0035) and the git step
   * cannot run without: it is what `human:<address>` becomes. It is read back here rather
   * than kept from the insert, because on a second run the insert conflicted and did nothing
   * and the id the history was rewritten to is the first run's.
   */
  readonly pseudonym: string;
  readonly anchored_at: Date;
  readonly beyond_use_hourly_at: Date;
  readonly beyond_use_daily_at: Date;
  readonly beyond_use_weekly_at: Date;
  readonly beyond_use_monthly_at: Date;
  /**
   * The completion standing on the row when this run opened it — the first run's, and `null`
   * on the run that is the first. Read under the lock, so it is exact for the whole routine:
   * it is what tells step 7 whether this run is the one the queue should hear about.
   */
  readonly completed_at: Date | null;
};

const erasureRecordOf = (row: ErasureRow): ErasureRecord => ({
  id: row.id,
  anchoredAt: row.anchored_at,
  beyondUseHourlyAt: row.beyond_use_hourly_at,
  beyondUseDailyAt: row.beyond_use_daily_at,
  beyondUseWeeklyAt: row.beyond_use_weekly_at,
  beyondUseMonthlyAt: row.beyond_use_monthly_at,
});

const OPENED = `SELECT id, pseudonym, anchored_at, beyond_use_hourly_at, beyond_use_daily_at,
                       beyond_use_weekly_at, beyond_use_monthly_at, completed_at
                  FROM erasure_request WHERE workspace_id = $1 AND subject_request_id = $2`;

/**
 * Steps 1 and 2's footing: the request this routine answers, and the row it runs on.
 *
 * The pseudonym is minted here and nowhere else, and it is minted **into the insert** rather
 * than decided before it: the unique key on the request means a second run's insert conflicts
 * and does nothing, so what comes back from the read below is always the id the history was
 * rewritten to, first run or fiftieth. That single statement is the whole of what makes the
 * routine idempotent — there is no "has this run already" to ask.
 */
const openTheRoutine = async (
  tx: Tx,
  workspaceId: string,
  subjectRequestId: string,
  lockedAt: Date,
): Promise<
  Result<
    {
      readonly request: SubjectRequest;
      readonly erasure: ErasureRecord;
      /** Beside the record rather than in it: the report is never handed this (ADR 0035). */
      readonly pseudonym: string;
      /** The completion already standing, so a replay can be told from a first run. */
      readonly completedAt: Date | null;
    },
    ErasureRefusal
  >
> => {
  const found = await tx.query(
    `SELECT workspace_id AS "workspaceId", id, person_id AS "personId", identifiers, kind,
            received_at AS "receivedAt", clock_started_at AS "clockStartedAt",
            due_at AS "dueAt", extended_to AS "extendedTo", answered_at AS "answeredAt", answer
       FROM subject_request
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, subjectRequestId],
  );
  const row = found.rows[0];
  if (row === undefined) return err("no-such-request");
  // Parsed at the boundary rather than asserted (ADR 0028): the row is the schema's shape.
  const request = boundarySchemas.subjectRequest.select.parse(row);
  if (request.kind !== "erasure") return err("not-an-erasure");

  const beyondUse = beyondUseFrom(lockedAt);
  // `locked_at` and `anchored_at` are one instant today, and two columns because the day O1
  // lands `backup_run` the anchor moves to the last dump's stamp and the lock's instant stays
  // what it is. The report says which of the two it used.
  await tx.query(
    `INSERT INTO erasure_request
       (workspace_id, id, subject_request_id, pseudonym, locked_at, anchored_at,
        beyond_use_hourly_at, beyond_use_daily_at, beyond_use_weekly_at, beyond_use_monthly_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, subject_request_id) DO NOTHING`,
    [
      workspaceId,
      ulid(),
      request.id,
      // Never the person id (ADR 0035): the minter's opaque id, so two workspaces that erase
      // one person hold two values nobody can join their rewritten histories on.
      ulid(),
      lockedAt,
      beyondUse.hourly,
      beyondUse.daily,
      beyondUse.weekly,
      beyondUse.monthly,
    ],
  );
  const opened = await tx.query<ErasureRow>(OPENED, [workspaceId, request.id]);
  const erasure = opened.rows[0];
  // The insert either landed a row or found one; a read that answers neither is a database
  // that has just refused a statement it reported as accepted.
  if (erasure === undefined) throw new Error("erasure: the request's routine row did not open");
  return ok({
    request,
    erasure: erasureRecordOf(erasure),
    pseudonym: erasure.pseudonym,
    completedAt: erasure.completed_at,
  });
};

const CONCEPT_FILE: ErasureFamily = "concept-file";

/**
 * The files in the bundle that name this person, by path. A concept-file location is
 * `<commit>:<path>` for a blob and a bare sha for an author line; only the first names a file,
 * and one path may be named at several commits, so the set is what a reader of the rows wants.
 * Two steps ask this — the report's list of IRIs and the re-hash of the checks that moved — so
 * it is read off the map once rather than parsed twice.
 */
const pathsNaming = (map: ErasureMap): readonly string[] => [
  ...new Set(
    (map.find((entry) => entry.family === CONCEPT_FILE)?.locations ?? [])
      .filter((location) => location.includes(":"))
      .map((location) => location.slice(location.indexOf(":") + 1)),
  ),
];

/**
 * The concepts whose body names this person, by IRI — what the report lists for the owner to
 * edit. The map's concept-file locations are `<commit>:<path>` for a file and a bare sha for
 * an author line; only the first names a file, and `concept_index` holds one row per path, so
 * a path is the join. An IRI is what an owner can open; a path at a commit is not.
 */
const conceptsNaming = async (
  tx: Tx,
  workspaceId: string,
  map: ErasureMap,
): Promise<readonly string[]> => {
  const paths = pathsNaming(map);
  if (paths.length === 0) return [];
  const found = await tx.query<{ iri: string }>(
    "SELECT DISTINCT iri FROM concept_index WHERE workspace_id = $1 AND path = ANY($2)",
    [workspaceId, paths],
  );
  return found.rows.map((row) => row.iri);
};

/**
 * What the spine records about each family: how many places the map named there. Each step
 * that acts on a store writes its own words into its own family's line beside this count, and
 * the report prints whatever it finds — so a step arrives by filling this record rather than
 * by reshaping it.
 */
const foundPerFamily = (map: ErasureMap): ErasureActions => {
  const actions: Partial<Record<ErasureFamily, ErasureAction>> = {};
  for (const entry of map) actions[entry.family] = { found: entry.locations.length };
  return actions;
};

/** The two families the git step acts on, named once so the lines below cannot drift apart. */
const BUNDLE_COMMIT: ErasureFamily = "bundle-commit";

/**
 * Step 3's two lines, written **into** the record the spine built rather than over it: each
 * family keeps the count of what the map found there and gains what this step did about it.
 * A step that reshaped the record would be a step every later step had to know about.
 */
const withTheGitStep = (
  actions: ErasureActions,
  step: { readonly rewritten: number; readonly moved: number },
): ErasureActions => ({
  ...actions,
  [CONCEPT_FILE]: { ...actions[CONCEPT_FILE], rewritten: step.rewritten },
  [BUNDLE_COMMIT]: { ...actions[BUNDLE_COMMIT], moved: step.moved },
});

const CONCEPT_VERIFICATION: ErasureFamily = "concept-verification";

/**
 * Step 4's two lines. `reindexed` is the index rows carried onto what their file now says and
 * `rehashed` the checks re-pointed at them — both usually **zero**, because a bundle names a
 * person in the two frontmatter keys ADR 0019 keeps out of the content hash, and a rewrite that
 * moved no hash left every check reading exactly what it read before. That is the step working,
 * and a report that said nothing at all about it could not tell it from a step that never ran.
 */
const withTheChecksMoved = (
  actions: ErasureActions,
  carried: { readonly concepts: number; readonly checks: number },
): ErasureActions => ({
  ...actions,
  [CONCEPT_FILE]: { ...actions[CONCEPT_FILE], reindexed: carried.concepts },
  [CONCEPT_VERIFICATION]: { ...actions[CONCEPT_VERIFICATION], rehashed: carried.checks },
});

/**
 * Step 5's five lines, one per identity family the map walks. **The arm is on the user row's
 * line**, which is what makes the report say which of the two ran — and it says only that:
 * never a count of memberships, and never that another workspace holds one, because a document
 * this workspace is handed is not where a judgement about another tenant is published
 * (ADR 0035's rejected oracle).
 */
const withTheIdentityStep = (actions: ErasureActions, swept: IdentitySwept): ErasureActions => ({
  ...actions,
  "identity-user": {
    ...actions["identity-user"],
    arm: swept.arm,
    pseudonymised: swept.pseudonymised,
    membershipsEnded: swept.membershipsEnded,
  },
  "identity-session": { ...actions["identity-session"], deleted: swept.sessions },
  "identity-verification": { ...actions["identity-verification"], deleted: swept.verifications },
  "identity-invitation": { ...actions["identity-invitation"], deleted: swept.invitations },
  "identity-account": { ...actions["identity-account"], deleted: swept.accounts },
});

const SOURCE_DOCUMENT: ErasureFamily = "source-document";

/**
 * Steps 6 and 7's line, which is the documents family's: the suppressions written for the
 * documents the map found, and the bindings whose derived copies this erasure invalidates,
 * which are those same documents' bindings. `found` is already on the line from the spine, so
 * a report reading `found 1, suppressed 0` is the one shape that says a document was named and
 * nothing was written for it — the gap, not a silence.
 *
 * The rebuild itself has no family and therefore no line here. It is a job on the queue, which
 * is where a reader of a rebuild looks: the report is what the platform holds about *this
 * person*, and a rebuild is the whole workspace's derived map made again.
 */
const withTheDocumentsStep = (
  actions: ErasureActions,
  documents: Suppressed & Pick<Rederived, "bindingsToReprocess">,
): ErasureActions => ({
  ...actions,
  [SOURCE_DOCUMENT]: {
    ...actions[SOURCE_DOCUMENT],
    suppressed: documents.suppressed,
    bindings: documents.bindingsToReprocess.length,
  },
});

const IDENTITY_USER: ErasureFamily = "identity-user";

/**
 * The person step 5 acts on: the one the **map** found, which is not always the one the request
 * names. A request may carry no person id and still be about somebody the identity set holds,
 * because the map resolves a subject by address as well as by id — and a request that names a
 * person this workspace holds no membership for finds none, which is the fence that keeps one
 * workspace's erasure off another's person.
 */
const personTheMapFound = (map: ErasureMap): string | null =>
  map.find((entry) => entry.family === IDENTITY_USER)?.locations[0] ?? null;

const detailOf = (request: SubjectRequest, map: ErasureMap): CompletedDetail => {
  const locations = map.reduce((total, entry) => total + entry.locations.length, 0);
  // The person id where the subject holds a login, and the field left out where they hold
  // none — an absent optional, never a null standing in for a person.
  return request.personId === null
    ? { subjectRequestId: request.id, locations }
    : { subjectRequestId: request.id, personId: request.personId, locations };
};

/** What the routine's last step reads back: the completion that stands, this run's or the first's. */
type CompletionRow = { readonly completed_at: Date | null; readonly report: string | null };

/**
 * Run the erasure routine for one subject request, under `pg_advisory_lock(41)` held from the
 * first step to the last.
 *
 * The steps this iteration builds are 1 (the pseudonym), 2 (the erasure map), 9 (the report)
 * and 11 (the completion and its ledger event). The git rewrite, the moved checks, the
 * identity set, the suppressions and the replay copy land on this spine.
 */
export const runErasure = async (
  platform: ErasurePrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor; readonly clock: Clock },
  input: { readonly workspaceId: string; readonly subjectRequestId: string },
): Promise<Result<ErasureRun, ErasureRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  const requestId = boundarySchemas.subjectRequest.select.shape.id.safeParse(
    input.subjectRequestId,
  );
  if (!workspace.success || !requestId.success) return err("malformed");
  const workspaceId = workspace.data;

  return withSessionLock(platform, doors.postgres, DUMP_LOCK, async () => {
    // Read once the lock is held, so the anchor is an instant no dump can have been taken
    // after: every date computed from it is the latest a copy of this person can expire.
    const lockedAt = doors.clock.now();

    const opened = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, (tx) =>
        openTheRoutine(tx, workspaceId, requestId.data, lockedAt),
      ),
    );
    if (!opened.ok) return err(opened.error);
    if (!opened.value.ok) return err(opened.value.error);
    const { request, erasure, pseudonym, completedAt: standingCompletion } = opened.value.value;

    // Step 2, in its own transaction: the map walks every store family and reads a real
    // repository, which is not work to hold a transaction open across the first step for.
    const searched = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, async (tx) => {
        const map = await erasureMapOf(platform, tx, doors.git, request);
        return { map, concepts: await conceptsNaming(tx, workspaceId, map) };
      }),
    );
    if (!searched.ok) return err(searched.error);
    const { map, concepts } = searched.value;

    // Step 3, under the per-repository lock, which is held across **both** halves: the
    // rewrite and the rows that name its commits have to move together, and a reconciler
    // tick that ran between them would meet a head its watermark could not reach and call
    // the history diverged.
    const rewritten = await attempt(() =>
      withRepositoryLockAs(platform, doors.git, workspaceId, async () => {
        const { moved } = await rewriteHistory(platform, doors.git, workspaceId, {
          addresses: request.identifiers?.emails ?? [],
          pseudonym,
        });
        // One transaction for both tables, because `concept_index`'s key into `bundle_commit`
        // is deferred to its end (migration 0015): the two are inconsistent inside it, which
        // is the only way to move a primary key that another table points at.
        //
        // Step 4 rides in the same transaction and under the same lock, because it reads each
        // file back at the commit its index row names and that hash has only just moved: a
        // step that ran after the commit would be reading rows another tick could have moved
        // under it, and one that ran before would be reading the history the rewrite replaced.
        const rows = await withScope(platform, doors.postgres, workspaceId, async (tx) => ({
          moved: await moveBundleCommits(platform, tx, moved),
          carried: await carryChecksOntoRewrite(platform, tx, doors.git, {
            workspaceId,
            paths: pathsNaming(map),
          }),
        }));
        return { rewritten: moved.length, moved: rows.moved, carried: rows.carried };
      }),
    );
    if (!rewritten.ok) return err(rewritten.error);

    // Step 5, in its own unscoped transaction, because the identity set carries no
    // `workspace_id` and a scoped transaction reaches none of it (ADR 0009).
    const identity = await attempt(() =>
      eraseFromTheIdentitySet(platform, doors.postgres, {
        workspaceId,
        personId: personTheMapFound(map),
        emails: (request.identifiers?.emails ?? []).map((email) => email.trim().toLowerCase()),
        pseudonym,
      }),
    );
    if (!identity.ok) return err(identity.error);

    // Step 6, in its own scoped transaction: one suppression per document the map found,
    // carrying the request's identifier set as it stands now. For a subject with no user row
    // and no history this is the erasure itself, and not a line beside one.
    const suppressed = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, (tx) =>
        suppressTheDocuments(platform, tx, {
          workspaceId,
          erasureRequestId: erasure.id,
          identifiers: request.identifiers,
          map,
        }),
      ),
    );
    if (!suppressed.ok) return err(suppressed.error);

    // Step 7: the graph re-derived by a `full-rebuild` job with reason *erasure*, and the
    // bindings whose derived copies this erasure invalidates listed for the wipe S1 lands.
    // Step 8 is the sentence the report already carries and a thing this routine does not do:
    // no step of it reaches the object store, because a company document that mentions a
    // person is suppressed when it is next reprocessed and never deleted.
    const rederived = await attempt(() =>
      rederiveAfterErasure(platform, doors.postgres, {
        workspaceId,
        map,
        completedAt: standingCompletion,
      }),
    );
    if (!rederived.ok) return err(rederived.error);

    const actions = withTheDocumentsStep(
      withTheIdentityStep(
        withTheChecksMoved(
          withTheGitStep(foundPerFamily(map), rewritten.value),
          rewritten.value.carried,
        ),
        identity.value,
      ),
      { ...suppressed.value, bindingsToReprocess: rederived.value.bindingsToReprocess },
    );
    const report = erasureReportOf({ request, erasure, actions, map, concepts });
    const completedAt = doors.clock.now();

    const completed = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, async (tx) => {
        // `completed_at IS NULL` is the idempotence, written as a statement rather than as a
        // question asked first: a second run's update matches no row, so the completion the
        // replay reads is always the one the first run wrote.
        await tx.query(
          `UPDATE erasure_request
              SET actions = $3, completed_at = $4, report = $5
            WHERE workspace_id = $1 AND id = $2 AND completed_at IS NULL`,
          [workspaceId, erasure.id, actions, completedAt, report],
        );
        const standing = await tx.query<CompletionRow>(
          "SELECT completed_at, report FROM erasure_request WHERE workspace_id = $1 AND id = $2",
          [workspaceId, erasure.id],
        );
        const row = standing.rows[0];
        if (row?.completed_at == null || row.report === null) {
          throw new Error("erasure: the routine did not complete the request it opened");
        }
        const auditEventId = ulid();
        // The door is called bare (ADR 0014 rule 4): its rejection aborts this transaction,
        // so a completion whose event cannot be written is a completion that did not happen.
        await record(platform, tx, {
          id: auditEventId,
          act: ERASURE_ACTS.completed,
          subjectId: erasure.id,
          detail: detailOf(request, map),
        });
        return { completedAt: row.completed_at, report: row.report, auditEventId };
      }),
    );
    if (!completed.ok) return err(completed.error);

    return ok({
      workspaceId,
      subjectRequestId: request.id,
      erasureRequestId: erasure.id,
      anchoredAt: erasure.anchoredAt,
      completedAt: completed.value.completedAt,
      report: completed.value.report,
      map,
      auditEventId: completed.value.auditEventId,
    });
  });
};
