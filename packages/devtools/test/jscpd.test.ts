import { describe, expect, it } from "vitest";

import { jscpdArgv, jscpdOver } from "@better-answers/devtools/jscpd";
import type { JscpdConfig, Tree } from "@better-answers/devtools/jscpd";

import { jscpdConfig } from "../../../jscpd.config.mjs";

/**
 * The copy-paste gate, run rather than remembered (`[CHECK1]`): a clone across two files
 * fires, the same clone under a named exception stays silent, and a tree with no clone stays
 * silent.
 *
 * The tree, the run and the reading of the report are the devtools runner's, which is what
 * makes the silent half mean anything. jscpd is the awkward case that shape exists for: it
 * exits zero for a tree it found nothing in, for a tree it was pointed at by a path that
 * matched no file, and — the one that caught this repository — for a config file it could
 * not parse, which it reports and then scans on its defaults anyway. Every one of those
 * would read as "no clones" without the smoke case the runner insists on.
 *
 * The tree gets its own configuration rather than the repository's: a suite that scanned
 * under `jscpd.config.mjs` would answer questions about this repository's exclusions instead
 * of about the tool, and the exclusions are proved where they are made — the last test below
 * reads them as values.
 */

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

/** The gate's own settings over a throwaway tree: two files, no exclusions of its own. */
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
  it("names both files when a block is copied from one into another", () => {
    const clones = jscpd(twoFilesOneClone);

    expect(clones).toHaveLength(1);
    expect([clones[0]?.left, clones[0]?.right].sort()).toEqual(["left.ts", "right.ts"]);
  });

  it("stays silent on the same copy when one half is fenced by a named exception", () => {
    const clones = jscpd({
      "left.ts": CLONE,
      "right.ts": `/* jscpd:ignore-start */\n${CLONE}/* jscpd:ignore-end */\n`,
    });

    expect(clones).toEqual([]);
  });

  it("stays silent on a tree whose files share nothing", () => {
    expect(jscpd({ "left.ts": CLONE, "right.ts": NOT_A_CLONE })).toEqual([]);
  });

  it("reads Python the way it reads TypeScript, so the worker is held to the same line", () => {
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
  it("refuses any duplication at all, over both halves of the tree, at five lines", () => {
    const argv = jscpdArgv(jscpdConfig).join(" ");

    expect(argv).toContain("--threshold 0");
    expect(argv).toContain("--min-lines 5");
    expect(argv).toContain("--min-tokens 50");
    expect(argv).toContain("--format typescript,tsx,python");
    expect(argv.endsWith("apps packages")).toBe(true);
  });

  it("walks past what this repository did not write, each exclusion where its reason is", () => {
    // Read as values so a deleted line fails here rather than turning into a red gate on a
    // branch that touched none of it. Every one of these is a decision `jscpd.config.mjs`
    // carries the reason for beside it.
    expect(jscpdConfig.ignore).toContain("apps/web/src/shared/ui/**");
    expect(jscpdConfig.ignore).toContain("**/lifts/**");
    expect(jscpdConfig.ignore).toContain("apps/worker/src/better_answers_worker/schema_view.py");
    expect(jscpdConfig.ignore).toContain("pnpm-lock.yaml");
    expect(jscpdConfig.ignore).toContain("apps/worker/uv.lock");
  });
});
