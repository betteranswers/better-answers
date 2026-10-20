import { boundarySchemas } from "@better-answers/schema";

import { action, declareActions, record, type DetailOf } from "../audit/index.ts";
import {
  carryVerificationsOntoRewrite,
  moveBundleCommits,
  withBundleFenceAs,
} from "../concepts/index.ts";
import {
  attempt,
  err,
  ok,
  processActorId,
  ulid,
  type Clock,
  type PlatformPrincipal,
  type Result,
} from "../kernel/index.ts";
import {
  ERASED_DOMAIN,
  rewriteHistory,
  type GitDoor,
  type Pseudonymisation,
} from "../store/git/index.ts";
import type { ObjectDoor } from "../store/objects/index.ts";
import { withScope, withSessionLock, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { eraseFromTheActors, inEverySweep, type ActorsSwept } from "./actors.ts";
import { eraseFromTheIdentitySet, type IdentityArm, type IdentitySwept } from "./identity.ts";
import { erasureMapOf, type ErasureFamily, type ErasureMap } from "./map.ts";
import { eraseFromTheQuestions, type QuestionsSwept } from "./questions.ts";
import { rederiveAfterErasure, type Rederived } from "./rederive.ts";
import { writeReplayCopy } from "./replay.ts";
import {
  erasureReportOf,
  type ErasureAction,
  type ErasureActions,
  type ErasureRecord,
} from "./report.ts";
import { monthsOn, type SubjectRequest } from "./requests.ts";
import { addressesSuppressedFor, suppressInTheWorkspace, type Suppressed } from "./suppressions.ts";

const ERASURE_ACTOR = processActorId("erasure");

const isTombstone = (address: string): boolean => address.endsWith(`@${ERASED_DOMAIN}`);

export type ErasurePrincipal = PlatformPrincipal & {
  readonly actorId: typeof ERASURE_ACTOR;
};

export const ERASURE: ErasurePrincipal = { kind: "platform", actorId: ERASURE_ACTOR };

export type ErasureLogLine = {
  readonly actor: typeof ERASURE_ACTOR;
  readonly erasure_request_id: string;
  readonly arm: IdentityArm;
  readonly pseudonymised: number;
  readonly sessions_deleted: number;
  readonly verifications_deleted: number;
  readonly accounts_deleted: number;
  readonly invitations_deleted_here: number;
  readonly invitations_deleted: number;
  readonly passkeys_deleted: number;
  readonly authenticators_deleted: number;
  readonly recovery_codes_deleted: number;
  readonly confirm_failures_deleted: number;
  readonly last_active_deleted: number;
};

export type QuestionsLogLine = {
  readonly actor: typeof ERASURE_ACTOR;
  readonly erasure_request_id: string;
  readonly records_rewritten: number;
  readonly questions_removed: number;
  readonly feedback_rewritten: number;
};

export type ErasureLog = {
  readonly info: (line: ErasureLogLine | QuestionsLogLine, message: string) => void;
};

const QUESTIONS_STEP_LOGGED = "erasure: what the questions step rewrote and removed";

const QUESTIONS_SINCE_LOGGED =
  "erasure: what was asked or flagged after the questions step, rewritten and removed as the member ended";

const IDENTITY_STEP_LOGGED =
  "erasure: the identity step's arm, and what it pseudonymised and deleted";

const DUMP_LOCK = 41;

const ERASURE_ACTIONS = declareActions("people", {
  completed: action("people.erasure.completed", {
    subjectRequestId: "id",
    personId: "id?",
    locations: "count",
  }),
});

type CompletedDetail = DetailOf<(typeof ERASURE_ACTIONS)["completed"]["detail"]>;

export type RunErasureRefusal = "malformed" | "no-such-request" | "not-an-erasure" | "no-address";

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
    RunErasureRefusal
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

type GitStep = {
  readonly rewritten: number;
  readonly moved: number;
  readonly carried: { readonly concepts: number; readonly verifications: number };
};

const inBothPasses = (first: GitStep, second: GitStep): GitStep => ({
  rewritten: first.rewritten + second.rewritten,
  moved: first.moved + second.moved,
  carried: {
    concepts: first.carried.concepts + second.carried.concepts,
    verifications: first.carried.verifications + second.carried.verifications,
  },
});

const withTheGitStep = (actions: ErasureActions, step: GitStep): ErasureActions => ({
  ...actions,
  [CONCEPT_FILE]: { ...actions[CONCEPT_FILE], rewritten: step.rewritten },
  [BUNDLE_COMMIT]: { ...actions[BUNDLE_COMMIT], moved: step.moved },
});

const CONCEPT_VERIFICATION: ErasureFamily = "concept-verification";

const withTheVerificationsMoved = (
  actions: ErasureActions,
  carried: GitStep["carried"],
): ErasureActions => ({
  ...actions,
  [CONCEPT_FILE]: { ...actions[CONCEPT_FILE], reindexed: carried.concepts },
  [CONCEPT_VERIFICATION]: { ...actions[CONCEPT_VERIFICATION], rehashed: carried.verifications },
});

const withTheActorsStep = (actions: ErasureActions, swept: ActorsSwept): ErasureActions => ({
  ...actions,
  [BUNDLE_COMMIT]: { ...actions[BUNDLE_COMMIT], actorsRewritten: swept.commits },
  [CONCEPT_VERIFICATION]: {
    ...actions[CONCEPT_VERIFICATION],
    actorsRewritten: swept.verifications,
  },
});

const rewritingTheBundle = (
  platform: ErasurePrincipal,
  doors: ErasureDoors,
  workspaceId: string,
  who: Pseudonymisation & { readonly paths: readonly string[] },
): Promise<Result<GitStep, Error>> =>
  attempt(() =>
    withBundleFenceAs(platform, doors, workspaceId, "exclusive", async () => {
      const { moved, paths } = await rewriteHistory(platform, doors.git, workspaceId, who);
      const rows = await withScope(platform, doors.postgres, workspaceId, async (tx) => ({
        moved: await moveBundleCommits(platform, tx, moved),
        carried: await carryVerificationsOntoRewrite(platform, tx, doors.git, {
          workspaceId,
          paths: [...new Set([...who.paths, ...paths])],
        }),
      }));
      return { rewritten: moved.length, moved: rows.moved, carried: rows.carried };
    }),
  );

const afterTheMembersEnd = async (
  platform: ErasurePrincipal,
  doors: ErasureDoors,
  subject: Pseudonymisation & {
    readonly workspaceId: string;
    readonly erasureRequestId: string;
    readonly personIds: readonly (string | null)[];
    readonly paths: readonly string[];
  },
): Promise<Result<{ readonly git: GitStep; readonly actors: ActorsSwept }, Error>> => {
  const { workspaceId } = subject;
  const suppressed = await attempt(() =>
    withScope(platform, doors.postgres, workspaceId, (tx) => addressesSuppressedFor(tx, subject)),
  );
  if (!suppressed.ok) return err(suppressed.error);
  const addresses = [...new Set([...subject.addresses, ...suppressed.value])].filter(
    (address) => !isTombstone(address),
  );
  const git = await rewritingTheBundle(platform, doors, workspaceId, { ...subject, addresses });
  if (!git.ok) return err(git.error);
  const actors = await attempt(() => eraseFromTheActors(platform, doors.postgres, subject));
  return actors.ok ? ok({ git: git.value, actors: actors.value }) : err(actors.error);
};

const withTheIdentityStep = (actions: ErasureActions, swept: IdentitySwept): ErasureActions => ({
  ...actions,
  "identity-user": { ...actions["identity-user"], membershipsEnded: swept.membersEnded },
});

const identityStepLineOf = (
  platform: ErasurePrincipal,
  erasureRequestId: string,
  swept: IdentitySwept,
): ErasureLogLine => ({
  actor: platform.actorId,
  erasure_request_id: erasureRequestId,
  arm: swept.arm,
  pseudonymised: swept.pseudonymised,
  sessions_deleted: swept.sessions,
  verifications_deleted: swept.verifications,
  accounts_deleted: swept.accounts,
  invitations_deleted_here: swept.invitationsHere,
  invitations_deleted: swept.invitationsEverywhere,
  passkeys_deleted: swept.passkeys,
  authenticators_deleted: swept.authenticators,
  recovery_codes_deleted: swept.recoveryCodes,
  confirm_failures_deleted: swept.confirmFailures,
  last_active_deleted: swept.lastActive,
});

const SOURCE_DOCUMENT: ErasureFamily = "source-document";

const withTheDocumentsStep = (
  actions: ErasureActions,
  documents: Suppressed & Pick<Rederived, "connectedSourcesToReprocess">,
): ErasureActions => ({
  ...actions,
  [SOURCE_DOCUMENT]: {
    ...actions[SOURCE_DOCUMENT],
    bindingsReindexed: documents.connectedSourcesToReprocess.length,
    identifiersWithheld: documents.identifiersWithheld,
  },
});

const QUESTION_ASKED: ErasureFamily = "question-asked";

const withTheQuestionsStep = (actions: ErasureActions, swept: QuestionsSwept): ErasureActions => ({
  ...actions,
  [QUESTION_ASKED]: { ...actions[QUESTION_ASKED], ...swept },
});

const questionsStepLineOf = (
  platform: ErasurePrincipal,
  erasureRequestId: string,
  swept: QuestionsSwept,
): QuestionsLogLine => ({
  actor: platform.actorId,
  erasure_request_id: erasureRequestId,
  records_rewritten: swept.rewritten,
  questions_removed: swept.questionsRemoved,
  feedback_rewritten: swept.feedbackRewritten,
});

const logTheSweep = (log: ErasureLog, line: QuestionsLogLine, message: string): void => {
  if (line.records_rewritten + line.feedback_rewritten > 0) log.info(line, message);
};

const inBothSweeps = (step: QuestionsSwept, since: QuestionsSwept): QuestionsSwept => ({
  rewritten: step.rewritten + since.rewritten,
  questionsRemoved: step.questionsRemoved + since.questionsRemoved,
  feedbackRewritten: step.feedbackRewritten + since.feedbackRewritten,
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
  const ofTheSubject = [...new Set(lowered(found.rows.map((row) => row.email)))].filter(
    (address) => !isTombstone(address),
  );
  return {
    ofTheSubject,
    inTheBundle: [...new Set([...ofTheSubject, ...lowered(subject.requested)])].filter(
      (address) => !isTombstone(address),
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

export type ErasureDoors = {
  readonly git: GitDoor;
  readonly postgres: PostgresDoor;
  readonly objects: ObjectDoor;
  readonly clock: Clock;
  readonly log: ErasureLog;
};

type ErasureOpened = {
  readonly request: SubjectRequest;
  readonly erasure: ErasureRecord;
  readonly pseudonym: string;
  readonly standingCompletion: Date | null;
  readonly map: ErasureMap;
  readonly concepts: readonly string[];
  readonly addresses: SubjectAddresses;

  readonly namedPeople: readonly string[];
};

const NAMED_PEOPLE = `SELECT id FROM "user" WHERE email = $1 OR lower(email) = ANY($2::text[])`;

const peopleNamedBy = async (
  tx: Tx,
  request: {
    readonly workspaceId: string;
    readonly erasureRequestId: string;
    readonly pseudonym: string;
    readonly addresses: readonly string[];
  },
): Promise<readonly string[]> => {
  const suppressed = await addressesSuppressedFor(tx, request);
  const addresses = [...new Set([...request.addresses, ...suppressed])].filter(
    (address) => !isTombstone(address),
  );
  const found = await tx.query<{ id: string }>(NAMED_PEOPLE, [
    `${request.pseudonym}@${ERASED_DOMAIN}`,
    addresses,
  ]);
  return found.rows.map((row) => row.id);
};

const openTheRequest = async (
  platform: ErasurePrincipal,
  doors: ErasureDoors,
  workspaceId: string,
  subjectRequestId: string,
  lockedAt: Date,
): Promise<Result<ErasureOpened, RunErasureRefusal | Error>> => {
  const opened = await attempt(() =>
    withScope(platform, doors.postgres, workspaceId, (tx) =>
      openTheRoutine(tx, workspaceId, subjectRequestId, lockedAt),
    ),
  );
  if (!opened.ok) return err(opened.error);
  if (!opened.value.ok) return err(opened.value.error);
  const { request, erasure, pseudonym, completedAt: standingCompletion } = opened.value.value;

  const searched = await attempt(() =>
    withScope(platform, doors.postgres, workspaceId, async (tx) => {
      const map = await erasureMapOf(platform, tx, doors.git, request);
      const addresses = await addressesOfTheSubject(tx, {
        personIds: [personTheMapFound(map), request.personId],
        requested: request.identifiers.emails,
      });
      return {
        map,
        concepts: await conceptsNaming(tx, workspaceId, map),
        addresses,
        namedPeople: await peopleNamedBy(tx, {
          workspaceId,
          erasureRequestId: erasure.id,
          pseudonym,
          addresses: addresses.inTheBundle,
        }),
      };
    }),
  );
  if (!searched.ok) return err(searched.error);
  const { map, concepts, addresses, namedPeople } = searched.value;

  if (namedInTheBundle(map) && addresses.inTheBundle.length === 0) return err("no-address");
  return ok({
    request,
    erasure,
    pseudonym,
    standingCompletion,
    map,
    concepts,
    addresses,
    namedPeople,
  });
};

const completeTheRequest = async (
  platform: ErasurePrincipal,
  doors: ErasureDoors,
  workspaceId: string,
  opened: ErasureOpened,
  actions: ErasureActions,
): Promise<Result<ErasureRun, Error>> => {
  const { request, erasure, pseudonym, standingCompletion, map, concepts } = opened;
  const report = erasureReportOf({ request, erasure, actions, map, concepts });
  const completedAt = doors.clock.now();

  const standsAt = standingCompletion ?? completedAt;

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
        action: ERASURE_ACTIONS.completed,
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
};

export const runErasure = async (
  platform: ErasurePrincipal,
  doors: ErasureDoors,
  input: { readonly workspaceId: string; readonly subjectRequestId: string },
): Promise<Result<ErasureRun, RunErasureRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  const requestId = boundarySchemas.subjectRequest.select.shape.id.safeParse(
    input.subjectRequestId,
  );
  if (!workspace.success || !requestId.success) return err("malformed");
  const workspaceId = workspace.data;

  return withSessionLock(platform, doors.postgres, DUMP_LOCK, async () => {
    const lockedAt = doors.clock.now();

    const opened = await openTheRequest(platform, doors, workspaceId, requestId.data, lockedAt);
    if (!opened.ok) return err(opened.error);
    const { request, erasure, pseudonym, standingCompletion, map, addresses, namedPeople } =
      opened.value;
    const personIds = [personTheMapFound(map), request.personId, ...namedPeople];
    const people = [...new Set(personIds.filter((person) => person !== null))];

    const rewritten = await rewritingTheBundle(platform, doors, workspaceId, {
      addresses: addresses.inTheBundle,
      people,
      pseudonym,
      paths: pathsNaming(map),
    });
    if (!rewritten.ok) return err(rewritten.error);

    const suppressed = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, (tx) =>
        suppressInTheWorkspace(platform, tx, {
          workspaceId,
          erasureRequestId: erasure.id,
          identifiers: request.identifiers,
          signInAddresses: addresses.ofTheSubject,
        }),
      ),
    );
    if (!suppressed.ok) return err(suppressed.error);

    const named = { workspaceId, personIds, pseudonym };
    const swept = await attempt(async () => {
      const questions = await eraseFromTheQuestions(platform, doors.postgres, named);
      logTheSweep(
        doors.log,
        questionsStepLineOf(platform, erasure.id, questions),
        QUESTIONS_STEP_LOGGED,
      );
      return { questions, actors: await eraseFromTheActors(platform, doors.postgres, named) };
    });
    if (!swept.ok) return err(swept.error);

    const identity = await attempt(() =>
      eraseFromTheIdentitySet(platform, doors.postgres, {
        workspaceId,
        personId: personTheMapFound(map),
        emails: addresses.ofTheSubject,
        pseudonym,
      }),
    );
    if (!identity.ok) return err(identity.error);
    doors.log.info(identityStepLineOf(platform, erasure.id, identity.value), IDENTITY_STEP_LOGGED);
    logTheSweep(
      doors.log,
      questionsStepLineOf(platform, erasure.id, identity.value.questionsSince),
      QUESTIONS_SINCE_LOGGED,
    );

    const after = await afterTheMembersEnd(platform, doors, {
      ...named,
      erasureRequestId: erasure.id,
      addresses: addresses.inTheBundle,
      people,
      paths: pathsNaming(map),
    });
    if (!after.ok) return err(after.error);

    const rederived = await attempt(() =>
      rederiveAfterErasure(platform, doors.postgres, {
        workspaceId,
        map,
        completedAt: standingCompletion,
      }),
    );
    if (!rederived.ok) return err(rederived.error);

    const git = inBothPasses(rewritten.value, after.value.git);
    const actions = withTheQuestionsStep(
      withTheDocumentsStep(
        withTheIdentityStep(
          withTheActorsStep(
            withTheVerificationsMoved(withTheGitStep(foundPerFamily(map), git), git.carried),
            inEverySweep(swept.value.actors, identity.value.actorsSince, after.value.actors),
          ),
          identity.value,
        ),
        {
          ...suppressed.value,
          connectedSourcesToReprocess: rederived.value.connectedSourcesToReprocess,
        },
      ),
      inBothSweeps(swept.value.questions, identity.value.questionsSince),
    );
    return completeTheRequest(platform, doors, workspaceId, opened.value, actions);
  });
};
