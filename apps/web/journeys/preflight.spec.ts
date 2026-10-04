import { signInHeading } from "../e2e/locators.ts";
import { expect, test, theSettingsAndInboxHold } from "./fixtures.ts";
import { refusedByTheEdge } from "./sign-in.ts";

test("the release answers before anyone signs in", async ({ page, request }) => {
  await test.step("The health check", async () => {
    const health = await request.get("/health");
    refusedByTheEdge(health, "the health check");
    expect(health.ok(), `the health check answered ${health.status()}`).toBe(true);
  });

  // Last on a page of the product's own, which the accessibility gate audits.
  await test.step("The sign-in page", async () => {
    const opened = await page.goto("/sign-in");
    if (opened !== null) refusedByTheEdge(opened, "the sign-in page");
    await expect(signInHeading(page)).toBeVisible();
  });

  await test.step("The journeys' settings", () => theSettingsAndInboxHold(request));
});
