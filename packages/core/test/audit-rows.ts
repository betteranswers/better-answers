import type pg from "pg";

import { ulid } from "@better-answers/schema";

/** One statement, since a round trip a row costs a shared runner seconds at ten thousand rows. */
export const auditEventsIn = async (
  pool: pg.Pool,
  events: {
    readonly workspaceId: string;
    readonly action: string;
    readonly actor: string;
    readonly count: number;
  },
): Promise<readonly string[]> => {
  const ids = Array.from({ length: events.count }, () => ulid());
  await pool.query(
    `INSERT INTO audit_event (id, workspace_id, action, actor, subject_id, detail)
     SELECT id, $2, $3, $4, id, '{}' FROM unnest($1::text[]) AS id`,
    [ids, events.workspaceId, events.action, events.actor],
  );
  return ids;
};
