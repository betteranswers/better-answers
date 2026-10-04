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

/** A refused act's button, held at its disabled look until the fade's last moment. */
const fadeAButtonBackFromItsDisabledLook = (): void => {
  const button = document.createElement("button");
  button.textContent = "Make Test person a Viewer";
  button.style.cssText =
    "background: var(--primary); color: var(--primary-foreground); padding: 8px 16px; opacity: 0.5; transition: opacity 4s step-end";
  document.querySelector("main")?.append(button);
  // Styled once at its disabled look, so the change below is a transition rather than a start.
  button.getBoundingClientRect();
  button.style.opacity = "1";
};

const setASpinnerTurning = (): void => {
  const spinner = document.createElement("span");
  spinner.style.cssText =
    "display: inline-block; width: 16px; height: 16px; border: 2px solid currentColor; animation: ba-spin 1s linear infinite";
  document.querySelector("main")?.append(spinner);
};

const theSignInPage = async (page: Page): Promise<void> => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
};

test("audits the page a spec leaves, though it never asked", async ({ page }) => {
  test.fail();
  await theSignInPage(page);
  await page.evaluate(drawAPictureWithNoAltText);
});

test("refuses a spec that leaves the product and audits nothing", async ({ page }) => {
  test.fail();
  await theSignInPage(page);

  await page.goto("about:blank");
});

test("lets a spec leave the origin once it has audited", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await theSignInPage(page);
  await passesTheAccessibilityGate();
  await page.goto("about:blank");
});

test("passes a clean page the spec never asked about", async ({ page }) => {
  await theSignInPage(page);
});

test("audits a button once its fade from disabled has ended", async ({
  page,
  passesTheAccessibilityGate,
}) => {
  await theSignInPage(page);
  await page.evaluate(fadeAButtonBackFromItsDisabledLook);
  await passesTheAccessibilityGate();
});

test("audits beside a spinner that never stops turning", async ({ page }) => {
  await theSignInPage(page);
  await page.evaluate(setASpinnerTurning);
});
