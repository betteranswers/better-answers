import type { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

// Type-only, so the pair `actor.ts` ↔ `principal.ts` forms no import cycle at runtime.
import type { ProcessActorId } from "./actor.ts";

/**
 * The Principal (`CONTEXT.md`, *principal*): who a call is made as. Built by
 * a transport from a verified credential, first parameter of every function in `core`
 * that touches tenant data, and alive only inside the transaction that resolved it
 * (`store/postgres`'s `withPrincipal`) — nothing caches one beyond a request.
 *
 * The ids are the boundary schemas' brands (ADR 0028: the boundary, not the table, is
 * the source of application-level types), so a user id cannot be passed where a
 * workspace id belongs.
 */
export type WorkspaceId = z.infer<typeof boundarySchemas.workspace.select>["id"];
export type UserId = z.infer<typeof boundarySchemas.user.select>["id"];
export type Role = z.infer<typeof boundarySchemas.member.select>["role"];
/** A ledger row's id — caller-minted, and what a governed write's commit trailer carries (ADR 0014 rule 4). */
export type AuditEventId = z.infer<typeof boundarySchemas.auditEvent.select>["id"];

/**
 * A group's id (ADR 0038), from the boundary like its neighbours rather than written by
 * hand: the members slice mints one, `group_member` names it, and T-006's `audience_groups`
 * holds exactly these.
 */
export type GroupId = z.infer<typeof boundarySchemas.group.select>["id"];

/** A person, in one workspace, at one role, on this call. */
export type UserPrincipal = {
  readonly kind: "user";
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly role: Role;
  /**
   * Every group this person is in, in this workspace, read on this call — groups are
   * re-read per call rather than carried on a credential (ADR 0009), so a person added to
   * a group sees what it sees on their next request and never has to sign in again.
   */
  readonly groups: readonly GroupId[];
};

/**
 * The platform acting as itself, with its own actor id and no person behind it
 * (`CONTEXT.md`, *platform principal*): workspace provisioning, the erasure routine,
 * the reconciler. Its acts are audited under that identity, never a person's.
 */
export type PlatformPrincipal = {
  readonly kind: "platform";
  /** The process arm of `ActorId` itself, so the two forms cannot drift apart. */
  readonly actorId: ProcessActorId;
};

export type Principal = UserPrincipal | PlatformPrincipal;

/**
 * What a transport hands the resolver: the token's `{workspace, user}` and its `iat`,
 * or the session's active workspace, user and creation time. `role` is present only
 * on a credential that carries one — the resolver refuses it if the member row
 * disagrees — and never on today's access token (ADR 0018, 2026-08-31 amendment).
 */
export type Claims = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly issuedAt: Date;
  readonly role?: Role;
};

/**
 * Why a resolve refused. Every one is a refusal, never a default role; a transport
 * maps them to its own protocol (a 401 on the MCP surface, a redirect on a page).
 */
export type PrincipalRefusal =
  | "not-a-member"
  | "credentials-revoked"
  | "role-disagrees"
  | "role-unknown"
  | "malformed-claims";
