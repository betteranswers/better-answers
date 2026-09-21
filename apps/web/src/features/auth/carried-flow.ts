const SIGNATURE = "sig";

export const carriedFlow = (search: string): string =>
  new URLSearchParams(search).has(SIGNATURE) ? search : "";

// Anything but a path on this origin is an open redirect with a person's session behind it.
export const safeReturnPath = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
};
