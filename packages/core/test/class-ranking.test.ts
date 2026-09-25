import { describe, expect, it } from "vitest";

import { narrower } from "../src/access/index.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

const THE_RANKING = [
  { one: "Restricted", other: "Restricted", narrower: "Restricted" },
  { one: "Restricted", other: "Internal", narrower: "Restricted" },
  { one: "Restricted", other: "Public", narrower: "Restricted" },
  { one: "Internal", other: "Restricted", narrower: "Restricted" },
  { one: "Internal", other: "Internal", narrower: "Internal" },
  { one: "Internal", other: "Public", narrower: "Internal" },
  { one: "Public", other: "Restricted", narrower: "Restricted" },
  { one: "Public", other: "Internal", narrower: "Internal" },
  { one: "Public", other: "Public", narrower: "Public" },
] as const;

describe("the class ranking, in the TypeScript tier and the database", () => {
  it("both answer the ranking's narrower class for every ordered pair", async () => {
    const answered = await db().runtimePool.query<{ narrower: string }>(
      `SELECT narrower_class(pair.a, pair.b) AS narrower
         FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS pair(a, b, at)
        ORDER BY pair.at`,
      [THE_RANKING.map((pair) => pair.one), THE_RANKING.map((pair) => pair.other)],
    );
    const expected = THE_RANKING.map(({ one, other, narrower: word }) => ({ one, other, word }));

    expect({
      theDatabase: THE_RANKING.map(({ one, other }, at) => ({
        one,
        other,
        word: answered.rows[at]?.narrower,
      })),
      theApp: THE_RANKING.map(({ one, other }) => ({ one, other, word: narrower(one, other) })),
    }).toEqual({ theDatabase: expected, theApp: expected });
  });
});
