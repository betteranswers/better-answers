import { z } from "zod";

import { createGroup } from "@better-answers/core/members";

import { actingIn, type TestApp } from "./harness.ts";

export const groupsMaking = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  names: z.array(z.string().min(1)).min(1),
});

/**
 * The slice's own act records the member as actor; a transaction each gives each event its own
 * instant.
 */
export const makeGroups = async (
  app: TestApp,
  asked: z.output<typeof groupsMaking>,
): Promise<{ readonly made: number }> => {
  const { workspaceId, userId } = asked;
  for (const name of asked.names) {
    await actingIn(app, { workspaceId, userId }, (principal, tx) =>
      createGroup(principal, tx, { name }),
    );
  }
  return { made: asked.names.length };
};
