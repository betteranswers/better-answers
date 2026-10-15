import type { AskedRecord } from "./questions-api.ts";

/** Null is the group for none: a refusal that matched no concept the reader may read. */
type RefusalGroup = {
  readonly collection: string | null;
  readonly records: readonly AskedRecord[];
};

export type Grouped = {
  readonly flagged: readonly AskedRecord[];
  readonly others: readonly AskedRecord[];
  readonly notAnswered: readonly RefusalGroup[];
};

const newestFirst = (left: AskedRecord, right: AskedRecord): number =>
  right.askedAt.localeCompare(left.askedAt) || right.id.localeCompare(left.id);

const byCollection = (left: RefusalGroup, right: RefusalGroup): number => {
  if (left.collection === null) return 1;
  if (right.collection === null) return -1;
  return left.collection.localeCompare(right.collection, "en-GB");
};

/** Sorted here too, so a record whose flag just closed takes its place before the read answers. */
export const groupedForReading = (records: readonly AskedRecord[]): Grouped => {
  const sorted = records.toSorted(newestFirst);
  const unflagged = sorted.filter((record) => !record.flagged);
  const refused = Map.groupBy(
    unflagged.filter((record) => record.verdict === "refuse"),
    (record) => record.refusedUnder ?? null,
  );
  return {
    flagged: sorted.filter((record) => record.flagged),
    others: unflagged.filter((record) => record.verdict !== "refuse"),
    notAnswered: [...refused]
      .map(([collection, held]) => ({ collection, records: held }))
      .toSorted(byCollection),
  };
};
