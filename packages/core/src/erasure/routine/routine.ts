import { boundarySchemas } from "@better-answers/schema";

import { action, declareActions, record, type DetailOf } from "../../audit/index.ts";
import { attempt, err, ok, ulid, type Result } from "../../kernel/index.ts";
import { withScope, withSessionLock, type Tx } from "../../store/postgres/index.ts";
import { erasureMapOf, type ErasureFamily, type ErasureMap } from "../map.ts";
import { subjectNamedBy, type SubjectNamed } from "../needles.ts";
import { writeReplayCopy } from "../replay.ts";
import { erasureReportOf, type ErasureActions, type ErasureRecord } from "../report.ts";
import { monthsOn, type SubjectRequest } from "../requests.ts";
import { suppressInTheWorkspace } from "../suppressions.ts";
import { eraseFromTheActors, inEverySweep } from "./actors.ts";
import { eraseFromTheIdentitySet } from "./identity.ts";
import { eraseFromTheQuestions } from "./questions.ts";
import { rederiveAfterErasure } from "./rederive.ts";
import {
  conceptsNaming,
  namedInTheBundle,
  pathsNaming,
  rewritingTheBundle,
  logTheSweep,
  questionsStepLineOf,
  identityStepLineOf,
  afterTheMembersEnd,
  inBothPasses,
  withTheQuestionsStep,
  withTheDocumentsStep,
  withTheIdentityStep,
  withTheActorsStep,
  withTheVerificationsMoved,
  withTheGitStep,
  foundPerFamily,
  inBothSweeps,
} from "./steps.ts";
import type {
  RunErasureRefusal,
  ErasurePrincipal,
  ErasureDoors,
  ErasureRun,
} from "./vocabulary.ts";

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
  const row: unknown = found.rows[0];
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

const IDENTITY_USER: ErasureFamily = "identity-user";

const personTheMapFound = (map: ErasureMap): string | null =>
  map.find((entry) => entry.family === IDENTITY_USER)?.locations[0] ?? null;

const detailOf = (request: SubjectRequest, map: ErasureMap): CompletedDetail => {
  const locations = map.reduce((total, entry) => total + entry.locations.length, 0);
  const personId = personTheMapFound(map);
  return personId === null
    ? { subjectRequestId: request.id, locations }
    : { subjectRequestId: request.id, personId, locations };
};

type CompletionRow = { readonly completed_at: Date | null; readonly report: string | null };

type ErasureOpened = {
  readonly request: SubjectRequest;
  readonly erasure: ErasureRecord;
  readonly pseudonym: string;
  readonly standingCompletion: Date | null;
  readonly map: ErasureMap;
  readonly concepts: readonly string[];
  readonly named: SubjectNamed;
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
      const named = await subjectNamedBy(tx, request, { erasureRequestId: erasure.id, pseudonym });
      const map = await erasureMapOf(platform, tx, doors.git, request, named);
      return { map, named, concepts: await conceptsNaming(tx, workspaceId, map) };
    }),
  );
  if (!searched.ok) return err(searched.error);
  const { map, concepts, named } = searched.value;

  if (namedInTheBundle(map) && named.needles.addresses.length === 0) return err("no-address");
  return ok({ request, erasure, pseudonym, standingCompletion, map, concepts, named });
};

const completeTheRequest = async (
  platform: ErasurePrincipal,
  doors: ErasureDoors,
  workspaceId: string,
  opened: ErasureOpened,
  actions: ErasureActions,
): Promise<Result<ErasureRun>> => {
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
    const { request, erasure, pseudonym, standingCompletion, map, named } = opened.value;
    const { needles } = named;
    const paths = pathsNaming(map);

    const rewritten = await rewritingTheBundle(platform, doors, workspaceId, {
      ...needles,
      pseudonym,
      paths,
    });
    if (!rewritten.ok) return err(rewritten.error);

    const suppressed = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, (tx) =>
        suppressInTheWorkspace(platform, tx, {
          workspaceId,
          erasureRequestId: erasure.id,
          identifiers: request.identifiers,
          signInAddresses: named.signInAddresses,
        }),
      ),
    );
    if (!suppressed.ok) return err(suppressed.error);

    const sweeping = { workspaceId, needles, pseudonym };
    const swept = await attempt(async () => {
      const questions = await eraseFromTheQuestions(platform, doors.postgres, {
        workspaceId,
        personIds: needles.people,
        pseudonym,
      });
      logTheSweep(
        doors.log,
        questionsStepLineOf(platform, erasure.id, questions),
        QUESTIONS_STEP_LOGGED,
      );
      return { questions, actors: await eraseFromTheActors(platform, doors.postgres, sweeping) };
    });
    if (!swept.ok) return err(swept.error);

    const identity = await attempt(() =>
      eraseFromTheIdentitySet(platform, doors.postgres, {
        ...sweeping,
        personId: named.member,
        emails: named.signInAddresses,
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
      ...needles,
      workspaceId,
      pseudonym,
      paths,
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
