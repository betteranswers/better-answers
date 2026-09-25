import { boundarySchemas } from "@better-answers/schema";

import {
  attempt,
  err,
  ok,
  type OperatorPrincipal,
  type Result,
  type WorkspaceId,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

type WorkspaceListed = {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly slug: string;
  readonly memberCount: number;
  readonly createdAt: string;
};

type WorkspaceRow = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly members: number;
  readonly created_at: Date;
};

/** Every workspace on the platform, by name. It reads the identity set alone. */
export const listWorkspaces = async (
  _operator: OperatorPrincipal,
  tx: Tx,
): Promise<Result<readonly WorkspaceListed[], Error>> => {
  const listed = await attempt(() =>
    tx.query<WorkspaceRow>(
      `SELECT w.id, w.name, w.slug, w.created_at,
              (SELECT count(*)::int FROM member m WHERE m.workspace_id = w.id) AS members
         FROM workspace w
        ORDER BY w.name, w.id`,
    ),
  );
  if (!listed.ok) return err(listed.error);

  return ok(
    listed.value.rows.map((row) => ({
      id: boundarySchemas.workspace.select.shape.id.parse(row.id),
      name: row.name,
      slug: row.slug,
      memberCount: row.members,
      createdAt: row.created_at.toISOString(),
    })),
  );
};
