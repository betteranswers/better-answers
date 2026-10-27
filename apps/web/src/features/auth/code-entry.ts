import { EMAIL_CODE_ATTEMPTS, EMAIL_CODE_LENGTH } from "@better-answers/schema/email-code";

export const selectTheCode = (fieldId: string) => {
  const field = document.getElementById(fieldId);
  if (!(field instanceof HTMLInputElement)) return;
  field.focus();
  field.select();
};

export const digitsOf = (entered: string, length = EMAIL_CODE_LENGTH): string =>
  entered.normalize("NFKC").replaceAll(/\D/gu, "").slice(0, length);

export const worthSending = (
  code: string,
  refused: readonly string[],
  length = EMAIL_CODE_LENGTH,
): boolean => code.length === length && !refused.includes(code);

export const triesLeft = (refusals: number): number => Math.max(0, EMAIL_CODE_ATTEMPTS - refusals);

const TRIES_SPENT = 403;

const EXPIRED = "OTP_EXPIRED";

type Refusal = { readonly status: number; readonly libraryCode: string | undefined };

export const codeSpent = (refusal: Refusal): boolean =>
  refusal.status === TRIES_SPENT || refusal.libraryCode === EXPIRED;
