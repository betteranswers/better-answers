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

/**
 * A member's write to the bundle, fenced across processes as well as in this one. The
 * in-process queue comes first, so one writer per workspace in this process waits on the fence.
 */
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

/** As withBundleWrite, for the platform's own work, which may rewrite history and so hold it alone. */
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

/**
 * As withBundleFenceAs, but `held` at once while work in this process has the repository or a
 * rewrite elsewhere holds the bundle. The in-process try still comes first: taking the fence
 * before the queue would make a cycle across processes that Postgres cannot see.
 */
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
