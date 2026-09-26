import { describe, expect, it } from "vitest";
import { z } from "zod";

import { llmPurpose } from "@better-answers/schema";

import { LLM_PURPOSES } from "../src/llm/index.ts";
import { contractFixture } from "./contract-fixture.ts";

const fixtureSchema = z.object({
  description: z.string(),
  fields: z.array(z.object({ field: z.string().min(1), is: z.string().min(1) })),
  outcomes: z.array(
    z.object({ outcome: z.string().min(1), failure: z.boolean(), is: z.string().min(1) }),
  ),
  rows: z.array(
    z.looseObject({
      purpose: z.string().min(1),
      outcome: z.string().min(1),
      run_id: z.string().nullable(),
      answer_id: z.string().nullable(),
    }),
  ),
});

const fixture = contractFixture("cost-ledger", fixtureSchema, "rows.json");

const recordedColumns = fixture.fields.map(({ field }) => field).toSorted();
const recordedOutcomes = fixture.outcomes.map(({ outcome }) => outcome).toSorted();
const failureOutcomes = fixture.outcomes
  .filter(({ failure }) => failure)
  .map(({ outcome }) => outcome);
const purposesTheRowsUse = [...new Set(fixture.rows.map((row) => row.purpose))].toSorted();

const WORDS_A_PROMPT_OR_A_COMPLETION_SITS_UNDER = [
  "prompt",
  "completion",
  "message",
  "content",
  "response",
  "text",
  "body",
];

describe("cost-ledger, golden rows for the cost ledger of model calls", () => {
  it("gives every row exactly the columns the cost ledger fixes", () => {
    expect(fixture.rows.map((row) => Object.keys(row).toSorted())).toEqual(
      fixture.rows.map(() => recordedColumns),
    );
  });

  it("records no column a prompt or completion could sit under", () => {
    expect(
      recordedColumns.filter((column) =>
        WORDS_A_PROMPT_OR_A_COMPLETION_SITS_UNDER.some((word) => column.includes(word)),
      ),
    ).toEqual([]);
  });

  it("uses exactly the purposes this tier and the schema speak", () => {
    expect(purposesTheRowsUse).toEqual([...LLM_PURPOSES].toSorted());
    expect(purposesTheRowsUse).toEqual([...llmPurpose.enumValues].toSorted());
  });

  it("puts a row behind every outcome, a failure among them", () => {
    const wordsTheRowsUse = [...new Set(fixture.rows.map((row) => row.outcome))].toSorted();

    expect(wordsTheRowsUse).toEqual(recordedOutcomes);
    expect(
      fixture.rows.filter((row) => failureOutcomes.includes(row.outcome)).length,
    ).toBeGreaterThan(0);
  });

  it("names exactly one of the run or the answer served", () => {
    expect(
      fixture.rows.map(
        (row) => [row.run_id, row.answer_id].filter((served) => served !== null).length,
      ),
    ).toEqual(fixture.rows.map(() => 1));

    expect(fixture.rows.filter((row) => row.run_id !== null).length).toBeGreaterThan(0);
    expect(fixture.rows.filter((row) => row.answer_id !== null).length).toBeGreaterThan(0);
  });
});
