import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { markOf, TONE_CLASSES, TrustMark } from "@/shared/knowledge/trust-mark.tsx";

afterEach(cleanup);

type Props = ComponentProps<typeof TrustMark>;

type Standing = Props["trust"];

type Dated = Extract<Props, { readonly dated: true }>["trust"];

const CURRENT = [
  [{ tier: "unverified", status: "current" }, "Unverified"],
  [{ tier: "machine-confirmed", status: "current" }, "Verified automatically"],
  [{ tier: "human-reviewed", status: "current" }, "Verified by Priya Shah"],
] as const satisfies readonly (readonly [Standing, string])[];

const NOT_CURRENT = [
  [{ tier: "human-reviewed", status: "changed-since-checked" }, "Changed since verified"],
  [{ tier: "human-reviewed", status: "out-of-date" }, "Out of date"],
  [{ tier: "unverified", status: "draft" }, "Draft"],
  [{ tier: "machine-confirmed", status: "deprecated" }, "Deprecated"],
] as const satisfies readonly (readonly [Standing, string])[];

const markFor = (trust: Standing, words: string) => {
  const { container } = render(<TrustMark trust={trust} words={words} />);
  const mark = container.firstElementChild;
  if (mark === null) throw new Error(`no mark rendered for ${words}`);
  return mark;
};

const drawn = (trust: Standing, words: string) => {
  const mark = markFor(trust, words);
  const result = { tint: mark.className, icon: mark.querySelector("svg")?.innerHTML };
  cleanup();
  return result;
};

describe("a trust mark", () => {
  it.each([...CURRENT, ...NOT_CURRENT].map(([trust, words]) => [words, trust] as const))(
    "shows %s beside an icon",
    (words, trust) => {
      const mark = markFor(trust, words);

      expect(mark.textContent).toBe(words);
      expect(mark.querySelector("svg[aria-hidden]")).not.toBeNull();
    },
  );

  it("draws a different icon for each of the seven standings", () => {
    const icons = [...CURRENT, ...NOT_CURRENT].map(([trust, words]) => drawn(trust, words).icon);

    expect(new Set(icons).size).toBe(icons.length);
  });

  it("tints verified, out-of-date, draft and unverified trust differently", () => {
    const standings: readonly Standing[] = [
      { tier: "machine-confirmed", status: "current" },
      { tier: "human-reviewed", status: "out-of-date" },
      { tier: "unverified", status: "draft" },
      { tier: "unverified", status: "current" },
    ];
    const tints = standings.map((trust) => drawn(trust, "Words").tint);

    expect(new Set(tints).size).toBe(4);
  });

  it("reads an out-of-date human-reviewed concept as out of date", () => {
    const outOfDate = drawn({ tier: "human-reviewed", status: "out-of-date" }, "Out of date");

    expect(drawn({ tier: "human-reviewed", status: "out-of-date" }, "Words")).toEqual(outOfDate);
    expect(drawn({ tier: "unverified", status: "out-of-date" }, "Words")).toEqual(outOfDate);
    expect(drawn({ tier: "human-reviewed", status: "current" }, "Words")).not.toEqual(outOfDate);
  });

  it("tints a deprecated concept as unverified, with its own icon", () => {
    const deprecated = drawn({ tier: "human-reviewed", status: "deprecated" }, "Deprecated");
    const unverified = drawn({ tier: "unverified", status: "current" }, "Unverified");

    expect(deprecated.tint).toBe(unverified.tint);
    expect(deprecated.icon).not.toBe(unverified.icon);
  });

  it("tints the mark from the classes of markOf's tone", () => {
    const trust: Standing = { tier: "human-reviewed", status: "changed-since-checked" };

    expect(markFor(trust, "Words").className).toContain(TONE_CLASSES[markOf(trust).tone]);
  });

  it("does not guess the mark from the words", () => {
    const words = "Verified by Priya Shah";

    expect(drawn({ tier: "unverified", status: "current" }, words)).toEqual(
      drawn({ tier: "unverified", status: "current" }, "Unverified"),
    );
  });
});

describe("a dated trust mark", () => {
  const CHECKED_AT = "2026-10-03T09:00:00.000Z";

  const datedMark = (trust: Dated, words: string) => {
    const { container } = render(<TrustMark trust={trust} words={words} dated />);
    return container.firstElementChild;
  };

  it("adds the day an automatic check passed", () => {
    const mark = datedMark(
      { tier: "machine-confirmed", status: "current", verifiedAt: CHECKED_AT },
      "Verified automatically",
    );

    expect(mark?.textContent).toBe("Verified automatically · 3 October 2026");
    expect(mark?.querySelector(".font-mono")?.textContent).toBe("3 October 2026");
  });

  it("leaves a person's date to the server's words", () => {
    const words = "Verified by Priya Shah · 3 October 2026";
    const mark = datedMark(
      { tier: "human-reviewed", status: "current", verifiedAt: CHECKED_AT },
      words,
    );

    expect(mark?.textContent).toBe(words);
  });

  it("adds no date to a check that no longer stands", () => {
    const mark = datedMark(
      { tier: "machine-confirmed", status: "out-of-date", verifiedAt: CHECKED_AT },
      "Out of date",
    );

    expect(mark?.textContent).toBe("Out of date");
  });

  it("adds no date to a check with no day recorded", () => {
    const mark = datedMark(
      { tier: "machine-confirmed", status: "current", verifiedAt: null },
      "Verified automatically",
    );

    expect(mark?.textContent).toBe("Verified automatically");
  });
});
