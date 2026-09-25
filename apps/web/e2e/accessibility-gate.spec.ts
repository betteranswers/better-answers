import type { Page } from "@playwright/test";

import { expect, test } from "./browser.ts";

const drawAPictureWithNoAltText = (): void => {
  const picture = document.createElement("img");
  picture.src =
    "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  picture.width = 64;
  picture.height = 64;
  document.querySelector("main")?.append(picture);
};

const theSignInScreen = async (page: Page): Promise<void> => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
};

test("audits the screen a spec leaves, though it never asked", async ({ page }) => {
  test.fail();
  await theSignInScreen(page);
  await page.evaluate(drawAPictureWithNoAltText);
});

test("refuses a spec that leaves the product and audits nothing", async ({ page }) => {
  test.fail();
  await theSignInScreen(page);

  await page.goto("about:blank");
});

test("lets a spec leave the origin once it has audited", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await theSignInScreen(page);
  await passesTheAccessibilityGate();
  await page.goto("about:blank");
});

test("passes a clean screen the spec never asked about", async ({ page }) => {
  await theSignInScreen(page);
});
