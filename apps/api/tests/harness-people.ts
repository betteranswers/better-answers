import { z } from "zod";

import { addToGroup, createGroup } from "@better-answers/core/members";

import { actingIn, type TestApp } from "./harness.ts";

export const groupsMaking = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  names: z.array(z.string().min(1)).min(1),
  memberIds: z.array(z.string().min(1)).default([]),
});

/**
 * The slice's own acts record the member as actor; a transaction each gives each event its own
 * instant.
 */
export const makeGroups = async (
  app: TestApp,
  asked: z.input<typeof groupsMaking>,
): Promise<{ readonly made: number }> => {
  const { workspaceId, userId } = asked;
  for (const name of asked.names) {
    const { groupId } = await actingIn(app, { workspaceId, userId }, (principal, tx) =>
      createGroup(principal, tx, { name }),
    );
    for (const memberId of asked.memberIds ?? []) {
      await actingIn(app, { workspaceId, userId }, (principal, tx) =>
        addToGroup(principal, tx, { groupId, userId: memberId }),
      );
    }
  }
  return { made: asked.names.length };
};
