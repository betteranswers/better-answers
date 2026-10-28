import { boundarySchemas, ROLES } from "@better-answers/schema";

import { err, ok, type Result } from "../../kernel/index.ts";
import type {
  Claims,
  OperatorPrincipal,
  OperatorRefusal,
  PrincipalRefusal,
  Role,
  UserId,
  UserPrincipal,
  WorkspaceId,
} from "../../kernel/index.ts";
import type { PostgresDoor, Tx } from "./door.ts";
import { answersARefusal, type Opened } from "./folding.ts";
import { type Opening, scopeTo, transaction } from "./transaction.ts";

const STAMP_STANDS_FOR = "interval '1 hour'";

const MEMBER_QUERY = `SELECT m.role AS role, u.credentials_revoked_at AS person_revoked_at,
            m.credentials_revoked_at AS member_revoked_at,
            COALESCE((SELECT array_agg(gm.group_id ORDER BY gm.group_id)
                        FROM group_member gm
                       WHERE gm.workspace_id = m.workspace_id AND gm.user_id = m.user_id),
                     '{}') AS group_ids,
            (SELECT s.second_factor_confirmed_at FROM session s
              WHERE s.id = $3 AND s.user_id = m.user_id) AS "confirmedAt",
            COALESCE((SELECT l.at < now() - ${STAMP_STANDS_FOR} FROM workspace_last_active l
                       WHERE l.workspace_id = m.workspace_id AND l.user_id = m.user_id),
                     true) AS "lastActiveStale"
     FROM member m
     JOIN "user" u ON u.id = m.user_id
    WHERE m.workspace_id = $1 AND m.user_id = $2`;

const MEMBER_QUERY_HELD = `${MEMBER_QUERY} FOR SHARE OF m, u`;

const isRole = (value: string): value is Role => ROLES.some((role) => role === value);

type MemberRow = {
  readonly role: string;
  readonly person_revoked_at: Date | null;
  readonly member_revoked_at: Date | null;
  readonly group_ids: readonly string[];

  readonly confirmedAt: Date | null;

  readonly lastActiveStale: boolean;
};

const STAMP = `INSERT INTO workspace_last_active (workspace_id, user_id, at)
       SELECT $1, $2, now()
        WHERE EXISTS (SELECT 1 FROM member WHERE workspace_id = $1 AND user_id = $2)
           ON CONFLICT (workspace_id, user_id)
           DO UPDATE SET at = now()
            WHERE workspace_last_active.at < now() - ${STAMP_STANDS_FOR}`;

const stampLastActive = async (
  door: PostgresDoor,
  workspaceId: string,
  userId: string,
): Promise<void> => {
  try {
    await transaction(door, async (tx) => {
      await scopeTo(tx, workspaceId);
      await tx.query("SET LOCAL lock_timeout = '50ms'");
      await tx.query(STAMP, [workspaceId, userId]);
    });
  } catch {
    // The request is already answered, and the next one past the hour stamps again.
  }
};

const resolveClaims = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
  query: string,
  opening: Opening,
): Promise<Opened<T>> => {
  const workspaceId = boundarySchemas.workspace.select.shape.id.safeParse(claims.workspaceId);
  const userId = boundarySchemas.user.select.shape.id.safeParse(claims.userId);
  if (!workspaceId.success || !userId.success) return err("malformed-claims");

  const credentialIssuedAtMs = claims.issuedAt.getTime();

  const seen = { lastActiveStale: false };
  const opened = await resolveScoped(
    door,
    workspaceId.data,
    userId.data,
    claims.sessionId ?? null,
    credentialIssuedAtMs,
    (row) => {
      const refusal = refuse(row, credentialIssuedAtMs);
      if (!refusal.ok) return refusal;

      seen.lastActiveStale = refusal.value.lastActiveStale;
      const resolved: ResolvedMember = {
        ...refusal.value,
        confirmedAtMs: refusal.value.confirmedAt?.getTime() ?? null,
      };
      return claims.role === undefined || claims.role === resolved.role
        ? ok(resolved)
        : err("role-disagrees");
    },
    work,
    query,
    opening,
  );
  if (opened.ok && seen.lastActiveStale) {
    await stampLastActive(door, workspaceId.data, userId.data);
  }
  return opened;
};

export const withPrincipal = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => resolveClaims(door, claims, work, MEMBER_QUERY, "BEGIN");

/**
 * As withPrincipal, but read-only: a write inside the work fails at its own statement. A stale
 * last-active stamp is still written.
 */
export const withPrincipalRead = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => resolveClaims(door, claims, work, MEMBER_QUERY, "BEGIN READ ONLY");

/**
 * As withPrincipal, but the member and user rows stay held until commit, so a revocation cannot
 * land between the read and the commit.
 */
export const withHeldPrincipal = async <T>(
  door: PostgresDoor,
  claims: Claims,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => resolveClaims(door, claims, work, MEMBER_QUERY_HELD, "BEGIN");

const withMemberQuery = async <T>(
  principal: UserPrincipal,
  door: PostgresDoor,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
  query: string,
  opening: Opening,
): Promise<Opened<T>> =>
  resolveScoped(
    door,
    principal.workspaceId,
    principal.userId,
    null,
    principal.credentialIssuedAtMs,
    (row) => {
      const refusal = refuse(row, principal.credentialIssuedAtMs);
      if (!refusal.ok) return refusal;

      const resolved: ResolvedMember = {
        ...refusal.value,
        confirmedAtMs: principal.secondFactorConfirmedAtMs,
      };
      return resolved.role === principal.role ? ok(resolved) : err("role-disagrees");
    },
    work,
    query,
    opening,
  );

/**
 * Refuses a non-member, an unknown role, revoked credentials, and a role that has moved.
 */
export const withMember = async <T>(
  principal: UserPrincipal,
  door: PostgresDoor,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => withMemberQuery(principal, door, work, MEMBER_QUERY_HELD, "BEGIN");

/**
 * As withMember, but read-only, and the rows are read, not held, so a long read never stalls
 * another Admin's role change or removal.
 */
export const withMemberUnheld = async <T>(
  principal: UserPrincipal,
  door: PostgresDoor,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Opened<T>> => withMemberQuery(principal, door, work, MEMBER_QUERY, "BEGIN READ ONLY");

const resolveScoped = async <T>(
  door: PostgresDoor,
  workspaceId: WorkspaceId,
  userId: UserId,
  sessionId: string | null,
  credentialIssuedAtMs: number,
  resolve: (row: MemberRow | undefined) => Result<ResolvedMember, PrincipalRefusal>,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
  query: string,
  opening: Opening,
): Promise<Opened<T>> =>
  transaction(
    door,
    async (tx): Promise<Opened<T>> => {
      await scopeTo(tx, workspaceId);

      const member = await tx.query<MemberRow>(query, [workspaceId, userId, sessionId]);
      const resolved = resolve(member.rows[0]);
      if (!resolved.ok) return err(resolved.error);

      const principal: UserPrincipal = {
        kind: "user",
        workspaceId,
        userId,
        role: resolved.value.role,

        groups: resolved.value.group_ids.map((id) =>
          boundarySchemas.group.select.shape.id.parse(id),
        ),
        credentialIssuedAtMs,
        secondFactorConfirmedAtMs: resolved.value.confirmedAtMs,
      };
      return ok(await work(principal, tx));
    },
    (opened) => !opened.ok || answersARefusal(opened.value),
    opening,
  );

type ResolvedMember = MemberRow & { readonly role: Role; readonly confirmedAtMs: number | null };

type AdmittedMember = MemberRow & { readonly role: Role };

const refuse = (
  row: MemberRow | undefined,
  credentialIssuedAtMs: number,
): Result<AdmittedMember, PrincipalRefusal> => {
  if (row === undefined) return err("not-a-member");

  if (!isRole(row.role)) return err("role-unknown");

  for (const revokedAt of [row.person_revoked_at, row.member_revoked_at]) {
    if (revokedAt !== null && credentialIssuedAtMs < revokedAt.getTime()) {
      return err("credentials-revoked");
    }
  }
  return ok({ ...row, role: row.role });
};

type OperatorRow = {
  readonly id: string;
  readonly operator: boolean;
  readonly revoked_at: Date | null;

  readonly confirmedAt: Date | null;
};

const carriesTheMark = (
  row: OperatorRow | undefined,
  credentialIssuedAtMs: number,
): row is OperatorRow =>
  row !== undefined &&
  row.operator &&
  (row.revoked_at === null || credentialIssuedAtMs >= row.revoked_at.getTime());

const resolveOperator = async <T>(
  door: PostgresDoor,
  claims: Pick<Claims, "userId" | "issuedAt" | "sessionId">,
  work: (operator: OperatorPrincipal, tx: Tx) => Promise<T>,
  opening: Opening,
): Promise<Result<T, OperatorRefusal>> => {
  const credentialIssuedAtMs = claims.issuedAt.getTime();

  return transaction(
    door,
    async (tx): Promise<Result<T, OperatorRefusal>> => {
      const found = await tx.query<OperatorRow>(
        `SELECT id, operator, credentials_revoked_at AS revoked_at,
                (SELECT s.second_factor_confirmed_at FROM session s
                  WHERE s.id = $2 AND s.user_id = "user".id) AS "confirmedAt"
           FROM "user" WHERE id = $1`,
        [claims.userId, claims.sessionId ?? null],
      );
      const row = found.rows[0];
      if (!carriesTheMark(row, credentialIssuedAtMs)) return err("not-the-operator");

      const operator: OperatorPrincipal = {
        kind: "operator",
        userId: boundarySchemas.user.select.shape.id.parse(row.id),
        credentialIssuedAtMs,
        secondFactorConfirmedAtMs: row.confirmedAt?.getTime() ?? null,
      };
      return ok(await work(operator, tx));
    },
    (opened) => !opened.ok || answersARefusal(opened.value),
    opening,
  );
};

export const withOperator = async <T>(
  door: PostgresDoor,
  claims: Pick<Claims, "userId" | "issuedAt" | "sessionId">,
  work: (operator: OperatorPrincipal, tx: Tx) => Promise<T>,
): Promise<Result<T, OperatorRefusal>> => resolveOperator(door, claims, work, "BEGIN");

export const withOperatorRead = async <T>(
  door: PostgresDoor,
  claims: Pick<Claims, "userId" | "issuedAt" | "sessionId">,
  work: (operator: OperatorPrincipal, tx: Tx) => Promise<T>,
): Promise<Result<T, OperatorRefusal>> => resolveOperator(door, claims, work, "BEGIN READ ONLY");
