import { z } from "zod";

import { boundarySchemas, REDACTION_ALWAYS_TIER } from "@better-answers/schema";

import { action, declareActions, record } from "../audit/index.ts";
import {
  actorIdOf,
  admit,
  ADMIN_ALONE,
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
import type { SourceRefusal } from "./vocabulary.ts";

const FINDING_ACTIONS = declareActions("sources", {
  restored: action("sources.finding.restored", { findingId: "id" }),
});

const FINDING_ID = boundarySchemas.finding.select.shape.id;

export const RESTORE_REASON = boundarySchemas.finding.select.shape.restoreReason.unwrap();

/** A SQL predicate on the two aliases: the finding belongs to its document's current redaction. */
export const raisedByTheLastSync = (finding: string, document: string): string =>
  `${finding}.rule_version || ':' || ${finding}.detector_pin = ${document}.redaction_version`;

export const restoreFindingInput = z.object({
  findingId: FINDING_ID,

  reason: RESTORE_REASON,

  batchId: boundarySchemas.auditEvent.select.shape.batchId.unwrap().optional(),
});

export type RestoreFindingInput = z.output<typeof restoreFindingInput>;

const restoreFindingAction = declareAction({
  admits: ADMIN_ALONE,
  input: restoreFindingInput,
  refuses: ["role-forbids", "no-such-finding", "not-the-always-set"],
});

export type FindingRestoreRefusal = SourceRefusal<RefusalOf<typeof restoreFindingAction>> | Error;

export type FindingRestored = {
  readonly findingId: string;
  readonly auditEventId: string;

  readonly restoredAt: Date;
};

export const restoreFinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RestoreFindingInput,
): Promise<Result<FindingRestored, FindingRestoreRefusal>> => {
  const admin = admit(restoreFindingAction, principal, input);
  if (!admin.ok) return err(admin.error);
  const { findingId, reason } = input;
  const { workspaceId } = admin.value;

  const known = await attempt(() =>
    tx.query<{ readonly tier: string }>(
      "SELECT tier FROM finding WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
      [workspaceId, findingId],
    ),
  );
  if (!known.ok) return err(known.error);
  const current = known.value.rows[0];
  if (current === undefined) return err("no-such-finding");
  if (current.tier !== REDACTION_ALWAYS_TIER) return err("not-the-always-set");

  const auditEventId = ulid();
  const written = await attempt(() =>
    tx.query<{ readonly restoredAt: Date }>(
      `UPDATE finding SET restored_at = now(), restored_by = $3, restore_reason = $4
        WHERE workspace_id = $1 AND id = $2
        RETURNING restored_at AS "restoredAt"`,
      [workspaceId, findingId, actorIdOf(admin.value), reason],
    ),
  );
  if (!written.ok) return err(written.error);
  const stamped = written.value.rows[0];

  if (stamped === undefined) return err(new Error("the finding was not there to restore"));

  await record(admin.value, tx, {
    id: auditEventId,
    action: FINDING_ACTIONS.restored,
    subjectId: findingId,
    detail: { findingId },
    batchId: input.batchId,
  });
  return ok({ findingId, auditEventId, restoredAt: stamped.restoredAt });
};
