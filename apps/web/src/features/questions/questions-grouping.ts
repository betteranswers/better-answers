import type { AskedRecord } from "./questions-api.ts";

export type Grouped = {
  readonly flagged: readonly AskedRecord[];
  readonly others: readonly AskedRecord[];
  readonly notAnswered: readonly AskedRecord[];
};

export const latestOfEach = (served: readonly AskedRecord[]): readonly AskedRecord[] => [
  ...new Map(served.map((record) => [record.id, record])).values(),
];

const newestFirst = (left: AskedRecord, right: AskedRecord): number =>
  right.askedAt.localeCompare(left.askedAt) || right.id.localeCompare(left.id);

export const groupedForReading = (records: readonly AskedRecord[]): Grouped => {
  const sorted = records.toSorted(newestFirst);
  const unflagged = sorted.filter((record) => !record.flagged);
  return {
    flagged: sorted.filter((record) => record.flagged),
    others: unflagged.filter((record) => record.verdict !== "refuse"),
    notAnswered: unflagged.filter((record) => record.verdict === "refuse"),
  };
};
