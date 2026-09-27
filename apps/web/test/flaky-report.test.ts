// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const web = fileURLToPath(new URL("..", import.meta.url));

type Run = { readonly stdout: string; readonly summary: string };

/** The spec's own import of Playwright resolves through the link, to the instance running it. */
const playwrightOver = (spec: string): Run => {
  const tree = realpathSync(mkdtempSync(path.join(tmpdir(), "flaky-report-")));
  try {
    symlinkSync(path.join(web, "node_modules"), path.join(tree, "node_modules"));
    const reporter = JSON.stringify(path.join(web, "e2e", "flaky-report.ts"));
    writeFileSync(
      path.join(tree, "playwright.config.ts"),
      `export default { testDir: ".", retries: 1, reporter: [[${reporter}]], use: { trace: "on-first-retry" } };\n`,
    );
    writeFileSync(path.join(tree, "a.spec.ts"), spec);
    const summary = path.join(tree, "summary.md");
    writeFileSync(summary, "");

    const run = spawnSync(
      process.execPath,
      [path.join(web, "node_modules", "@playwright", "test", "cli.js"), "test"],
      {
        cwd: tree,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_STEP_SUMMARY: summary,
          GITHUB_WORKSPACE: tree,
          TRACE_ARTIFACT: "browser-traces-attempt-1",
        },
      },
    );
    if (run.status !== 0) {
      throw new Error(`playwright exited ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
    }
    return { stdout: run.stdout, summary: readFileSync(summary, "utf8") };
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
};

describe("the flaky report", () => {
  it("names a test that passed only on its retry", () => {
    const run = playwrightOver(
      [
        'import { test } from "@playwright/test";',
        'test.describe("the checkout", () => {',
        '  test("takes a payment", () => {',
        '    if (test.info().retry === 0) throw new Error("the first attempt fails");',
        "  });",
        "});",
        "",
      ].join("\n"),
    );

    expect(run.stdout).toContain(
      "::warning file=a.spec.ts,line=3,title=Flaky browser test::" +
        "the checkout › takes a payment failed, then passed on retry: Error: the first attempt fails\n",
    );
    expect(run.summary).toContain(
      "| the checkout › takes a payment | `a.spec.ts:3` | Error: the first attempt fails | " +
        "`browser-traces-attempt-1/a-the-checkout-takes-a-payment-retry1/trace.zip` |\n",
    );
  }, 60_000);

  it("names nothing when every test passes at first", () => {
    const run = playwrightOver(
      ['import { test } from "@playwright/test";', 'test("takes a payment", () => {});', ""].join(
        "\n",
      ),
    );

    expect(run.stdout).not.toContain("::warning");
    expect(run.summary).toBe("");
  }, 60_000);
});
