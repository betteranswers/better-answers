export const COUNTED: readonly (readonly [what: string, prose: string, counted: string])[] = [
  ["specs", "Two specs open a member and remove one.", "Two specs"],
  ["callers", "Both callers hand the trimmed name.", "Both callers"],
  ["other callers", "Held for three other callers at once.", "three other callers"],
  ["wrapped call sites", "Held for two call\nsites at once.", "two call sites"],
];

export const NOT_COUNTED: readonly (readonly [what: string, prose: string])[] = [
  ["a count of something else", "Postgres holds two locks here, one per table."],
  ["a test runner's tests", "Playwright retries both tests on CI only."],
  ["cipher suites", "TLS 1.3 offers five suites, all AEAD."],
  ["a queue's consumers", "A Kafka group with two consumers splits the partitions."],
  ["specs in digits", "A run of 3 specs is the smallest that shards."],
  ["the one caller", "The person is the one caller."],
];

export const commented = (marker: string, prose: string): string =>
  prose
    .split("\n")
    .map((line) => `${marker} ${line}\n`)
    .join("");
