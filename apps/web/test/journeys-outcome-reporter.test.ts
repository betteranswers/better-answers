// @vitest-environment node

import { describe, expect, it } from "vitest";

import { journeysOver, moduleAt } from "./playwright-tree.ts";

const ADDRESS = "admin@journeys.example";

/** A spec whose journeys name their role and raise could-not-run as the real ones do. */
const specOf = (...lines: readonly string[]): string =>
  [
    'import { test } from "@playwright/test";',
    `import { couldNotRun, playsTheRole } from ${moduleAt("journeys/outcome.ts")};`,
    ...lines,
    "",
  ].join("\n");

const ADMIN_FAILS_ON_MEMBERS = [
  'test("the Admin acts on every screen", async () => {',
  '  playsTheRole("Admin");',
  '  await test.step("Members", async () => {',
  '    await test.step("moves three members to Editor", async () => {',
  `      throw new Error("${ADDRESS} still reads Viewer");`,
  "    });",
  "  });",
  "});",
];

describe("the journeys' outcome reporter", () => {
  it("writes held when every journey passed", () => {
    const run = journeysOver(
      specOf(
        'test("the preflight finds the release answering", () => {});',
        'test("the Viewer lands on their home", async () => {',
        '  playsTheRole("Viewer");',
        '  await test.step("Home", async () => {});',
        "});",
      ),
    );

    expect(run.outcome).toBe("held\n");
    expect(run.summary).toBe("\n### Journeys: held\n\nEvery journey passed.\n");
  }, 60_000);

  it("writes fail and names the role, screen and step", () => {
    const run = journeysOver(
      specOf(...ADMIN_FAILS_ON_MEMBERS, 'test("the Viewer lands on their home", () => {});'),
    );

    expect(run.outcome).toBe("fail\n");
    expect(run.summary).toContain(
      "| fail | Admin | Members | moves three members to Editor |  |\n",
    );
    expect(run.summary).not.toContain(ADDRESS);
  }, 60_000);

  it("writes could-not-run over a failure, naming both", () => {
    const run = journeysOver(
      specOf(
        ...ADMIN_FAILS_ON_MEMBERS,
        'test("the Editor lands on their home", async () => {',
        '  playsTheRole("Editor");',
        '  await test.step("Sign in", async () => {',
        '    await test.step("Send the code", () => couldNotRun("the sign-in ceiling refused the Send"));',
        "  });",
        "});",
      ),
    );

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      [
        "| Outcome | Role | Screen | Step | Why it could not run |",
        "| --- | --- | --- | --- | --- |",
        "| fail | Admin | Members | moves three members to Editor |  |",
        "| could-not-run | Editor | Sign in | Send the code | the sign-in ceiling refused the Send |",
      ].join("\n"),
    );
  }, 60_000);

  it("names a step that failed inside a fixture", () => {
    const run = journeysOver(
      specOf(
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
    );

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain(
      "| could-not-run | Viewer | Sign in | Enter the code | the code was rotated by another send |\n",
    );
  }, 60_000);

  it("writes could-not-run when no journey ran", () => {
    const run = journeysOver(specOf('test.skip("the Admin acts on every screen", () => {});'));

    expect(run.outcome).toBe("could-not-run\n");
    expect(run.summary).toContain("No journey ran to its end.");
  }, 60_000);
});
