import { describe, expect, it } from "vitest";

import type { AskedRecord } from "@/features/questions/questions-api.ts";
import { groupedForReading, latestOfEach } from "@/features/questions/questions-grouping.ts";

type Shape = Pick<AskedRecord, "id" | "askedAt" | "verdict" | "flagged"> &
  Partial<Pick<AskedRecord, "refusedUnder">>;

const aRecord = (shape: Shape): AskedRecord => ({
  askedBy: { kind: "former-member" },
  transport: "mcp",
  collectionsNamed: [],
  question: `Question ${shape.id}`,
  judgeState: "not-judged",
  concepts: [],
  drafted: null,
  feedback: [],
  ...shape,
});

const at = (minute: number): string => `2026-10-15T09:${String(minute).padStart(2, "0")}:00.000Z`;

const idsOf = (records: readonly AskedRecord[]): readonly string[] =>
  records.map((record) => record.id);

describe("the questions asked grouping", () => {
  it("puts every flagged record first, a refusal among them", () => {
    const grouped = groupedForReading([
      aRecord({ id: "f1", askedAt: at(1), verdict: "refuse", flagged: true, refusedUnder: null }),
      aRecord({ id: "f2", askedAt: at(2), verdict: "ok", flagged: true }),
      aRecord({ id: "o1", askedAt: at(3), verdict: "ok", flagged: false }),
    ]);

    expect(idsOf(grouped.flagged)).toEqual(["f2", "f1"]);
    expect(idsOf(grouped.others)).toEqual(["o1"]);
    expect(grouped.notAnswered).toEqual([]);
  });

  it("lists the rest newest first, once-flagged records included", () => {
    const grouped = groupedForReading([
      aRecord({ id: "flagged-once", askedAt: at(5), verdict: "warn", flagged: false }),
      aRecord({ id: "newer", askedAt: at(9), verdict: "related", flagged: false }),
      aRecord({ id: "oldest", askedAt: at(1), verdict: null, flagged: false }),
    ]);

    expect(idsOf(grouped.others)).toEqual(["newer", "flagged-once", "oldest"]);
  });

  it("groups refusals by collection, the group for none last", () => {
    const grouped = groupedForReading([
      aRecord({ id: "n1", askedAt: at(1), verdict: "refuse", flagged: false, refusedUnder: null }),
      aRecord({ id: "w1", askedAt: at(2), verdict: "refuse", flagged: false, refusedUnder: "web" }),
      aRecord({
        id: "a1",
        askedAt: at(3),
        verdict: "refuse",
        flagged: false,
        refusedUnder: "audits",
      }),
      aRecord({
        id: "a2",
        askedAt: at(4),
        verdict: "refuse",
        flagged: false,
        refusedUnder: "audits",
      }),
      aRecord({ id: "n2", askedAt: at(5), verdict: "refuse", flagged: false, refusedUnder: null }),
    ]);

    expect(
      grouped.notAnswered.map(({ collection, records }) => [collection, idsOf(records)]),
    ).toEqual([
      ["audits", ["a2", "a1"]],
      ["web", ["w1"]],
      [null, ["n2", "n1"]],
    ]);
    expect(grouped.others).toEqual([]);
  });
});

describe("the records a read has served", () => {
  it("keeps one copy of a record two pages served", () => {
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
