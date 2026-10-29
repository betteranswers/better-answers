import type { APIRequestContext, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import { anAddress, provision, signedInAtHome, skipLinkReachesThePage } from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const ANSWER_TESTS = pageNamed(menuGroupIn(CONTROL_CENTRE, "questions"), "Answer Tests");

const answerTests = (page: Page) => page.getByRole("region", { name: "Answer Tests" });

const anAdminSignedIn = async (page: Page, api: APIRequestContext, workspace: string) => {
  const email = anAddress("admin");
  await provision(api, { name: workspace, adminEmail: email });
  await signedInAtHome(page, api, email);
};

test.describe("the Answer Tests page", () => {
  test("renders within the constitution's list budget", async ({ page, request }) => {
    await anAdminSignedIn(page, request, "Teesdale Brackets");

    const startedAtMs = Date.now();
    await page.goto(ANSWER_TESTS.path);
    await expect(answerTests(page)).toHaveText(/\S/);
    const elapsedMs = Date.now() - startedAtMs;

    test.info().annotations.push({ type: "answer tests page", description: `${elapsedMs} ms` });
    expect(elapsedMs, "the Answer Tests page rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  test("is keyboard-reachable and axe-clean under its group", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminSignedIn(page, request, "Arkengarthdale Hinges");
    await page.goto(ANSWER_TESTS.path);
    await expect(answerTests(page)).toHaveText(/\S/);

    await skipLinkReachesThePage(page);

    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Questions" [level=1]
        - paragraph
        - region "Answer Tests":
          - heading "Answer Tests" [level=2]
    `);

    await passesTheAccessibilityGate();
  });
});
