import type { APIRequestContext, Page } from "@playwright/test";

import {
  CONNECT_ASSISTANT,
  goHome,
  JUMP_TO,
  RAIL,
  unbuiltLineOf,
  UNKNOWN_PAGE,
} from "@/app/words.ts";
import { ACCOUNT_HEADING } from "@/features/auth/account-words.ts";
import { aRole, ROLES } from "@/features/people/role-meanings.ts";
import { KEYSTROKE_WORDS, keystrokesOn } from "@/shared/keystroke-words.ts";
import { CONTROL_CENTRE, headingOf, HOMES, KNOWLEDGE, type Role } from "@/shared/navigation.ts";

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
  quoted,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "./harness.ts";

const READ_BUDGET_MS = 1000;

/** Every role joins the same way, so the Admin here differs from the others by role alone. */
const signedInAs = async (page: Page, api: APIRequestContext, role: Role) => {
  const email = anAddress(role.toLowerCase());
  const member = await person(api, email, { displayName: `A ${role}` });
  const workspace = await provision(api, { name: `A workspace for ${aRole(role)}` });
  await addMember(api, { role, userId: member.id, workspaceId: workspace.workspaceId });

  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const unknownPage = (page: Page) =>
  page.getByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading });

/** In the shell, past the skip link, the not-found's one link is the way home. */
const homeOfferedInTheShell = async (page: Page, role: Role, audited: () => Promise<void>) => {
  const home = goHome(HOMES[role]);
  await notFoundOfferingHome(page, role);
  await expect(page.getByRole("navigation", { name: RAIL })).toBeVisible();
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
  const home = HOMES[role];

  test(`lands ${aRole(role)} on ${home.name} after sign-in`, async ({ page, request }) => {
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
    const home = HOMES[role];
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await expect(page.getByRole("navigation", { name: RAIL })).toMatchAriaSnapshot(`
      - navigation ${quoted(RAIL)}:
        - list:
          - /children: equal
          - listitem:
            - link ${quoted(home.name)}
          - listitem:
            - link ${quoted(KNOWLEDGE.name)}
    `);
    await expect(page.getByRole("navigation", { name: CONTROL_CENTRE.name })).toHaveCount(0);
    const address = await askShowsTheServedAddress(page);
    const [first, second, third] = CONNECT_ASSISTANT.steps;
    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${quoted(headingOf(home))} [level=1]
        - paragraph: ${quoted(unbuiltLineOf(home))}
        - heading ${quoted(CONNECT_ASSISTANT.heading)} [level=2]
        - list:
          - listitem:
            - paragraph: ${quoted(first)}
          - listitem:
            - paragraph: ${quoted(second)}
            - code: ${quoted(address)}
            - button ${quoted(CONNECT_ASSISTANT.copy)}
            - status
          - listitem:
            - paragraph: ${quoted(third)}
        - paragraph: ${quoted(CONNECT_ASSISTANT.asYou)}
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

    const copy = page.getByRole("button", { name: CONNECT_ASSISTANT.copy });
    await tabUntilFocused(page, copy);
    await page.keyboard.press("Enter");

    await expect(page.getByRole("main").getByRole("list").getByRole("status")).toHaveText(
      CONNECT_ASSISTANT.copied,
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
  });

  test(`shows ${aRole(role)} Members as if it never existed`, async ({ page, request }) => {
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await page.goto("/people/not-a-page");
    await expect(page.getByRole("link", { name: goHome(HOMES[role]) })).toBeVisible();
    const neverExisted = await page.getByRole("main").ariaSnapshot();

    await page.goto(HOMES.Admin.path);

    await expect(page.getByRole("link", { name: goHome(HOMES[role]) })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
    expect(await page.getByRole("main").ariaSnapshot(), "a hidden page gives itself away").toBe(
      neverExisted,
    );
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: CONTROL_CENTRE.name })).toHaveCount(0);

    await personMenu(page, role).click();
    await expect(page.getByRole("menuitem")).toHaveText([ACCOUNT_HEADING, "Sign out"]);
  });
}

test("draws a Viewer's Ask within a second of arriving", async ({ page, request }) => {
  const home = HOMES.Viewer;
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");

  const started = Date.now();
  await page.goto(home.path);
  await expect(page.getByText(unbuiltLineOf(home))).toBeVisible();
  const elapsedMs = Date.now() - started;

  test.info().annotations.push({ type: "Ask drawn", description: `${elapsedMs} ms` });
  expect(elapsedMs, "Ask was not drawn within its second").toBeLessThan(READ_BUDGET_MS);
});

test("lists the shell's keystrokes alone on Ask and unknown pages", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const home = HOMES.Viewer;
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");
  const theShells = [KEYSTROKE_WORDS.showTheList, JUMP_TO.name];

  await page
    .getByRole("navigation", { name: RAIL })
    .getByRole("button", { name: KEYSTROKE_WORDS.button })
    .click();
  const onAsk = page.getByRole("dialog", { name: keystrokesOn(home.name) });
  await expect(onAsk).toContainText(KEYSTROKE_WORDS.noneOfItsOwn);
  await expect(onAsk.getByRole("definition")).toHaveText(theShells);
  await passesTheAccessibilityGate();
  await keystrokesDismissed(page, onAsk);

  // Hidden from a Viewer, so it is the page that never existed.
  await page.goto(HOMES.Admin.path);
  await expect(unknownPage(page)).toBeVisible();
  const onUnknown = await keystrokesListed(page, KEYSTROKE_WORDS.thisPage);
  await expect(onUnknown).toContainText(KEYSTROKE_WORDS.noneOfItsOwn);
  await expect(onUnknown.getByRole("definition")).toHaveText(theShells);
  await keystrokesDismissed(page, onUnknown);
});
