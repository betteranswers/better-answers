import type { ScreenPath } from "@/shared/navigation.ts";

/** Typed by the navigation list, so a screen moved there fails here at compile time. */
export const EVERYONE_PATH: ScreenPath = "/console/people/everyone";

export const NAMES_WAITING_PATH: ScreenPath = "/console/people/names-waiting";

const SEARCH = "search";

const PERSON = "person";

const ACT = "act";

/** The sheet's two acts that ask for a sign-in from the last hour. */
export type FreshAct = "revoke" | "correct";

const addressOf = (path: ScreenPath, query: Readonly<Record<string, string>>): string =>
  `${path}?${new URLSearchParams(query).toString()}`;

/** Where signing in again comes back to: the person, found by their address, open at the act. */
export const backTo = (
  person: { readonly id: string; readonly email: string },
  act: FreshAct,
): string => addressOf(EVERYONE_PATH, { [SEARCH]: person.email, [PERSON]: person.id, [ACT]: act });

/** Where signing in again comes back to from Names waiting: the list, focus on the person's act. */
export const backToTheName = (personId: string): string =>
  addressOf(NAMES_WAITING_PATH, { [PERSON]: personId });

export type Arrival = {
  readonly search: string;
  readonly personId: string | undefined;
  readonly act: FreshAct;
};

/** Read off the address bar, whose query the router would re-type as JSON. */
export const arrival = (): Arrival => {
  const query = new URLSearchParams(globalThis.location.search);
  return {
    search: query.get(SEARCH) ?? "",
    personId: query.get(PERSON) ?? undefined,
    act: query.get(ACT) === "correct" ? "correct" : "revoke",
  };
};
