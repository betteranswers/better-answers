import type { boundarySchemas } from "@better-answers/schema";
import type { z } from "zod";

import type { ProcessActorId } from "./actor.ts";
import type { KernelRefusal } from "./vocabulary.ts";

export type WorkspaceId = z.infer<typeof boundarySchemas.workspace.select>["id"];
export type UserId = z.infer<typeof boundarySchemas.user.select>["id"];
export type Role = z.infer<typeof boundarySchemas.member.select>["role"];

export type AuditEventId = z.infer<typeof boundarySchemas.auditEvent.select>["id"];

export type AccessRequestId = z.infer<typeof boundarySchemas.accessRequest.select>["id"];

export type GroupId = z.infer<typeof boundarySchemas.group.select>["id"];

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

export type Claims = {
  readonly workspaceId: string;
  readonly userId: string;
  readonly issuedAt: Date;
  readonly role?: Role;
};

export type PrincipalRefusal = KernelRefusal<
  "not-a-member" | "credentials-revoked" | "role-disagrees" | "role-unknown" | "malformed-claims"
>;
