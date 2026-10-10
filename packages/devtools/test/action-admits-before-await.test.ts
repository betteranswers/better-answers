import { describe, expect, it } from "vitest";

import { pluginConfigFor } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/action-admits-before-await";
const FILE = "action.ts";

const CONFIG = pluginConfigFor({ [RULE]: "error" });

const DECLARATION = `const reprocessAction = declareAction({
  admits: { role: "Admin", purposes: [] },
  input: schema,
  refuses: ["role-forbids"],
});
`;

const holding = (body: string): Tree => ({ [FILE]: `${DECLARATION}\n${body}` });

const ADMITS_FIRST = `export const reprocess = async (principal, tx, input) => {
  const admitted = admit(reprocessAction, principal, input);
  if (!admitted.ok) return admitted;
  const row = await tx.query("SELECT 1");
  return row;
};
`;

const AWAITS_FIRST = `export const reprocess = async (principal, tx, input) => {
  const row = await tx.query("SELECT 1");
  const admitted = admit(reprocessAction, principal, input);
  if (!admitted.ok) return admitted;
  return row;
};
`;

const lint = oxlintOver(CONFIG, { tree: holding(AWAITS_FIRST), flagged: [FILE] });

describe("the rule that a declared action admits before it awaits", () => {
  it("refuses an action reading before admitting, naming its rules file", () => {
    const output = lint.output(holding(AWAITS_FIRST));

    expect(output).toContain("awaits before it admits");
    expect(output).toContain("the root `CODING_STANDARDS.md`");
    expect(output).toContain("better-answers(action-admits-before-await)");
  });

  it("stays silent on an action that admits, then awaits", () => {
    expect(lint.flagged(holding(ADMITS_FIRST))).toEqual([]);
  });

  it("refuses a declaration no function here passes to `admit`", () => {
    const unused = `export const reprocess = async (principal, tx) => tx.query("SELECT 1");\n`;
    const output = lint.output(holding(unused));

    expect(output).toContain("`reprocessAction`");
    expect(output).toContain("states a gate nothing runs");
  });

  it("leaves alone a step that declares nothing", () => {
    const step = {
      "step.ts": `export const enqueueJobIn = async (principal, tx, input) => {
  const landed = await tx.query("SELECT 1 FROM job WHERE workspace_id = $1", [input.workspaceId]);
  return landed;
};
`,
    };

    expect(lint.flagged(step)).toEqual([]);
  });

  it("fires on an inner callback that awaits before it admits", () => {
    const nested = `export const reprocess = async (principal, tx, input) => {
  const admitted = admit(reprocessAction, principal, input);
  if (!admitted.ok) return admitted;
  return tx.run(async (inner) => {
    await inner.query("SELECT 1");
    return admit(reprocessAction, principal, input);
  });
};
`;

    expect(lint.flagged(holding(nested))).toEqual([FILE]);
  });

  describe.each(["requireAdmin", "requireFreshSignIn"])("the shorthand `%s`", (shorthand) => {
    const step = (body: string): Tree => ({ "step.ts": body });

    it("refuses a step that awaits before it, naming the call", () => {
      const late = `export const groups = async (principal, tx) => {
  const rows = await tx.query("SELECT 1");
  const admin = ${shorthand}(principal);
  if (!admin.ok) return admin;
  return rows;
};
`;
      const output = lint.output(step(late));

      expect(output).toContain("awaits before it admits");
      expect(output).toContain(`run \`${shorthand}\` first`);
    });

    it("stays silent on a step that calls it, then awaits", () => {
      const first = `export const groups = async (principal, tx) => {
  const admin = ${shorthand}(principal);
  if (!admin.ok) return admin;
  return tx.query("SELECT 1");
};
`;

      expect(lint.flagged(step(first))).toEqual([]);
    });
  });

  it("refuses a late `admit`, though a shorthand came first", () => {
    const mixed = `export const reprocess = async (principal, tx, input) => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return admin;
  await tx.query("SELECT 1");
  return admit(reprocessAction, principal, input);
};
`;
    const output = lint.output(holding(mixed));

    expect(output).toContain("run `admit` first");
  });

  it("pairs a declaration with `admit` alone, never a shorthand's argument", () => {
    const both = `export const reprocess = async (principal, tx, input) => {
  const admin = requireAdmin(reprocessAction);
  if (!admin.ok) return admin;
  return tx.query("SELECT 1");
};
`;
    const output = lint.output(holding(both));

    expect(output).toContain("`reprocessAction`");
    expect(output).toContain("states a gate nothing runs");
  });
});
