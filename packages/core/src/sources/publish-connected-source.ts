import { z } from "zod";

import {
  CONNECTED_SOURCE_PUBLISHED_STATE,
  INDEX_KIND,
  JOB_DONE_STATUS,
} from "@better-answers/schema";

import { record, STORED_DETAIL_KEYS, type DetailOf } from "../audit/index.ts";
import { cascadingVisibility } from "../concepts/index.ts";
import {
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
import {
  adminOnConnectedSource,
  connectedSourceNamed,
  CONNECTED_SOURCE_ID,
  type ActingOnConnectedSource,
} from "./admin-connected-source.ts";
import {
  CONNECTED_SOURCE_ACTIONS,
  type RedactionCategoryWord,
  type FindingCounts,
} from "./connected-source.ts";
import { dpiaInputFor } from "./dpia.ts";
import { raisedByTheLastSync } from "./findings.ts";
import type { SourceRefusal } from "./vocabulary.ts";

const CONFIRMATIONS = [
  "lawfulBasisRecorded",
  "privacyInformationUpdated",
  "dpiaReferenced",
] as const;

const countOf = (found: ReadonlyMap<string, number>, category: RedactionCategoryWord): number =>
  found.get(category) ?? 0;

const countsOf = (found: ReadonlyMap<string, number>): FindingCounts => ({
  findingsSpecialCategory: countOf(found, "special-category"),
  findingsBankDetails: countOf(found, "bank-details"),
  findingsGovernmentIdentifier: countOf(found, "government-identifier"),
  findingsDateOfBirth: countOf(found, "date-of-birth"),
  findingsHomeAddress: countOf(found, "home-address"),
  findingsPersonalContact: countOf(found, "personal-contact"),
  findingsPersonName: countOf(found, "person-name"),
  findingsJobTitle: countOf(found, "job-title"),
});

export const publishConnectedSourceInput = z.object({
  connectedSourceId: CONNECTED_SOURCE_ID,

  confirmations: z.object({
    lawfulBasisRecorded: z.boolean(),
    privacyInformationUpdated: z.boolean(),
    dpiaReferenced: z.boolean(),
  } satisfies Record<(typeof CONFIRMATIONS)[number], z.ZodBoolean>),
});

export type PublishConnectedSourceInput = z.output<typeof publishConnectedSourceInput> & {
  readonly publishedAt: Date;
};

const publishConnectedSourceAction = declareAction({
  admits: ADMIN_ALONE,
  input: publishConnectedSourceInput,
  refuses: [
    "role-forbids",
    "no-such-binding",
    "not-indexed",
    "already-published",
    "confirmation-missing",
  ],
});

export type PublishConnectedSourceRefusal =
  | SourceRefusal<RefusalOf<typeof publishConnectedSourceAction>>
  | Error;

export type ConnectedSourcePublished = {
  readonly connectedSourceId: string;
  readonly auditEventId: string;

  readonly dpiaHash: string;
};

const LATEST_SYNC = `SELECT status FROM job
    WHERE workspace_id = $1 AND kind = $2 AND subject_id = $3
    ORDER BY enqueued_at DESC, id DESC
    LIMIT 1`;

const FINDINGS_BY_CATEGORY = `SELECT f.category, count(*)::int AS found
    FROM finding f
    JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
   WHERE f.workspace_id = $1 AND d.connected_source_id = $2 AND ${raisedByTheLastSync("f", "d")}
   GROUP BY f.category`;

type ConnectedSourceToPublish = {
  readonly published_at: Date | null;
  readonly sensitivity: string;
  readonly audience: string;
};

const connectedSourceToPublish = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
): Promise<
  Result<
    ConnectedSourceToPublish,
    SourceRefusal<"no-such-binding" | "already-published" | "not-indexed"> | Error
  >
> => {
  const { workspaceId, connectedSourceId } = acting;
  const connectedSource = await connectedSourceNamed<ConnectedSourceToPublish>(acting, tx, {
    columns: "published_at, sensitivity, audience",
    lock: "for-update",
  });
  if (!connectedSource.ok) return err(connectedSource.error);
  if (connectedSource.value.published_at !== null) return err("already-published");

  const sync = await attempt(() =>
    tx.query<{ status: string }>(LATEST_SYNC, [workspaceId, INDEX_KIND, connectedSourceId]),
  );
  if (!sync.ok) return err(sync.error);

  if (sync.value.rows[0]?.status !== JOB_DONE_STATUS) return err("not-indexed");
  return ok(connectedSource.value);
};

type DpiaAndFindingCounts = { readonly dpiaHash: string; readonly counts: FindingCounts };

const dpiaAndFindingCounts = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
): Promise<
  Result<DpiaAndFindingCounts, SourceRefusal<"role-forbids" | "no-such-binding"> | Error>
> => {
  const { admin, workspaceId, connectedSourceId } = acting;
  const dpia = await dpiaInputFor(admin, tx, { connectedSourceId: connectedSourceId });
  if (!dpia.ok) return err(dpia.error);
  const counted = await attempt(() =>
    tx.query<{ category: string; found: number }>(FINDINGS_BY_CATEGORY, [
      workspaceId,
      connectedSourceId,
    ]),
  );
  if (!counted.ok) return err(counted.error);
  const found = new Map(counted.value.rows.map((row) => [row.category, row.found]));
  return ok({ dpiaHash: dpia.value.hash, counts: countsOf(found) });
};

type PublishedDetail = DetailOf<(typeof CONNECTED_SOURCE_ACTIONS)["published"]["detail"]>;

const stampPublished = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
  publishedAt: Date,
  detail: PublishedDetail,
): Promise<Result<string>> => {
  const { admin, workspaceId, connectedSourceId } = acting;
  const auditEventId = ulid();
  const published = await attempt(() =>
    tx.query(
      "UPDATE connected_source SET published_at = $3, state = $4 WHERE workspace_id = $1 AND id = $2",
      [workspaceId, connectedSourceId, publishedAt, CONNECTED_SOURCE_PUBLISHED_STATE],
    ),
  );
  if (!published.ok) return err(published.error);

  await record(admin, tx, {
    id: auditEventId,
    action: CONNECTED_SOURCE_ACTIONS.published,
    subjectId: connectedSourceId,
    detail,
  });
  return ok(auditEventId);
};

const publishWritten = async (
  acting: ActingOnConnectedSource,
  tx: Tx,
  input: PublishConnectedSourceInput,
): Promise<
  Result<Omit<ConnectedSourcePublished, "connectedSourceId">, PublishConnectedSourceRefusal>
> => {
  const connectedSource = await connectedSourceToPublish(acting, tx);
  if (!connectedSource.ok) return err(connectedSource.error);
  const read = await dpiaAndFindingCounts(acting, tx);
  if (!read.ok) return err(read.error);
  const { dpiaHash, counts } = read.value;

  const published = await stampPublished(acting, tx, input.publishedAt, {
    [STORED_DETAIL_KEYS.connectedSourceId]: acting.connectedSourceId,
    lawfulBasisRecorded: input.confirmations.lawfulBasisRecorded,
    privacyInformationUpdated: input.confirmations.privacyInformationUpdated,
    dpiaReferenced: input.confirmations.dpiaReferenced,
    ...counts,
    dpiaHash,
    sensitivity: connectedSource.value.sensitivity,
    audience: connectedSource.value.audience,
  });
  if (!published.ok) return err(published.error);
  return ok({ auditEventId: published.value, dpiaHash });
};

/**
 * `confirmation-missing` unless all three confirmations are true, and `not-indexed` unless the
 * latest sync is done.
 */
export const publishConnectedSource = async (
  principal: UserPrincipal,
  tx: Tx,
  input: PublishConnectedSourceInput,
): Promise<Result<ConnectedSourcePublished, PublishConnectedSourceRefusal>> => {
  const admitted = admit(publishConnectedSourceAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const acting = adminOnConnectedSource(admitted.value, input.connectedSourceId);
  const { admin, connectedSourceId } = acting;

  if (!CONFIRMATIONS.every((named) => input.confirmations[named] === true)) {
    return err("confirmation-missing");
  }

  const cascaded = await cascadingVisibility(admin, tx, { connectedSourceId }, () =>
    publishWritten(acting, tx, input),
  );
  if (!cascaded.ok) return err(cascaded.error);
  return ok({ connectedSourceId, ...cascaded.value.written });
};
