import { boundarySchemas } from "@better-answers/schema";
import { z } from "zod";

import { visibilityAgreed, visibilityOf, widens, type Visibility } from "../access/index.ts";
import { act, declareActs, record, type AuditEvent, type LedgerAct } from "../audit/index.ts";
import { attempt, err, ok, ulid, type Result, type UserPrincipal } from "../kernel/index.ts";
import { openingACascadeOverHeldGroups } from "../concepts/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { adminOnBinding, bindingNamed, BINDING_ID, type ActingOnBinding } from "./admin-binding.ts";
import { cascadeOverEvidence } from "./cascade.ts";
import { holdsAnUnreviewedSpecialCategory } from "./review.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export { adminOnBinding, BINDING_ID, type BindingId } from "./admin-binding.ts";
export {
  bindUpload,
  bindUploadFields,
  publishBinding,
  publishBindingInput,
  reprocessBinding,
  reprocessBindingAct,
  reprocessBindingInput,
  UPLOAD_BYTE_CAP,
  UPLOAD_MEDIA_TYPES,
  type BindUploadFields,
  type BindUploadRefusal,
  type ReprocessBindingInput,
  type ReprocessBindingRefusal,
} from "./binding.ts";
export {
  ORPHANED_UPLOAD_GRACE_HOURS,
  sweepOrphanedUploads,
  UPLOAD_SWEEP,
  type SweepUploadsRefusal,
  type SweptUploads,
} from "./orphans.ts";
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

export { chunkIdOf, parseLocator, spanText, type LocatorRefusal } from "./chunk-address.ts";
export {
  findPassages,
  passageAt,
  previewChunks,
  previewChunksInput,
  type Passage,
  type PassageHit,
  type PreviewedChunk,
} from "./passages.ts";
export { listBindings } from "./listing.ts";
export { SOURCE_REFUSALS, type SourceRefusal } from "./vocabulary.ts";

const SOURCE_ACTS = declareActs("sources", {
  narrowed: act("sources.binding.narrowed", {
    bindingId: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),

  widened: act("sources.binding.widened", {
    bindingId: "id",
    fromSensitivity: "sensitivity",
    fromAudience: "audience",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

const BINDING_VISIBILITY = boundarySchemas.sourceBinding.select.pick({
  sensitivity: true,
  audience: true,
  audienceGroups: true,
});

// A narrowing and a widening ask for the same pair; built twice, since one schema exported under
// two names is a duplicate export.
const theClassAsked = () =>
  BINDING_VISIBILITY.extend({
    bindingId: BINDING_ID,
    audienceGroups: BINDING_VISIBILITY.shape.audienceGroups.default(null),
  }).transform(({ bindingId, ...asked }, ctx) => {
    const visibility = visibilityAgreed(asked, ctx);
    return visibility === undefined ? z.NEVER : { bindingId, visibility };
  });

export const narrowBindingInput = theClassAsked();

export type NarrowBindingInput = z.output<typeof narrowBindingInput>;

export const widenBindingInput = theClassAsked();

export type WidenBindingInput = z.output<typeof widenBindingInput>;

export type NarrowBindingRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-group" | "widening-refused">
  | Error;

export type WidenBindingRefusal =
  | SourceRefusal<
      | "role-forbids"
      | "no-such-binding"
      | "no-such-group"
      | "not-wider"
      | "special-category-unreviewed"
    >
  | Error;

type BindingClassSet = {
  readonly bindingId: string;
  readonly auditEventId: string;
  readonly visibility: Visibility;

  readonly concepts: readonly string[];

  readonly compositions: readonly string[];
};

export type BindingNarrowed = BindingClassSet;

export type BindingWidened = BindingClassSet;

type BindingRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

type ClassHeldRefusal = SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-group"> | Error;

type ClassAsked = {
  readonly acting: ActingOnBinding;
  readonly from: Visibility;
  readonly next: Visibility;
};

// A narrowing and a widening both open the cascade before they lock the binding, so the two queue
// behind each other rather than deadlock.
const classAskedOf = async (
  principal: UserPrincipal,
  tx: Tx,
  input: z.output<ReturnType<typeof theClassAsked>>,
): Promise<Result<ClassAsked, ClassHeldRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const next = input.visibility;

  const groups = await openingACascadeOverHeldGroups(
    acting.value.admin,
    tx,
    next.audienceGroups ?? [],
  );
  if (!groups.ok) return err(groups.error);
  const current = await bindingNamed<BindingRow>(acting.value, tx, {
    columns: "sensitivity, audience, audience_groups",
    lock: "for-update",
  });
  if (!current.ok) return err(current.error);
  if (!groups.value) return err("no-such-group");
  return ok({ acting: acting.value, from: visibilityOf(current.value), next });
};

const classSet = async <A extends LedgerAct>(
  acting: ActingOnBinding,
  tx: Tx,
  next: Visibility,
  ledger: Pick<AuditEvent<A>, "act" | "detail">,
): Promise<Result<BindingClassSet, Error>> => {
  const { admin, workspaceId, bindingId } = acting;
  const written = await attempt(() =>
    tx.query(
      `UPDATE source_binding SET sensitivity = $3, audience = $4, audience_groups = $5
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, bindingId, next.sensitivity, next.audience, next.audienceGroups],
    ),
  );
  if (!written.ok) return err(written.error);

  const auditEventId = ulid();
  await record(admin, tx, { id: auditEventId, subjectId: bindingId, ...ledger });
  const cascaded = await attempt(() => cascadeOverEvidence(admin, tx, { bindingId }));
  if (!cascaded.ok) return err(cascaded.error);
  return ok({ bindingId, auditEventId, visibility: next, ...cascaded.value });
};

export const narrowBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowBindingInput,
): Promise<Result<BindingNarrowed, NarrowBindingRefusal>> => {
  const asked = await classAskedOf(principal, tx, input);
  if (!asked.ok) return err(asked.error);
  const { acting, from, next } = asked.value;
  if (widens(from, next)) return err("widening-refused");

  return classSet(acting, tx, next, {
    act: SOURCE_ACTS.narrowed,
    detail: {
      bindingId: acting.bindingId,
      sensitivity: next.sensitivity,
      audience: next.audience,
    },
  });
};

// A document's own class is left alone: the derivation reads the narrower of it and the binding's.
export const widenBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: WidenBindingInput,
): Promise<Result<BindingWidened, WidenBindingRefusal>> => {
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
      bindingId: acting.bindingId,
      fromSensitivity: from.sensitivity,
      fromAudience: from.audience,
      sensitivity: next.sensitivity,
      audience: next.audience,
    },
  });
};
