import { z } from "zod";

import { visibilityAgreed, visibilityOf, widens, type Visibility } from "../access/index.ts";
import {
  action,
  declareActions,
  record,
  STORED_DETAIL_KEYS,
  type AuditEvent,
  type AuditAction,
} from "../audit/index.ts";
import { cascadingVisibility } from "../concepts/index.ts";
import {
  admit,
  ADMIN_ALONE,
  attempt,
  attemptResult,
  declareAction,
  err,
  ok,
  ulid,
  type AdminUserPrincipal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { holdsEveryGroup } from "../members/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import {
  adminOnConnectedSource,
  connectedSourceNamed,
  CONNECTED_SOURCE_ID,
  CONNECTED_SOURCE_VISIBILITY,
  type ActingOnConnectedSource,
} from "./admin-connected-source.ts";
import { holdsAnUnreviewedSpecialCategory } from "./review.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export {
  adminOnConnectedSource,
  CONNECTED_SOURCE_ID,
  type ConnectedSourceId,
} from "./admin-connected-source.ts";
export {
  connectUpload,
  connectUploadFields,
  publishConnectedSource,
  publishConnectedSourceInput,
  reprocessConnectedSource,
  reprocessConnectedSourceAction,
  reprocessConnectedSourceInput,
  UPLOAD_BYTE_CAP,
  UPLOAD_MEDIA_TYPES,
  type ConnectUploadFields,
  type ConnectUploadRefusal,
  type ReprocessConnectedSourceInput,
  type ReprocessConnectedSourceRefusal,
} from "./connected-source.ts";
export {
  ORPHANED_UPLOAD_GRACE_HOURS,
  sweepOrphanedUploads,
  UPLOAD_SWEEP,
  type SweepUploadsRefusal,
  type SweptUploads,
} from "./orphans.ts";
export { reindexEveryConnectedSource, REINDEX } from "./reindex.ts";
export { restoreFinding, restoreFindingInput } from "./findings.ts";
export {
  dismissAsNotSpecialCategory,
  dismissAsNotSpecialCategoryInput,
  groupOfFindingsKey,
  findingsOf,
  findingsOfInput,
  keepInText,
  keepInTextInput,
  narrowDocuments,
  narrowDocumentsInput,
} from "./review.ts";
export {
  dpiaInputFor,
  dpiaReadInput,
  NOT_RECORDED,
  PLATFORM_HELD_CATEGORIES,
  REDACTION_CATEGORIES,
  SPECIAL_CATEGORY_CONDITION,
  type DpiaInput,
} from "./dpia.ts";
/** @public C1 */
export type { DpiaReadInput, DpiaInputRead, DpiaInputRefusal } from "./dpia.ts";

export { passageIdOf, parseLocator, spanText, type LocatorRefusal } from "./passage-address.ts";
export {
  findPassages,
  passageAt,
  previewPassages,
  previewPassagesInput,
  type Passage,
  type PassageBound,
  type PassageMatch,
  type PreviewedPassage,
} from "./passages.ts";
export { listConnectedSources } from "./listing.ts";
export { SOURCE_REFUSALS, type SourceRefusal } from "./vocabulary.ts";

const SOURCE_ACTIONS = declareActions("sources", {
  narrowed: action("sources.binding.narrowed", {
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),

  widened: action("sources.binding.widened", {
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    fromSensitivity: "sensitivity",
    fromAudience: "audience",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

/**
 * A narrowing and a widening ask for the same pair; built twice, since one schema exported under
 * two names is a duplicate export.
 */
const theSensitivityAsked = () =>
  CONNECTED_SOURCE_VISIBILITY.extend({
    connectedSourceId: CONNECTED_SOURCE_ID,
    audienceGroups: CONNECTED_SOURCE_VISIBILITY.shape.audienceGroups.default(null),
  }).transform(({ connectedSourceId, ...asked }, ctx) => {
    const visibility = visibilityAgreed(asked, ctx);
    return visibility === undefined ? z.NEVER : { connectedSourceId, visibility };
  });

export const narrowConnectedSourceInput = theSensitivityAsked();

export type NarrowConnectedSourceInput = z.output<typeof narrowConnectedSourceInput>;

export const widenConnectedSourceInput = theSensitivityAsked();

export type WidenConnectedSourceInput = z.output<typeof widenConnectedSourceInput>;

const narrowConnectedSourceAction = declareAction({
  admits: ADMIN_ALONE,
  input: narrowConnectedSourceInput,
  refuses: ["role-forbids", "no-such-binding", "no-such-group", "widening-refused"],
});

export type NarrowConnectedSourceRefusal =
  | SourceRefusal<RefusalOf<typeof narrowConnectedSourceAction>>
  | Error;

const widenConnectedSourceAction = declareAction({
  admits: ADMIN_ALONE,
  input: widenConnectedSourceInput,
  refuses: [
    "role-forbids",
    "no-such-binding",
    "no-such-group",
    "not-wider",
    "special-category-unreviewed",
  ],
});

export type WidenConnectedSourceRefusal =
  | SourceRefusal<RefusalOf<typeof widenConnectedSourceAction>>
  | Error;

type ConnectedSourceSensitivitySet = {
  readonly connectedSourceId: string;
  readonly auditEventId: string;
  readonly visibility: Visibility;

  readonly concepts: readonly string[];

  readonly writeUps: readonly string[];
};

export type ConnectedSourceNarrowed = ConnectedSourceSensitivitySet;

export type ConnectedSourceWidened = ConnectedSourceSensitivitySet;

type ConnectedSourceRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

type SensitivityHeldRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-group">
  | Error;

type SensitivityAsked = {
  readonly acting: ActingOnConnectedSource;
  readonly from: Visibility;
  readonly next: Visibility;
};

type SensitivityChecked<A extends AuditAction, E> = (
  asked: SensitivityAsked,
  tx: Tx,
) => Promise<Result<Pick<AuditEvent<A>, "action" | "detail">, E>>;

/**
 * Inside the cascade's lock, before the connected source's: a narrowing and a widening then queue
 * behind each other rather than deadlock.
 */
const sensitivityAskedOf = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
  next: Visibility,
): Promise<Result<SensitivityAsked, SensitivityHeldRefusal>> => {
  const groups = await attemptResult(() =>
    holdsEveryGroup(acting.admin, tx, next.audienceGroups ?? []),
  );
  if (!groups.ok) return err(groups.error);
  const current = await connectedSourceNamed<ConnectedSourceRow>(acting, tx, {
    columns: "sensitivity, audience, audience_groups",
    lock: "for-update",
  });
  if (!current.ok) return err(current.error);
  if (!groups.value) return err("no-such-group");
  return ok({ acting, from: visibilityOf(current.value), next });
};

const sensitivityWritten = async <A extends AuditAction>(
  acting: ActingOnConnectedSource,
  tx: Tx,
  next: Visibility,
  auditEvent: Pick<AuditEvent<A>, "action" | "detail">,
): Promise<Result<string, Error>> => {
  const { admin, workspaceId, connectedSourceId } = acting;
  const written = await attempt(() =>
    tx.query(
      `UPDATE connected_source SET sensitivity = $3, audience = $4, audience_groups = $5
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, connectedSourceId, next.sensitivity, next.audience, next.audienceGroups],
    ),
  );
  if (!written.ok) return err(written.error);

  const auditEventId = ulid();
  await record(admin, tx, { id: auditEventId, subjectId: connectedSourceId, ...auditEvent });
  return ok(auditEventId);
};

/** `checked` refuses the move, or names the audit event that records it. */
const sensitivitySet = async <A extends AuditAction, E>(
  admin: AdminUserPrincipal,
  tx: Tx,
  input: z.output<ReturnType<typeof theSensitivityAsked>>,
  checked: SensitivityChecked<A, E>,
): Promise<Result<ConnectedSourceSensitivitySet, SensitivityHeldRefusal | E | Error>> => {
  const acting = adminOnConnectedSource(admin, input.connectedSourceId);
  const { connectedSourceId } = acting;
  const next = input.visibility;

  const cascaded = await cascadingVisibility(
    admin,
    tx,
    { connectedSourceId },
    async (tx): Promise<Result<string, SensitivityHeldRefusal | E | Error>> => {
      const asked = await sensitivityAskedOf(acting, tx, next);
      if (!asked.ok) return err(asked.error);
      const auditEvent = await checked(asked.value, tx);
      if (!auditEvent.ok) return err(auditEvent.error);
      return sensitivityWritten(acting, tx, next, auditEvent.value);
    },
  );
  if (!cascaded.ok) return err(cascaded.error);
  const { written: auditEventId, concepts, writeUps } = cascaded.value;
  return ok({ connectedSourceId, auditEventId, visibility: next, concepts, writeUps });
};

const narrowing: SensitivityChecked<
  typeof SOURCE_ACTIONS.narrowed,
  SourceRefusal<"widening-refused">
> = async ({ acting, from, next }) => {
  if (widens(from, next)) return err("widening-refused");
  return ok({
    action: SOURCE_ACTIONS.narrowed,
    detail: {
      [STORED_DETAIL_KEYS.connectedSourceId]: acting.connectedSourceId,
      sensitivity: next.sensitivity,
      audience: next.audience,
    },
  });
};

const widening: SensitivityChecked<
  typeof SOURCE_ACTIONS.widened,
  SourceRefusal<"not-wider" | "special-category-unreviewed"> | Error
> = async ({ acting, from, next }, tx) => {
  if (!widens(from, next) || widens(next, from)) return err("not-wider");

  const unreviewed = await holdsAnUnreviewedSpecialCategory(acting, tx);
  if (!unreviewed.ok) return err(unreviewed.error);
  if (unreviewed.value) return err("special-category-unreviewed");

  return ok({
    action: SOURCE_ACTIONS.widened,
    detail: {
      [STORED_DETAIL_KEYS.connectedSourceId]: acting.connectedSourceId,
      fromSensitivity: from.sensitivity,
      fromAudience: from.audience,
      sensitivity: next.sensitivity,
      audience: next.audience,
    },
  });
};

/**
 * `widening-refused` if the visibility asked is wider in sensitivity or audience, even when it is
 * narrower in the other.
 */
export const narrowConnectedSource = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowConnectedSourceInput,
): Promise<Result<ConnectedSourceNarrowed, NarrowConnectedSourceRefusal>> => {
  const admitted = admit(narrowConnectedSourceAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  return sensitivitySet(admitted.value, tx, input, narrowing);
};

/**
 * `not-wider` unless the visibility asked is wider in sensitivity or audience and narrower in neither.
 * A document's own sensitivity is left alone: the derivation reads the narrower of it and the connected source's.
 */
export const widenConnectedSource = async (
  principal: UserPrincipal,
  tx: Tx,
  input: WidenConnectedSourceInput,
): Promise<Result<ConnectedSourceWidened, WidenConnectedSourceRefusal>> => {
  const admitted = admit(widenConnectedSourceAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  return sensitivitySet(admitted.value, tx, input, widening);
};
