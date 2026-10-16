import { describe, expect, it } from "vitest";

import { pluginConfigFor, readOxlintConfig } from "@better-answers/devtools/oxlint-config";
import { oxlintOver } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const RULE = "better-answers/import-statically";
const FILE = "src/probe.ts";

const importing = (file: string): Tree => ({
  [file]: 'export const probe = async () => import("./other.ts");\n',
});

const lifting = readOxlintConfig().overrides.filter((one) => one.rules?.[RULE] !== undefined);

const lint = oxlintOver(
  JSON.stringify({ ...JSON.parse(pluginConfigFor({ [RULE]: "error" })), overrides: lifting }),
  { tree: importing(FILE), flagged: [FILE] },
);

describe("the rule that source imports statically", () => {
  it("refuses a dynamic `import()` in source, naming the fix", () => {
    const output = lint.output(importing(FILE));

    expect(output).toContain("better-answers(import-statically)");
    expect(output).toContain("Import the module statically");
  });

  it("stays silent on a static import in source", () => {
    expect(lint.flagged({ [FILE]: 'export { probe } from "./other.ts";\n' })).toEqual([]);
  });

  it.each(["src/probe.test.ts", "test/probe.ts", "e2e/probe.ts", "scripts/probe.mjs"])(
    "stays silent on a dynamic `import()` in %s",
    (file) => {
      expect(lint.flagged(importing(file))).toEqual([]);
    },
  );

  it("is lifted by one override in the real config", () => {
    expect(lifting).toHaveLength(1);
  });
});
