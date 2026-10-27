import { PERSON_PREFIX, type PlatformPrincipal } from "../../kernel/index.ts";
import type { Needles } from "../../store/git/index.ts";
import { withScope, type PostgresDoor, type Tx } from "../../store/postgres/index.ts";
import type { ErasureFamily } from "../map.ts";
import { askersOf } from "./questions.ts";

export type ActorSweepSubject = {
  readonly workspaceId: string;
  readonly needles: Needles;
  readonly pseudonym: string;
};

type Counts = Readonly<Record<string, number>>;

type ActorSweep = {
  readonly family: ErasureFamily;
  readonly statement: string;
  readonly parameters: (subject: ActorSweepSubject) => readonly unknown[];
};

const counted = (update: string): string =>
  `WITH rewritten AS (${update} RETURNING 1) SELECT count(*)::int AS "actorsRewritten" FROM rewritten`;

const byActorId = (subject: ActorSweepSubject): readonly unknown[] => [
  subject.workspaceId,
  askersOf(subject.needles.people),
  `${PERSON_PREFIX}${subject.pseudonym}`,
];

const byPersonId = (subject: ActorSweepSubject): readonly unknown[] => [
  subject.workspaceId,
  subject.needles.people,
  subject.pseudonym,
];

const ACTOR_SWEEPS = [
  {
    family: "bundle-commit",
    statement: counted(
      "UPDATE bundle_commit SET actor = $3 WHERE workspace_id = $1 AND actor = ANY($2)",
    ),
    parameters: byActorId,
  },
  {
    family: "concept-verification",
    statement: counted(
      "UPDATE concept_verification SET actor = $3 WHERE workspace_id = $1 AND actor = ANY($2)",
    ),
    parameters: byActorId,
  },
  {
    family: "concept-sensitivity-override",
    statement: counted(
      "UPDATE concept_sensitivity_override SET actor = $3 WHERE workspace_id = $1 AND actor = ANY($2)",
    ),
    parameters: byActorId,
  },
  {
    family: "finding",
    statement: counted(`UPDATE finding
       SET reviewed_by = CASE WHEN reviewed_by = ANY($2) THEN $3 ELSE reviewed_by END,
           review_reason = CASE WHEN reviewed_by = ANY($2) THEN NULL ELSE review_reason END,
           restored_by = CASE WHEN restored_by = ANY($2) THEN $3 ELSE restored_by END,
           restore_reason = CASE WHEN restored_by = ANY($2) THEN '' ELSE restore_reason END
     WHERE workspace_id = $1 AND (reviewed_by = ANY($2) OR restored_by = ANY($2))`),
    parameters: byActorId,
  },
  {
    family: "suggestion",
    statement: `SELECT erase_from_the_suggestions($1, $2, $3) AS "actorsRewritten"`,
    parameters: byPersonId,
  },
  {
    family: "concept-write-request",
    statement: `SELECT rewritten AS "actorsRewritten", bodies_replaced AS "bodiesReplaced"
                  FROM erase_from_the_write_requests($1, $2, $3, $4)`,
    parameters: (subject) => [
      subject.workspaceId,
      subject.needles.people,
      subject.needles.addresses,
      subject.pseudonym,
    ],
  },
  {
    family: "write-up-version",
    statement: `SELECT pseudonymise_record_actors($1, 'write_up_version', $2, $3) AS "actorsRewritten"`,
    parameters: byPersonId,
  },
  {
    family: "guide-definition-version",
    statement: `SELECT pseudonymise_record_actors($1, 'guide_definition_version', $2, $3) AS "actorsRewritten"`,
    parameters: byPersonId,
  },
  {
    family: "usage",
    statement: counted("UPDATE usage SET actor = $3 WHERE workspace_id = $1 AND actor = ANY($2)"),
    parameters: byActorId,
  },
] as const satisfies readonly ActorSweep[];

type ActorFamily = (typeof ACTOR_SWEEPS)[number]["family"];

export type ActorsSwept = ReadonlyMap<ActorFamily, Counts>;

export const NO_ACTORS_SWEPT: ActorsSwept = new Map();

const sweptBy = async (tx: Tx, sweep: ActorSweep, subject: ActorSweepSubject): Promise<Counts> => {
  const answered = await tx.query<Counts>(sweep.statement, [...sweep.parameters(subject)]);
  const [counts] = answered.rows;
  if (counts === undefined) throw new Error(`erasure: the ${sweep.family} sweep answered no row`);
  return counts;
};

export const sweepTheActors = async (tx: Tx, subject: ActorSweepSubject): Promise<ActorsSwept> => {
  const swept = new Map<ActorFamily, Counts>();
  // oxlint-disable-next-line eslint/no-await-in-loop -- every actor sweep runs on the erasure's transaction
  for (const sweep of ACTOR_SWEEPS) swept.set(sweep.family, await sweptBy(tx, sweep, subject));
  return swept;
};

export const eraseFromTheActors = (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  subject: ActorSweepSubject,
): Promise<ActorsSwept> =>
  withScope(platform, door, subject.workspaceId, (tx) => sweepTheActors(tx, subject));

const summed = (left: Counts, right: Counts): Counts => {
  const total = new Map(Object.entries(left));
  for (const [label, count] of Object.entries(right))
    total.set(label, (total.get(label) ?? 0) + count);
  return Object.fromEntries(total);
};

export const inEverySweep = (...sweeps: readonly ActorsSwept[]): ActorsSwept => {
  const total = new Map<ActorFamily, Counts>();
  for (const sweep of sweeps) {
    for (const [family, counts] of sweep)
      total.set(family, summed(total.get(family) ?? {}, counts));
  }
  return total;
};
