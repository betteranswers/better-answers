// @vitest-environment node

import { describe, expect, it } from "vitest";

import { moduleAt, playwrightOver } from "./playwright-tree.ts";

const flakyReportOver = (spec: string) => {
  const reporter = moduleAt("e2e/flaky-report.ts");
  const run = playwrightOver(
    {
      "playwright.config.ts": `export default { testDir: ".", retries: 1, reporter: [[${reporter}]], use: { trace: "on-first-retry" } };\n`,
      "a.spec.ts": spec,
    },
    { TRACE_ARTIFACT: "browser-traces-attempt-1" },
  );
  if (run.status !== 0) {
    throw new Error(`playwright exited ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
  }
  return run;
};

describe("the flaky report", () => {
  it("names a test that passed only on its retry", () => {
    const run = flakyReportOver(
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
    const run = flakyReportOver(
      ['import { test } from "@playwright/test";', 'test("takes a payment", () => {});', ""].join(
        "\n",
      ),
    );

    expect(run.stdout).not.toContain("::warning");
    expect(run.summary).toBe("");
  }, 60_000);
});
