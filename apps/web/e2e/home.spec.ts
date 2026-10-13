import type { APIRequestContext, Page } from "@playwright/test";

import { aRole, ROLES } from "@/features/people/role-meanings.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  askShowsTheServedAddress,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  notFoundOfferingHome,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "./harness.ts";

const READ_BUDGET_MS = 1000;

/** Each role's home, as the rail's link and the way home name it. */
const HOME_NAMED = { Admin: "Members", Editor: "Ask", Viewer: "Ask" } as const satisfies Readonly<
  Record<Role, string>
>;

/** Every role joins the same way, so the Admin here differs from the others by role alone. */
const signedInAs = async (page: Page, api: APIRequestContext, role: Role) => {
  const email = anAddress(role.toLowerCase());
  const member = await person(api, email, { displayName: `A ${role}` });
  const workspace = await provision(api, { name: `A workspace for ${aRole(role)}` });
  await addMember(api, { role, userId: member.id, workspaceId: workspace.workspaceId });

  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const unknownPage = (page: Page) => page.getByRole("heading", { level: 1, name: "Page Not Found" });

/** In the shell, past the skip link, the not-found's one link is the way home. */
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

const personMenu = (page: Page, role: Role) =>
  page.getByRole("banner").getByRole("button", { name: `A ${role}`, exact: true });

for (const role of ROLES) {
  test(`lands ${aRole(role)} on ${HOME_NAMED[role]} after sign-in`, async ({ page, request }) => {
    await signedInAs(page, request, role);

    await landedAtHome(page, role);
  });

  test(`offers ${aRole(role)} their own home at an unknown address`, async ({
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

test("offers a Viewer's home from an unknown page, shell kept", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");

  await page.goto("/system/not-a-page");

  await homeOfferedInTheShell(page, "Viewer", passesTheAccessibilityGate);
});

for (const role of ["Editor", "Viewer"] as const) {
  test(`shows ${aRole(role)} Ask on its way, and Knowledge`, async ({ page, request }) => {
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await expect(page.getByRole("navigation", { name: "Areas" })).toMatchAriaSnapshot(`
      - navigation "Areas":
        - list:
          - /children: equal
          - listitem:
            - link "Ask"
          - listitem:
            - link "Knowledge"
    `);
    await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);
    const address = await askShowsTheServedAddress(page);
    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Ask" [level=1]
        - paragraph
        - heading "Connect Claude as Your Assistant" [level=2]
        - list:
          - /children: equal
          - listitem:
            - paragraph
          - listitem:
            - paragraph
            - code: ${JSON.stringify(address)}
            - button "Copy Address"
            - status
          - listitem:
            - paragraph
        - paragraph
    `);
  });

  test(`copies the address on ${aRole(role)} Ask by keyboard`, async ({
    page,
    context,
    request,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signedInAs(page, request, role);
    await landedAtHome(page, role);
    const address = await askShowsTheServedAddress(page);

    const copy = page.getByRole("button", { name: "Copy Address" });
    await tabUntilFocused(page, copy);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("main").getByRole("list").getByRole("status")).toHaveText(/\S/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  });

  test(`shows ${aRole(role)} Members as if it never existed`, async ({ page, request }) => {
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await page.goto("/people/not-a-page");
    await expect(page.getByRole("link", { name: "Go to Ask" })).toBeVisible();
    const neverExisted = await page.getByRole("main").ariaSnapshot();

    await page.goto(HOMES.Admin.path);

    await expect(page.getByRole("link", { name: "Go to Ask" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
    expect(await page.getByRole("main").ariaSnapshot(), "a hidden page gives itself away").toBe(
      neverExisted,
    );
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);

    await personMenu(page, role).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Account", "Sign Out"]);
  });
}

test("draws a Viewer's Ask within a second of arriving", async ({ page, request }) => {
  const home = HOMES.Viewer;
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");

  const started = Date.now();
  await page.goto(home.path);
  await expect(
    page.getByRole("heading", { level: 2, name: "Connect Claude as Your Assistant" }),
  ).toBeVisible();
  const elapsedMs = Date.now() - started;

  test.info().annotations.push({ type: "Ask drawn", description: `${elapsedMs} ms` });
  expect(elapsedMs, "Ask was not drawn within its second").toBeLessThan(READ_BUDGET_MS);
});

test("lists the shell's keystrokes alone on Ask and unknown pages", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");
  const theShells = ["Show This List", "Jump To"];
  // The list always says where single keys work; a page with none of its own adds a line.
  const addsNoLine = "the list adds no line for a page with no keystrokes of its own";

  await page
    .getByRole("navigation", { name: "Areas" })
    .getByRole("button", { name: "Keyboard Shortcuts" })
    .click();
  const onAsk = page.getByRole("dialog", { name: "Keyboard Shortcuts on Ask" });
  await expect(onAsk.getByRole("paragraph"), addsNoLine).toHaveCount(2);
  await expect(onAsk.getByRole("definition")).toHaveText(theShells);
  await passesTheAccessibilityGate();
  await keystrokesDismissed(page, onAsk);

  // Hidden from a Viewer, so it is the page that never existed.
  await page.goto(HOMES.Admin.path);
  await expect(unknownPage(page)).toBeVisible();
  const onUnknown = await keystrokesListed(page, "This Page");
  await expect(onUnknown.getByRole("paragraph"), addsNoLine).toHaveCount(2);
  await expect(onUnknown.getByRole("definition")).toHaveText(theShells);
  await keystrokesDismissed(page, onUnknown);
});
