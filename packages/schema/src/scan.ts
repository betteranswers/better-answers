/** The next position at or after each index whose character `stops` holds, `-1` where
 * there is none. */
export const nextStopsOf = (text: string, stops: (ch: string) => boolean): Int32Array => {
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

const SCHEME = /[a-z0-9+.-]/i;

const colonAfter = (text: string, at: number): number | undefined => {
  if (!/[a-z]/i.test(text[at + 1] ?? "")) return undefined;
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
