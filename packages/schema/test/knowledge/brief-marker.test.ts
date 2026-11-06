import { describe, expect, it } from "vitest";

import { markersOf, replaceMarkers } from "../../src/knowledge/brief-marker.ts";

describe("the markers of a Brief", () => {
  it("lists each marker in order, including repeats", () => {
    expect(markersOf("A[^one] B[^two-2] C[^one]")).toEqual(["one", "two-2", "one"]);
  });

  it("does not read a footnote definition as a marker", () => {
    expect(markersOf("Claim[^a].\n\n[^b]: a definition")).toEqual(["a"]);
  });

  it("finds no marker in prose without a footnote", () => {
    expect(markersOf("Plain words, a [link](x) and [^ spaced].")).toEqual([]);
  });
});

describe("the markers in a Brief that holds code", () => {
  it("reads no marker inside a code span", () => {
    expect(markersOf("Write `[^one]` to cite, then cite[^two].")).toEqual(["two"]);
  });

  it("reads no marker inside a fenced block", () => {
    expect(markersOf("Before[^a]\n\n```\n[^b]\n```\n\nAfter[^c]")).toEqual(["a", "c"]);
  });

  it("reads a marker beside a code span", () => {
    expect(markersOf("`code`[^a] and [^b]`code`")).toEqual(["a", "b"]);
  });

  it("reads a backslash-escaped backtick as text", () => {
    expect(markersOf("Cost \\`[^a] and`")).toEqual(["a"]);
  });
});

describe("a colon after a marker", () => {
  it("reads a marker with a colon after it mid-line", () => {
    expect(markersOf("Cited here[^a]: the policy, and again[^b]:")).toEqual(["a", "b"]);
  });

  it("reads a definition only where it opens a line", () => {
    expect(markersOf("[^a]: first\n   [^b]: indented\ntext [^c]: mid")).toEqual(["c"]);
  });

  it("reads a marker that opens a line", () => {
    expect(markersOf("[^a] opens the line")).toEqual(["a"]);
  });

  it("reads a colon after a marker that follows code", () => {
    expect(markersOf("`code`[^a]: here")).toEqual(["a"]);
  });
});

describe("replacing the markers of a Brief", () => {
  it("replaces markers only, leaving code and definitions as typed", () => {
    const replaced = replaceMarkers(
      "A[^a]: b `[^a]`\n\n[^a]: defined\n\n```\n[^a]\n```",
      (label) => `<${label}>`,
    );

    expect(replaced).toBe("A<a>: b `[^a]`\n\n[^a]: defined\n\n```\n[^a]\n```");
  });
});
