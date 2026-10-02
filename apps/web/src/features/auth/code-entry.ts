import { EMAIL_CODE_ATTEMPTS, EMAIL_CODE_LENGTH } from "@better-answers/schema/email-code";

/** An email client may space, dash or widen the digits it shows, so only digits are kept. */
export const digitsOf = (entered: string, length = EMAIL_CODE_LENGTH): string =>
  entered.normalize("NFKC").replaceAll(/\D/g, "").slice(0, length);

/** A whole code goes to the api, once: a value it refused for this code would only spend a try. */
export const worthSending = (
  code: string,
  refused: readonly string[],
  length = EMAIL_CODE_LENGTH,
): boolean => code.length === length && !refused.includes(code);

/** The api names no tries left, so they are counted from the refusals since the code was sent. */
export const triesLeft = (refusals: number): number => Math.max(0, EMAIL_CODE_ATTEMPTS - refusals);

/** The library's answer once a code's tries are spent, whichever browser tab or page spent them. */
const TRIES_SPENT = 403;

/** The library deletes a code as it reports it expired, so every later try would read as wrong. */
const EXPIRED = "OTP_EXPIRED";

type Refusal = { readonly status: number; readonly libraryCode: string | undefined };

export const codeSpent = (refusal: Refusal): boolean =>
  refusal.status === TRIES_SPENT || refusal.libraryCode === EXPIRED;
