import type { View } from "@/shared/screens.ts";

/** Typed by the list of screens, so a view renamed there fails here at compile time. */
export const EVERYONE_PATH: View["path"] = "/console/people/everyone";

const SEARCH = "search";

const PERSON = "person";

/** Where signing in again comes back to: the person, found by their address, open at the act. */
export const backTo = (person: { readonly id: string; readonly email: string }): string =>
  `${EVERYONE_PATH}?${new URLSearchParams({ [SEARCH]: person.email, [PERSON]: person.id }).toString()}`;

export type Arrival = { readonly search: string; readonly personId: string | undefined };

/** Read off the address bar, whose query the router would re-type as JSON. */
export const arrival = (): Arrival => {
  const query = new URLSearchParams(globalThis.location.search);
  return { search: query.get(SEARCH) ?? "", personId: query.get(PERSON) ?? undefined };
};
