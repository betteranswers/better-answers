import { z } from "zod";

import { visibilityAgreed, visibilityOf, widens, type Visibility } from "../access/index.ts";
import {
  act,
  declareActs,
  record,
  STORED_DETAIL_KEYS,
  type AuditEvent,
  type AuditAct,
} from "../audit/index.ts";
import { openingACascadeOverHeldGroups } from "../concepts/index.ts";
import { attempt, err, ok, ulid, type Result, type UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import {
  adminOnConnectedSource,
  connectedSourceNamed,
  CONNECTED_SOURCE_ID,
  CONNECTED_SOURCE_VISIBILITY,
  type ActingOnConnectedSource,
} from "./admin-connected-source.ts";
import { cascadeOverEvidence } from "./cascade.ts";
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
  reprocessConnectedSourceAct,
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
  findingGroupKey,
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
  type PassageHit,
  type PreviewedPassage,
} from "./passages.ts";
export { listConnectedSources } from "./listing.ts";
export { SOURCE_REFUSALS, type SourceRefusal } from "./vocabulary.ts";

const SOURCE_ACTS = declareActs("sources", {
  narrowed: act("sources.binding.narrowed", {
    [STORED_DETAIL_KEYS.connectedSourceId]: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),

  widened: act("sources.binding.widened", {
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
const theClassAsked = () =>
  CONNECTED_SOURCE_VISIBILITY.extend({
    connectedSourceId: CONNECTED_SOURCE_ID,
    audienceGroups: CONNECTED_SOURCE_VISIBILITY.shape.audienceGroups.default(null),
  }).transform(({ connectedSourceId, ...asked }, ctx) => {
    const visibility = visibilityAgreed(asked, ctx);
    return visibility === undefined ? z.NEVER : { connectedSourceId, visibility };
  });

export const narrowConnectedSourceInput = theClassAsked();

export type NarrowConnectedSourceInput = z.output<typeof narrowConnectedSourceInput>;

export const widenConnectedSourceInput = theClassAsked();

export type WidenConnectedSourceInput = z.output<typeof widenConnectedSourceInput>;

export type NarrowConnectedSourceRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-group" | "widening-refused">
  | Error;

export type WidenConnectedSourceRefusal =
  | SourceRefusal<
      | "role-forbids"
      | "no-such-binding"
      | "no-such-group"
      | "not-wider"
      | "special-category-unreviewed"
    >
  | Error;

type ConnectedSourceClassSet = {
  readonly connectedSourceId: string;
  readonly auditEventId: string;
  readonly visibility: Visibility;

  readonly concepts: readonly string[];

  readonly compositions: readonly string[];
};

export type ConnectedSourceNarrowed = ConnectedSourceClassSet;

export type ConnectedSourceWidened = ConnectedSourceClassSet;

type ConnectedSourceRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

type ClassHeldRefusal = SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-group"> | Error;

type ClassAsked = {
  readonly acting: ActingOnConnectedSource;
  readonly from: Visibility;
  readonly next: Visibility;
};

/**
 * A narrowing and a widening both open the cascade before they lock the connected source, so the two queue
 * behind each other rather than deadlock.
 */
const classAskedOf = async (
  principal: UserPrincipal,
  tx: Tx,
  input: z.output<ReturnType<typeof theClassAsked>>,
): Promise<Result<ClassAsked, ClassHeldRefusal>> => {
  const acting = adminOnConnectedSource(principal, input.connectedSourceId);
  if (!acting.ok) return err(acting.error);
  const next = input.visibility;

  const groups = await openingACascadeOverHeldGroups(
    acting.value.admin,
    tx,
    next.audienceGroups ?? [],
  );
  if (!groups.ok) return err(groups.error);
  const current = await connectedSourceNamed<ConnectedSourceRow>(acting.value, tx, {
    columns: "sensitivity, audience, audience_groups",
    lock: "for-update",
  });
  if (!current.ok) return err(current.error);
  if (!groups.value) return err("no-such-group");
  return ok({ acting: acting.value, from: visibilityOf(current.value), next });
};

const classSet = async <A extends AuditAct>(
  acting: ActingOnConnectedSource,
  tx: Tx,
  next: Visibility,
  auditEvent: Pick<AuditEvent<A>, "act" | "detail">,
): Promise<Result<ConnectedSourceClassSet, Error>> => {
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
  const cascaded = await attempt(() => cascadeOverEvidence(admin, tx, { connectedSourceId }));
  if (!cascaded.ok) return err(cascaded.error);
  return ok({ connectedSourceId, auditEventId, visibility: next, ...cascaded.value });
};

/**
 * `widening-refused` if the class asked is wider in sensitivity or audience, even when it is
 * narrower in the other.
 */
export const narrowConnectedSource = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowConnectedSourceInput,
): Promise<Result<ConnectedSourceNarrowed, NarrowConnectedSourceRefusal>> => {
  const asked = await classAskedOf(principal, tx, input);
  if (!asked.ok) return err(asked.error);
  const { acting, from, next } = asked.value;
  if (widens(from, next)) return err("widening-refused");

  return classSet(acting, tx, next, {
    act: SOURCE_ACTS.narrowed,
    detail: {
      [STORED_DETAIL_KEYS.connectedSourceId]: acting.connectedSourceId,
      sensitivity: next.sensitivity,
      audience: next.audience,
    },
  });
};

/**
 * `not-wider` unless the class asked is wider in sensitivity or audience and narrower in neither.
 * A document's own class is left alone: the derivation reads the narrower of it and the connected source's.
 */
export const widenConnectedSource = async (
  principal: UserPrincipal,
  tx: Tx,
  input: WidenConnectedSourceInput,
): Promise<Result<ConnectedSourceWidened, WidenConnectedSourceRefusal>> => {
  const asked = await classAskedOf(principal, tx, input);
  if (!asked.ok) return err(asked.error);
  const { acting, from, next } = asked.value;
  if (!widens(from, next) || widens(next, from)) return err("not-wider");

  const unreviewed = await holdsAnUnreviewedSpecialCategory(acting, tx);
  if (!unreviewed.ok) return err(unreviewed.error);
  if (unreviewed.value) return err("special-category-unreviewed");

  return classSet(acting, tx, next, {
    act: SOURCE_ACTS.widened,
    detail: {
      [STORED_DETAIL_KEYS.connectedSourceId]: acting.connectedSourceId,
      fromSensitivity: from.sensitivity,
      fromAudience: from.audience,
      sensitivity: next.sensitivity,
      audience: next.audience,
    },
  });
};
