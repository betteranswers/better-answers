import { processActorId, type PlatformPrincipal } from "@better-answers/core/kernel";

export const IDENTITY_PRINCIPAL: PlatformPrincipal = {
  kind: "platform",
  actorId: processActorId("identity"),
};
