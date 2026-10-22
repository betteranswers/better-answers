import {
  attempt,
  err,
  type ActorId,
  type PlatformPrincipal,
  type Principal,
  type PrincipalRefusal,
  type Result,
  type UserId,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  commit,
  tryRepositoryLockAs,
  withRepositoryLock,
  withRepositoryLockAs,
  type CommitAuthor,
  type CommitRefusal,
  type CommitRequest,
  type Committed,
  type GitDoor,
} from "../store/git/index.ts";
import {
  scopeClause,
  scopeParameter,
  tryWorkspaceFence,
  withMember,
  withWorkspaceFence,
  type FenceHold,
  type LockHeld,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";

export const foldKind = (kind: string): string =>
  kind.replaceAll(/\S+/g, (word) => {
    const cased = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    if (cased.endsWith("ies")) return `${cased.slice(0, -3)}y`;
    if (/(s|x|z|ch|sh)es$/.test(cased)) return cased.slice(0, -2);
    if (/(ss|us|is)$/.test(cased) || !cased.endsWith("s")) return cased;
    return cased.slice(0, -1);
  });

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

export const commitAndLandAsMember = async <Refused extends string = never>(
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  request: CommitRequest,
  land: (fresh: UserPrincipal, tx: Tx, committed: Committed) => Promise<void>,
  admits: (fresh: UserPrincipal, tx: Tx) => Promise<Refused | undefined>,
): Promise<Result<Committed, CommitRefusal | Refused | PrincipalRefusal | Error>> => {
  const held = await attempt(() =>
    withMember(principal, doors.postgres, async (fresh, tx) => {
      const refusal = await admits(fresh, tx);
      if (refusal !== undefined) return err(refusal);
      const committed = await commit(fresh, doors.git, request);
      if (committed.ok) await land(fresh, tx, committed.value);
      return committed;
    }),
  );
  if (!held.ok) return err(held.error);
  return held.value.ok ? held.value.value : err(held.value.error);
};

type CommitLanding = {
  readonly commit: Committed;
  readonly actor: ActorId;
  readonly auditEventId: string;
};

export const landBundleCommit = async (
  principal: Principal,
  tx: Tx,
  landing: CommitLanding,
): Promise<void> => {
  await tx.query(
    `INSERT INTO bundle_commit (workspace_id, sha, parent_sha, audit_event_id, actor)
     VALUES (${scopeClause(1)}, $2, $3, $4, $5)`,
    [
      scopeParameter(principal),
      landing.commit.sha,
      landing.commit.parent,
      landing.auditEventId,
      landing.actor,
    ],
  );
};

export const authorOf = async (
  principal: Principal,
  tx: Tx,
  personId: UserId,
): Promise<CommitAuthor> => {
  const found = await tx.query<CommitAuthor>(
    `SELECT u.name, u.email FROM "user" u
       JOIN member m ON m.user_id = u.id AND m.workspace_id = ${scopeClause(1)}
      WHERE u.id = $2`,
    [scopeParameter(principal), personId],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error("the running member has no user row to sign the commits with");
  }
  return row;
};
