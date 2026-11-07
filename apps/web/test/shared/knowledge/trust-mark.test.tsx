import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TrustMark } from "@/shared/knowledge/trust-mark.tsx";

afterEach(cleanup);

const SEVEN = [
  "Verified by Priya Shah",
  "Verified automatically",
  "Unverified",
  "Changed since verified",
  "Out of date",
  "Draft",
  "Deprecated",
];

const markOf = (words: string) => {
  const { container } = render(<TrustMark words={words} />);
  const mark = container.firstElementChild;
  if (mark === null) throw new Error(`no mark rendered for ${words}`);
  return mark;
};

describe("a trust mark", () => {
  it.each(SEVEN)("shows %s beside its icon", (words) => {
    const mark = markOf(words);

    expect(mark.textContent).toBe(words);
    expect(mark.querySelector("svg[aria-hidden]")).not.toBeNull();
  });

  it("draws a different icon for each of the seven words", () => {
    const icons = SEVEN.map((words) => {
      const drawn = markOf(words).querySelector("svg")?.innerHTML;
      cleanup();
      return drawn;
    });

    expect(new Set(icons).size).toBe(SEVEN.length);
  });

  it("tints verified, out-of-date and draft trust differently", () => {
    const tints = ["Verified automatically", "Out of date", "Draft", "Unverified"].map((words) => {
      const tint = markOf(words).className;
      cleanup();
      return tint;
    });

    expect(new Set(tints).size).toBe(4);
  });

  it("keeps words outside the closed set as plain text", () => {
    const mark = markOf("Something else");

    expect(mark.textContent).toBe("Something else");
    expect(mark.querySelector("svg")).toBeNull();
  });
});
