import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { invitation, user } from "./identity-tables.ts";
import { withRLS } from "./with-rls.ts";
import { workspace } from "./workspace-table.ts";

/**
 * The *access request* (`CONTEXT.md`; ADR 0038): a signed-in person's recorded ask to join
 * one workspace, with a reason, decided by an Admin — approved, which mints the invitation,
 * or declined. An ordinary tenant table (`withRLS()`), so a request always belongs to the
 * workspace it names and an Admin reads only their own workspace's queue.
 *
 * **The requester is a person id** — the identity set's `user` row (ADR 0035), never an
 * email: the person has signed in and holds no membership here, which is the whole point of
 * the record. The reason is required, because an Admin deciding needs one.
 *
 * **No asks column and no duration column** (ADR 0038): a v0.1 request asks for exactly one
 * thing, workspace membership, so the kind is implicit and a later kind is an additive
 * column; temporal access is Entra-PIM territory and is not adopted. There is no expiry
 * state and no sweeper either.
 */

/** The three statuses a request passes through, the one closed list, as `ROLES` is for roles. */
export const ACCESS_REQUEST_STATUSES = ["waiting", "approved", "declined"] as const;

/** The status a request is born at — nobody has decided it yet. */
export const ACCESS_REQUEST_OPEN_STATUS =
  "waiting" satisfies (typeof ACCESS_REQUEST_STATUSES)[number];

/**
 * How long a reason may be. A sentence of why, not a document: the column is text, so the
 * bound is the boundary's, and it is here rather than in the slice because the boundary
 * narrows every writer at once — a request surface open to any signed-in person is a place
 * an unbounded field would be storage a stranger chooses the size of.
 */
export const ACCESS_REQUEST_REASON_MAX = 1_000;

const statusList = ACCESS_REQUEST_STATUSES.map((status) => `'${status}'`).join(", ");

export const accessRequest = withRLS(
  "access_request",
  {
    // Caller-minted, as the ledger's id is: the act mints it before it writes, so the
    // event's subject id and the row's id are one value the act never has to read back.
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // No cascade on either person reference, nor on the invitation: the platform does not
    // delete a `user` row — the delete-user endpoint is refused as unconfigured and an
    // erasure pseudonymises the row and keeps its id (ADR 0035) — so a cascade would be a
    // promise about a path that does not exist, and the plain reference says instead that
    // the row is spoken for.
    requesterId: text("requester_id")
      .notNull()
      .references(() => user.id),
    reason: text("reason").notNull(),
    status: text("status").notNull().default(ACCESS_REQUEST_OPEN_STATUS),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    // The three columns a decision writes, all null until one is taken.
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    // What approve minted, so T-027's accept flow and the screens join the two records.
    invitationId: text("invitation_id").references(() => invitation.id),
  },
  "workspaceId",
  (table) => [
    index("access_request_workspace_id_idx").on(table.workspaceId),
    // One open request per workspace and requester (ADR 0038): a partial unique index over
    // the waiting status, so asking twice is refused by the database while a person who was
    // declined may ask again. The refusal never reaches a caller as its own outcome — the
    // request act answers the same neutral acknowledgement it answers for an unknown slug.
    uniqueIndex("access_request_waiting_uidx")
      .on(table.workspaceId, table.requesterId)
      .where(sql.raw(`status = '${ACCESS_REQUEST_OPEN_STATUS}'`)),
    check("access_request_status_check", sql.raw(`status IN (${statusList})`)),
    // The decision's three sentences, made the database's: a waiting request carries no
    // decision and a decided one carries both halves of it; only an approved request names
    // an invitation. A row that said otherwise would be a queue that lied to the screen.
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
