import { z } from "zod";

import { PAGE_NUMBER, searchText } from "@/shared/list-address.ts";

import type { InvitationStatus } from "./invitations-api.ts";

export const INVITATIONS_LIST = "invitations";

export const INVITATION_STATUSES = [
  "waiting",
  "accepted",
  "expired",
  "cancelled",
] as const satisfies readonly InvitationStatus[];

export const DEFAULT_STATUS = INVITATION_STATUSES[0];

export const INVITATIONS_FIELDS = {
  search: searchText(),
  status: z.enum(INVITATION_STATUSES).catch(DEFAULT_STATUS),
  page: PAGE_NUMBER,
};

export const isActable = (status: InvitationStatus): boolean =>
  status === "waiting" || status === "expired";
