import type { APIRequestContext, Page } from "@playwright/test";

import { ASK, HOMES, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const CONNECT_CLAUDE = pageNamed(menuGroupIn(ASK, "ask"), "Connect Claude");

const aViewerSignedIn = async (page: Page, api: APIRequestContext) => {
  const email = anAddress("viewer");
  const member = await person(api, email, { displayName: "A Viewer" });
  const workspace = await provision(api, { name: "A workspace for a Viewer" });
  await addMember(api, { role: "Viewer", userId: member.id, workspaceId: workspace.workspaceId });

  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const unknownPage = (page: Page) => page.getByRole("heading", { level: 1, name: "Page Not Found" });

const copyAddress = (page: Page) => page.getByRole("button", { name: "Copy Address" });

test("shows only app-wide shortcuts on Connect Claude and unknown pages", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await aViewerSignedIn(page, request);
  await landedAtHome(page, "Viewer");
  await page
    .getByRole("navigation", { name: "Ask" })
    .getByRole("link", { name: "Connect Claude" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${CONNECT_CLAUDE.path}$`));
  const appWideShortcuts = ["Show This List", "Jump To"];
  const extraLineMessage = "Keyboard Shortcuts added a line for a page with no shortcuts";

  await test.step("renders Connect Claude within one second", async () => {
    const started = Date.now();
    await page.goto(CONNECT_CLAUDE.path);
    await expect(copyAddress(page)).toBeVisible();
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "connect claude", description: `${elapsed} ms` });
    expect(elapsed, "Connect Claude took longer than one second to render").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  await test.step("reaches Copy Address by keyboard alone", async () => {
    await skipLinkReachesThePage(page);
    await page.keyboard.press("Tab");
    await expect(copyAddress(page)).toBeFocused();
  });

  await test.step("shows only app-wide shortcuts on Connect Claude", async () => {
    await page
      .getByRole("navigation", { name: "Areas" })
      .getByRole("button", { name: "Keyboard Shortcuts" })
      .click();
    const onConnect = page.getByRole("dialog", { name: "Keyboard Shortcuts on Connect Claude" });
    await expect(onConnect.getByRole("paragraph"), extraLineMessage).toHaveCount(2);
    await expect(onConnect.getByRole("definition")).toHaveText(appWideShortcuts);
    await passesTheAccessibilityGate();
    await keystrokesDismissed(page, onConnect);
  });

  await test.step("shows only app-wide shortcuts on an unknown page", async () => {
    await page.goto(HOMES.Admin.path);
    await expect(unknownPage(page)).toBeVisible();
    const onUnknown = await keystrokesListed(page, "This Page");
    await expect(onUnknown.getByRole("paragraph"), extraLineMessage).toHaveCount(2);
    await expect(onUnknown.getByRole("definition")).toHaveText(appWideShortcuts);
    await keystrokesDismissed(page, onUnknown);
  });
});
