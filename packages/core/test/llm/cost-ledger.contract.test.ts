import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LLM_CALL_OUTCOMES, llmPurpose } from "@better-answers/schema";

import { LLM_PURPOSES } from "../../src/llm/index.ts";
import { contractFixture } from "../fixtures/contract-fixture.ts";
import { postgresForSuite } from "../support/suite-postgres.ts";

const db = postgresForSuite();

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
const failureOutcomes = new Set(
  fixture.outcomes.filter(({ failure }) => failure).map(({ outcome }) => outcome),
);
const purposesTheRowsUse = [...new Set(fixture.rows.map((row) => row.purpose))].toSorted();

const PROMPT_OR_COMPLETION_WORDS = [
  "prompt",
  "completion",
  "message",
  "content",
  "response",
  "text",
  "body",
];

describe("the cost-ledger contract fixture of model call rows", () => {
  it("gives every fixture row exactly the listed columns", () => {
    expect(fixture.rows.map((row) => Object.keys(row).toSorted())).toEqual(
      fixture.rows.map(() => recordedColumns),
    );
  });

  it("lists exactly the columns of the migrated llm_call table", async () => {
    const columns = await db().pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'llm_call'",
    );

    expect(columns.rows.map((row) => row.column_name).toSorted()).toEqual(recordedColumns);
  });

  it("lists exactly the outcomes in LLM_CALL_OUTCOMES", () => {
    expect([...LLM_CALL_OUTCOMES].toSorted()).toEqual(recordedOutcomes);
  });

  it("lists no column named for prompt or completion text", () => {
    expect(
      recordedColumns.filter((column) =>
        PROMPT_OR_COMPLETION_WORDS.some((word) => column.includes(word)),
      ),
    ).toEqual([]);
  });

  it("uses exactly the purposes that core and the schema define", () => {
    expect(purposesTheRowsUse).toEqual([...LLM_PURPOSES].toSorted());
    expect(purposesTheRowsUse).toEqual([...llmPurpose.enumValues].toSorted());
  });

  it("has a row for every outcome, including a failure", () => {
    const wordsTheRowsUse = [...new Set(fixture.rows.map((row) => row.outcome))].toSorted();

    expect(wordsTheRowsUse).toEqual(recordedOutcomes);
    expect(fixture.rows.filter((row) => failureOutcomes.has(row.outcome)).length).toBeGreaterThan(
      0,
    );
  });

  it("sets exactly one of run_id and answer_id per row", () => {
    expect(
      fixture.rows.map(
        (row) => [row.run_id, row.answer_id].filter((served) => served !== null).length,
      ),
    ).toEqual(fixture.rows.map(() => 1));

    expect(fixture.rows.filter((row) => row.run_id !== null).length).toBeGreaterThan(0);
    expect(fixture.rows.filter((row) => row.answer_id !== null).length).toBeGreaterThan(0);
  });
});
