import {
  completeRecord,
  openRecord,
  reserveJudge,
  type AskSteps,
} from "@better-answers/core/answering";
import {
  err,
  ok,
  type Clock,
  type KernelRefusal,
  type PrincipalRefusal,
  type Result,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import type { Credentials, ModelClient } from "@better-answers/core/llm";
import {
  withMember,
  withMemberUnheld,
  type PostgresDoor,
  type Tx,
} from "@better-answers/core/store/postgres";
import type { QuestionTransport } from "@better-answers/schema";

/** What `ask` calls a model through, on whichever transport asked. */
export type ModelDoors = {
  /** Absent where the api holds no envelope key: no model key opens, so no judge is called. */
  readonly credentials: Credentials | undefined;
  readonly models: ModelClient;
};

/** What a road opens its transactions with and calls a model through; `ask` is handed none. */
export type StepDoors = ModelDoors & {
  readonly door: PostgresDoor;
  readonly clock: Clock;
};

/** A step refuses a member who is gone, or whose groups moved since the call resolved them. */
export type StepRefusal = PrincipalRefusal | KernelRefusal<"changed-meanwhile">;

/** Both readings come sorted from the one member query, so they agree place by place or not at all. */
const inTheSameGroups = (resolved: UserPrincipal, readBack: UserPrincipal): boolean =>
  resolved.groups.length === readBack.groups.length &&
  resolved.groups.every((group, place) => group === readBack.groups[place]);

/**
 * Reads the member again through `open`, which refuses a moved role. Moved groups would read
 * under another predicate than the record keeps.
 */
const steppedAs = async <Value, Refused>(
  open: typeof withMember,
  door: PostgresDoor,
  asker: UserPrincipal,
  work: (member: UserPrincipal, tx: Tx) => Promise<Result<Value, Refused>>,
): Promise<Result<Value, Refused | StepRefusal>> => {
  const opened = await open(
    asker,
    door,
    async (member, tx): Promise<Result<Value, Refused | StepRefusal>> =>
      inTheSameGroups(asker, member) ? work(member, tx) : err("changed-meanwhile"),
  );
  return opened.ok ? opened.value : opened;
};

/**
 * Each step opens and settles its own transaction, so none is held between them. Only the read
 * lends its transaction, which opens read-only.
 */
export const stepsFor = (
  { door, clock, credentials, models }: StepDoors,
  asker: UserPrincipal,
  transport: QuestionTransport,
): AskSteps<StepRefusal> => ({
  openRecord: (opening) =>
    steppedAs(withMember, door, asker, (member, tx) =>
      openRecord(member, tx, { ...opening, transport }),
    ),
  read: (work) => steppedAs(withMemberUnheld, door, asker, (_member, tx) => work(tx)),
  reserve: async (reserving) =>
    credentials === undefined
      ? ok(undefined)
      : steppedAs(withMember, door, asker, (member, tx) =>
          reserveJudge(member, tx, credentials, reserving),
        ),
  callModel: models.callModel,
  decide: models.decide,
  completeRecord: (completion) =>
    steppedAs(withMember, door, asker, (member, tx) =>
      completeRecord(member, tx, { ...completion, completedAt: clock.now() }),
    ),
});
