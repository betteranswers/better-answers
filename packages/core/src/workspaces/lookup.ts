import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import {
  admit,
  ANY_ROLE,
  attempt,
  declareAction,
  err,
  ok,
  type RefusalOf,
  type Result,
  type PlatformPrincipal,
  type PrincipalRefusal,
  type Role,
  type UserId,
  type UserPrincipal,
  type WorkspaceId,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityRead,
  withPrincipalRead,
} from "../store/postgres/index.ts";
import { type WorkspaceHeld, workspacesOf } from "./people.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

/** In id order; empty, not refused, for an id no person holds. */
export const workspacesHeldBy = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  userId: string,
): Promise<Result<readonly WorkspaceId[], "malformed" | Error>> => {
  const person = boundarySchemas.user.select.shape.id.safeParse(userId);
  if (!person.success) return err("malformed");

  const held = await attempt(() =>
    withIdentityRead(platform, door, async (tx) => {
      const members = await tx.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM member WHERE user_id = $1 ORDER BY workspace_id",
        [person.data],
      );

      return members.rows.map((row) =>
        boundarySchemas.workspace.select.shape.id.parse(row.workspace_id),
      );
    }),
  );
  if (!held.ok) return err(held.error);
  return ok(held.value);
};

type ReadWorkspacesHeldInput = {
  readonly personId: string;
};

/**
 * In name order; empty, not refused, for an id no person holds. A workspace where the person's
 * sign-ins were ended stays listed.
 */
export const readWorkspacesHeld = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: ReadWorkspacesHeldInput,
): Promise<Result<readonly WorkspaceHeld[], "malformed" | Error>> => {
  const person = boundarySchemas.user.select.shape.id.safeParse(input.personId);
  if (!person.success) return err("malformed");
  const personId = person.data;

  return attempt(() =>
    withIdentityRead(
      platform,
      door,
      async (tx) => (await workspacesOf(tx, [personId])).get(personId) ?? [],
    ),
  );
};

export const workspaceIds = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
): Promise<Result<readonly WorkspaceId[]>> => {
  const listed = await attempt(() =>
    withIdentityRead(platform, door, async (tx) => {
      const rows = await tx.query<{ id: string }>("SELECT id FROM workspace ORDER BY id");

      return rows.rows.map((row) => boundarySchemas.workspace.select.shape.id.parse(row.id));
    }),
  );
  if (!listed.ok) return err(listed.error);
  return ok(listed.value);
};

export const workspaceIdByShortName = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  shortName: string,
): Promise<Result<WorkspaceId | undefined>> => {
  const wanted = boundarySchemas.workspace.select.shape.shortName.safeParse(shortName);
  if (!wanted.success) return ok(undefined);

  const found = await attempt(() =>
    withIdentityRead(platform, door, async (tx) => {
      const rows = await tx.query<{ id: string }>(
        "SELECT id FROM workspace WHERE short_name = $1",
        [wanted.data],
      );
      const id = rows.rows[0]?.id;

      return id === undefined ? undefined : boundarySchemas.workspace.select.shape.id.parse(id);
    }),
  );
  if (!found.ok) return err(found.error);
  return ok(found.value);
};

export type Member = {
  readonly workspace: { readonly id: WorkspaceId; readonly name: string };
  readonly person: { readonly id: UserId; readonly name: string; readonly email: string };
  readonly role: Role;
};

const readMemberAction = declareAction({
  admits: ANY_ROLE,
  input: z.object({}),
  refuses: ["role-forbids", "workspace-gone", "person-gone"],
});

export type MemberReadRefusal = WorkspaceRefusal<RefusalOf<typeof readMemberAction>>;

export const readMember = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<Member, MemberReadRefusal | Error>> => {
  const admitted = admit(readMemberAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  const member = admitted.value;

  const workspace = await attempt(() =>
    tx.query<{ name: string }>("SELECT name FROM workspace WHERE id = $1", [member.workspaceId]),
  );
  if (!workspace.ok) return err(workspace.error);
  const name = workspace.value.rows[0]?.name;
  if (name === undefined) return err("workspace-gone");

  const person = await attempt(() =>
    tx.query<{ name: string; email: string }>('SELECT name, email FROM "user" WHERE id = $1', [
      member.userId,
    ]),
  );
  if (!person.ok) return err(person.error);
  const row = person.value.rows[0];
  if (row === undefined) return err("person-gone");

  return ok({
    workspace: { id: member.workspaceId, name },
    person: { id: member.userId, name: row.name, email: row.email },
    role: member.role,
  });
};

/**
 * Resolves the member by address, case-insensitively, as a credential issued at `at` would be: a
 * revocation after `at` refuses it.
 */
export const principalOfMember = async (
  door: PostgresDoor,
  input: { readonly workspaceId: string; readonly email: string; readonly at: Date },
): Promise<Result<UserPrincipal, "malformed" | PrincipalRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const person = await attempt(() =>
    door.pool.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = lower($1)', [
      input.email,
    ]),
  );
  if (!person.ok) return err(person.error);
  const userId = person.value.rows[0]?.id;
  if (userId === undefined) return err("not-a-member");
  const resolved = await attempt(() =>
    withPrincipalRead(
      door,
      { workspaceId: workspace.data, userId, issuedAt: input.at },
      async (principal) => principal,
    ),
  );
  if (!resolved.ok) return err(resolved.error);
  return resolved.value;
};
