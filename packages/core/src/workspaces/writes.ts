import { boundarySchemas, CREATOR_ROLE } from "@better-answers/schema";

import { action, declareActions, record, STORED_DETAIL_KEYS } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  processActorId,
  refusalFor,
  type Result,
  ulid,
  type PlatformPrincipal,
  type Role,
  type UserId,
  type WorkspaceId,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityRead,
  withScope,
} from "../store/postgres/index.ts";
import { hasNoDisplayName } from "./display-name.ts";
import { promoting } from "./promotion.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

export const TOOLS_LIST_TTL_MS_DEFAULT = 300_000;
export const TOOLS_LIST_TTL_CONFIG_KEY = "mcp.tools_list_ttl_ms";

const BOOTSTRAP_ACTOR = processActorId("bootstrap");

export type BootstrapPrincipal = PlatformPrincipal & {
  readonly actorId: typeof BOOTSTRAP_ACTOR;
};

export const BOOTSTRAP: BootstrapPrincipal = { kind: "platform", actorId: BOOTSTRAP_ACTOR };

const WORKSPACE_ACTIONS = declareActions("platform", {
  provisioned: action("platform.workspace.provisioned", { adminUserId: "id", role: "role" }),
  renamed: action("platform.workspace.renamed", {
    nameChanged: "flag",
    [STORED_DETAIL_KEYS.shortNameChanged]: "flag",
  }),
});

const MEMBER_ACTIONS = declareActions("people", {
  added: action("people.member.added", { userId: "id", role: "role" }),
});

const insertMember = async (
  tx: Tx,
  workspaceId: WorkspaceId,
  userId: UserId,
  role: Role,
): Promise<void> => {
  if (role === "Admin") await promoting(tx, userId);
  await tx.query(
    "INSERT INTO member (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())",
    [ulid(), workspaceId, userId, role],
  );
};

export type ProvisionWorkspaceInput = {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;

  readonly adminUserId: string;
};

export type ProvisionRefusal = WorkspaceRefusal<
  "slug-taken" | "workspace-exists" | "no-such-user" | "no-display-name" | "malformed"
>;

const PROVISION_CONSTRAINTS = {
  workspace_short_name_unique: "slug-taken",
  workspace_pkey: "workspace-exists",
  member_user_id_user_id_fk: "no-such-user",
} as const satisfies Record<string, ProvisionRefusal>;

type NamedPerson = { readonly id: UserId; readonly name: string };

const personOf = (row: { readonly id: string; readonly name: string }): NamedPerson => ({
  id: boundarySchemas.user.select.shape.id.parse(row.id),
  name: row.name,
});

const personById = async (tx: Tx, id: UserId): Promise<NamedPerson | undefined> => {
  const rows = await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM "user" WHERE id = $1',
    [id],
  );
  const row = rows.rows[0];
  return row === undefined ? undefined : personOf(row);
};

type Credited = Result<NamedPerson, WorkspaceRefusal<"no-such-user" | "no-display-name">>;

const credited = (person: NamedPerson | undefined): Credited => {
  if (person === undefined) return err("no-such-user");
  if (hasNoDisplayName(person.name)) return err("no-display-name");
  return ok(person);
};

/** The admin must already exist and have a display name. */
export const provisionWorkspace = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ProvisionWorkspaceInput,
): Promise<
  Result<
    { workspaceId: WorkspaceId; actorId: PlatformPrincipal["actorId"] },
    ProvisionRefusal | Error
  >
> => {
  const row = boundarySchemas.workspace.insert.safeParse({
    id: input.id,
    name: input.name,
    shortName: input.shortName,
  });
  const admin = boundarySchemas.user.select.shape.id.safeParse(input.adminUserId);
  if (!row.success || !admin.success) return err("malformed");

  const provisioned = await attempt(() =>
    withScope(platform, door, row.data.id, async (tx): Promise<Credited> => {
      const person = credited(await personById(tx, admin.data));
      if (!person.ok) return person;

      await tx.query("INSERT INTO workspace (id, name, short_name) VALUES ($1, $2, $3)", [
        row.data.id,
        row.data.name,
        row.data.shortName,
      ]);

      await record(platform, tx, {
        id: ulid(),
        action: WORKSPACE_ACTIONS.provisioned,
        subjectId: row.data.id,
        detail: { adminUserId: admin.data, role: CREATOR_ROLE },
      });
      await tx.query("SELECT create_workspace_partition($1)", [row.data.id]);

      await insertMember(tx, row.data.id, admin.data, CREATOR_ROLE);
      await tx.query(
        "INSERT INTO workspace_config (workspace_id, key, value) VALUES ($1, $2, $3)",
        [row.data.id, TOOLS_LIST_TTL_CONFIG_KEY, String(TOOLS_LIST_TTL_MS_DEFAULT)],
      );
      return person;
    }),
  );

  if (!provisioned.ok) return err(refusalFor(provisioned.error, PROVISION_CONSTRAINTS));
  if (!provisioned.value.ok) return err(provisioned.value.error);
  return ok({ workspaceId: row.data.id, actorId: platform.actorId });
};

export type RenameWorkspaceInput = {
  readonly workspaceId: string;
  readonly name?: string | undefined;
  readonly shortName?: string | undefined;
};

export type RenameRefusal = WorkspaceRefusal<"malformed" | "no-such-workspace" | "slug-taken">;

type WorkspaceNames = { readonly name: string; readonly shortName: string };

type WorkspaceRenamed = WorkspaceNames & {
  readonly workspaceId: WorkspaceId;
  readonly actorId: PlatformPrincipal["actorId"];
};

const RENAME_CONSTRAINTS = {
  workspace_short_name_unique: "slug-taken",
} as const satisfies Record<string, RenameRefusal>;

/**
 * A field the input leaves out keeps what it holds. An input naming neither is malformed, and one
 * that changes neither writes nothing.
 */
export const renameWorkspace = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RenameWorkspaceInput,
): Promise<Result<WorkspaceRenamed, RenameRefusal | Error>> => {
  const workspaceId = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  const asked = boundarySchemas.workspace.update.safeParse({
    name: input.name,
    shortName: input.shortName,
  });
  if (!workspaceId.success || !asked.success) return err("malformed");
  const { name, shortName } = asked.data;
  if (name === undefined && shortName === undefined) return err("malformed");

  const renamed = await attempt(() =>
    withScope(
      platform,
      door,
      workspaceId.data,
      async (tx): Promise<Result<WorkspaceNames, WorkspaceRefusal<"no-such-workspace">>> => {
        const held = await tx.query<WorkspaceNames>(
          'SELECT name, short_name AS "shortName" FROM workspace WHERE id = $1 FOR UPDATE',
          [workspaceId.data],
        );
        const was = held.rows[0];
        if (was === undefined) return err("no-such-workspace");
        const next = { name: name ?? was.name, shortName: shortName ?? was.shortName };
        const nameChanged = next.name !== was.name;
        const shortNameChanged = next.shortName !== was.shortName;
        if (!nameChanged && !shortNameChanged) return ok(next);

        await tx.query("UPDATE workspace SET name = $2, short_name = $3 WHERE id = $1", [
          workspaceId.data,
          next.name,
          next.shortName,
        ]);
        await record(platform, tx, {
          id: ulid(),
          action: WORKSPACE_ACTIONS.renamed,
          subjectId: workspaceId.data,
          detail: { nameChanged, [STORED_DETAIL_KEYS.shortNameChanged]: shortNameChanged },
        });
        return ok(next);
      },
    ),
  );

  if (!renamed.ok) return err(refusalFor(renamed.error, RENAME_CONSTRAINTS));
  if (!renamed.value.ok) return err(renamed.value.error);
  return ok({ workspaceId: workspaceId.data, ...renamed.value.value, actorId: platform.actorId });
};

const personByEmail = async (tx: Tx, email: string): Promise<NamedPerson | undefined> => {
  const rows = await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM "user" WHERE lower(email) = lower($1)',
    [email],
  );
  const row = rows.rows[0];
  return row === undefined ? undefined : personOf(row);
};

/** Matches the address case-insensitively; undefined when no person holds it. */
export const personIdByEmail = (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  email: string,
): Promise<Result<UserId | undefined>> =>
  attempt(() =>
    withIdentityRead(platform, door, async (tx) => (await personByEmail(tx, email))?.id),
  );

export type AddMemberInput = {
  readonly workspaceId: string;
  readonly email: string;
  readonly role: Role;
};

export type AddMemberRefusal = WorkspaceRefusal<
  "malformed" | "no-such-workspace" | "no-such-user" | "no-display-name" | "already-a-member"
>;

export type MemberAdded = {
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly role: Role;
  readonly actorId: PlatformPrincipal["actorId"];
};

const holdsARow = async (tx: Tx, statement: string, ...parameters: string[]): Promise<boolean> => {
  const found = await tx.query(statement, parameters);
  return (found.rowCount ?? 0) > 0;
};

type AddingRefusal = WorkspaceRefusal<
  "no-such-workspace" | "no-such-user" | "no-display-name" | "already-a-member"
>;

/** Finds the person by address, case-insensitively; they must already have a display name. */
export const addMember = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: AddMemberInput,
): Promise<Result<MemberAdded, AddMemberRefusal | Error>> => {
  const workspaceId = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspaceId.success) return err("malformed");

  const added = await attempt(() =>
    withScope(
      platform,
      door,
      workspaceId.data,
      async (tx): Promise<Result<UserId, AddingRefusal>> => {
        if (!(await holdsARow(tx, "SELECT 1 FROM workspace WHERE id = $1", workspaceId.data))) {
          return err("no-such-workspace");
        }
        const person = credited(await personByEmail(tx, input.email));
        if (!person.ok) return person;
        const userId = person.value.id;
        const held = await holdsARow(
          tx,
          "SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2",
          workspaceId.data,
          userId,
        );
        if (held) return err("already-a-member");

        await insertMember(tx, workspaceId.data, userId, input.role);
        await record(platform, tx, {
          id: ulid(),
          action: MEMBER_ACTIONS.added,
          subjectId: userId,
          detail: { userId, role: input.role },
        });
        return ok(userId);
      },
    ),
  );

  if (!added.ok) return err(added.error);
  if (!added.value.ok) return err(added.value.error);
  return ok({
    workspaceId: workspaceId.data,
    userId: added.value.value,
    role: input.role,
    actorId: platform.actorId,
  });
};
