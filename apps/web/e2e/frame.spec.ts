import { expect, test } from "./browser.ts";

import { anAddress, provision, signIn } from "./harness.ts";

test("a browser reaches the frame the api serves on app.", async ({ page, request }) => {
  const email = anAddress("frame");
  await provision(request, { name: "Frame", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);

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

  await expect(page.getByRole("region", { name: "You" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "Sources" })).toBeFocused();

  await navigation.getByRole("link", { name: "Knowledge" }).click();
  await expect(page).toHaveURL(/\/knowledge\/review-table$/);
  await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Review table" })).toBeVisible();
  await expect(page.getByText("This view is not built yet.")).toBeVisible();
  await expect(page.getByText("the workspace's map")).toBeVisible();

  // `goto` is the bookmark: a fresh document at a path no file sits at, not a click.
  await page.goto("/people/erasure-and-suppression");
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Erasure and suppression" }),
  ).toBeVisible();
  await expect(page.getByText("This view is not built yet.")).toBeVisible();

  const painted = await page.locator("main").evaluate((main) => {
    const frame = main.parentElement;
    if (frame === null) throw new Error("the screen has no frame around it");
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--surface-page)";
    document.body.append(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { frame: getComputedStyle(frame).backgroundColor, token };
  });
  expect(painted.token).not.toBe("rgba(0, 0, 0, 0)");
  expect(painted.frame).toBe(painted.token);
});
