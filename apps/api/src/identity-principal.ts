import type { PlatformPrincipal } from "@better-answers/core/kernel";

// Outside the auth module, so the tRPC router reaches it without pulling Better Auth into the
// web's type program.
export const IDENTITY_PRINCIPAL: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-identity",
};
