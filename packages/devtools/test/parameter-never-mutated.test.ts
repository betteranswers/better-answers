import { describe, expect, it } from "vitest";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/parameter-never-mutated";
const FILE = "probe.ts";

const holding = (source: string): Tree => ({ [FILE]: source });

const SORTS_PARAMETER = "export const ranked = (rows: number[]) => rows.sort((a, b) => a - b);\n";

const lint = oxlintOver(pluginConfigFor({ [RULE]: "error" }), {
  tree: holding(SORTS_PARAMETER),
  flagged: [FILE],
});

describe("the rule that a function never mutates a parameter", () => {
  it("refuses a parameter sorted in place, naming the fix", () => {
    const output = lint.output(holding(SORTS_PARAMETER));

    expect(output).toContain("better-answers(parameter-never-mutated)");
    expect(output).toContain("`sort` changes the parameter `rows` in place");
    expect(output).toContain("return a new value");
  });

  it.each([
    ["`push` on a parameter", "export function add(rows: number[]) {\n  rows.push(1);\n}\n"],
    [
      "`Object.assign` onto a parameter",
      "export const stamp = (row: object) => Object.assign(row, { seen: true });\n",
    ],
    [
      "a destructured parameter reversed",
      "export const flip = ({ rows }: { rows: number[] }) => rows.reverse();\n",
    ],
    [
      "a defaulted parameter spliced",
      "export const cut = (rows: number[] = []) => rows.splice(0, 1);\n",
    ],
    [
      "an outer parameter mutated inside a callback",
      "export const fill = (rows: number[], more: number[]) => {\n  more.forEach((one) => rows.push(one));\n};\n",
    ],
  ])("refuses %s", (_shape, source) => {
    expect(lint.flagged(holding(source))).toEqual([FILE]);
  });

  it.each([
    [
      "a local array",
      "export const ranked = () => {\n  const rows = [2, 1];\n  rows.sort((a, b) => a - b);\n  return rows;\n};\n",
    ],
    [
      "a sorted copy of a parameter",
      "export const ranked = (rows: number[]) => [...rows].sort((a, b) => a - b);\n",
    ],
    [
      "a parameter's `toSorted`",
      "export const ranked = (rows: number[]) => rows.toSorted((a, b) => a - b);\n",
    ],
    [
      "a Map parameter's `set`",
      "export const note = (seen: Map<string, number>) => seen.set('a', 1);\n",
    ],
    [
      "a local that shadows a parameter",
      "export const ranked = (rows: number[]) => {\n  {\n    const rows = [2, 1];\n    rows.sort((a, b) => a - b);\n  }\n  return rows;\n};\n",
    ],
    [
      "a locator parameter's `fill`",
      "export const typed = async (field: { fill: (text: string) => Promise<void> }) => field.fill('a');\n",
    ],
    [
      "`Object.assign` onto a fresh object",
      "export const stamp = (row: object) => Object.assign({}, row, { seen: true });\n",
    ],
  ])("stays silent on %s", (_shape, source) => {
    expect(lint.flagged(holding(source))).toEqual([]);
  });
});
