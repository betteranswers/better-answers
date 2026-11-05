import { z } from "zod";

import { boundarySchemas, type USAGE_ACTS } from "@better-answers/schema";

import {
  actorIdOf,
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  ulid,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

const RECORDED_ACTS = [
  "copied",
  "exported",
] as const satisfies readonly (typeof USAGE_ACTS)[number][];

const recordUsageInput = z.strictObject({
  subject: z.strictObject({
    writeUpId: boundarySchemas.writeUp.select.shape.id,
    version: boundarySchemas.writeUpVersion.select.shape.version,
  }),
  act: z.enum(RECORDED_ACTS),
});

export type RecordUsageInput = z.input<typeof recordUsageInput>;

const recordUsageAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<RecordUsageInput>(),
  refuses: ["role-forbids"],
});

export type UsageRefusal = RefusalOf<typeof recordUsageAction> | Error;

const ITS_USAGE = `INSERT INTO usage (workspace_id, id, actor, act, write_up_id, write_up_version)
  VALUES ($1, $2, $3, $4, $5, $6)`;

export const recordUsage = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RecordUsageInput,
): Promise<Result<{ readonly id: string }, UsageRefusal>> => {
  const admitted = admit(recordUsageAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const taker = admitted.value;
  const id = ulid();
  const stored = await attempt(() =>
    tx.query(ITS_USAGE, [
      taker.workspaceId,
      id,
      actorIdOf(taker),
      input.act,
      input.subject.writeUpId,
      input.subject.version,
    ]),
  );
  return stored.ok ? ok({ id }) : err(stored.error);
};
