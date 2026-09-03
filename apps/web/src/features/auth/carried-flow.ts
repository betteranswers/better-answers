/**
 * A host's OAuth flow passes through these screens. Better Auth carries its authorization
 * state as a **signed query** — `ba_param` naming the parameters covered, `sig` over them
 * — and resumes only from that exact string, so every screen in the walk keeps the query
 * whole and hands it on. A screen that dropped one parameter would break the signature and
 * the connection with it (prototype 61, bug 2).
 */

/** The parameter that says a signed query is present; the platform never writes it. */
const SIGNATURE = "sig";

/**
 * The carried query, `?` and all, or an empty string when this visit is the product's own
 * rather than a host's flow.
 */
export const carriedFlow = (search: string): string =>
  new URLSearchParams(search).has(SIGNATURE) ? search : "";

/** The same string as `/oauth2/continue` takes it: the query, without its `?`. */
export const asOauthQuery = (carried: string): string => carried.replace(/^\?/, "");

/**
 * Where an ended session sends a person back to. It is a path on this origin and nothing
 * else: an absolute URL here would be an open redirect with a person's session behind it.
 */
export const safeReturnPath = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
};
