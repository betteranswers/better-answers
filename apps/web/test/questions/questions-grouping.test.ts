import { describe, expect, it } from "vitest";

import type { AskedRecord } from "@/features/questions/questions-api.ts";
import { groupedForReading, latestOfEach } from "@/features/questions/questions-grouping.ts";

type Shape = Pick<AskedRecord, "id" | "askedAt" | "verdict" | "flagged">;

const aRecord = (shape: Shape): AskedRecord => ({
  askedBy: { kind: "former-member" },
  transport: "mcp",
  collectionsNamed: [],
  question: `Question ${shape.id}`,
  judgeState: "not-judged",
  map: { state: "live" },
  concepts: [],
  drafted: null,
  feedback: [],
  ...shape,
});

const at = (minute: number): string => `2026-10-15T09:${String(minute).padStart(2, "0")}:00.000Z`;

const idsOf = (records: readonly AskedRecord[]): readonly string[] =>
  records.map((record) => record.id);

describe("grouping questions asked", () => {
  it("puts flagged records first, including an unanswered one", () => {
    const grouped = groupedForReading([
      aRecord({ id: "f1", askedAt: at(1), verdict: "refuse", flagged: true }),
      aRecord({ id: "f2", askedAt: at(2), verdict: "ok", flagged: true }),
      aRecord({ id: "o1", askedAt: at(3), verdict: "ok", flagged: false }),
    ]);

    expect(idsOf(grouped.flagged)).toEqual(["f2", "f1"]);
    expect(idsOf(grouped.others)).toEqual(["o1"]);
    expect(grouped.notAnswered).toEqual([]);
  });

  it("lists other records newest first, including closed flags", () => {
    const grouped = groupedForReading([
      aRecord({ id: "flagged-once", askedAt: at(5), verdict: "warn", flagged: false }),
      aRecord({ id: "newer", askedAt: at(9), verdict: "related", flagged: false }),
      aRecord({ id: "oldest", askedAt: at(1), verdict: null, flagged: false }),
    ]);

    expect(idsOf(grouped.others)).toEqual(["newer", "flagged-once", "oldest"]);
  });

  it("groups unflagged unanswered records together, newest first", () => {
    const grouped = groupedForReading([
      aRecord({ id: "r1", askedAt: at(1), verdict: "refuse", flagged: false }),
      aRecord({ id: "o1", askedAt: at(2), verdict: "ok", flagged: false }),
      aRecord({ id: "r2", askedAt: at(3), verdict: "refuse", flagged: false }),
      aRecord({ id: "f1", askedAt: at(4), verdict: "refuse", flagged: true }),
    ]);

    expect(idsOf(grouped.notAnswered)).toEqual(["r2", "r1"]);
    expect(idsOf(grouped.others)).toEqual(["o1"]);
    expect(idsOf(grouped.flagged)).toEqual(["f1"]);
  });
});

describe("records returned across pages", () => {
  it("keeps the latest copy of a record returned twice", () => {
    const flaggedThen = aRecord({ id: "x", askedAt: at(1), verdict: "ok", flagged: true });
    const closedSince = aRecord({ id: "x", askedAt: at(1), verdict: "ok", flagged: false });
    const other = aRecord({ id: "y", askedAt: at(2), verdict: "ok", flagged: false });

    const served = latestOfEach([flaggedThen, other, closedSince]);

    expect(served.map((record) => [record.id, record.flagged])).toEqual([
      ["x", false],
      ["y", false],
    ]);
  });
});
