const SIGNATURE = "sig";

/**
 * The router's search string turns a repeated key into one JSON array, breaking a signed query,
 * so these screens read theirs off the address bar.
 */
export const pageQuery = (): string => globalThis.location.search;

/** The whole query when it carries a signed flow, else the empty string. */
export const carriedFlow = (query: string): string =>
  new URLSearchParams(query).has(SIGNATURE) ? query : "";

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

/** A screen, such as the sign-in screen, asked to send the person on to `path` once done. */
export const backTo = (screen: string, path: string): string =>
  `${screen}?redirect=${encodeURIComponent(path)}`;

/** A signed flow goes on to the workspace picker; otherwise `redirect` on this origin, or home. */
export const nextAfterSignIn = (query: string): string => {
  const carried = carriedFlow(query);
  if (carried !== "") return `/choose-workspace${carried}`;
  return safeReturnPath(new URLSearchParams(query).get("redirect")) ?? "/";
};
