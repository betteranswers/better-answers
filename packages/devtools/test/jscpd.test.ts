import { describe, expect, it } from "vitest";

import { jscpdArgv, jscpdOver } from "@better-answers/devtools/jscpd";
import type { JscpdConfig, Tree } from "@better-answers/devtools/jscpd";

import { jscpdConfig } from "../../../jscpd.config.mjs";

const CLONE = `export const shape = (input: string): string => {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  const parts = upper.split(",");
  const joined = parts.join("-");
  return joined;
};
`;

const NOT_A_CLONE = `export const other = (count: number): number => count + 1;
`;

const overATree: JscpdConfig = {
  paths: ["."],
  formats: ["typescript", "tsx", "python"],
  minLines: 5,
  minTokens: 50,
  threshold: 0,
  ignore: [],
};

const twoFilesOneClone: Tree = { "left.ts": CLONE, "right.ts": CLONE };

const jscpd = jscpdOver(overATree, { tree: twoFilesOneClone, clones: 1 });

describe("the copy-paste gate over a throwaway tree", () => {
  it("names both files when a block is copied between them", () => {
    const clones = jscpd(twoFilesOneClone);

    expect(clones).toHaveLength(1);
    expect([clones[0]?.left, clones[0]?.right].sort()).toEqual(["left.ts", "right.ts"]);
  });

  it("stays silent when one half is fenced as an exception", () => {
    const clones = jscpd({
      "left.ts": CLONE,
      "right.ts": `/* jscpd:ignore-start */\n${CLONE}/* jscpd:ignore-end */\n`,
    });

    expect(clones).toEqual([]);
  });

  it("stays silent on a tree whose files share nothing", () => {
    expect(jscpd({ "left.ts": CLONE, "right.ts": NOT_A_CLONE })).toEqual([]);
  });

  it("names a Python clone as it names a TypeScript one", () => {
    const python = [
      "def shape(value: str) -> str:",
      "    trimmed = value.strip()",
      "    upper = trimmed.upper()",
      '    parts = upper.split(",")',
      '    kept = [part for part in parts if part != ""]',
      '    joined = "-".join(kept)',
      '    stamped = joined + "-" + str(len(kept))',
      "    return stamped",
      "",
    ].join("\n");

    const clones = jscpd({ "left.py": python, "right.py": python });

    expect(clones).toHaveLength(1);
  });
});

describe("the gate's configuration, as the root script runs it", () => {
  it("refuses any five-line clone over both halves of the tree", () => {
    const argv = jscpdArgv(jscpdConfig).join(" ");

    expect(argv).toContain("--threshold 0");
    expect(argv).toContain("--min-lines 5");
    expect(argv).toContain("--min-tokens 50");
    expect(argv).toContain("--format typescript,tsx,python");
    expect(argv.endsWith("apps packages")).toBe(true);
  });

  it("walks past files this repository did not write", () => {
    expect(jscpdConfig.ignore).toContain("apps/web/src/shared/ui/**");
    expect(jscpdConfig.ignore).toContain("**/lifts/**");
    expect(jscpdConfig.ignore).toContain("apps/worker/src/better_answers_worker/schema_view.py");
    expect(jscpdConfig.ignore).toContain("pnpm-lock.yaml");
    expect(jscpdConfig.ignore).toContain("apps/worker/uv.lock");
  });
});
