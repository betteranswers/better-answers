import { boundarySchemas, REDACTION_ALWAYS_TIER } from "@better-answers/schema";

import { act, declareActs, record } from "../audit/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  ok,
  requireAdmin,
  ulid,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { SourceRefusal } from "./vocabulary.ts";

const FINDING_ACTS = declareActs("sources", {
  restored: act("sources.finding.restored", { findingId: "id" }),
});

const FINDING_ID = boundarySchemas.finding.select.shape.id;

const RESTORE_REASON = boundarySchemas.finding.insert.shape.restoreReason;

export const raisedByTheLastRun = (finding: string, document: string): string =>
  `${finding}.rule_version || ':' || ${finding}.detector_pin = ${document}.redaction_version`;

export type RestoreFindingInput = {
  readonly findingId: string;

  readonly reason: string;

  readonly batchId?: string | undefined;
};

export type FindingRestoreRefusal =
  | SourceRefusal<"role-forbids" | "malformed" | "no-such-finding" | "not-the-always-set">
  | Error;

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
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const findingId = FINDING_ID.safeParse(input.findingId);
  const reason = RESTORE_REASON.safeParse(input.reason);
  if (!findingId.success || !reason.success || typeof reason.data !== "string") {
    return err("malformed");
  }
  const { workspaceId } = admin.value;

  const known = await attempt(() =>
    tx.query<{ readonly tier: string }>(
      "SELECT tier FROM finding WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
      [workspaceId, findingId.data],
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
      [workspaceId, findingId.data, actorIdOf(admin.value), reason.data],
    ),
  );
  if (!written.ok) return err(written.error);
  const stamped = written.value.rows[0];

  if (stamped === undefined) return err(new Error("the finding was not there to restore"));

  await record(admin.value, tx, {
    id: auditEventId,
    act: FINDING_ACTS.restored,
    subjectId: findingId.data,
    detail: { findingId: findingId.data },
    batchId: input.batchId,
  });
  return ok({ findingId: findingId.data, auditEventId, restoredAt: stamped.restoredAt });
};
