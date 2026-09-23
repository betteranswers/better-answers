import { boundarySchemas } from "@better-answers/schema";
import { z } from "zod";

import { visibilityAgreed, visibilityOf, widens, type Visibility } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import { attempt, err, ok, ulid, type Result, type UserPrincipal } from "../kernel/index.ts";
import { openingACascadeOverHeldGroups } from "../concepts/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { adminOnBinding, bindingNamed, BINDING_ID } from "./admin-binding.ts";
import { cascadeOverEvidence } from "./cascade.ts";
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
  UPLOAD_ORIGINALS_PREFIX,
  type BindingPublished,
  type BindingReprocessed,
  type BindUploadFields,
  type BindUploadInput,
  type BindUploadRefusal,
  type PublishBindingInput,
  type PublishBindingRefusal,
  type ReprocessBindingInput,
  type ReprocessBindingRefusal,
  type UploadBound,
} from "./binding.ts";
export {
  ORPHANED_UPLOAD_GRACE_HOURS,
  sweepOrphanedUploads,
  UPLOAD_SWEEP,
  type SweepUploadsInput,
  type SweepUploadsRefusal,
  type SweptUploads,
  type UploadSweepPrincipal,
} from "./orphans.ts";
export {
  restoreFinding,
  restoreFindingInput,
  type FindingRestored,
  type FindingRestoreRefusal,
  type RestoreFindingInput,
} from "./findings.ts";
export {
  findingGroupKey,
  findingsOf,
  findingsOfInput,
  keepInText,
  keepInTextInput,
  narrowDocuments,
  narrowDocumentsInput,
  type DocumentsNarrowed,
  type FindingGroup,
  type FindingGroupKey,
  type FindingsOfInput,
  type FindingsOfRefusal,
  type KeepInTextInput,
  type KeepInTextRefusal,
  type KeptInText,
  type NarrowDocumentsInput,
  type NarrowDocumentsRefusal,
} from "./review.ts";
export {
  dpiaInputFor,
  dpiaReadInput,
  NOT_RECORDED,
  PLATFORM_HELD_CATEGORIES,
  REDACTION_CATEGORIES,
  SPECIAL_CATEGORY_CONDITION,
  type DpiaInput,
  type DpiaReadInput,
  type DpiaInputRead,
  type DpiaInputRefusal,
  type DpiaRoute,
  type RedactionCategory,
} from "./dpia.ts";

export {
  chunkIdOf,
  parseLocator,
  spanText,
  type Locator,
  type LocatorRefusal,
} from "./chunk-address.ts";
export {
  findPassages,
  MAX_PASSAGE_HITS,
  passageAt,
  previewChunks,
  previewChunksInput,
  type Passage,
  type PassageHit,
  type PreviewChunksInput,
  type PreviewedChunk,
} from "./passages.ts";
export { SOURCE_REFUSALS, type SourceRefusal } from "./vocabulary.ts";

const SOURCE_ACTS = declareActs("sources", {
  narrowed: act("sources.binding.narrowed", {
    bindingId: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
});

const BINDING_VISIBILITY = boundarySchemas.sourceBinding.select.pick({
  sensitivity: true,
  audience: true,
  audienceGroups: true,
});

export const narrowBindingInput = BINDING_VISIBILITY.extend({
  bindingId: BINDING_ID,
  audienceGroups: BINDING_VISIBILITY.shape.audienceGroups.default(null),
}).transform(({ bindingId, ...asked }, ctx) => {
  const visibility = visibilityAgreed(asked, ctx);
  return visibility === undefined ? z.NEVER : { bindingId, visibility };
});

export type NarrowBindingInput = z.output<typeof narrowBindingInput>;

export type NarrowBindingRefusal =
  | SourceRefusal<"role-forbids" | "no-such-binding" | "no-such-group" | "widening-refused">
  | Error;

export type BindingNarrowed = {
  readonly bindingId: string;
  readonly auditEventId: string;
  readonly visibility: Visibility;

  readonly concepts: readonly string[];

  readonly compositions: readonly string[];
};

type BindingRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

export const narrowBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowBindingInput,
): Promise<Result<BindingNarrowed, NarrowBindingRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, workspaceId, bindingId } = acting.value;

  const next = input.visibility;

  const groups = await openingACascadeOverHeldGroups(admin, tx, next.audienceGroups ?? []);
  if (!groups.ok) return err(groups.error);
  const current = await bindingNamed<BindingRow>(acting.value, tx, {
    columns: "sensitivity, audience, audience_groups",
    lock: "for-update",
  });
  if (!current.ok) return err(current.error);
  if (!groups.value) return err("no-such-group");
  if (widens(visibilityOf(current.value), next)) return err("widening-refused");

  const auditEventId = ulid();
  const narrowed = await attempt(() =>
    tx.query(
      `UPDATE source_binding SET sensitivity = $3, audience = $4, audience_groups = $5
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, bindingId, next.sensitivity, next.audience, next.audienceGroups],
    ),
  );
  if (!narrowed.ok) return err(narrowed.error);

  await record(admin, tx, {
    id: auditEventId,
    act: SOURCE_ACTS.narrowed,
    subjectId: bindingId,
    detail: { bindingId, sensitivity: next.sensitivity, audience: next.audience },
  });
  const cascaded = await attempt(() => cascadeOverEvidence(admin, tx, { bindingId }));
  if (!cascaded.ok) return err(cascaded.error);
  return ok({ bindingId, auditEventId, visibility: next, ...cascaded.value });
};
