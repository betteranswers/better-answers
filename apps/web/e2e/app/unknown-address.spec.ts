import type { Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import { railOf, signedInWithNoWorkspace, signInHeading } from "../harness.ts";

const NOWHERE = "/nothing-here";

const NOT_FOUND = "Page Not Found";

const notFound = (page: Page) => page.getByRole("heading", { level: 1, name: NOT_FOUND });

test("offers a signed-out visitor the logo and sign-in", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await page.goto(NOWHERE);

  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole("banner")).toHaveText("better-answers", { useInnerText: true });
  await expect(page.getByRole("main").getByRole("link")).toHaveText(["Sign In"]);
  await expect(page).toHaveURL(NOWHERE);
  await passesTheAccessibilityGate();

  await page.getByRole("link", { name: "Sign In" }).click();
  await expect(signInHeading(page)).toBeVisible();
});

test("draws an unknown address outside the shell without a workspace", async ({
  page,
  request,
}) => {
  await signedInWithNoWorkspace(page, request, "nowhere");
  await page.goto(NOWHERE);

  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole("banner")).toHaveText("better-answers", { useInnerText: true });
  await expect(railOf(page)).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link")).toHaveText(["Go to Your Home Page"]);
});
