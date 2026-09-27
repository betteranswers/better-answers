import { z } from "zod";

/** Longer than any address a mail system delivers to, so a real one is never refused. */
const ADDRESS = z.email().max(254);

/** Trimmed and lower-cased, as Better Auth stores an address and signs a person in by it. */
export const emailAddressOf = (asked: string): string | undefined => {
  const address = ADDRESS.safeParse(asked.trim().toLowerCase());
  return address.success ? address.data : undefined;
};
