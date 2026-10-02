import { EMAIL_ADDRESS } from "@better-answers/schema/email-address";

/** Trimmed and lower-cased, as Better Auth stores an address and signs a person in by it. */
export const emailAddressOf = (asked: string): string | undefined => {
  const address = EMAIL_ADDRESS.safeParse(asked.trim().toLowerCase());
  return address.success ? address.data : undefined;
};
