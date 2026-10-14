import { PERSON_PREFIX, type PlatformPrincipal } from "../kernel/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { askersOf } from "./questions.ts";

export type ActorsSwept = {
  readonly commits: number;
  readonly verifications: number;
};

export const NO_ACTORS_SWEPT: ActorsSwept = { commits: 0, verifications: 0 };

const REWRITE_THE_COMMITS = `UPDATE bundle_commit SET actor = $3
   WHERE workspace_id = $1 AND actor = ANY($2)`;

const REWRITE_THE_VERIFICATIONS = `UPDATE concept_verification SET actor = $3
   WHERE workspace_id = $1 AND actor = ANY($2)`;

/**
 * Rewrites the person's actor id on the commit and verification rows to the erasure pseudonym,
 * in this workspace alone and in the caller's transaction. The audit log keeps the person id.
 */
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
  return { commits: commits.rowCount ?? 0, verifications: verifications.rowCount ?? 0 };
};

/** As sweepTheActors, in one transaction of its own. Does nothing where no person is named. */
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
});
