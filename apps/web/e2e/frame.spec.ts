import { expect, test } from "@playwright/test";

/**
 * The acceptance seam for T-035: the api serves the built SPA on `app.`, and a real browser
 * reaches Control Centre's frame.
 *
 * No session is made here. Signing in is a later ticket, and the frame renders without one
 * — which is the other thing this test holds: nothing on the screen claims to know who is
 * looking at it.
 */
test("a browser reaches the frame the api serves on app.", async ({ page }) => {
  // A screen's own address, not the root: this is the history fallback, so a bookmark and a
  // refresh both have to reach the shell rather than a 404.
  await page.goto("/system");

  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Control Centre" });
  await expect(navigation.getByRole("link")).toHaveText([
    "Sources",
    "Suggestions",
    "Knowledge",
    "Questions",
    "People",
    "System",
  ]);

  // Keyboard order is DOM order and the first stop is the skip link (`[A11Y1]`). Asserted
  // before anything is clicked, because a click is what moves focus off the document.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "Sources" })).toBeFocused();

  // The five unbuilt screens say so, in the glossary's words.
  await navigation.getByRole("link", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  await expect(page.getByText("This screen is not built yet.")).toBeVisible();
  await expect(page.getByText("the workspace's map")).toBeVisible();

  // The frame is styled by the design system's tokens, so the page is on the token surface
  // rather than the browser's default white.
  const background = await page
    .locator("body")
    .evaluate((body) => getComputedStyle(body).getPropertyValue("--surface-page").trim());
  expect(background).not.toBe("");
});
