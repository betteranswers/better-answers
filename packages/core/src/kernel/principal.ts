import type { z } from "zod";

import type {
  AccessRequestId,
  AuditEventId,
  boundarySchemas,
  GroupId,
  UserId,
  WorkspaceId,
} from "@better-answers/schema";

import type { ProcessActorId } from "./actor.ts";
import type { KernelRefusal } from "./vocabulary.ts";

export type { AccessRequestId, AuditEventId, GroupId, UserId, WorkspaceId };

export type Role = z.infer<typeof boundarySchemas.member.select>["role"];

/**
 * A Principal outlives the transaction that resolved it only where an action opens its own; never
 * the request, and that action's door re-judges it.
 */
export type UserPrincipal = {
  readonly kind: "user";
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly role: Role;

  readonly groups: readonly GroupId[];

  readonly credentialIssuedAtMs: number;
};

export type PlatformPrincipal = {
  readonly kind: "platform";

  readonly actorId: ProcessActorId;
};

export type Principal = UserPrincipal | PlatformPrincipal;

/**
 * Kept out of `Principal`, so no action over a workspace's data can be handed a caller who belongs
 * to none of them.
 */
export type OperatorPrincipal = {
  readonly kind: "operator";
  readonly userId: UserId;

  readonly credentialIssuedAtMs: number;
};

export type Claims = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly issuedAt: Date;
  readonly role?: Role;

  /** The session a cookie names, whose confirmation stamp is the person's; a bearer names none. */
  readonly sessionId?: string;
};

export type PrincipalRefusal = KernelRefusal<
  "not-a-member" | "credentials-revoked" | "role-disagrees" | "role-unknown" | "malformed-claims"
>;

export type OperatorRefusal = KernelRefusal<"not-the-operator">;
