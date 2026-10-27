/** The next position at or after each index whose character `stops` holds, `-1` where
 * there is none. */
const nextStopsOf = (text: string, stops: (ch: string) => boolean): Int32Array => {
  const next = new Int32Array(text.length + 1);
  next[text.length] = -1;
  for (let at = text.length - 1; at >= 0; at -= 1) {
    next[at] = stops(text[at] ?? "") ? at : (next[at + 1] ?? -1);
  }
  return next;
};

/** The next `close` at or after each position, `-1` where there is none. */
export const nextOf = (text: string, close: string): Int32Array =>
  nextStopsOf(text, (ch) => ch === close);

const ASCII_WHITESPACE = " \t\n\r\f\v";

export const isAsciiWhitespace = (ch: string): boolean => ASCII_WHITESPACE.includes(ch);

export const collapsedWhitespace = (text: string): string =>
  text
    // oxlint-disable-next-line eslint/require-unicode-regexp -- Stryker negates \v to \V, which the u flag refuses at load
    .split(/[ \t\n\r\f\v]+/)
    .filter((word) => word !== "")
    .join(" ");

export const autolinkEndsOf = (text: string): Int32Array =>
  nextStopsOf(text, (ch) => ch === ">" || isAsciiWhitespace(ch));

const SCHEME = /[A-Za-z0-9+.-]/u;

export const SCHEMED = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

const colonAfter = (text: string, at: number): number | undefined => {
  if (!/[A-Za-z]/u.test(text[at + 1] ?? "")) return undefined;
  let scheme = at + 2;
  while (scheme < text.length && SCHEME.test(text[scheme] ?? "")) scheme += 1;
  return text[scheme] === ":" ? scheme : undefined;
};

/** Where the autolink starting at `at` closes, or `undefined` when it is none. */
export const autolinkClosesAt = (
  text: string,
  at: number,
  ends: Int32Array,
): number | undefined => {
  const colon = colonAfter(text, at);
  if (colon === undefined) return undefined;
  const end = ends[colon + 1] ?? -1;
  return end !== -1 && text[end] === ">" ? end : undefined;
};
