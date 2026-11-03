import type { APIRequestContext, Page } from "@playwright/test";

import { ROLES } from "@/features/people/role-meanings.ts";
import { ASK, HOMES, menuGroupIn, pageNamed, type Role } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  A_ROLE,
  addMember,
  anAddress,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  notFoundOfferingHome,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
} from "../harness.ts";

const CONNECT_CLAUDE = pageNamed(menuGroupIn(ASK, "ask"), "Connect Claude");

const HOME_NAMED = {
  Admin: "Members",
  Editor: "New Question",
  Viewer: "New Question",
} as const satisfies Readonly<Record<Role, string>>;

const signedInAs = async (page: Page, api: APIRequestContext, role: Role) => {
  const email = anAddress(role.toLowerCase());
  const member = await person(api, email, { displayName: `A ${role}` });
  const workspace = await provision(api, { name: `A workspace for ${A_ROLE[role]}` });
  await addMember(api, { role, userId: member.id, workspaceId: workspace.workspaceId });

  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const unknownPage = (page: Page) => page.getByRole("heading", { level: 1, name: "Page Not Found" });

const homeOfferedInTheShell = async (page: Page, role: Role, audited: () => Promise<void>) => {
  const home = `Go to ${HOME_NAMED[role]}`;
  await notFoundOfferingHome(page, role);
  await expect(page.getByRole("navigation", { name: "Areas" })).toBeVisible();
  await audited();
  await skipLinkReachesThePage(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: home })).toBeFocused();
  await page.keyboard.press("Enter");
  await landedAtHome(page, role);
};

for (const role of ROLES) {
  test(`offers ${A_ROLE[role]} their own home at an unknown address`, async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await page.goto("/not-a-page");

    await homeOfferedInTheShell(page, role, passesTheAccessibilityGate);
  });
}

const connectStepsOpened = async (page: Page) => {
  await page.getByRole("main").getByRole("link", { name: "connect Claude" }).click();
  await expect(page).toHaveURL(new RegExp(`${CONNECT_CLAUDE.path}$`));
};

test("lists the shell's keystrokes alone on Connect Claude, unknown pages", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");
  await connectStepsOpened(page);
  const theShells = ["Show This List", "Jump To"];
  const addsNoLine = "the list adds no line for a page with no keystrokes of its own";

  await page
    .getByRole("navigation", { name: "Areas" })
    .getByRole("button", { name: "Keyboard Shortcuts" })
    .click();
  const onConnect = page.getByRole("dialog", { name: "Keyboard Shortcuts on Connect Claude" });
  await expect(onConnect.getByRole("paragraph"), addsNoLine).toHaveCount(2);
  await expect(onConnect.getByRole("definition")).toHaveText(theShells);
  await passesTheAccessibilityGate();
  await keystrokesDismissed(page, onConnect);

  await page.goto(HOMES.Admin.path);
  await expect(unknownPage(page)).toBeVisible();
  const onUnknown = await keystrokesListed(page, "This Page");
  await expect(onUnknown.getByRole("paragraph"), addsNoLine).toHaveCount(2);
  await expect(onUnknown.getByRole("definition")).toHaveText(theShells);
  await keystrokesDismissed(page, onUnknown);
});
