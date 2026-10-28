import { describe, expect, it } from "vitest";

import { lineReferencesIn } from "@better-answers/devtools/line-references";

const textsIn = (text: string): readonly string[] =>
  lineReferencesIn(text).map((reference) => reference.text);

describe("the line references a doc may not hold", () => {
  it.each([
    { shape: "a file name and a line", text: "see `x.ts:12`", found: ["x.ts:12"] },
    {
      shape: "a path and a range",
      text: "in `apps/api/src/auth/auth.ts:793-808`",
      found: ["apps/api/src/auth/auth.ts:793-808"],
    },
    {
      shape: "a range with an en dash",
      text: "at routes.mjs:763–769",
      found: ["routes.mjs:763–769"],
    },
    { shape: "a line and a column", text: "(`spec.tsx:40:9`)", found: ["spec.tsx:40:9"] },
    { shape: "a dotted test file", text: "`sign-in.test.ts:666`", found: ["sign-in.test.ts:666"] },
    {
      shape: "a bare fragment after a file",
      text: "(`suite.ts:230`, `:280`)",
      found: ["suite.ts:230", ":280"],
    },
    { shape: "a bare range fragment", text: "(`:64-81`)", found: [":64-81"] },
  ])("names $shape", ({ text, found }) => {
    expect(textsIn(text)).toEqual(found);
  });

  it("names the doc line each reference sits on", () => {
    const text = "one\ntwo `a.ts:3`\nthree\nfour `b.py:10-12` and `:14`\n";

    expect(lineReferencesIn(text)).toEqual([
      { line: 2, text: "a.ts:3" },
      { line: 4, text: "b.py:10-12" },
      { line: 4, text: ":14" },
    ]);
  });

  it.each([
    { shape: "a port on localhost", text: "listens on localhost:5432" },
    { shape: "a port on an address", text: "binds 127.0.0.1:3000 and 0.0.0.0:8080" },
    { shape: "a port on a dotted host", text: "reaches db.example.dev:5432" },
    { shape: "a time", text: "it ran at 11:26 and again at 13:10" },
    { shape: "a URL with a port", text: "https://example.com:8080/path/a.md" },
    { shape: "a file name and a word", text: "`fixture.json:admin` and `x.ts:typed`" },
    { shape: "a file name and a version", text: "pins `lock.yaml:v2` and `a.ts:12abc`" },
    { shape: "a line of a log file", text: "the last at line 293990 of watch.err" },
    { shape: "a ratio", text: "a score of 3:1 and 12:30" },
  ])("passes $shape", ({ text }) => {
    expect(textsIn(text)).toEqual([]);
  });
});
