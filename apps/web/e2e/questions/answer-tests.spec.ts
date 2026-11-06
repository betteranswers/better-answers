import type { APIRequestContext, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import { anAddress, provision, signedInAtHome, skipLinkReachesThePage } from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const ANSWER_TESTS = pageNamed(menuGroupIn(CONTROL_CENTRE, "questions"), "Answer Tests");

const emptyState = (page: Page) => page.getByText("No answer tests yet", { exact: true });

const anAdminSignedIn = async (page: Page, api: APIRequestContext, workspace: string) => {
  const email = anAddress("admin");
  await provision(api, { name: workspace, adminEmail: email });
  await signedInAtHome(page, api, email);
};

test.describe("the Answer Tests page", () => {
  test("loads under the Questions heading and works by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminSignedIn(page, request, "Arkengarthdale Hinges");

    await test.step("loads within the list time budget", async () => {
      const startedAtMs = Date.now();
      await page.goto(ANSWER_TESTS.path);
      await expect(emptyState(page)).toBeVisible();
      const elapsedMs = Date.now() - startedAtMs;

      test.info().annotations.push({ type: "answer tests page", description: `${elapsedMs} ms` });
      expect(
        elapsedMs,
        "the Answer Tests page took longer than its time budget to render",
      ).toBeLessThan(LIST_BUDGET_MS);
    });

    await skipLinkReachesThePage(page);

    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Answer Tests" [level=1]
    `);

    await passesTheAccessibilityGate();
  });
});
