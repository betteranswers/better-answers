import type { CarriedOn } from "./sign-in-words.ts";

const SIGNATURE = "sig";

/** When the signed query lapses, in seconds since the epoch. */
const EXPIRY = "exp";

const MS_PER_SECOND = 1000;

/**
 * The router's search string turns a repeated key into one JSON array, breaking a signed query,
 * so these pages read theirs off the address bar.
 */
export const pageQuery = (): string => globalThis.location.search;

/** The whole query when it carries a signed flow, else the empty string. */
export const carriedFlow = (query: string): string =>
  new URLSearchParams(query).has(SIGNATURE) ? query : "";

const stillLive = (query: string): boolean =>
  carriedFlow(query) !== "" &&
  Number(new URLSearchParams(query).get(EXPIRY)) * MS_PER_SECOND > Date.now();

/** A live flow resumes at the picker, which hands it on to consent. */
export const nextAfterJoining = (query: string): string =>
  stillLive(query) ? `/choose-workspace${query}` : "/";

/**
 * The Better Auth client plugin sends the page's signed query with every write, and the api refuses a lapsed
 * one, sign-out included.
 */
export const dropTheCarriedFlow = (): void => {
  if (carriedFlow(pageQuery()) === "") return;
  globalThis.history.replaceState(globalThis.history.state, "", globalThis.location.pathname);
};

/** A router navigation would re-serialise a carried query and break its signature. */
export const leavingFor = (href: string) => ({
  href,
  replace: true,
  reloadDocument: new URL(href, "https://app.invalid").searchParams.has(SIGNATURE),
});

/** Anything but a path on this origin is an open redirect with a person's session behind it. */
const safeReturnPath = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
};

const INVITATIONS = "/invitations/";

export const invitationAt = (invitationId: string): string =>
  `${INVITATIONS}${encodeURIComponent(invitationId)}`;

export const isAnInvitation = (path: string): boolean => path.startsWith(INVITATIONS);

/** A page, such as the sign-in page, asked to send the person on to `path` once done. */
export const backTo = (page: string, path: string): string =>
  `${page}?redirect=${encodeURIComponent(path)}`;

/** A signed flow goes on to the workspace picker; otherwise `redirect` on this origin, or home. */
export const nextAfterSignIn = (query: string): string => {
  const carried = carriedFlow(query);
  if (carried !== "") return `/choose-workspace${carried}`;
  return safeReturnPath(new URLSearchParams(query).get("redirect")) ?? "/";
};

/** Claude is the one assistant the authorization server admits, so a signed flow is Claude's. */
export const carriedOnTo = (query: string): CarriedOn | undefined => {
  if (carriedFlow(query) !== "") return "connecting";
  const back = safeReturnPath(new URLSearchParams(query).get("redirect"));
  return back !== undefined && isAnInvitation(back) ? "joining" : undefined;
};
