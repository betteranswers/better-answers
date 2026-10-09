import type { Locator, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import { anAddress, provision, signIn } from "./harness.ts";

const GROUPS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Groups").path;

const groupsRegion = (page: Page) => page.getByRole("region", { name: "Groups" });

/** Hidden regions left out, as a screen reader leaves them: only a region in the tree is found. */
const emptyStatusIn = (scope: Locator): Locator =>
  scope.getByRole("status").filter({ hasNotText: /\S/ });

/** Rendered, so it is tracked, yet no taller than a visually hidden pixel, so it leaves no gap. */
const standsWithoutRoom = async (status: Locator) => {
  await expect(status).not.toHaveCSS("display", "none");
  const box = await status.boundingBox();
  expect(box?.height, "the empty region takes room on the page").toBeLessThanOrEqual(1);
};

test.describe("an action's outcome region", () => {
  test("stands in the accessibility tree before its first outcome", async ({ page, request }) => {
    const adminEmail = anAddress("admin");
    await provision(request, { name: "Calder Joinery", adminEmail });
    await page.goto(GROUPS_PAGE);
    await signIn(page, request, adminEmail);
    await expect(page).toHaveURL(new RegExp(`${GROUPS_PAGE}$`));

    const inTheBand = emptyStatusIn(page.getByRole("banner"));
    await expect(inTheBand, "the band's outcome region is out of the tree").toHaveCount(1);
    await standsWithoutRoom(inTheBand);

    // The section's read outcome stands beside the list's action outcome, so the page holds two.
    const onThePage = emptyStatusIn(groupsRegion(page));
    await expect(onThePage, "the page's outcome regions are out of the tree").toHaveCount(2);
    for (const status of await onThePage.all()) {
      await standsWithoutRoom(status);
    }
    const standing = await onThePage.elementHandles();

    await groupsRegion(page)
      .getByRole("textbox", { name: "Name of a new group" })
      .fill("Site leads");
    await groupsRegion(page).getByRole("button", { name: "Create the group" }).click();

    await expect
      .poll(() => Promise.all(standing.map((status) => status.textContent())), {
        message: "the outcome came in a region that was not there while it was empty",
      })
      .toContain("Site leads is created.");
  });
});
