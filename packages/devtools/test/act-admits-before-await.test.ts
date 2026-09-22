import path from "node:path";

import { readOxlintConfig, repositoryRoot } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import { describe, expect, it } from "vitest";

import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/act-admits-before-await";
const FILE = "act.ts";

const specifier = (): string => {
  const plugin = readOxlintConfig().jsPlugins.find((one) => one.name === "better-answers");
  if (plugin === undefined)
    throw new Error(".oxlintrc.json no longer loads the better-answers plugin.");
  return path.join(repositoryRoot, plugin.specifier);
};

const CONFIG = JSON.stringify({
  jsPlugins: [{ name: "better-answers", specifier: specifier() }],
  rules: { [RULE]: "error" },
});

// Spelled in two halves, so the tag scan does not read this assertion as a citation.
const tag = (family: string, number: string): string => `[${family}${number}]`;

const DECLARATION = `const reprocessAct = declareAct({
  admits: { role: "Admin", purposes: [] },
  input: schema,
  refuses: ["role-forbids"],
  effect: "write",
});
`;

const holding = (body: string): Tree => ({ [FILE]: `${DECLARATION}\n${body}` });

const ADMITS_FIRST = `export const reprocess = async (principal, tx, input) => {
  const admitted = admit(reprocessAct, principal, input);
  if (!admitted.ok) return admitted;
  const row = await tx.query("SELECT 1");
  return row;
};
`;

const AWAITS_FIRST = `export const reprocess = async (principal, tx, input) => {
  const row = await tx.query("SELECT 1");
  const admitted = admit(reprocessAct, principal, input);
  if (!admitted.ok) return admitted;
  return row;
};
`;

const lint = oxlintOver(CONFIG, { tree: holding(AWAITS_FIRST), flagged: [FILE] });

describe("the rule that a declared act admits before it awaits", () => {
  it("refuses an act that reads a row before it admits, naming its rule", () => {
    const output = lint.output(holding(AWAITS_FIRST));

    expect(output).toContain("awaits before it admits");
    expect(output).toContain(tag("SEC", "5"));
    expect(output).toContain("better-answers(act-admits-before-await)");
  });

  it("stays silent on an act that admits first and awaits after", () => {
    expect(lint.flagged(holding(ADMITS_FIRST))).toEqual([]);
  });

  it("refuses a declaration no function here passes to `admit`", () => {
    const unused = `export const reprocess = async (principal, tx) => tx.query("SELECT 1");\n`;
    const output = lint.output(holding(unused));

    expect(output).toContain("`reprocessAct`");
    expect(output).toContain("states a gate nothing runs");
  });

  it("leaves a step alone: it takes the principal its act admitted and declares nothing", () => {
    const step = {
      "step.ts": `export const enqueueJobIn = async (principal, tx, input) => {
  const landed = await tx.query("INSERT INTO job VALUES ($1)", [input.workspaceId]);
  return landed;
};
`,
    };

    expect(lint.flagged(step)).toEqual([]);
  });

  it("reads each function on its own, so an inner callback's await is not the act's", () => {
    const nested = `export const reprocess = async (principal, tx, input) => {
  const admitted = admit(reprocessAct, principal, input);
  if (!admitted.ok) return admitted;
  return tx.run(async (inner) => {
    await inner.query("SELECT 1");
    return admit(reprocessAct, principal, input);
  });
};
`;

    expect(lint.flagged(holding(nested))).toEqual([FILE]);
  });
});
