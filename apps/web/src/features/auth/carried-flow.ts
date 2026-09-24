const SIGNATURE = "sig";

// The router's search string turns a repeated key into one JSON array, breaking a signed query,
// so these screens read theirs off the address bar.
export const pageQuery = (): string => globalThis.location.search;

export const carriedFlow = (query: string): string =>
  new URLSearchParams(query).has(SIGNATURE) ? query : "";

// A router navigation would re-serialise a carried query and break its signature.
export const leavingFor = (href: string) => ({
  href,
  replace: true,
  reloadDocument: new URL(href, "https://app.invalid").searchParams.has(SIGNATURE),
});

// Anything but a path on this origin is an open redirect with a person's session behind it.
const safeReturnPath = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
};

export const nextAfterSignIn = (query: string): string => {
  const carried = carriedFlow(query);
  if (carried !== "") return `/choose-workspace${carried}`;
  return safeReturnPath(new URLSearchParams(query).get("redirect")) ?? "/";
};
