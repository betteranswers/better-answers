import { addressOf, type Ask, askedIn } from "@/shared/address-ask.ts";
import type { PagePath } from "@/shared/navigation.ts";

/** Typed by the navigation list, so a page moved there fails here at compile time. */
export const EVERYONE_PATH: PagePath = "/console/people/everyone";

export const NAMES_WAITING_PATH: PagePath = "/console/people/names-waiting";

const SEARCH = "search";

const PERSON = "person";

/** Read through `askedIn`, so a return address under the older key still lands. */
const ACTION: Ask = "action";

/** The sheet's two actions that ask for a sign-in from the last hour. */
export type FreshAction = "revoke" | "correct";

/** Where signing in again comes back to: the person, found by their address, open at the action. */
export const backTo = (
  person: { readonly id: string; readonly email: string },
  action: FreshAction,
): string =>
  addressOf(EVERYONE_PATH, { [SEARCH]: person.email, [PERSON]: person.id, [ACTION]: action });

/** Where signing in again comes back to from Names waiting: the list, focus on the person's action. */
export const backToTheName = (personId: string): string =>
  addressOf(NAMES_WAITING_PATH, { [PERSON]: personId });

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
