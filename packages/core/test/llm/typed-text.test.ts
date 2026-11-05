import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REDACTION_ALWAYS_TIER } from "@better-answers/schema";

import { checkTypedText } from "../../src/llm/index.ts";
import { contractFixture } from "../fixtures/contract-fixture.ts";

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
  it("replaces a National Insurance number with the placeholder (AE11)", () => {
    const question =
      "Does the pension scheme need my National Insurance number AB 12 34 56 C before I join?";

    expect(checkTypedText(question)).toBe(
      "Does the pension scheme need my National Insurance number [withheld] before I join?",
    );
  });

  it("replaces a sort code and account number with the placeholder", () => {
    const question = "Can payroll pay expenses into sort code 20-00-00, account number 12345678?";

    expect(checkTypedText(question)).toBe("Can payroll pay expenses into sort code [withheld]?");
  });

  it("replaces a sort code pair labelled between its two numbers", () => {
    const question = "Can payroll pay expenses into 20-00-00, account number 12345678?";

    expect(checkTypedText(question)).toBe("Can payroll pay expenses into [withheld]?");
  });

  it("leaves text with an invalid National Insurance prefix unchanged", () => {
    const question = "Is GB123456A a National Insurance number?";

    expect(checkTypedText(question)).toBe(question);
  });

  it("replaces a sentence holding a special-category cue with the placeholder", () => {
    const question = "Who signs off a return to work? I was diagnosed with asthma last month.";

    expect(checkTypedText(question)).toBe("Who signs off a return to work? [withheld]");
  });

  it("returns a question with no match unchanged", () => {
    const question = "How long is the notice period for a framework contract?";

    expect(checkTypedText(question)).toBe(question);
  });

  it("leaves a person's name unchanged, a known limit", () => {
    const question = "Does Rosalind Petheridge still lead the audit team?";

    expect(checkTypedText(question)).toBe(question);
  });
});

describe("the typed-text check on a long text", () => {
  const WITHIN_FIVE_SECONDS = { timeout: 5000 };
  const LONG_RUN = 10_000;

  it(
    "finds sort code pairs after 10,000 unbroken characters without stalling",
    WITHIN_FIVE_SECONDS,
    () => {
      const run = "x".repeat(LONG_RUN);

      expect(checkTypedText(`${run} ${"sort 20-00-00 12345678 ".repeat(200)}`)).toBe(
        `${run} ${"sort [withheld] ".repeat(200)}`,
      );
    },
  );

  it("finds cues after 10,000 spaces without stalling", WITHIN_FIVE_SECONDS, () => {
    const opened = `Rota\n\n${" ".repeat(LONG_RUN)}`;

    expect(checkTypedText(`${opened}${"sickness ".repeat(60_000)}end`)).toBe(`${opened}[withheld]`);
  });
});

describe("the typed-text cases in the redaction contract fixture", () => {
  it("redacts every fixture case to its expected text", () => {
    const read = fixture.typed_text.cases.map(({ name, input }) => ({
      name,
      text: checkTypedText(input),
    }));

    expect(read).toEqual(
      fixture.typed_text.cases.map(({ name, expected }) => ({ name, text: expected })),
    );
  });

  it("covers every always-tier category and no other category", () => {
    const always = fixture.categories
      .filter(({ tier }) => tier === REDACTION_ALWAYS_TIER)
      .map(({ category }) => category);
    const covered = new Set(fixture.typed_text.cases.flatMap(({ categories }) => categories));

    expect([...covered].toSorted()).toEqual(always.toSorted());
  });
});
