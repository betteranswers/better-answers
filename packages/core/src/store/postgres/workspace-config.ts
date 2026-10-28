import type { UserPrincipal, WorkspaceId } from "../../kernel/index.ts";
import type { Tx } from "./door.ts";

export const readWorkspaceConfig = async (
  principal: UserPrincipal,
  tx: Tx,
  key: string,
): Promise<string | undefined> => {
  const found = await tx.query<{ value: string }>(
    "SELECT value FROM workspace_config WHERE workspace_id = $1 AND key = $2",
    [principal.workspaceId, key],
  );
  return found.rows[0]?.value;
};

export const holdWorkspaceConfig = async (
  principal: UserPrincipal,
  tx: Tx,
  key: string,
): Promise<string | undefined> => {
  const found = await tx.query<{ value: string }>(
    "SELECT value FROM workspace_config WHERE workspace_id = $1 AND key = $2 FOR UPDATE",
    [principal.workspaceId, key],
  );
  return found.rows[0]?.value;
};

export const writeWorkspaceConfig = async (
  tx: Tx,
  setting: { readonly workspaceId: WorkspaceId; readonly key: string; readonly value: string },
): Promise<void> => {
  await tx.query(
    `INSERT INTO workspace_config (workspace_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [setting.workspaceId, setting.key, setting.value],
  );
};
