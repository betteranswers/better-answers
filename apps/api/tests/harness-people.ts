import { z } from "zod";

import {
  addToGroup,
  createGroup,
  flagDisplayName,
  flagDisplayNameInput,
  requestAccess,
} from "@better-answers/core/members";

import { IDENTITY_PRINCIPAL } from "../src/identity-principal.ts";
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

export const accessAsking = z.object({
  slug: z.string().min(1),
  requesterId: z.string().min(1),
  reason: z.string().min(1),
});

/**
 * The slice's own act under the principal the ask-to-join procedure uses, without the sign-in and
 * the answer's floor that procedure puts in front of it.
 */
export const askToJoin = async (
  app: TestApp,
  asked: z.output<typeof accessAsking>,
): Promise<{ readonly asked: true }> => {
  const answered = await requestAccess(IDENTITY_PRINCIPAL, app.doors.postgres, asked);
  if (!answered.ok) throw new Error(`the ask answered ${String(answered.error)}`);
  return { asked: true };
};

export const nameFlagging = flagDisplayNameInput.extend({
  workspaceId: z.string().min(1),
  adminId: z.string().min(1),
});

/**
 * The slice's own act under the flagging Admin, less the operator's email the procedure sends once
 * it commits.
 */
export const flagTheName = async (
  app: TestApp,
  asked: z.output<typeof nameFlagging>,
): Promise<{ readonly flagged: true }> => {
  await actingIn(app, { workspaceId: asked.workspaceId, userId: asked.adminId }, (principal, tx) =>
    flagDisplayName(principal, tx, { personId: asked.personId }),
  );
  return { flagged: true };
};
