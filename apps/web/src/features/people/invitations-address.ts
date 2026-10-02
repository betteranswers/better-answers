import { z } from "zod";

import { PAGE_NUMBER } from "@/shared/list-address.ts";

import type { InvitationStatus } from "./invitations-api.ts";

/** Members' keys carry `members`, so the Invitations tab's carry their own prefix. */
export const INVITATIONS_LIST = "invitations";

/** In the order the status switch offers them, the one the tab opens on first. */
export const INVITATION_STATUSES = [
  "waiting",
  "accepted",
  "expired",
  "cancelled",
] as const satisfies readonly InvitationStatus[];

export const INVITATIONS_FIELDS = {
  search: z.string().catch(""),
  status: z.enum(INVITATION_STATUSES).catch("waiting"),
  page: PAGE_NUMBER,
};

/** Only a waiting or an expired invitation can be resent or cancelled, so only these are ticked. */
export const isActable = (status: InvitationStatus): boolean =>
  status === "waiting" || status === "expired";
