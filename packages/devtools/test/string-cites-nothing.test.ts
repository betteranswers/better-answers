import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { describe, expect, it } from "vitest";

import { tag } from "./fixture-text.ts";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/string-cites-nothing";
const FILE = "probe.ts";

const saying = (text: string): Tree => ({ [FILE]: `export const usage = "${text}";\n` });

const lint = oxlintOver(pluginConfigFor({ [RULE]: "error" }), {
  tree: saying("Ask the owner about T-243 first."),
  flagged: [FILE],
});

describe("the string rule refuses a citation a reader cannot open", () => {
  it("names what the string cites and the rule it breaks", () => {
    const output = lint.output(saying("Ask the owner about T-243 first."));

    expect(output).toContain("This string cites a ticket id (`T-243`)");
    expect(output).toContain(tag("COMMENT", "1"));
    expect(output).toContain("better-answers(string-cites-nothing)");
  });

  it.each([
    ["an ADR number", "The graph is Postgres under ADR 0021."],
    ["an ISO date", "The registry moved on 2026-09-21."],
    ["a slashed date", "The registry moved on 21/09/2026."],
    ["a rule tag", `A raw insert lives in a factory (${tag("TEST", "4")}).`],
  ])("refuses a string citing %s", (_what, text) => {
    expect(lint.flagged(saying(text))).toEqual([FILE]);
  });

  it("refuses a citation in a template literal's text", () => {
    const template = {
      [FILE]: "export const usage = (id: string): string => `${id} landed under T-243.`;\n",
    };

    expect(lint.flagged(template)).toEqual([FILE]);
  });

  it("refuses a citation in a template literal's escaped text", () => {
    const template = { [FILE]: "export const usage = `\\u0054-243 landed, and that is all.`;\n" };

    expect(lint.flagged(template)).toEqual([FILE]);
  });
});

describe("the string rule walks past a string citing nothing", () => {
  it("stays silent over a string saying what to do", () => {
    expect(lint.flagged(saying("Name a workspace this person belongs to."))).toEqual([]);
  });

  it("walks past a value with no prose in it", () => {
    expect(lint.flagged({ [FILE]: 'export const profile = "mcp-2026-07-28";\n' })).toEqual([]);
  });

  it("walks past a regular expression, which is not prose", () => {
    expect(lint.flagged({ [FILE]: "export const moved = /moved under T-243 here/;\n" })).toEqual(
      [],
    );
  });

  it("leaves a comment to the comment rule", () => {
    const commented = {
      [FILE]: "// Kept because the claim protocol changed under T-243.\nexport const keep = 1;\n",
    };

    expect(lint.flagged(commented)).toEqual([]);
  });

  it("walks past the same string in a test", () => {
    const inATest = {
      "tests/probe.ts": 'export const usage = "The graph is Postgres under ADR 0021.";\n',
    };

    expect(lint.flagged(inATest)).toEqual([]);
  });

  it("walks past the same string in a tag-printing gate", () => {
    const inAGate = {
      "packages/devtools/src/insert-scan.ts": `export const said = "A raw insert lives in a factory (${tag("TEST", "4")}).";\n`,
    };

    expect(lint.flagged(inAGate)).toEqual([]);
  });
});
