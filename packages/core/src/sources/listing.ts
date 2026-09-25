import {
  BINDING_INDEXED_STATE,
  BINDING_INDEXING_STATE,
  BINDING_LANDED_STATE,
  BINDING_PUBLISHED_STATE,
  boundarySchemas,
  DOCUMENT_QUARANTINED_OUTCOME,
  JOB_CLAIMED_STATUS,
  JOB_DONE_STATUS,
  type BINDING_STATES,
} from "@better-answers/schema";
import { z } from "zod";

import {
  attempt,
  err,
  ok,
  requireAdmin,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { latestRunsOf, type SubjectRun } from "../runs/index.ts";
import type { Tx } from "../store/postgres/index.ts";

type BindingState = (typeof BINDING_STATES)[number];

type QuarantinedDocument = {
  readonly documentId: string;
  readonly title: string;

  readonly error: string;
};

const LISTED_ROW = boundarySchemas.sourceBinding.select
  .pick({
    id: true,
    name: true,
    connector: true,
    sensitivity: true,
    audience: true,
    audienceGroups: true,
    destination: true,
    retentionClass: true,
    publishedAt: true,
  })
  .extend({ documentCount: z.int().nonnegative(), chunkCount: z.int().nonnegative() });

type ListedRow = z.output<typeof LISTED_ROW>;

export type ListedBinding = Omit<ListedRow, "id" | "publishedAt"> & {
  readonly bindingId: ListedRow["id"];
  readonly state: BindingState;
  readonly publishedAt: string | null;
  readonly lastRun: SubjectRun | null;
  readonly quarantined: readonly QuarantinedDocument[];

  readonly quarantinedByError: Readonly<Record<string, number>>;
};

export type ListBindingsRefusal = RoleRefusal | Error;

type QuarantineRow = {
  readonly binding_id: string;
  readonly id: string;
  readonly title: string;
  readonly quarantine_error: string;
};

const BINDINGS = `SELECT b.id, b.name, b.connector, b.sensitivity, b.audience,
            b.audience_groups AS "audienceGroups", b.destination,
            b.retention_class AS "retentionClass", b.published_at AS "publishedAt",
            (SELECT count(*)::int FROM source_document d
              WHERE d.workspace_id = b.workspace_id AND d.binding_id = b.id) AS "documentCount",
            (SELECT count(*)::int FROM "index".chunk c
              WHERE c.workspace_id = b.workspace_id AND c.binding_id = b.id) AS "chunkCount"
       FROM source_binding b
      WHERE b.workspace_id = $1
      ORDER BY b.name, b.id`;

/**
 * The error is the converter's own name for why, so an Admin is told without a log being read.
 */
const QUARANTINED = `SELECT binding_id, id, title, quarantine_error FROM source_document
      WHERE workspace_id = $1 AND outcome = $2 AND quarantine_error IS NOT NULL
      ORDER BY binding_id, title, id`;

const UNREADABLE_BINDING = new Error("a source binding's row is not the shape its table admits");

/**
 * The worker cannot write the binding's state column, so everything short of a publish is read
 * off the binding's latest run.
 */
const stateOf = (publishedAt: Date | null, lastRun: SubjectRun | null): BindingState => {
  if (publishedAt !== null) return BINDING_PUBLISHED_STATE;
  if (lastRun?.status === JOB_DONE_STATUS) return BINDING_INDEXED_STATE;
  if (lastRun?.status === JOB_CLAIMED_STATUS) return BINDING_INDEXING_STATE;
  return BINDING_LANDED_STATE;
};

const countedByError = (quarantined: readonly QuarantinedDocument[]) => {
  const counts = new Map<string, number>();
  for (const { error } of quarantined) counts.set(error, (counts.get(error) ?? 0) + 1);
  return Object.fromEntries(counts);
};

export const listBindings = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<readonly ListedBinding[], ListBindingsRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  const read = await attempt(async () => ({
    bindings: (await tx.query(BINDINGS, [workspaceId])).rows,
    quarantined: (
      await tx.query<QuarantineRow>(QUARANTINED, [workspaceId, DOCUMENT_QUARANTINED_OUTCOME])
    ).rows,
  }));
  if (!read.ok) return err(read.error);
  const parsed = z.array(LISTED_ROW).safeParse(read.value.bindings);
  if (!parsed.success) return err(UNREADABLE_BINDING);
  const rows = parsed.data;

  const lastRuns = await latestRunsOf(admin.value, tx, { subjectIds: rows.map((row) => row.id) });
  if (!lastRuns.ok) return err(lastRuns.error);

  return ok(
    rows.map(({ id, publishedAt, ...row }) => {
      const lastRun = lastRuns.value.get(id) ?? null;
      const quarantined = read.value.quarantined
        .filter((document) => document.binding_id === id)
        .map((document) => ({
          documentId: document.id,
          title: document.title,
          error: document.quarantine_error,
        }));
      return {
        bindingId: id,
        ...row,
        state: stateOf(publishedAt, lastRun),
        publishedAt: publishedAt?.toISOString() ?? null,
        lastRun,
        quarantined,
        quarantinedByError: countedByError(quarantined),
      };
    }),
  );
};
