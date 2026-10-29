import { withBundleFenceAs } from "../../bundle/index.ts";
import { carryVerificationsOntoRewrite, moveBundleCommits } from "../../concepts/index.ts";
import { attempt, err, ok, type Result } from "../../kernel/index.ts";
import { rewriteHistory, type Pseudonymisation } from "../../store/git/index.ts";
import { withScope, type Tx } from "../../store/postgres/index.ts";
import type { ErasureFamily, ErasureMap } from "../map.ts";
import type { ErasureAction, ErasureActions } from "../report.ts";
import type { Suppressed } from "../suppressions.ts";
import { eraseFromTheActors, type ActorsSwept } from "./actors.ts";
import type { IdentitySwept } from "./identity.ts";
import type { QuestionsSwept } from "./questions.ts";
import type { Rederived } from "./rederive.ts";
import type {
  ErasurePrincipal,
  ErasureDoors,
  ErasureLogLine,
  QuestionsLogLine,
  ErasureLog,
} from "./vocabulary.ts";

const CONCEPT_FILE: ErasureFamily = "concept-file";

export const pathsNaming = (map: ErasureMap): readonly string[] => [
  ...new Set(
    (map.find((entry) => entry.family === CONCEPT_FILE)?.locations ?? [])
      .filter((location) => location.includes(":"))
      .map((location) => location.slice(location.indexOf(":") + 1)),
  ),
];

export const namedInTheBundle = (map: ErasureMap): boolean =>
  (map.find((entry) => entry.family === CONCEPT_FILE)?.locations ?? []).length > 0;

export const conceptsNaming = async (
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

export const foundPerFamily = (map: ErasureMap): ErasureActions => {
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

export const inBothPasses = (first: GitStep, second: GitStep): GitStep => ({
  rewritten: first.rewritten + second.rewritten,
  moved: first.moved + second.moved,
  carried: {
    concepts: first.carried.concepts + second.carried.concepts,
    verifications: first.carried.verifications + second.carried.verifications,
  },
});

export const withTheGitStep = (actions: ErasureActions, step: GitStep): ErasureActions => ({
  ...actions,
  [CONCEPT_FILE]: { ...actions[CONCEPT_FILE], rewritten: step.rewritten },
  [BUNDLE_COMMIT]: { ...actions[BUNDLE_COMMIT], moved: step.moved },
});

const CONCEPT_VERIFICATION: ErasureFamily = "concept-verification";

export const withTheVerificationsMoved = (
  actions: ErasureActions,
  carried: GitStep["carried"],
): ErasureActions => ({
  ...actions,
  [CONCEPT_FILE]: { ...actions[CONCEPT_FILE], reindexed: carried.concepts },
  [CONCEPT_VERIFICATION]: { ...actions[CONCEPT_VERIFICATION], rehashed: carried.verifications },
});

export const withTheActorsStep = (actions: ErasureActions, swept: ActorsSwept): ErasureActions => {
  const taken = { ...actions };
  for (const [family, counts] of swept) taken[family] = { ...taken[family], ...counts };
  return taken;
};

export const rewritingTheBundle = (
  platform: ErasurePrincipal,
  doors: ErasureDoors,
  workspaceId: string,
  who: Pseudonymisation & { readonly paths: readonly string[] },
): Promise<Result<GitStep>> =>
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

export const afterTheMembersEnd = async (
  platform: ErasurePrincipal,
  doors: ErasureDoors,
  subject: Pseudonymisation & {
    readonly workspaceId: string;
    readonly paths: readonly string[];
  },
): Promise<Result<{ readonly git: GitStep; readonly actors: ActorsSwept }>> => {
  const { workspaceId, addresses, people, pseudonym } = subject;
  const git = await rewritingTheBundle(platform, doors, workspaceId, subject);
  if (!git.ok) return err(git.error);
  const actors = await attempt(() =>
    eraseFromTheActors(platform, doors.postgres, {
      workspaceId,
      needles: { addresses, people },
      pseudonym,
    }),
  );
  return actors.ok ? ok({ git: git.value, actors: actors.value }) : err(actors.error);
};

export const withTheIdentityStep = (
  actions: ErasureActions,
  swept: IdentitySwept,
): ErasureActions => ({
  ...actions,
  "identity-user": { ...actions["identity-user"], membershipsEnded: swept.membersEnded },
  "concept-owner": { ...actions["concept-owner"], deleted: swept.ownersDeleted },
});

export const identityStepLineOf = (
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

export const withTheDocumentsStep = (
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

export const withTheQuestionsStep = (
  actions: ErasureActions,
  swept: QuestionsSwept,
): ErasureActions => ({
  ...actions,
  [QUESTION_ASKED]: { ...actions[QUESTION_ASKED], ...swept },
});

export const questionsStepLineOf = (
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

export const logTheSweep = (log: ErasureLog, line: QuestionsLogLine, message: string): void => {
  if (line.records_rewritten + line.feedback_rewritten > 0) log.info(line, message);
};

export const inBothSweeps = (step: QuestionsSwept, since: QuestionsSwept): QuestionsSwept => ({
  rewritten: step.rewritten + since.rewritten,
  questionsRemoved: step.questionsRemoved + since.questionsRemoved,
  feedbackRewritten: step.feedbackRewritten + since.feedbackRewritten,
});
