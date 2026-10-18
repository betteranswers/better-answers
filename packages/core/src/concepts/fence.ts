import {
  attempt,
  err,
  type PlatformPrincipal,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  tryRepositoryLockAs,
  withRepositoryLock,
  withRepositoryLockAs,
  type GitDoor,
} from "../store/git/index.ts";
import {
  tryWorkspaceFence,
  withWorkspaceFence,
  type FenceHold,
  type LockHeld,
  type PostgresDoor,
} from "../store/postgres/index.ts";

type BundleDoors = { readonly git: GitDoor; readonly postgres: PostgresDoor };

export const withBundleWrite = async <T extends Result<unknown, unknown>>(
  principal: UserPrincipal,
  doors: BundleDoors,
  work: () => Promise<T>,
): Promise<T | Result<never, Error>> => {
  const fenced = await attempt(() =>
    withRepositoryLock(principal, doors.git, () =>
      withWorkspaceFence(principal, doors.postgres, principal.workspaceId, "shared", work),
    ),
  );
  return fenced.ok ? fenced.value : err(fenced.error);
};

export const withBundleFenceAs = <T>(
  platform: PlatformPrincipal,
  doors: BundleDoors,
  workspaceId: string,
  hold: FenceHold,
  work: () => Promise<T>,
): Promise<T> =>
  withRepositoryLockAs(platform, doors.git, workspaceId, () =>
    withWorkspaceFence(platform, doors.postgres, workspaceId, hold, work),
  );

export const tryBundleFenceAs = async <T>(
  platform: PlatformPrincipal,
  doors: BundleDoors,
  workspaceId: string,
  hold: FenceHold,
  work: () => Promise<T>,
): Promise<Result<T, LockHeld>> => {
  const tried = await tryRepositoryLockAs(platform, doors.git, workspaceId, () =>
    tryWorkspaceFence(platform, doors.postgres, workspaceId, hold, work),
  );
  return tried.ok ? tried.value : tried;
};
