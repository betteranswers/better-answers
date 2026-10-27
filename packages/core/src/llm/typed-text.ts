const WITHHELD = "[withheld]";

type Hit = { readonly start: number; readonly end: number };

const SPACE = String.raw`\t\n\v\f\r\x1c-\x1f \x85\xa0\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}`;

const WORD = String.raw`\p{L}\p{N}_`;

const WORD_TO_PRESIDIO = String.raw`\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}`;

const DIGIT = String.raw`\p{Nd}`;

const edgeOf = (word: string): string =>
  `(?:(?<=[${word}])(?![${word}])|(?<![${word}])(?=[${word}]))`;

const EDGE = edgeOf(WORD);
const EDGE_TO_PRESIDIO = edgeOf(WORD_TO_PRESIDIO);

const A_NATIONAL_INSURANCE_NUMBER = new RegExp(
  String.raw`${EDGE_TO_PRESIDIO}(?!bg|gb|nk|kn|nt|tn|zz|BG|GB|NK|KN|NT|TN|ZZ)([a-ceghj-pr-tw-zA-CEGHJ-PR-TW-Z]{1}[a-ceghj-npr-tw-zA-CEGHJ-NPR-TW-Z]{1}) ?([0-9]{2}) ?([0-9]{2}) ?([0-9]{2}) ?([a-dA-D]{1})${EDGE_TO_PRESIDIO}`,
  "giu",
);

const AN_NHS_NUMBER = new RegExp(
  String.raw`${EDGE_TO_PRESIDIO}([0-9]{3})[- ]?([0-9]{3})[- ]?([0-9]{4})${EDGE_TO_PRESIDIO}`,
  "gu",
);

const A_SORT_CODE_WITH_AN_ACCOUNT = new RegExp(
  `${EDGE}${DIGIT}{2}[- ]?${DIGIT}{2}[- ]?${DIGIT}{2}${EDGE}.{0,40}?${EDGE}${DIGIT}{8}${EDGE}`,
  "gsu",
);

const A_WORD_THAT_NAMES_A_PAIR = /account|sort|bank|payment|bacs/iu;

const A_WHOLE_WORD_THAT_NAMES_A_PAIR = new RegExp(
  `${EDGE}(?:account|sort|bank|payment|bacs)s?${EDGE}`,
  "iu",
);

const A_CUE = new RegExp(String.raw`(?<!\p{L})(?:diagnos[ei]|medication|sickness)`, "giu");

const A_SENTENCE_BREAK = new RegExp(String.raw`(?<=[.!?])[${SPACE}]+|\n[${SPACE}]*\n`, "gu");

const A_SPACE = new RegExp(`[${SPACE}]`, "u");

const hitOf = (match: RegExpExecArray): Hit => ({
  start: match.index,
  end: match.index + match[0].length,
});

const passesTheCheckDigit = (written: string): boolean => {
  const digits = Array.from(written.replaceAll(/[- ]/gu, ""), Number);
  return digits.reduce((sum, digit, at) => sum + digit * (10 - at), 0) % 11 === 0;
};

const isSpace = (unit: string | undefined): boolean => unit !== undefined && A_SPACE.test(unit);

const runAround = (text: string, at: number): Hit => {
  let start = at;
  while (start > 0 && !isSpace(text[start - 1])) start -= 1;
  let end = at;
  while (end < text.length && !isSpace(text[end])) end += 1;
  return { start, end };
};

const namedPairsIn = (text: string): readonly Hit[] => {
  const naming = A_WORD_THAT_NAMES_A_PAIR.exec(text);
  if (naming === null) return [];
  const named = naming.index + naming[0].length;
  const pairs: Hit[] = [];
  let run: Hit = { start: 0, end: 0 };
  let joinedByAColon = false;
  for (const pair of Array.from(text.matchAll(A_SORT_CODE_WITH_AN_ACCOUNT), hitOf)) {
    if (pair.start >= run.end) {
      run = runAround(text, pair.start);
      joinedByAColon = text.slice(run.start, run.end).includes(":");
    }
    const namedBetween = A_WHOLE_WORD_THAT_NAMES_A_PAIR.test(text.slice(pair.start, pair.end));
    if (joinedByAColon || named <= run.end || namedBetween) pairs.push(pair);
  }
  return pairs;
};

const trimmed = (text: string, sentence: Hit): Hit => {
  let { start, end } = sentence;
  while (start < end && isSpace(text[start])) start += 1;
  while (end > start && isSpace(text[end - 1])) end -= 1;
  return { start, end };
};

const sentenceBefore = (text: string, breaks: readonly Hit[], next: number): Hit =>
  trimmed(text, { start: breaks[next - 1]?.end ?? 0, end: breaks[next]?.start ?? text.length });

const sentencesWithACue = (text: string): readonly Hit[] => {
  const breaks = Array.from(text.matchAll(A_SENTENCE_BREAK), hitOf);
  const sentences: Hit[] = [];
  let next = 0;
  let read = -1;
  for (const cue of text.matchAll(A_CUE)) {
    while ((breaks[next]?.end ?? Infinity) <= cue.index) next += 1;
    if (next !== read) sentences.push(sentenceBefore(text, breaks, next));
    read = next;
  }
  return sentences;
};

const hitsIn = (text: string): readonly Hit[] => [
  ...Array.from(text.matchAll(A_NATIONAL_INSURANCE_NUMBER), hitOf),
  ...Array.from(text.matchAll(AN_NHS_NUMBER))
    .filter((match) => passesTheCheckDigit(match[0]))
    .map(hitOf),
  ...namedPairsIn(text),
  ...sentencesWithACue(text),
];

const leftOf = (one: Hit, ahead: readonly Hit[]): readonly Hit[] => {
  let { start, end } = one;
  for (const winner of ahead) {
    if (winner.end <= one.start || one.end <= winner.start) continue;
    if (winner.start <= one.start) start = Math.max(start, winner.end);
    else end = Math.min(end, winner.start);
  }
  return start < end ? [{ start, end }] : [];
};

const writtenSpansOf = (hits: readonly Hit[]): readonly Hit[] => {
  const longestFirst = hits.toSorted(
    (one, other) => other.end - other.start - (one.end - one.start),
  );
  return longestFirst
    .flatMap((one, place) => leftOf(one, longestFirst.slice(0, place)))
    .toSorted((one, other) => one.start - other.start);
};

export const checkTypedText = (text: string): string =>
  writtenSpansOf(hitsIn(text)).reduceRight(
    (sent, { start, end }) => sent.slice(0, start) + WITHHELD + sent.slice(end),
    text,
  );
