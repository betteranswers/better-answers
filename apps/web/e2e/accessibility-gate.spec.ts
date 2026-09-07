import type { Page } from "@playwright/test";

import { expect, test } from "./browser.ts";

/**
 * The suite's own accessibility gate, proved by running it (T-081, `[CHECK1]`).
 *
 * `[A11Y1]` is only a rule the run keeps if every spec is held to it, and a gate each spec
 * has to remember is a gate the next spec forgets — which is what happened: on 05/09/2026
 * two browser specs in six called axe and four did not, while the skill described the suite
 * as auditing every screen. The gate is now a fixture in `browser.ts` that runs whether the
 * spec asks or not, and these four tests are what makes that claim checkable rather than
 * believed.
 *
 * **Why two of them expect their own failure.** A gate is proved by where it fires as much
 * as by where it stays quiet, and a fixture that fires does so by failing the test it is
 * attached to — so the only way to assert the firing from inside the suite is `test.fail()`,
 * which Playwright checks in both directions: it fails the run when the test passes as well
 * as when it does not. A gate that stopped running turns both green-by-failure tests into
 * "expected to fail, but passed" and the suite goes red. Their bodies are two lines against
 * the sign-in screen, and `test.fail()` would swallow a failure to render it as readily as
 * the gate's; the fourth test below renders the same screen without `test.fail()`, so a
 * broken sign-in fails there in the open rather than passing here in disguise.
 */

/**
 * A picture with nothing said about it: the plainest WCAG 2.2 A failure there is
 * (`image-alt`, under `wcag2a`), drawn on the screen rather than built into the app. The
 * source is inline so nothing is fetched, and the size is set so the element is on the page
 * a reader would meet rather than collapsed to nothing.
 */
const drawAPictureWithNoAltText = (): void => {
  const picture = document.createElement("img");
  picture.src =
    "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
  picture.width = 64;
  picture.height = 64;
  document.querySelector("main")?.append(picture);
};

/** The one screen these tests use: reached with no session, so nothing has to be provisioned. */
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
  // Somewhere this product never served, which is what the consent flow's client redirect
  // is: the gate has no screen of ours to read, so it asks the spec what it audited instead.
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

// The quiet half of the pair. On its own it would pass for a gate that never ran; what makes
// it evidence is the first test above, which fails unless the same gate runs unasked.
test("a screen with nothing wrong with it is left alone by the gate it never mentioned", async ({
  page,
}) => {
  await theSignInScreen(page);
});
