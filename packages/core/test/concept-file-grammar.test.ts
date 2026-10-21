import { describe, expect, it } from "vitest";

import { parseConceptFile } from "../src/concepts/index.ts";

const MALFORMED = { ok: false, error: "malformed" };

describe("the concept-file grammar", () => {
  it("reads a quoted key, and a list of strings", () => {
    expect([
      parseConceptFile('---\n"title": "x"\n---\n\nbody\n'),
      parseConceptFile('---\n"tags":\n  - "a"\n---\n\nbody\n'),
    ]).toEqual([
      { ok: true, value: { frontmatter: { title: "x" }, body: "body\n" } },
      { ok: true, value: { frontmatter: { tags: ["a"] }, body: "body\n" } },
    ]);
  });

  it("refuses a file with junk before a quoted key", () => {
    expect(parseConceptFile('---\n x"title": "x"\n---\n\nbody\n')).toEqual(MALFORMED);
  });

  it("refuses a file with a numeric list item", () => {
    expect(parseConceptFile('---\n"tags":\n  - 1\n---\n\nbody\n')).toEqual(MALFORMED);
  });

  it("refuses a file with no opening fence", () => {
    expect(parseConceptFile('"title": "x"\n---\n\nbody\n')).toEqual(MALFORMED);
  });
});
