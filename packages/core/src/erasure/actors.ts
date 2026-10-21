import { PERSON_PREFIX, type PlatformPrincipal } from "../kernel/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { askersOf } from "./questions.ts";

export type ActorsSwept = {
  readonly commits: number;
  readonly verifications: number;
  readonly overrides: number;
  readonly findings: number;
};

export const NO_ACTORS_SWEPT: ActorsSwept = {
  commits: 0,
  verifications: 0,
  overrides: 0,
  findings: 0,
};

const REWRITE_THE_COMMITS = `UPDATE bundle_commit SET actor = $3
   WHERE workspace_id = $1 AND actor = ANY($2)`;

const REWRITE_THE_VERIFICATIONS = `UPDATE concept_verification SET actor = $3
   WHERE workspace_id = $1 AND actor = ANY($2)`;

const REWRITE_THE_OVERRIDES = `UPDATE concept_sensitivity_override SET actor = $3
   WHERE workspace_id = $1 AND actor = ANY($2)`;

const REWRITE_THE_FINDINGS = `UPDATE finding
     SET reviewed_by = CASE WHEN reviewed_by = ANY($2) THEN $3 ELSE reviewed_by END,
         review_reason = CASE WHEN reviewed_by = ANY($2) THEN NULL ELSE review_reason END,
         restored_by = CASE WHEN restored_by = ANY($2) THEN $3 ELSE restored_by END,
         restore_reason = CASE WHEN restored_by = ANY($2) THEN '' ELSE restore_reason END
   WHERE workspace_id = $1 AND (reviewed_by = ANY($2) OR restored_by = ANY($2))`;

export const sweepTheActors = async (
  tx: Tx,
  subject: {
    readonly workspaceId: string;
    readonly actors: readonly string[];
    readonly pseudonym: string;
  },
): Promise<ActorsSwept> => {
  const parameters = [subject.workspaceId, subject.actors, `${PERSON_PREFIX}${subject.pseudonym}`];
  const commits = await tx.query(REWRITE_THE_COMMITS, parameters);
  const verifications = await tx.query(REWRITE_THE_VERIFICATIONS, parameters);
  const overrides = await tx.query(REWRITE_THE_OVERRIDES, parameters);
  const findings = await tx.query(REWRITE_THE_FINDINGS, parameters);
  return {
    commits: commits.rowCount ?? 0,
    verifications: verifications.rowCount ?? 0,
    overrides: overrides.rowCount ?? 0,
    findings: findings.rowCount ?? 0,
  };
};

export const eraseFromTheActors = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  subject: {
    readonly workspaceId: string;
    readonly personIds: readonly (string | null)[];
    readonly pseudonym: string;
  },
): Promise<ActorsSwept> => {
  const actors = askersOf(subject.personIds);
  if (actors.length === 0) return NO_ACTORS_SWEPT;

  return withScope(platform, door, subject.workspaceId, (tx) =>
    sweepTheActors(tx, { workspaceId: subject.workspaceId, actors, pseudonym: subject.pseudonym }),
  );
};

export const inEverySweep = (...sweeps: readonly ActorsSwept[]): ActorsSwept => ({
  commits: sweeps.reduce((total, sweep) => total + sweep.commits, 0),
  verifications: sweeps.reduce((total, sweep) => total + sweep.verifications, 0),
  overrides: sweeps.reduce((total, sweep) => total + sweep.overrides, 0),
  findings: sweeps.reduce((total, sweep) => total + sweep.findings, 0),
});
