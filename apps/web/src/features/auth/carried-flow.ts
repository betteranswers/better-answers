import type { CarriedOn } from "./sign-in-words.ts";

const SIGNATURE = "sig";

const EXPIRY = "exp";

const MS_PER_SECOND = 1000;

/**
 * The router's search string turns a repeated key into one JSON array, breaking a signed query,
 * so these pages read theirs off the address bar.
 */
export const pageQuery = (): string => globalThis.location.search;

export const carriedFlow = (query: string): string =>
  new URLSearchParams(query).has(SIGNATURE) ? query : "";

const stillLive = (query: string): boolean =>
  carriedFlow(query) !== "" &&
  Number(new URLSearchParams(query).get(EXPIRY)) * MS_PER_SECOND > Date.now();

export const nextAfterJoining = (query: string): string =>
  stillLive(query) ? `/choose-workspace${query}` : "/";

/**
 * The Better Auth client plugin sends the page's signed query with every write, and the api refuses a lapsed
 * one, sign-out included.
 */
export const dropTheCarriedFlow = (): (() => void) => {
  const { pathname, search, hash } = globalThis.location;
  if (carriedFlow(search) === "") return () => undefined;
  globalThis.history.replaceState(globalThis.history.state, "", pathname);
  return () => {
    if (globalThis.location.pathname !== pathname) return;
    globalThis.history.replaceState(globalThis.history.state, "", `${pathname}${search}${hash}`);
  };
};

/** A router navigation would re-serialise a carried query and break its signature. */
export const leavingFor = (href: string) => ({
  href,
  replace: true,
  reloadDocument: new URL(href, "https://app.invalid").searchParams.has(SIGNATURE),
});

const safeReturnPath = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  if (value.includes("\\") || /\p{Cc}/u.test(value)) return undefined;
  return value;
};

const INVITATIONS = "/invitations/";

export const invitationAt = (invitationId: string): string =>
  `${INVITATIONS}${encodeURIComponent(invitationId)}`;

export const isAnInvitation = (path: string): boolean => path.startsWith(INVITATIONS);

export const backTo = (page: string, path: string): string =>
  `${page}?redirect=${encodeURIComponent(path)}`;

export const nextAfterSignIn = (query: string): string => {
  const carried = carriedFlow(query);
  if (carried !== "") return `/choose-workspace${carried}`;
  return safeReturnPath(new URLSearchParams(query).get("redirect")) ?? "/";
};

export const carriedOnTo = (query: string): CarriedOn | undefined => {
  if (carriedFlow(query) !== "") return "connecting";
  const back = safeReturnPath(new URLSearchParams(query).get("redirect"));
  return back !== undefined && isAnInvitation(back) ? "joining" : undefined;
};
