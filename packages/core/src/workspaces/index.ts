import { z } from "zod";

import { boundarySchemas, CREATOR_ROLE } from "@better-answers/schema";

import {
  action,
  declareActions,
  type EndedGrant,
  record,
  STORED_DETAIL_KEYS,
} from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  refusalFor,
  requireFreshSignIn,
  type Result,
  ulid,
} from "../kernel/index.ts";
import type {
  OperatorPrincipal,
  PlatformPrincipal,
  PrincipalRefusal,
  Role,
  UserId,
  UserPrincipal,
  WorkspaceId,
} from "../kernel/index.ts";
import {
  type PostgresDoor,
  type Tx,
  withIdentityRead,
  withIdentityWrite,
  withPrincipalRead,
  withScope,
} from "../store/postgres/index.ts";
import { hasNoDisplayName } from "./display-name.ts";
import { endTokens, REVOKED_EVERYWHERE, type TokensEnded } from "./grants.ts";
import { promoting } from "./promotion.ts";
import type { WorkspaceRefusal } from "./vocabulary.ts";

export { WORKSPACE_REFUSALS } from "./vocabulary.ts";
export { addPerson } from "./add-person.ts";
export type { AddPersonRefusal } from "./add-person.ts";
export { actorOf, namesOfPeople, peopleAmong, personNamed } from "./actors.ts";
export { recordGrantsEndedHere } from "./grants.ts";
export { detailsNamed } from "./grant-names.ts";
export type { AuditEventActor, PeopleNames } from "./actors.ts";
export {
  applyDisplayNameRule,
  correctDisplayName,
  correctDisplayNameInput,
  DISPLAY_NAME_CORRECTED,
  hasNoDisplayName,
  holdTheNameOf,
  notErasedAt,
  setDisplayName,
  setDisplayNameInput,
} from "./display-name.ts";
export type { SetDisplayNameRefusal } from "./display-name.ts";
export { listWorkspaces } from "./listing.ts";
export {
  operatorAddresses,
  restoreSignIn,
  setOperatorMark,
  standingAsOperator,
} from "./operator.ts";
export type { SignInRestored } from "./operator.ts";
export { inspectPerson, inspectPersonInput, listPeople, listPeopleInput } from "./people.ts";
export {
  applyPasskeyNameRule,
  dismissPasskeyOffer,
  recordPasskeyAdded,
  recordPasskeyUse,
  removePasskey,
  removePasskeyInput,
  renamePasskey,
  renamePasskeyInput,
} from "./passkeys.ts";
export {
  acknowledgeRecoveryCodes,
  acknowledgeRecoveryCodesInput,
  hashOfTyped,
  replaceRecoveryCodes,
  replaceRecoveryCodesInput,
} from "./recovery-codes.ts";
export { reserveAuthenticatorTry } from "./confirm-throttle.ts";
export {
  acceptRestoreCode,
  confirmByAuthenticator,
  confirmByPasskey,
  parkAuthenticatorSecret,
  readParkedAuthenticatorSecret,
  replaceFactorsByAuthenticator,
  replaceFactorsByPasskey,
  spendRecoveryCode,
} from "./confirming.ts";
export {
  keepPasskeyChallenge,
  readPasskeyCredentials,
  takePasskeyChallenge,
} from "./passkey-confirm.ts";
export {
  readCredentialsHeld,
  readSecondFactor,
  recordAuthenticatorSetUp,
  removeAuthenticator,
} from "./second-factor.ts";
export type { CredentialsHeld, SecondFactorHeld } from "./second-factor.ts";
export { promoting } from "./promotion.ts";
export { judgeTheSession } from "./session-standing.ts";
export type { SessionNamed, SessionStanding } from "./session-standing.ts";
export {
  recordConsent,
  recordSignIn,
  SESSION_VERIFICATION_PREFIXES,
  SIGN_IN_CODE_PREFIX,
  SIGN_IN_LINK_PREFIX,
  VERIFICATION_PREFIXES,
  verificationIdentifiersOf,
} from "./sign-in-and-consent.ts";
export type { SignInMethod } from "../audit/index.ts";

export const TOOLS_LIST_TTL_MS_DEFAULT = 300_000;
export const TOOLS_LIST_TTL_CONFIG_KEY = "mcp.tools_list_ttl_ms";

const BOOTSTRAP_ACTOR = "process:better-answers-bootstrap";

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

/**
 * Creates the workspace with its partition, its default config and the admin's member row at
 * `CREATOR_ROLE`. The admin must already exist and have a display name.
 */
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

  const action = await attempt(() =>
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

  if (!action.ok) return err(refusalFor(action.error, PROVISION_CONSTRAINTS));
  if (!action.value.ok) return err(action.value.error);
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
): Promise<Result<UserId | undefined, Error>> =>
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

export const endEverySignInAndTokenInput = z.object({
  personId: boundarySchemas.user.select.shape.id,
});

type EndEverySignInAndTokenInput = z.output<typeof endEverySignInAndTokenInput> & {
  /** When the action happens: the sign-in's age is judged against it, and it is the revocation's. */
  readonly at: Date;
};

type CredentialsRevoked = {
  readonly personId: UserId;

  /** Later than the `at` asked for where an earlier revocation already held a later instant. */
  readonly revokedAt: string;
};

export type EndEverySignInAndTokenRefusal = WorkspaceRefusal<"no-such-user" | "sign-in-too-old">;

type CredentialsEnded = { readonly held: Date; readonly grants: readonly EndedGrant[] };

/** Undefined, having changed nothing, when no person holds the id. */
const endingCredentials = async (
  tx: Tx,
  personId: UserId,
  at: Date,
): Promise<CredentialsEnded | undefined> => {
  const person = await tx.query<{ at: Date }>(
    'UPDATE "user" SET credentials_revoked_at = GREATEST(COALESCE(credentials_revoked_at, $2), $2), updated_at = now() WHERE id = $1 RETURNING credentials_revoked_at AS at',
    [personId, at],
  );
  const held = person.rows[0]?.at;
  if (held === undefined) return undefined;
  await tx.query("DELETE FROM session WHERE user_id = $1 AND created_at < $2", [personId, held]);
  const { grants } = await endTokens(tx, { personId, before: held, workspaceId: null });
  return { held, grants };
};

/**
 * Ends every session and OAuth token the person was issued before the revocation instant, in every
 * workspace, and records the action under the operator. The instant only moves forward: an `at`
 * before the one held keeps the held one.
 */
export const endEverySignInAndToken = async (
  operator: OperatorPrincipal,
  tx: Tx,
  input: EndEverySignInAndTokenInput,
): Promise<Result<CredentialsRevoked, EndEverySignInAndTokenRefusal | Error>> => {
  const fresh = requireFreshSignIn(operator, input.at);
  if (!fresh.ok) return err(fresh.error);
  const { personId } = input;

  const ended = await attempt(() => endingCredentials(tx, personId, input.at));
  if (!ended.ok) return err(ended.error);
  if (ended.value === undefined) return err("no-such-user");

  await record(fresh.value, tx, {
    id: ulid(),
    action: REVOKED_EVERYWHERE,
    subjectId: personId,
    detail: { grants: ended.value.grants },
  });
  return ok({ personId, revokedAt: ended.value.held.toISOString() });
};

export type RevokeWorkspaceTokensInput = {
  readonly workspaceId: string;
  readonly userId: string;

  readonly at: Date;
};

/**
 * The step inside an action's own transaction: the tokens whose consented workspace is this one. It
 * takes the principal its action admitted, and judges none.
 */
export const endWorkspaceTokens = (
  _admitted: PlatformPrincipal | UserPrincipal,
  tx: Tx,
  input: { readonly workspaceId: WorkspaceId; readonly personId: UserId; readonly at: Date },
): Promise<TokensEnded> =>
  endTokens(tx, { personId: input.personId, before: input.at, workspaceId: input.workspaceId });

/**
 * Ends the person's OAuth tokens for this workspace issued before `at`. Sessions are deliberately
 * untouched: a browser session belongs to the person, not to one workspace, so ending it would
 * reach another tenant.
 */
export const revokeWorkspaceTokens = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: RevokeWorkspaceTokensInput,
): Promise<
  Result<
    {
      workspaceId: WorkspaceId;
      userId: string;
      actorId: PlatformPrincipal["actorId"];
      refreshTokensEnded: number;
      accessTokensEnded: number;
    },
    "malformed" | Error
  >
> => {
  const workspaceId = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  const userId = boundarySchemas.user.select.shape.id.safeParse(input.userId);
  if (!workspaceId.success || !userId.success) return err("malformed");

  const ended = await attempt(() =>
    withIdentityWrite(platform, door, (tx) =>
      endWorkspaceTokens(platform, tx, {
        workspaceId: workspaceId.data,
        personId: userId.data,
        at: input.at,
      }),
    ),
  );

  if (!ended.ok) return err(ended.error);
  return ok({
    workspaceId: workspaceId.data,
    userId: userId.data,
    actorId: platform.actorId,
    refreshTokensEnded: ended.value.refreshTokensEnded,
    accessTokensEnded: ended.value.accessTokensEnded,
  });
};

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

export const workspaceIds = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
): Promise<Result<readonly WorkspaceId[], Error>> => {
  const listed = await attempt(() =>
    withIdentityRead(platform, door, async (tx) => {
      const rows = await tx.query<{ id: string }>("SELECT id FROM workspace ORDER BY id");

      return rows.rows.map((row) => boundarySchemas.workspace.select.shape.id.parse(row.id));
    }),
  );
  if (!listed.ok) return err(listed.error);
  return ok(listed.value);
};

/** Undefined for a malformed short name, as for one no workspace holds. */
export const workspaceIdByShortName = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  shortName: string,
): Promise<Result<WorkspaceId | undefined, Error>> => {
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

export type MemberReadRefusal = WorkspaceRefusal<"workspace-gone" | "person-gone">;

export const readMember = async (
  principal: UserPrincipal,
  tx: Tx,
): Promise<Result<Member, MemberReadRefusal | Error>> => {
  const workspace = await attempt(() =>
    tx.query<{ name: string }>("SELECT name FROM workspace WHERE id = $1", [principal.workspaceId]),
  );
  if (!workspace.ok) return err(workspace.error);
  const name = workspace.value.rows[0]?.name;
  if (name === undefined) return err("workspace-gone");

  const person = await attempt(() =>
    tx.query<{ name: string; email: string }>('SELECT name, email FROM "user" WHERE id = $1', [
      principal.userId,
    ]),
  );
  if (!person.ok) return err(person.error);
  const row = person.value.rows[0];
  if (row === undefined) return err("person-gone");

  return ok({
    workspace: { id: principal.workspaceId, name },
    person: { id: principal.userId, name: row.name, email: row.email },
    role: principal.role,
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
