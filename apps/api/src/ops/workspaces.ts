import { attempt, err, ok, type Result } from "@better-answers/core/kernel";
import { initRepository } from "@better-answers/core/store/git";
import type { PostgresDoor } from "@better-answers/core/store/postgres";
import {
  addMember,
  addPerson,
  BOOTSTRAP,
  personIdByEmail,
  provisionWorkspace,
  renameWorkspace,
  type AddMemberRefusal,
  type AddPersonRefusal,
  type ProvisionRefusal,
  type RenameRefusal,
} from "@better-answers/core/workspaces";
import { ROLES, ulid } from "@better-answers/schema";

import type { Doors } from "../doors.ts";
import { IDENTITY_PRINCIPAL } from "../identity-principal.ts";
import {
  DONE,
  REFUSED,
  USAGE,
  type OpsIo,
  type Flags,
  flagValue,
  bundleStore,
  exitOf,
} from "./cli.ts";

export const notSignedIn = (email: string): string =>
  `no-such-user: ${email} has not signed in; have them sign in with an email code first, or add them with add-person, then run this again`;

const noDisplayName = (email: string): string =>
  `no-display-name: ${email} has given no display name; have them sign in and give one, then run this again`;

export const noSuchWorkspace = (workspaceId: string): string =>
  `no-such-workspace: ${workspaceId} is not a workspace`;

const provisionReason = (
  refusal: ProvisionRefusal | Error,
  shortName: string,
  email: string,
): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "no-such-user":
      return notSignedIn(email);
    case "no-display-name":
      return noDisplayName(email);
    case "slug-taken":
      return `slug-taken: another workspace already holds the short name ${shortName}`;
    case "workspace-exists":
      return "workspace-exists: a workspace already holds the id this run drew; run it again";
    case "malformed":
      return "malformed: the name and the short name must each carry at least one character";
    default:
      return refusal;
  }
};

const signedInPerson = async (
  postgres: PostgresDoor,
  email: string,
): Promise<Result<string, "no-such-user" | Error>> => {
  const person = await personIdByEmail(BOOTSTRAP, postgres, email);
  if (!person.ok) return err(person.error);
  return person.value === undefined ? err("no-such-user") : ok(person.value);
};

const provisionRefused = (
  refusal: ProvisionRefusal | Error,
  shortName: string,
  email: string,
  io: OpsIo,
): number => {
  io.say(`provision-workspace: REFUSED — ${provisionReason(refusal, shortName, email)}`);
  return exitOf(refusal);
};

export const provisionWorkspaceCommand = async (
  doors: Doors,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const name = flagValue(flags, "name");
  const shortName = flagValue(flags, "short-name");
  const email = flagValue(flags, "admin");
  if (name === undefined || shortName === undefined || email === undefined) {
    io.say(
      "provision-workspace: --name <name>, --short-name <short name> and --admin <email> are required",
    );
    return USAGE;
  }
  const git = bundleStore(doors, "the workspace's bundle repository cannot be created");
  if (!git.ok) {
    io.say(`provision-workspace: REFUSED — ${git.error}`);
    return REFUSED;
  }
  const postgres = doors.postgres;
  const admin = await signedInPerson(postgres, email);
  if (!admin.ok) return provisionRefused(admin.error, shortName, email, io);
  const id = ulid();
  const provisioned = await provisionWorkspace(BOOTSTRAP, postgres, {
    id,
    name,
    shortName,
    adminUserId: admin.value,
  });
  if (!provisioned.ok) return provisionRefused(provisioned.error, shortName, email, io);
  const repository = await attempt(() => initRepository(git.value, id));
  if (!repository.ok) {
    io.say(
      `provision-workspace: REFUSED — workspace ${id} stands with ${email} as its Admin, but its bundle repository could not be created: ${repository.error.message}; a rerun is refused slug-taken, so create the repository by hand before any import`,
    );
    return REFUSED;
  }
  io.say(`provision-workspace: done — ${id}, short name ${shortName}, Admin ${email}`);
  return DONE;
};

const memberReason = (
  refusal: AddMemberRefusal | Error,
  workspaceId: string,
  email: string,
): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "malformed":
      return `malformed: --workspace ${workspaceId} is not a workspace id`;
    case "no-such-user":
      return notSignedIn(email);
    case "no-display-name":
      return noDisplayName(email);
    case "no-such-workspace":
      return noSuchWorkspace(workspaceId);
    case "already-a-member":
      return `already-a-member: ${email} is already a member of workspace ${workspaceId}; a role change is the Admin's action on the People page`;
  }
};

export const addMemberCommand = async (doors: Doors, flags: Flags, io: OpsIo): Promise<number> => {
  const workspaceId = flagValue(flags, "workspace");
  const email = flagValue(flags, "email");
  const asked = flagValue(flags, "role");
  if (workspaceId === undefined || email === undefined || asked === undefined) {
    io.say(
      `add-member: --workspace <id>, --email <email> and --role <${ROLES.join("|")}> are required`,
    );
    return USAGE;
  }
  const role = ROLES.find((word) => word === asked);
  if (role === undefined) {
    io.say(`add-member: --role must be one of ${ROLES.join(", ")}`);
    return USAGE;
  }
  const added = await addMember(BOOTSTRAP, doors.postgres, { workspaceId, email, role });
  if (!added.ok) {
    io.say(`add-member: REFUSED — ${memberReason(added.error, workspaceId, email)}`);
    return exitOf(added.error);
  }
  io.say(`add-member: done — ${email} added to workspace ${workspaceId} as ${role}`);
  return DONE;
};

const ADD_PERSON_USAGE = "add-person: --email <address> and --name <display name> are required";

const personReason = (refusal: AddPersonRefusal, email: string): string => {
  switch (refusal) {
    case "malformed":
      return `malformed: ${email} is not an email address`;
    case "person-exists":
      return `person-exists: ${email} is already a person; add-member takes them as they stand`;
    case "display-name-angle-bracket":
    case "display-name-control-character":
    case "display-name-empty":
    case "display-name-not-one-line":
    case "display-name-too-long":
      return `${refusal}: a display name is one line of 1 to 100 characters, with no angle brackets or control characters`;
    default:
      return refusal;
  }
};

const personRefused = (refusal: AddPersonRefusal | Error, email: string, io: OpsIo): number => {
  if (refusal instanceof Error) {
    io.say(`add-person: REFUSED — ${refusal.message}`);
    return REFUSED;
  }
  io.say(`add-person: REFUSED — ${personReason(refusal, email)}`);
  return exitOf(refusal);
};

export const addPersonCommand = async (doors: Doors, flags: Flags, io: OpsIo): Promise<number> => {
  const email = flagValue(flags, "email");
  const name = flagValue(flags, "name");
  if (email === undefined || name === undefined) {
    io.say(ADD_PERSON_USAGE);
    return USAGE;
  }
  const added = await addPerson(IDENTITY_PRINCIPAL, doors.postgres, { email, name });
  if (!added.ok) return personRefused(added.error, email, io);
  const person = added.value;
  io.say(
    `add-person: done — ${person.personId}, ${person.email}, named ${person.displayName}; unverified until their first email-code sign-in`,
  );
  return DONE;
};

const renameReason = (refusal: RenameRefusal | Error, workspaceId: string): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "malformed":
      return "malformed: give --workspace a workspace id, and --name, --short-name or both a value that is not blank";
    case "no-such-workspace":
      return noSuchWorkspace(workspaceId);
    case "slug-taken":
      return "slug-taken: another workspace already holds that short name";
  }
};

export const renameWorkspaceCommand = async (
  doors: Doors,
  flags: Flags,
  io: OpsIo,
): Promise<number> => {
  const workspaceId = flagValue(flags, "workspace");
  if (workspaceId === undefined) {
    io.say(
      "rename-workspace: --workspace <id> is required, with --name <name>, --short-name <short name> or both",
    );
    return USAGE;
  }
  const renamed = await renameWorkspace(BOOTSTRAP, doors.postgres, {
    workspaceId,
    name: flagValue(flags, "name"),
    shortName: flagValue(flags, "short-name"),
  });
  if (!renamed.ok) {
    io.say(`rename-workspace: REFUSED — ${renameReason(renamed.error, workspaceId)}`);
    return exitOf(renamed.error);
  }
  const { name, shortName } = renamed.value;
  io.say(
    `rename-workspace: done — workspace ${workspaceId} is named ${name}, short name ${shortName}`,
  );
  return DONE;
};
