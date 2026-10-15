import type { APIRequestContext, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  A_ROLE,
  aMemberSignedInAt,
  anAddress,
  navOf,
  notFoundOfferingHome,
  provision,
  signedInAtHome,
  skipLinkReachesThePage,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const ANSWER_TESTS = pageNamed(menuGroupIn(CONTROL_CENTRE, "questions"), "Answer Tests");

const answerTests = (page: Page) => page.getByRole("region", { name: "Answer Tests" });

/** A new workspace's Admin, at home: no answer test can exist, since nothing records a correction. */
const anAdminSignedIn = async (page: Page, api: APIRequestContext, workspace: string) => {
  const email = anAddress("admin");
  await provision(api, { name: workspace, adminEmail: email });
  await signedInAtHome(page, api, email);
};

test.describe("the Answer Tests page", () => {
  test("shows an Admin no answer test and no figure", async ({ page, request }) => {
    await anAdminSignedIn(page, request, "Wensleydale Fixings");

    await navOf(page, "Control Centre").getByRole("link", { name: "Answer Tests" }).click();

    await expect(page).toHaveURL(new RegExp(`${ANSWER_TESTS.path}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Questions" })).toBeVisible();
    await expect(answerTests(page), "the empty state says nothing").toHaveText(/\S/);
    const main = page.getByRole("main");
    await expect(main, "the page shows a percentage").not.toContainText("%");
    await expect(answerTests(page), "the empty state shows a figure").not.toContainText(/\d/);
    await expect(answerTests(page).getByRole("table")).toHaveCount(0);
    await expect(answerTests(page).getByRole("list")).toHaveCount(0);
  });

  test("renders within the constitution's list budget", async ({ page, request }) => {
    await anAdminSignedIn(page, request, "Teesdale Brackets");

    // A fresh document, so nothing the page draws is already in its cache.
    const startedAtMs = Date.now();
    await page.goto(ANSWER_TESTS.path);
    await expect(answerTests(page)).toHaveText(/\S/);
    const elapsedMs = Date.now() - startedAtMs;

    test.info().annotations.push({ type: "answer tests page", description: `${elapsedMs} ms` });
    expect(elapsedMs, "the Answer Tests page rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`hides the page from ${A_ROLE[role]} as an unknown address`, async ({ page, request }) => {
      await aMemberSignedInAt(page, request, role, ANSWER_TESTS.path);

      await notFoundOfferingHome(page, role);
      await expect(answerTests(page), "a hidden page drew its region").toHaveCount(0);
    });
  }

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
