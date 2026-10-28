import { describe, expect, it } from "vitest";

import { askedFrom, type AskStreamEvent } from "@/shared/api/ask-stream.ts";

type Result = { readonly verdict: string };

const RESULT: Result = { verdict: "related" };

const OPENED: AskStreamEvent<Result> = { kind: "result", result: RESULT };

const POLICY = "https://better-answers.com/c/01J6PPPPPPPPPPPPPPPPPPPPPP";
const LMS = "https://better-answers.com/c/01J6QQQQQQQQQQQQQQQQQQQQQQ";

const sentence = (collection: string | null, said: string, concepts: readonly string[]) =>
  ({ kind: "sentence", collection, sentence: said, concepts }) as const;

describe("folding an answer's stream", () => {
  it("holds nothing until the result arrives", () => {
    const events: AskStreamEvent<Result>[] = [
      { kind: "phase", phase: "reading" },
      { kind: "keep-alive" },
      { kind: "phase", phase: "judging" },
    ];

    expect(askedFrom(events)).toBeUndefined();
  });

  it("ignores keep-alives and phases wherever they fall", () => {
    const told: AskStreamEvent<Result>[] = [
      OPENED,
      sentence("audits", "Claims close within 30 days.", [POLICY]),
      { kind: "part", collection: "audits", outcome: "drafted" },
    ];
    const kept: AskStreamEvent<Result>[] = [
      { kind: "phase", phase: "reading" },
      { kind: "keep-alive" },
      OPENED,
      { kind: "phase", phase: "drafting" },
      { kind: "keep-alive" },
      ...told.slice(1),
      { kind: "keep-alive" },
    ];

    expect(askedFrom(kept)).toEqual(askedFrom(told));
  });

  it("gathers each collection's sentences into its own part", () => {
    const events: AskStreamEvent<Result>[] = [
      OPENED,
      sentence("audits", "Claims close within 30 days.", [POLICY]),
      sentence("audits", "Receipts are kept.", [POLICY]),
      { kind: "part", collection: "audits", outcome: "drafted" },
      sentence(null, "The LMS keeps its logs.", [LMS]),
    ];

    expect(askedFrom(events)).toEqual({
      verdict: "related",
      prose: [
        {
          collection: "audits",
          sentences: [
            { sentence: "Claims close within 30 days.", concepts: [POLICY] },
            { sentence: "Receipts are kept.", concepts: [POLICY] },
          ],
          outcome: "drafted",
        },
        {
          collection: null,
          sentences: [{ sentence: "The LMS keeps its logs.", concepts: [LMS] }],
          outcome: undefined,
        },
      ],
    });
  });

  it("keeps a part that ended with no sentence", () => {
    const events: AskStreamEvent<Result>[] = [
      OPENED,
      { kind: "part", collection: "audits", outcome: "paused" },
    ];

    expect(askedFrom(events)?.prose).toEqual([
      { collection: "audits", sentences: [], outcome: "paused" },
    ]);
  });
});
