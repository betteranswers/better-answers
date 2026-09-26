const MOST_WORDS = 10;

const SHOULD = /\bshould\b/i;

/** Read as the test runs, so an `.each` row or a template literal is already filled in. */
export const holdTitle = (title: string): void => {
  const words = title.split(/\s+/).filter((word) => word !== "").length;
  if (words <= MOST_WORDS && !SHOULD.test(title)) return;
  throw new Error(
    `A test title is a present-tense phrase of 10 words at most, never "should" [TEST5]: ${JSON.stringify(title)} runs to ${String(words)}`,
  );
};
