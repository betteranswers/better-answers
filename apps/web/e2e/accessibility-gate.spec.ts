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

test("a spec that never asks for the gate is audited anyway, on the screen it leaves behind", async ({
  page,
}) => {
  test.fail();
  await theSignInScreen(page);
  await page.evaluate(drawAPictureWithNoAltText);
});

test("a spec that leaves the browser off the product's screens and audits none of them is refused", async ({
  page,
}) => {
  test.fail();
  await theSignInScreen(page);

  await page.goto("about:blank");
});

test("a spec that audits the screen it exercises may then leave the product's origin", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await theSignInScreen(page);
  await passesTheAccessibilityGate();
  await page.goto("about:blank");
});

test("a screen with nothing wrong with it is left alone by the gate it never mentioned", async ({
  page,
}) => {
  await theSignInScreen(page);
});
