import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { invitation, user } from "./identity-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

export const ACCESS_REQUEST_STATUSES = ["waiting", "approved", "declined"] as const;

export const ACCESS_REQUEST_OPEN_STATUS =
  "waiting" satisfies (typeof ACCESS_REQUEST_STATUSES)[number];

export const ACCESS_REQUEST_REASON_MAX = 1_000;

const statusList = ACCESS_REQUEST_STATUSES.map((status) => `'${status}'`).join(", ");

export const accessRequest = withRLS(
  "access_request",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),

    // No cascade on either person reference or the invitation: the platform never deletes a
    // `user` row, so one promises a path that does not exist.
    requesterId: text("requester_id")
      .notNull()
      .references(() => user.id),
    reason: text("reason").notNull(),
    status: text("status").notNull().default(ACCESS_REQUEST_OPEN_STATUS),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),

    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),

    invitationId: text("invitation_id").references(() => invitation.id),
  },
  "workspaceId",
  (table) => [
    index("access_request_workspace_id_idx").on(table.workspaceId),

    uniqueIndex("access_request_waiting_uidx")
      .on(table.workspaceId, table.requesterId)
      .where(sql.raw(`status = '${ACCESS_REQUEST_OPEN_STATUS}'`)),
    check("access_request_status_check", sql.raw(`status IN (${statusList})`)),

    check(
      "access_request_decision_check",
      sql.raw(
        `(status = '${ACCESS_REQUEST_OPEN_STATUS}') = (decided_at IS NULL)
         AND (decided_at IS NULL) = (decided_by IS NULL)
         AND (invitation_id IS NULL OR status = 'approved')`,
      ),
    ),
  ],
);
