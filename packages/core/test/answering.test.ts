import { describe, expect, it } from "vitest";

import {
  mapWords,
  NOT_ANSWERED,
  renderAnswer,
  renderFeedback,
  renderOpen,
  trustWords,
  type AnswerResult,
} from "../src/answering/index.ts";

/**
 * The human renderings through the slice's interface: the reader's words and no others
 * (CONTEXT.md, *trust words the reader sees*, *map*, *feedback*), and the answer's
 * verdict-first shape with its map line (ADR 0016).
 */

const answer = (overrides: Partial<AnswerResult>): AnswerResult => ({
  verdict: "ok",
  text: "The company holds ISO/IEC 27001:2022.",
  citations: [{ iri: "https://better-answers.com/c/01A", url: "https://app.example/c/01A" }],
  conflicts: [],
  coverage: { asked: 1, answered: 1 },
  unmappedPassages: [],
  map: { state: "live" },
  ...overrides,
});

describe("the trust words", () => {
  it("names the tier for a current unit, with the person, the date and a rider where there is one", () => {
    expect(
      trustWords({
        tier: "human-reviewed",
        status: "current",
        checkedBy: "Priya Shah",
        checkedAt: "2026-03-03",
        rider: null,
      }),
    ).toBe("Checked by Priya Shah · 3 March 2026");
    expect(
      trustWords({
        tier: "human-reviewed",
        status: "current",
        checkedBy: "Priya Shah",
        checkedAt: "2026-03-03",
        rider: "imported",
      }),
    ).toBe("Checked by Priya Shah · 3 March 2026 · imported");
    expect(
      trustWords({
        tier: "machine-confirmed",
        status: "current",
        checkedBy: null,
        checkedAt: null,
        rider: "source-moved-on",
      }),
    ).toBe("Checked by the platform · source moved on");
    expect(
      trustWords({
        tier: "unverified",
        status: "current",
        checkedBy: null,
        checkedAt: null,
        rider: null,
      }),
    ).toBe("Unchecked");
  });

  it("names the status when it is not current, whatever the tier", () => {
    const base = {
      tier: "human-reviewed" as const,
      checkedBy: "A",
      checkedAt: "2026-01-01",
      rider: null,
    };
    expect(trustWords({ ...base, status: "changed-since-checked" })).toBe("Changed since checked");
    expect(trustWords({ ...base, status: "out-of-date" })).toBe("Out of date");
    expect(trustWords({ ...base, status: "draft" })).toBe("Draft");
    expect(trustWords({ ...base, status: "deprecated" })).toBe("Deprecated");
  });
});

describe("the answer's rendering", () => {
  it("puts the verdict first and the map's line second, for each of the map's three states", () => {
    expect(renderAnswer(answer({})).split("\n").slice(0, 2)).toEqual([
      "**Answered from the company's knowledge.**",
      "_map as of now_",
    ]);
    expect(mapWords({ state: "as_of", at: "2026-09-01T10:00:00Z" })).toBe(
      "map as of 1 September 2026",
    );
    expect(mapWords({ state: "unavailable_since", since: "2026-09-01T10:00:00Z" })).toBe(
      "map unavailable since 1 September 2026",
    );
    expect(
      renderAnswer(answer({ map: { state: "unavailable_since", since: "2026-09-01" } })),
    ).toContain("_map unavailable since 1 September 2026_");
  });

  it("renders a refusal as the one sentence, with no prose and its unmapped passages", () => {
    const refused = renderAnswer(
      answer({
        verdict: "refuse",
        text: NOT_ANSWERED,
        citations: [],
        unmappedPassages: [
          {
            locator: "p.4",
            source: "Policy.pdf",
            text: "Retained for six years.",
            sensitivity: "Internal",
          },
        ],
      }),
    );

    expect(refused.startsWith(`**${NOT_ANSWERED}**`)).toBe(true);
    expect(refused).toContain("Not company knowledge · Internal");
    expect(refused).not.toContain("[1]");
  });
});

describe("open's and feedback's renderings", () => {
  it("renders a passage as a quotation with its source, locator and sensitivity word", () => {
    expect(
      renderOpen({
        found: true,
        passage: {
          locator: "p.4",
          source: "Policy.pdf",
          text: "Retained.",
          sensitivity: "Internal",
        },
      }),
    ).toBe("> Retained.\n\n— Policy.pdf (p.4) · Internal");
    expect(renderOpen({ found: false, locator: "p.9" })).toBe("No passage at p.9.");
  });

  it("renders feedback in words, never the wire token", () => {
    expect(
      renderFeedback({ outcome: "received", feedback: { iri: "x", verdict: "helpful" } }),
    ).toContain("x marked helpful");
    expect(
      renderFeedback({
        outcome: "received",
        feedback: { iri: "x", verdict: "flag", reason: "out-of-date", detail: "renewed in May" },
      }),
    ).toContain('flagged as out of date — "renewed in May"');
  });
});
