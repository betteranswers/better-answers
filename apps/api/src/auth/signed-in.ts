import { z } from "zod";

import { attempt } from "@better-answers/core/kernel";

import type { Auth } from "./auth.ts";

const signedIn = z
  .object({
    session: z.object({ id: z.string(), createdAt: z.coerce.date(), expiresAt: z.coerce.date() }),
    user: z.object({ id: z.string(), email: z.string() }),
  })
  .nullable()
  .catch(null);

export type SignedIn = NonNullable<z.output<typeof signedIn>>;

/** The session the headers carry, with the age a setup carries over; undefined when there is none. */
export const signedInPerson = async (
  auth: Auth,
  headers: Headers,
): Promise<SignedIn | undefined> => {
  const read = await attempt(() => auth.api.getSession({ headers }));
  return read.ok ? (signedIn.parse(read.value) ?? undefined) : undefined;
};
