import { type Ask, askedIn } from "@/shared/address-ask.ts";
import type { PagePath } from "@/shared/navigation.ts";

export const EVERYONE_PATH: PagePath = "/console/people/everyone";

export const NAMES_WAITING_PATH: PagePath = "/console/people/names-waiting";

const SEARCH = "search";

const PERSON = "person";

const ACTION: Ask = "action";

export type FreshAction = "revoke" | "correct";

export type Arrival = {
  readonly search: string;
  readonly personId: string | undefined;
  readonly action: FreshAction;
};

/** Read off the address bar, whose query the router would re-type as JSON. */
export const arrival = (): Arrival => {
  const query = new URLSearchParams(globalThis.location.search);
  return {
    search: query.get(SEARCH) ?? "",
    personId: query.get(PERSON) ?? undefined,
    action: askedIn(query, ACTION) === "correct" ? "correct" : "revoke",
  };
};
