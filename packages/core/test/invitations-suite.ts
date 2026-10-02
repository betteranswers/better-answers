import { createHash } from "node:crypto";

import type { MigratedPostgres } from "@better-answers/schema/testing";

import { CeilingMet, type Result, type Role, type UserPrincipal } from "../src/kernel/index.ts";
import {
  cancelInvitation,
  inviteMembers,
  inviteMembersInput,
  resendInvitation,
} from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import type { ProvisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { readingAs, seedingWith } from "./suite-postgres.ts";

export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const INVITED_AT = new Date("2031-06-15T09:30:00.000Z");

export const A_WEEK_LATER = "2031-06-22T09:30:00.000Z";

export type InvitationRow = {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly inviter_id: string;
  readonly created_at: Date;
  readonly expires_at: Date;
};

export const answeredValue = <T>(answer: Result<T, unknown>): T => {
  if (!answer.ok) throw new Error(`the act answered ${String(answer.error)}`);
  return answer.value;
};

/** When to ask again, if the act answered a ceiling met. */
export const ceilingOf = (answer: Result<unknown, unknown>): number | undefined =>
  !answer.ok && answer.error instanceof CeilingMet ? answer.error.retryAfterSeconds : undefined;

/** `db` answers the suite's database once its hooks have run, so it is read at each call. */
export const invitationsSuite = (db: () => MigratedPostgres) => {
  const as = <T>(
    workspace: ProvisionedWorkspace,
    userId: string,
    work: (principal: UserPrincipal, tx: Tx) => Promise<Result<T, unknown>>,
  ) => readingAs(db().runtimePool, { workspaceId: workspace.workspaceId, userId }, work);

  const sending = (
    workspace: ProvisionedWorkspace,
    addresses: readonly string[],
    role: string,
    now: Date = INVITED_AT,
  ) =>
    as(workspace, workspace.adminUserId, (principal, tx) =>
      inviteMembers(principal, tx, {
        ...inputOf(inviteMembersInput, { addresses, role }),
        now,
      }),
    );

  /** One address, answering its one invitation as the act answered it. */
  const invite = async (
    workspace: ProvisionedWorkspace,
    address: string,
    role: string,
    now: Date = INVITED_AT,
  ) => {
    const sent = await sending(workspace, [address], role, now);
    if (!sent.ok) return sent;
    const [one] = sent.value;
    if (one === undefined) throw new Error("the send answered no invitation");
    return { ok: true as const, value: one };
  };

  const resending = (workspace: ProvisionedWorkspace, invitationId: string, now: Date) =>
    as(workspace, workspace.adminUserId, (principal, tx) =>
      resendInvitation(principal, tx, { invitationId, now }),
    );

  /** Five emails to `address` in the hour `INVITED_AT` falls in: an invitation and four resends. */
  const atTheCeiling = async (workspace: ProvisionedWorkspace, address: string) => {
    const invited = answeredValue(await invite(workspace, address, "Viewer"));
    for (let resend = 0; resend < 4; resend += 1) {
      answeredValue(await resending(workspace, invited.invitationId, INVITED_AT));
    }
    return invited;
  };

  const cancelledInvitation = async (
    workspace: ProvisionedWorkspace,
    address: string,
    role = "Viewer",
  ) => {
    const invited = answeredValue(await invite(workspace, address, role));
    answeredValue(
      await as(workspace, workspace.adminUserId, (principal, tx) =>
        cancelInvitation(principal, tx, { invitationId: invited.invitationId }),
      ),
    );
    return invited;
  };

  const memberAt = async (workspace: ProvisionedWorkspace, role: Role) =>
    seedingWith(db().pool, async (seed) => {
      const person = await seed.user();
      await seed.member({ workspaceId: workspace.workspaceId, userId: person.id, role });
      return person;
    });

  /** A row as an accept or a past send left it, written beside the act. */
  const invitationLeft = (
    workspace: ProvisionedWorkspace,
    row: { readonly email: string; readonly status: string; readonly expiresAt?: Date },
  ) =>
    seedingWith(db().pool, async (seed) =>
      seed.invitation({
        workspaceId: workspace.workspaceId,
        inviterId: workspace.adminUserId,
        createdAt: INVITED_AT,
        expiresAt: row.expiresAt ?? new Date(A_WEEK_LATER),
        email: row.email,
        status: row.status,
        role: "Viewer",
      }),
    );

  const invitationsOf = async (workspace: ProvisionedWorkspace): Promise<InvitationRow[]> =>
    (
      await db().pool.query<InvitationRow>(
        `SELECT id, email, role, status, inviter_id, created_at, expires_at
           FROM invitation WHERE workspace_id = $1 ORDER BY created_at, id`,
        [workspace.workspaceId],
      )
    ).rows;

  const invitationEvents = async (workspace: ProvisionedWorkspace) =>
    (
      await db().pool.query<{
        act: string;
        actor: string;
        subject_id: string;
        detail: Record<string, string>;
        batch_id: string | null;
      }>(
        `SELECT act, actor, subject_id, detail, batch_id FROM audit_event
          WHERE workspace_id = $1 AND act LIKE 'people.invitation.%' ORDER BY id`,
        [workspace.workspaceId],
      )
    ).rows;

  /** The emails counted to `address` from this workspace, in every window. */
  const emailsCountedTo = async (workspace: ProvisionedWorkspace, address: string) => {
    const key = createHash("sha256").update(`${workspace.workspaceId}:${address}`).digest("hex");
    const counted = await db().pool.query<{ count: number }>(
      "SELECT coalesce(sum(count), 0)::int AS count FROM ingress_counter WHERE scope = 'invitation' AND key = $1",
      [key],
    );
    return counted.rows[0]?.count;
  };

  return {
    as,
    sending,
    invite,
    resending,
    atTheCeiling,
    cancelledInvitation,
    memberAt,
    invitationLeft,
    invitationsOf,
    invitationEvents,
    emailsCountedTo,
  };
};
