import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REDACTION_ALWAYS_TIER } from "@better-answers/schema";

import { checkTypedText } from "../src/llm/index.ts";
import { contractFixture } from "./contract-fixture.ts";

const fixture = contractFixture(
  "redaction",
  z.object({
    categories: z.array(z.object({ category: z.string().min(1), tier: z.string().min(1) })),
    typed_text: z.object({
      why: z.string().min(1),
      cases: z
        .array(
          z.object({
            name: z.string().min(1),
            categories: z.array(z.string().min(1)),
            input: z.string().min(1),
            expected: z.string().min(1),
            why: z.string().min(1),
          }),
        )
        .min(1),
    }),
  }),
);

describe("the typed-text check", () => {
  it("AE11: writes the placeholder over a National Insurance number", () => {
    const question =
      "Does the pension scheme need my National Insurance number AB 12 34 56 C before I join?";

    // The space before the number goes with it, as it does in the worker.
    expect(checkTypedText(question)).toBe(
      "Does the pension scheme need my National Insurance number[withheld] before I join?",
    );
  });

  it("writes the placeholder over a sort code and account number", () => {
    const question = "Can payroll pay expenses into sort code 20-00-00, account number 12345678?";

    expect(checkTypedText(question)).toBe("Can payroll pay expenses into sort code [withheld]?");
  });

  it("writes the placeholder over a special-category cue's sentence", () => {
    const question = "Who signs off a return to work? I was diagnosed with asthma last month.";

    expect(checkTypedText(question)).toBe("Who signs off a return to work? [withheld]");
  });

  it("returns a question with no hit byte for byte", () => {
    const question = "How long is the notice period for a framework contract?";

    expect(checkTypedText(question)).toBe(question);
  });

  it("leaves a person's name in the text: the stated limit", () => {
    const question = "Does Rosalind Petheridge still lead the audit team?";

    expect(checkTypedText(question)).toBe(question);
  });
});

describe("the typed-text check on a long text", () => {
  // The suite's own timeout would let a check that takes half a minute pass.
  const AT_ONCE = { timeout: 5000 };
  const A_LONG_RUN = 10_000;

  it("reads pairs after a long unbroken run without stalling", AT_ONCE, () => {
    const run = "x".repeat(A_LONG_RUN);

    expect(checkTypedText(`${run} ${"sort 20-00-00 12345678 ".repeat(200)}`)).toBe(
      `${run} ${"sort [withheld] ".repeat(200)}`,
    );
  });

  it("reads cues after a long run of spaces without stalling", AT_ONCE, () => {
    const opened = `Rota\n\n${" ".repeat(A_LONG_RUN)}`;

    expect(checkTypedText(`${opened}${"sickness ".repeat(60_000)}end`)).toBe(`${opened}[withheld]`);
  });
});

describe("the redaction agreement's typed-text cases", () => {
  it("reads every case as the worker's detector reads it", () => {
    const read = fixture.typed_text.cases.map(({ name, input }) => ({
      name,
      text: checkTypedText(input),
    }));

    expect(read).toEqual(
      fixture.typed_text.cases.map(({ name, expected }) => ({ name, text: expected })),
    );
  });

  it("holds a case for every always-tier category, and no other", () => {
    const always = fixture.categories
      .filter(({ tier }) => tier === REDACTION_ALWAYS_TIER)
      .map(({ category }) => category);
    const covered = new Set(fixture.typed_text.cases.flatMap(({ categories }) => categories));

    expect([...covered].toSorted()).toEqual(always.toSorted());
  });
});
