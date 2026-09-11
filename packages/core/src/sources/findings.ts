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
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * The **finding** restore (`CONTEXT.md`; ADR 0020; the S0 spec, *The acts on the ledger*):
 * an Admin lets one span of the **always set** back into a document, with a reason.
 *
 * The always set is policy — no binding switches it off — so the one way a span it withheld
 * ever returns is an Admin saying, span by span, why this one is a business fact: the
 * company's own sort code on the company's own supplier form is the case the rule exists for.
 * The act writes the instant, the Admin and the reason on the finding; the reprocess that
 * puts the span back into the text is S1's, keyed on this row.
 *
 * **The reason lands on the row and never on the ledger** (`[AUDIT5]`). It is free text an
 * Admin typed and could name a person; the detail carries the finding's id alone, so the
 * ledger stays a table an erasure never rewrites.
 */

/**
 * The restore act. Its subject is the finding and its detail the finding's id: a reader who
 * wants the reason opens the row the act wrote it on.
 */
const FINDING_ACTS = declareActs("sources", {
  restored: act("sources.finding.restored", { findingId: "id" }),
});

const FINDING_ID = boundarySchemas.finding.select.shape.id;

/**
 * The reason's own bound, read off the column rather than written a second time here (ADR
 * 0028): how long a reason may be is the boundary's to say, and the refinement trims, so a
 * reason of whitespace is the empty string the bound refuses. The column is nullable, because
 * a finding nobody restored carries no reason — so the schema admits an absence this act never
 * has, and the act takes a string back from it or refuses.
 */
const RESTORE_REASON = boundarySchemas.finding.insert.shape.restoreReason;

export type RestoreFindingInput = {
  readonly findingId: string;
  /** Why this span is a business fact — a sentence an Admin typed, never a fixed word. */
  readonly reason: string;
};

/**
 * Why a restore was refused. `not-the-always-set` is the one this act exists to say: the two
 * default tiers are switched at the binding rather than span by span, so restoring one of
 * their findings would be an Admin reaching past the binding's own rules in force.
 */
export type FindingRestoreRefusal =
  | RoleRefusal
  | "malformed"
  | "no-such-finding"
  | "not-the-always-set"
  | Error;

export type FindingRestored = {
  readonly findingId: string;
  readonly auditEventId: string;
  /** The instant the database stamped on the row, read back with it (ADR 0040). */
  readonly restoredAt: Date;
};

/**
 * Restore one always-set span, and record the act, in one transaction (`[AUDIT1]`).
 *
 * Every refusal is decided before a row is written: the role, the shape of the id and the
 * reason, the finding's existence, and — against the row as it stands — its tier. The row is
 * rewritten, and the ledger row is written after it and **bare**, so its rejection aborts the
 * transaction the restore landed in (ADR 0014 rule 4).
 *
 * **The always-set check reads the row's `tier` and never its category.** The officer-block
 * post-pass raises a `person-name` — a default-off category — at the always tier, and that
 * span is exactly the one an Admin restores; an act that read the category would refuse it.
 * Which categories exist is the `redaction` agreement's and nothing imports it (ADR 0031),
 * which is the second reason the tier is what this reads.
 *
 * The instant is the database's `now()` and not a clock this act was handed, because it is a
 * row's own timestamp (ADR 0040); the actor is the kernel's one derivation from the Principal
 * (`[AUDIT3]`), so no slice composes `human:<id>` by hand. A second restore by an Admin is
 * allowed and writes its own ledger row: correcting a reason is itself an act, and the ledger
 * keeps both (`[AUDIT3]`, the ledger is never rewritten).
 *
 * The row is read `FOR UPDATE`, so two Admins restoring the same span queue rather than each
 * reading a tier the other is about to leave behind.
 */
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
  // The row was locked a statement ago, so the update reached it. The store's answer is read
  // rather than assumed all the same: a statement that wrote nothing is the store failing,
  // and a caller reads that rather than an instant nobody stamped.
  if (stamped === undefined) return err(new Error("the finding was not there to restore"));

  // Bare, after the row: the door's rejection aborts the transaction the row landed in.
  await record(admin.value, tx, {
    id: auditEventId,
    act: FINDING_ACTS.restored,
    subjectId: findingId.data,
    detail: { findingId: findingId.data },
  });
  return ok({ findingId: findingId.data, auditEventId, restoredAt: stamped.restoredAt });
};
