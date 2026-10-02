/** As the api mints a code. */
const CODE_LENGTH = 6;

/** As many wrong tries as the api takes before a code stops working. */
const CODE_TRIES = 3;

/** An email client may space, dash or widen the digits it shows, so only digits are kept. */
export const digitsOf = (entered: string): string =>
  entered.normalize("NFKC").replaceAll(/\D/g, "").slice(0, CODE_LENGTH);

/** Six digits go to the api, once: a value it refused for this code would only spend a try. */
export const worthSending = (code: string, refused: readonly string[]): boolean =>
  code.length === CODE_LENGTH && !refused.includes(code);

/** The api names no tries left, so they are counted from the refusals since the code was sent. */
export const triesLeft = (refusals: number): number => Math.max(0, CODE_TRIES - refusals);
