import type pg from "pg";

import { bundleHistory } from "../../fixtures/bundle.ts";
import type { Scenario } from "../../fixtures/workspace-with-bundle.ts";

/** A live write refuses a head whose rows were lost, so lost commits get stand-in rows meanwhile. */
export const standInRowsFor = async (
  pool: pg.Pool,
  scenario: Scenario,
): Promise<() => Promise<void>> => {
  const history = await bundleHistory(scenario.git, scenario.workspaceId);
  const recorded = await pool.query<{ sha: string }>(
    "SELECT sha FROM bundle_commit WHERE workspace_id = $1",
    [scenario.workspaceId],
  );
  const known = new Set(recorded.rows.map((row) => row.sha));
  const lost = history.flatMap((sha, at) => (known.has(sha) ? [] : [{ sha, at }]));
  await pool.query(
    `INSERT INTO bundle_commit (workspace_id, sha, parent_sha, audit_event_id, actor)
     SELECT $1, lost.sha, lost.parent, gen_random_uuid()::text, 'process:stand-in'
       FROM unnest($2::text[], $3::text[]) AS lost(sha, parent)`,
    [
      scenario.workspaceId,
      lost.map(({ sha }) => sha),
      lost.map(({ at }) => history[at - 1] ?? null),
    ],
  );
  return async () => {
    await pool.query("DELETE FROM bundle_commit WHERE workspace_id = $1 AND sha = ANY($2)", [
      scenario.workspaceId,
      lost.map(({ sha }) => sha),
    ]);
  };
};
