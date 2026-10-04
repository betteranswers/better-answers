// @vitest-environment node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { journeysOver, moduleAt, OUTCOME_FILE } from "./playwright-tree.ts";

const web = fileURLToPath(new URL("..", import.meta.url));

const ADDRESS = "admin@journeys.example";

/** A spec whose journeys name their role and raise could-not-run as the real ones do. */
const specOf = (...lines: readonly string[]): string =>
  [
    'import { expect, test } from "@playwright/test";',
    `import { couldNotRun, failed, playsTheRole } from ${moduleAt("journeys/outcome.ts")};`,
    ...lines,
    "",
  ].join("\n");

const ADMIN_FAILS_ON_MEMBERS = [
  'test("the Admin acts on every page", async () => {',
  '  playsTheRole("Admin");',
  '  await test.step("Members", async () => {',
  '    await test.step("moves three members to Editor", async () => {',
  `      throw new Error("${ADDRESS} still reads Viewer");`,
  "    });",
  "  });",
  "});",
];

/** The address comes from the environment, as a journey's does, and shows on the page and in a diff. */
const ADMIN_FAILS_TO_ACT = [
  "const address = process.env.JOURNEYS_ADMIN_EMAIL;",
  "const status = '<main><p role=\"status\">Sign-in email sent to ' + address + '.</p></main>';",
  'test("the Admin signs in", async ({ page }) => {',
  '  playsTheRole("Admin");',
  "  await page.setContent(status);",
  '  await test.step("Sign in", async () => {',
  '    await page.getByLabel("Email address").fill(address, { timeout: 500 });',
  "  });",
  "});",
];

const ADMIN_FAILS_WITH_THE_ADDRESS_IN_VIEW = [
  ...ADMIN_FAILS_TO_ACT,
  'test("the Editor reads their sign-in status", async ({ page }) => {',
  '  playsTheRole("Editor");',
  "  await page.setContent(status);",
  '  await test.step("Sign in", async () => {',
  '    await expect(page.getByRole("status")).toHaveText("Signed in.", { timeout: 500 });',
  "  });",
  "});",
];

const WITH_THE_ADDRESS = { JOURNEYS_ADMIN_EMAIL: ADDRESS };

const NO_ROLE_JOURNEY = "No role journey ran to its end.";

/** The journeys' configured reporters, written so the tree resolves them and keeps its own word. */
const configuredReporters = async (): Promise<string> => {
  vi.stubEnv("PUBLIC_URL", "https://app.better-answers.example");
  vi.resetModules();
  const { reporter } = (await import("../playwright.journeys.config.ts")).default;
  const entries = (typeof reporter === "string" ? [[reporter]] : (reporter ?? [])).map(
    ([name, options]) => [
      name.startsWith("./") ? path.join(web, name) : name,
      name.endsWith("outcome-reporter.ts") ? { outcomeFile: OUTCOME_FILE } : options,
    ],
  );
  return JSON.stringify(entries);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the journeys' outcome reporter", () => {
  it("writes held when every journey passed", async () => {
    const run = await journeysOver({
      spec: specOf(
        'test("the preflight finds the release answering", () => {});',
        'test("the Viewer lands on their home", async () => {',
        '  playsTheRole("Viewer");',
        '  await test.step("Home", async () => {});',
        "});",
      ),
    });

    expect(run.outcome).toBe("held\n");
    expect(run.summary).toBe("\n### Journeys: held\n\nEvery journey passed.\n");
  }, 60_000);

  it("writes fail and names the role, page and step", async () => {
    const run = await journeysOver({
      spec: specOf(...ADMIN_FAILS_ON_MEMBERS, 'test("the Viewer lands on their home", () => {});'),
    });

    expect(run.outcome).toBe("fail\n");
    expect(run.summary).toContain(
      "| fail | Admin | Members | moves three members to Editor |  |\n",
    );
    expect(run.summary).not.toContain(ADDRESS);
  }, 60_000);

  it("writes could-not-run over a failure, naming both", async () => {
    const run = await journeysOver({
      spec: specOf(
        ...ADMIN_FAILS_ON_MEMBERS,
        'test("the Editor lands on their home", async () => {',
        '  playsTheRole("Editor");',
        '  await test.step("Sign in", async () => {',
        '    await test.step("Send the code", () => couldNotRun("a rate ceiling refused the Send"));',
        "  });",
        "});",
      ),
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      [
        "| Outcome | Role | Page | Step | Why |",
        "| --- | --- | --- | --- | --- |",
        "| fail | Admin | Members | moves three members to Editor |  |",
        "| could-not-run | Editor | Sign in | Send the code | a rate ceiling refused the Send |",
      ].join("\n"),
    );
  }, 60_000);

  it("prints a failure's authored reason, never its error", async () => {
    const run = await journeysOver({
      spec: specOf(
        'test("the Admin signs in", async () => {',
        '  playsTheRole("Admin");',
        '  await test.step("Sign in", async () => {',
        '    await test.step("Read the code", () => failed("the sign-in email carried no code"));',
        "  });",
        "});",
        ...ADMIN_FAILS_ON_MEMBERS,
      ),
    });

    expect(run.outcome).toBe("fail\n");
    expect(run.summary).toContain(
      [
        "| fail | Admin | Sign in | Read the code | the sign-in email carried no code |",
        "| fail | Admin | Members | moves three members to Editor |  |",
      ].join("\n"),
    );
    expect(run.summary).not.toContain(ADDRESS);
  }, 60_000);

  it("names a step that failed inside a fixture", async () => {
    const run = await journeysOver({
      spec: specOf(
        "const journey = test.extend<{ signedIn: void }>({",
        "  signedIn: [",
        "    async ({}, use) => {",
        '      playsTheRole("Viewer");',
        '      await test.step("Sign in", async () => {',
        '        await test.step("Enter the code", () => couldNotRun("the code was rotated by another send"));',
        "      });",
        "      await use();",
        "    },",
        "    { auto: true },",
        "  ],",
        "});",
        'journey("the Viewer lands on their home", () => {});',
      ),
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      "| could-not-run | Viewer | Sign in | Enter the code | the code was rotated by another send |\n",
    );
  }, 60_000);

  it("says outside any step for a failure outside every step", async () => {
    const run = await journeysOver({
      spec: specOf(
        'test("the Admin acts on every page", () => {',
        '  playsTheRole("Admin");',
        '  throw new Error("the journey broke between its steps");',
        "});",
      ),
    });

    expect(run.outcome).toBe("fail\n");
    expect(run.summary).toContain("| fail | Admin | outside any step | outside any step |  |\n");
  }, 60_000);

  it("writes fail for a timed-out journey, naming its step", async () => {
    const run = await journeysOver({
      spec: specOf(
        'test("the Admin acts on every page", async () => {',
        "  test.setTimeout(1_000);",
        '  playsTheRole("Admin");',
        '  await test.step("Audit log", async () => {',
        '    await test.step("loads more events", () => new Promise(() => {}));',
        "  });",
        "});",
      ),
    });

    expect(run.outcome).toBe("fail\n");
    expect(run.summary).toContain("| fail | Admin | Audit log | loads more events |  |\n");
  }, 60_000);

  it("writes could-not-run for a run stopped midway", async () => {
    const run = await journeysOver({
      spec: specOf(
        'test("the Admin acts on every page", async () => {',
        '  playsTheRole("Admin");',
        '  await test.step("Members", async () => {',
        '    process.kill(process.ppid, "SIGINT");',
        "    await new Promise((resolve) => setTimeout(resolve, 30_000));",
        "  });",
        "});",
      ),
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain("the run was stopped before the journey ended");
  }, 60_000);

  it("writes could-not-run when no journey ran", async () => {
    const run = await journeysOver({
      spec: specOf('test.skip("the Admin acts on every page", () => {});'),
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(NO_ROLE_JOURNEY);
  }, 60_000);

  it("writes could-not-run when only the preflight passed", async () => {
    const run = await journeysOver({
      spec: specOf('test("the preflight finds the release answering", () => {});'),
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(NO_ROLE_JOURNEY);
  }, 60_000);

  it("writes could-not-run for a tree holding no journey", async () => {
    const run = await journeysOver({});

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(NO_ROLE_JOURNEY);
  }, 60_000);

  it("writes could-not-run when a journey fails to load", async () => {
    const run = await journeysOver({
      spec: specOf('throw new Error("the journey will not load");'),
    });

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(NO_ROLE_JOURNEY);
  }, 60_000);

  it("keeps a failed action's address out of the summary", async () => {
    const run = await journeysOver({
      spec: specOf(...ADMIN_FAILS_WITH_THE_ADDRESS_IN_VIEW),
      env: WITH_THE_ADDRESS,
    });

    expect(run.outcome).toBe("fail\n");
    expect(run.summary).toContain("| fail | Admin | Sign in | Sign in |  |\n");
    expect(run.summary).not.toContain(ADDRESS);
  }, 60_000);
});

describe("what a failed journey leaves behind", () => {
  it("prints no address through the journeys' own reporters", async () => {
    const run = await journeysOver({
      spec: specOf(...ADMIN_FAILS_WITH_THE_ADDRESS_IN_VIEW),
      reporter: await configuredReporters(),
      env: { ...WITH_THE_ADDRESS, PLAYWRIGHT_NO_COPY_PROMPT: "1" },
    });

    expect(run.outcome).toBe("fail\n");
    expect(`${run.stdout}${run.stderr}`).not.toContain(ADDRESS);
    expect(run.summary).not.toContain(ADDRESS);
  }, 60_000);

  it("would print the address through Playwright's list reporter", async () => {
    const run = await journeysOver({
      spec: specOf(...ADMIN_FAILS_WITH_THE_ADDRESS_IN_VIEW),
      reporter: '[["list"]]',
      env: WITH_THE_ADDRESS,
    });

    expect(run.stdout).toContain(ADDRESS);
  }, 60_000);

  it("leaves no page snapshot holding an address, prompt off", async () => {
    const withPrompt = await journeysOver({
      spec: specOf(...ADMIN_FAILS_TO_ACT),
      env: WITH_THE_ADDRESS,
    });
    const withoutPrompt = await journeysOver({
      spec: specOf(...ADMIN_FAILS_TO_ACT),
      env: { ...WITH_THE_ADDRESS, PLAYWRIGHT_NO_COPY_PROMPT: "1" },
    });
    const holdingTheAddress = (left: ReadonlyMap<string, string>) =>
      [...left].filter(([, content]) => content.includes(ADDRESS)).map(([file]) => file);

    expect(holdingTheAddress(withPrompt.left)).not.toEqual([]);
    expect(holdingTheAddress(withoutPrompt.left)).toEqual([]);
  }, 60_000);
});
