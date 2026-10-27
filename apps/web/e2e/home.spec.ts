import type { APIRequestContext, Page } from "@playwright/test";

import { ROLES } from "@/features/people/role-meanings.ts";
import { ASK, HOMES, menuGroupIn, pageNamed, type Role } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  A_ROLE,
  addMember,
  anAddress,
  askShowsTheServedAddress,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  navOf,
  notFoundOfferingHome,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "./harness.ts";

const READ_BUDGET_MS = 1000;

const CONNECT_CLAUDE = pageNamed(menuGroupIn(ASK, "ask"), "Connect Claude");

const HOME_NAMED = {
  Admin: "Members",
  Editor: "New Question",
  Viewer: "New Question",
} as const satisfies Readonly<Record<Role, string>>;

const CONTROL_CENTRE_MENUS = {
  Admin: 1,
  Editor: 0,
  Viewer: 0,
} as const satisfies Readonly<Record<Role, number>>;

const signedInAs = async (page: Page, api: APIRequestContext, role: Role) => {
  const email = anAddress(role.toLowerCase());
  const member = await person(api, email, { displayName: `A ${role}` });
  const workspace = await provision(api, { name: `A workspace for ${A_ROLE[role]}` });
  await addMember(api, { role, userId: member.id, workspaceId: workspace.workspaceId });

  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const controlCentreMenu = (page: Page) => navOf(page, "Control Centre");

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

const personMenu = (page: Page, role: Role) =>
  page.getByRole("banner").getByRole("button", { name: `A ${role}`, exact: true });

for (const role of ROLES) {
  test(`lands ${A_ROLE[role]} on ${HOME_NAMED[role]} after sign-in`, async ({ page, request }) => {
    await signedInAs(page, request, role);

    await landedAtHome(page, role);
    await expect(controlCentreMenu(page)).toHaveCount(CONTROL_CENTRE_MENUS[role]);
  });

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

const connectStepsOpened = async (page: Page) => {
  await page.getByRole("main").getByRole("link", { name: "connect Claude" }).click();
  await expect(page).toHaveURL(new RegExp(`${CONNECT_CLAUDE.path}$`));
};

for (const role of ["Editor", "Viewer"] as const) {
  test(`shows ${A_ROLE[role]} Ask and Knowledge, asking on New question`, async ({
    page,
    request,
  }) => {
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
    await expect(controlCentreMenu(page)).toHaveCount(0);
    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Ask" [level=1]
        - paragraph:
          - link "connect Claude"
        - region "New Question":
          - heading "New Question" [level=2]
          - textbox "Question"
          - button "Ask"
          - status
    `);
  });

  test(`shows ${A_ROLE[role]} the steps to connect Claude`, async ({ page, request }) => {
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await connectStepsOpened(page);

    const address = await askShowsTheServedAddress(page);
    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Ask" [level=1]
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
          - listitem:
            - paragraph
        - paragraph
    `);
  });

  test(`copies the address on ${A_ROLE[role]} connect steps by keyboard`, async ({
    page,
    context,
    request,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signedInAs(page, request, role);
    await landedAtHome(page, role);
    await connectStepsOpened(page);
    const address = await askShowsTheServedAddress(page);

    const copy = page.getByRole("button", { name: "Copy Address" });
    await tabUntilFocused(page, copy);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("main").getByRole("list").getByRole("status")).toHaveText(/\S/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  });

  test(`shows ${A_ROLE[role]} Members as if it never existed`, async ({ page, request }) => {
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await page.goto("/people/not-a-page");
    await expect(page.getByRole("link", { name: "Go to New Question" })).toBeVisible();
    const neverExisted = await page.getByRole("main").ariaSnapshot();

    await page.goto(HOMES.Admin.path);

    await expect(page.getByRole("link", { name: "Go to New Question" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
    expect(await page.getByRole("main").ariaSnapshot(), "a hidden page gives itself away").toBe(
      neverExisted,
    );
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(controlCentreMenu(page)).toHaveCount(0);

    await personMenu(page, role).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Account", "Sign Out"]);
  });
}

test("draws a Viewer's home within a second of arriving", async ({ page, request }) => {
  const home = HOMES.Viewer;
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");

  const started = Date.now();
  await page.goto(home.path);
  await expect(
    page.getByRole("region", { name: "New Question" }).getByRole("textbox", { name: "Question" }),
  ).toBeVisible();
  const elapsedMs = Date.now() - started;

  test.info().annotations.push({ type: "New question drawn", description: `${elapsedMs} ms` });
  expect(elapsedMs, "New question was not drawn within its second").toBeLessThan(READ_BUDGET_MS);
});

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
