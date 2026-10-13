const WITHHELD = "[withheld]";

type Hit = { readonly start: number; readonly end: number };

/**
 * Python's whitespace, which the worker's patterns read: unlike JavaScript's `\s` it holds NEL
 * and four separator controls, and not the byte-order mark.
 */
const SPACE = String.raw`\t\n\v\f\r\x1c-\x1f \x85\xa0\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}`;

/** A word's characters to Python's `re`, which the worker's own patterns run on. */
const WORD = String.raw`\p{L}\p{N}_`;

/** The same to Presidio's engine: a combining mark is a word's character, a fraction is not. */
const WORD_TO_PRESIDIO = String.raw`\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}`;

/** Python's `\d` is any decimal digit, where JavaScript's is 0 to 9. */
const DIGIT = String.raw`\p{Nd}`;

/** `\b` over the given word characters; JavaScript's own counts ASCII letters alone. */
const edgeOf = (word: string): string =>
  `(?:(?<=[${word}])(?![${word}])|(?<![${word}])(?=[${word}]))`;

const EDGE = edgeOf(WORD);
const EDGE_TO_PRESIDIO = edgeOf(WORD_TO_PRESIDIO);

/**
 * Presidio's pattern as written. It reads its refused prefixes before the optional space, so a
 * number after a space takes that space and any prefix.
 */
const A_NATIONAL_INSURANCE_NUMBER = new RegExp(
  String.raw`${EDGE_TO_PRESIDIO}(?!bg|gb|nk|kn|nt|tn|zz|BG|GB|NK|KN|NT|TN|ZZ) ?([a-ceghj-pr-tw-zA-CEGHJ-PR-TW-Z]{1}[a-ceghj-npr-tw-zA-CEGHJ-NPR-TW-Z]{1}) ?([0-9]{2}) ?([0-9]{2}) ?([0-9]{2}) ?([a-dA-D]{1})${EDGE_TO_PRESIDIO}`,
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

const NAMES_AN_ACCOUNT = ["account", "sort", "bank", "payment", "bacs"];

/**
 * The worker reads a cue by lemma. These are the forms it folds, bounded by letters alone so
 * that none it reads is missed.
 */
const A_CUE = new RegExp(
  String.raw`(?<!\p{L})(?:diagnos(?:e|es|ed|ing|is)|medications?|sickness(?:es)?)(?!\p{L})`,
  "giu",
);

const A_SENTENCE_BREAK = new RegExp(String.raw`(?<=[.!?])[${SPACE}]+|\n[${SPACE}]*\n`, "gu");

const A_SPACE = new RegExp(`[${SPACE}]`, "u");
const LEADING_SPACE = new RegExp(`^[${SPACE}]+`, "u");
const TRAILING_SPACE = new RegExp(`[${SPACE}]+$`, "u");

const hitOf = (match: RegExpExecArray): Hit => ({
  start: match.index,
  end: match.index + match[0].length,
});

const passesTheCheckDigit = (written: string): boolean => {
  const digits = Array.from(written.replaceAll(/[- ]/g, ""), Number);
  return digits.reduce((sum, digit, at) => sum + digit * (10 - at), 0) % 11 === 0;
};

/**
 * The worker reads five words back through its tokenizer. This reads all the text up to the
 * pair's first space, which holds those five.
 */
const namedBefore = (text: string, pair: Hit): boolean => {
  const toASpace = text.slice(pair.start).search(A_SPACE);
  const read = toASpace === -1 ? text : text.slice(0, pair.start + toASpace);
  return NAMES_AN_ACCOUNT.some((word) => read.toLowerCase().includes(word));
};

/** A blank line ends a sentence as a full stop does, and the space round it is no part of it. */
const sentenceAround = (text: string, at: number): Hit => {
  let start = 0;
  let end = text.length;
  for (const gap of text.matchAll(A_SENTENCE_BREAK)) {
    const closes = gap.index + gap[0].length;
    if (closes <= at) start = closes;
    else if (gap.index > at) {
      end = gap.index;
      break;
    }
  }
  const sentence = text.slice(start, end);
  return {
    start: start + sentence.length - sentence.replace(LEADING_SPACE, "").length,
    end: end - (sentence.length - sentence.replace(TRAILING_SPACE, "").length),
  };
};

const hitsIn = (text: string): readonly Hit[] => [
  ...Array.from(text.matchAll(A_NATIONAL_INSURANCE_NUMBER), hitOf),
  ...Array.from(text.matchAll(AN_NHS_NUMBER))
    .filter((match) => passesTheCheckDigit(match[0]))
    .map(hitOf),
  ...Array.from(text.matchAll(A_SORT_CODE_WITH_AN_ACCOUNT), hitOf).filter((pair) =>
    namedBefore(text, pair),
  ),
  ...Array.from(text.matchAll(A_CUE), (cue) => sentenceAround(text, cue.index)),
];

/** What a hit keeps once each hit ahead of it has taken the characters the two share. */
const leftOf = (one: Hit, ahead: readonly Hit[]): readonly Hit[] => {
  let { start, end } = one;
  for (const winner of ahead) {
    if (winner.end <= one.start || one.end <= winner.start) continue;
    if (winner.start <= one.start) start = Math.max(start, winner.end);
    else end = Math.min(end, winner.start);
  }
  return start < end ? [{ start, end }] : [];
};

/** The longer hit keeps its span, so a hit inside another writes nothing of its own. */
const writtenSpansOf = (hits: readonly Hit[]): readonly Hit[] => {
  const longestFirst = hits.toSorted(
    (one, other) => other.end - other.start - (one.end - one.start),
  );
  return longestFirst
    .flatMap((one, place) => leftOf(one, longestFirst.slice(0, place)))
    .toSorted((one, other) => one.start - other.start);
};

/**
 * What a model is sent for text a person typed: each always-tier hit under the placeholder,
 * read as the worker's detector reads it. A person's name is never a hit, because reading one
 * takes the detector's model.
 */
export const checkTypedText = (text: string): string =>
  writtenSpansOf(hitsIn(text)).reduceRight(
    (sent, { start, end }) => sent.slice(0, start) + WITHHELD + sent.slice(end),
    text,
  );
