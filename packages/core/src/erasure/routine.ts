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
import {
  ERASED_DOMAIN,
  rewriteHistory,
  withRepositoryLockAs,
  type GitDoor,
} from "../store/git/index.ts";
import type { ObjectDoor } from "../store/objects/index.ts";
import { withScope, withSessionLock, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { eraseFromTheIdentitySet, type IdentitySwept } from "./identity.ts";
import { erasureMapOf, type ErasureFamily, type ErasureMap } from "./map.ts";
import { rederiveAfterErasure, type Rederived } from "./rederive.ts";
import { writeReplayCopy } from "./replay.ts";
import {
  erasureReportOf,
  type ErasureAction,
  type ErasureActions,
  type ErasureRecord,
} from "./report.ts";
import { monthsOn, type SubjectRequest } from "./requests.ts";
import { suppressTheDocuments, type Suppressed } from "./suppressions.ts";

const ERASURE_ACTOR = "process:better-answers-erasure";

export type ErasurePrincipal = PlatformPrincipal & {
  readonly actorId: typeof ERASURE_ACTOR;
};

export const ERASURE: ErasurePrincipal = { kind: "platform", actorId: ERASURE_ACTOR };

export type ErasureLogLine = {
  readonly actor: typeof ERASURE_ACTOR;
  readonly erasure_request_id: string;
  readonly invitations_deleted: number;
};

// The row and the report are the erasing workspace's to read, so what the routine did beyond it
// goes to the tier's log.
export type ErasureLog = {
  readonly info: (line: ErasureLogLine, message: string) => void;
};

const IDENTITY_STEP_LOGGED = "erasure: what the identity step deleted across every workspace";

// deploy/backup.sh takes the same advisory lock by this number; change one and a dump runs
// beside an erasure.
const DUMP_LOCK = 41;

const ERASURE_ACTS = declareActs("people", {
  completed: act("people.erasure.completed", {
    subjectRequestId: "id",
    personId: "id?",
    locations: "count",
  }),
});

type CompletedDetail = DetailOf<(typeof ERASURE_ACTS)["completed"]["detail"]>;

export type ErasureRefusal = "malformed" | "no-such-request" | "not-an-erasure" | "no-address";

export type ErasureRun = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;

  readonly anchoredAt: Date;
  readonly completedAt: Date;
  readonly report: string;

  readonly map: ErasureMap;

  readonly auditEventId: string;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Months are calendar months, as deploy/backup.sh's interval writes them;
// packages/schema/test/factory.ts spells the same four and moves with this.
const BEYOND_USE = { hourlyHours: 48, dailyDays: 30, weeklyWeeks: 8, monthlyMonths: 6 } as const;

export const beyondUseFrom = (anchoredAt: Date) => ({
  hourly: new Date(anchoredAt.getTime() + BEYOND_USE.hourlyHours * HOUR_MS),
  daily: new Date(anchoredAt.getTime() + BEYOND_USE.dailyDays * DAY_MS),
  weekly: new Date(anchoredAt.getTime() + BEYOND_USE.weeklyWeeks * 7 * DAY_MS),

  monthly: monthsOn(anchoredAt, BEYOND_USE.monthlyMonths),
});

type ErasureRow = {
  readonly id: string;

  readonly pseudonym: string;
  readonly anchored_at: Date;
  readonly beyond_use_hourly_at: Date;
  readonly beyond_use_daily_at: Date;
  readonly beyond_use_weekly_at: Date;
  readonly beyond_use_monthly_at: Date;

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

      readonly pseudonym: string;

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

  const request = boundarySchemas.subjectRequest.select.parse(row);
  if (request.kind !== "erasure") return err("not-an-erasure");

  const beyondUse = beyondUseFrom(lockedAt);

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

  if (erasure === undefined) throw new Error("erasure: the request's routine row did not open");
  return ok({
    request,
    erasure: erasureRecordOf(erasure),
    pseudonym: erasure.pseudonym,
    completedAt: erasure.completed_at,
  });
};

const CONCEPT_FILE: ErasureFamily = "concept-file";

const pathsNaming = (map: ErasureMap): readonly string[] => [
  ...new Set(
    (map.find((entry) => entry.family === CONCEPT_FILE)?.locations ?? [])
      .filter((location) => location.includes(":"))
      .map((location) => location.slice(location.indexOf(":") + 1)),
  ),
];

const namedInTheBundle = (map: ErasureMap): boolean =>
  (map.find((entry) => entry.family === CONCEPT_FILE)?.locations ?? []).length > 0;

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

const foundPerFamily = (map: ErasureMap): ErasureActions => {
  const actions: Partial<Record<ErasureFamily, ErasureAction>> = {};
  for (const entry of map) actions[entry.family] = { found: entry.locations.length };
  return actions;
};

const BUNDLE_COMMIT: ErasureFamily = "bundle-commit";

const withTheGitStep = (
  actions: ErasureActions,
  step: { readonly rewritten: number; readonly moved: number },
): ErasureActions => ({
  ...actions,
  [CONCEPT_FILE]: { ...actions[CONCEPT_FILE], rewritten: step.rewritten },
  [BUNDLE_COMMIT]: { ...actions[BUNDLE_COMMIT], moved: step.moved },
});

const CONCEPT_VERIFICATION: ErasureFamily = "concept-verification";

const withTheChecksMoved = (
  actions: ErasureActions,
  carried: { readonly concepts: number; readonly checks: number },
): ErasureActions => ({
  ...actions,
  [CONCEPT_FILE]: { ...actions[CONCEPT_FILE], reindexed: carried.concepts },
  [CONCEPT_VERIFICATION]: { ...actions[CONCEPT_VERIFICATION], rehashed: carried.checks },
});

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
  "identity-invitation": { ...actions["identity-invitation"], deleted: swept.invitationsHere },
  "identity-account": { ...actions["identity-account"], deleted: swept.accounts },
});

const identityStepLineOf = (
  platform: ErasurePrincipal,
  erasureRequestId: string,
  swept: IdentitySwept,
): ErasureLogLine => ({
  actor: platform.actorId,
  erasure_request_id: erasureRequestId,
  invitations_deleted: swept.invitationsEverywhere,
});

const SOURCE_DOCUMENT: ErasureFamily = "source-document";

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

const personTheMapFound = (map: ErasureMap): string | null =>
  map.find((entry) => entry.family === IDENTITY_USER)?.locations[0] ?? null;

type SubjectAddresses = {
  readonly inTheBundle: readonly string[];
  readonly ofTheSubject: readonly string[];
};

const ADDRESSES_OF = `SELECT lower(email) AS email FROM "user" WHERE id = ANY($1::text[])`;

const lowered = (addresses: readonly string[]): readonly string[] =>
  addresses.map((address) => address.trim().toLowerCase()).filter((address) => address !== "");

const addressesOfTheSubject = async (
  tx: Tx,
  subject: {
    readonly personIds: readonly (string | null)[];
    readonly requested: readonly string[];
  },
): Promise<SubjectAddresses> => {
  const people = [...new Set(subject.personIds.filter((id) => id !== null))];
  const found =
    people.length === 0 ? { rows: [] } : await tx.query<{ email: string }>(ADDRESSES_OF, [people]);
  const erased = (address: string): boolean => address.endsWith(`@${ERASED_DOMAIN}`);
  const ofTheSubject = [...new Set(lowered(found.rows.map((row) => row.email)))].filter(
    (address) => !erased(address),
  );
  return {
    ofTheSubject,
    inTheBundle: [...new Set([...ofTheSubject, ...lowered(subject.requested)])].filter(
      (address) => !erased(address),
    ),
  };
};

const detailOf = (request: SubjectRequest, map: ErasureMap): CompletedDetail => {
  const locations = map.reduce((total, entry) => total + entry.locations.length, 0);
  const personId = personTheMapFound(map);
  return personId === null
    ? { subjectRequestId: request.id, locations }
    : { subjectRequestId: request.id, personId, locations };
};

type CompletionRow = { readonly completed_at: Date | null; readonly report: string | null };

export const runErasure = async (
  platform: ErasurePrincipal,
  doors: {
    readonly git: GitDoor;
    readonly postgres: PostgresDoor;
    readonly objects: ObjectDoor;
    readonly clock: Clock;
    readonly log: ErasureLog;
  },
  input: { readonly workspaceId: string; readonly subjectRequestId: string },
): Promise<Result<ErasureRun, ErasureRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  const requestId = boundarySchemas.subjectRequest.select.shape.id.safeParse(
    input.subjectRequestId,
  );
  if (!workspace.success || !requestId.success) return err("malformed");
  const workspaceId = workspace.data;

  return withSessionLock(platform, doors.postgres, DUMP_LOCK, async () => {
    const lockedAt = doors.clock.now();

    const opened = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, (tx) =>
        openTheRoutine(tx, workspaceId, requestId.data, lockedAt),
      ),
    );
    if (!opened.ok) return err(opened.error);
    if (!opened.value.ok) return err(opened.value.error);
    const { request, erasure, pseudonym, completedAt: standingCompletion } = opened.value.value;

    const searched = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, async (tx) => {
        const map = await erasureMapOf(platform, tx, doors.git, request);
        return {
          map,
          concepts: await conceptsNaming(tx, workspaceId, map),

          addresses: await addressesOfTheSubject(tx, {
            personIds: [personTheMapFound(map), request.personId],
            requested: request.identifiers?.emails ?? [],
          }),
        };
      }),
    );
    if (!searched.ok) return err(searched.error);
    const { map, concepts, addresses } = searched.value;

    if (namedInTheBundle(map) && addresses.inTheBundle.length === 0) return err("no-address");

    const rewritten = await attempt(() =>
      // The lock spans the rewrite and the rows naming its commits: a reconciler tick between
      // them meets a head its watermark cannot reach.
      withRepositoryLockAs(platform, doors.git, workspaceId, async () => {
        const { moved } = await rewriteHistory(platform, doors.git, workspaceId, {
          addresses: addresses.inTheBundle,
          pseudonym,
        });

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

    const identity = await attempt(() =>
      eraseFromTheIdentitySet(platform, doors.postgres, {
        workspaceId,
        personId: personTheMapFound(map),
        emails: addresses.ofTheSubject,
        pseudonym,
      }),
    );
    if (!identity.ok) return err(identity.error);
    // Logged as the step commits, not at completion: a run that dies after it leaves the next
    // run nothing left to count.
    doors.log.info(identityStepLineOf(platform, erasure.id, identity.value), IDENTITY_STEP_LOGGED);

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

    const standsAt = standingCompletion ?? completedAt;

    // Written before the completion commits: a run that leaves no copy loses the erasure to
    // every restore from a dump older than the request.
    const copied = await attempt(() =>
      writeReplayCopy(platform, doors.objects, {
        workspaceId,
        subjectRequestId: request.id,
        erasureRequestId: erasure.id,
        personId: personTheMapFound(map),
        pseudonym,
        completedAt: standsAt,
        identifiers: request.identifiers,
        map,
      }),
    );
    if (!copied.ok) return err(copied.error);

    const completed = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, async (tx) => {
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
