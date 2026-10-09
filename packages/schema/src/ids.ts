import type { z } from "zod";

import { boundarySchemas } from "./boundary-schemas.ts";

/** Each branded id's parser is its table's own select column, so the brand has one definition. */
export const ids = {
  workspaceId: boundarySchemas.workspace.select.shape.id,
  userId: boundarySchemas.user.select.shape.id,
  groupId: boundarySchemas.group.select.shape.id,
  connectedSourceId: boundarySchemas.connectedSource.select.shape.id,
  writeUpId: boundarySchemas.writeUp.select.shape.id,
  auditEventId: boundarySchemas.auditEvent.select.shape.id,
  accessRequestId: boundarySchemas.accessRequest.select.shape.id,
  conceptIri: boundarySchemas.conceptIndex.select.shape.iri,
} as const;

export type WorkspaceId = z.output<typeof ids.workspaceId>;
export type UserId = z.output<typeof ids.userId>;
export type GroupId = z.output<typeof ids.groupId>;
export type ConnectedSourceId = z.output<typeof ids.connectedSourceId>;
export type WriteUpId = z.output<typeof ids.writeUpId>;
export type AuditEventId = z.output<typeof ids.auditEventId>;
export type AccessRequestId = z.output<typeof ids.accessRequestId>;
export type ConceptIri = z.output<typeof ids.conceptIri>;
