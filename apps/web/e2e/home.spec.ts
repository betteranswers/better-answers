import type { APIRequestContext, Page } from "@playwright/test";

import { goHome, unbuiltLineOf, UNKNOWN_SCREEN } from "@/app/words.ts";
import { aRole, ROLES } from "@/features/people/role-meanings.ts";
import {
  CONTROL_CENTRE,
  controlCentreOpensAt,
  HOMES,
  READER_SURFACE,
  viewAt,
  type Role,
} from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  landedAtHome,
  person,
  provision,
  quoted,
  signIn,
  skipLinkReachesTheScreen,
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

const unknownScreen = (page: Page) =>
  page.getByRole("heading", { level: 1, name: UNKNOWN_SCREEN.heading });

const personMenu = (page: Page, role: Role) =>
  page.getByRole("banner").getByRole("button", { name: `A ${role}` });

/** Radix focuses the menu's first entry when a key opens it, and each surface's link comes first. */
const firstInThePersonMenu = async (page: Page, role: Role, name: string) => {
  await tabUntilFocused(page, personMenu(page, role));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await expect(personMenu(page, role)).toBeFocused();
};

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

    await page.goto("/not-a-screen");

    await expect(unknownScreen(page)).toBeVisible();
    await expect(page.getByRole("link", { name: goHome(home) })).toBeVisible();
    await passesTheAccessibilityGate();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: goHome(home) })).toBeFocused();
    await page.keyboard.press("Enter");
    await landedAtHome(page, role);
  });
}

test("offers a Viewer's home from an unknown view, shell kept", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const home = HOMES.Viewer;
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");

  await page.goto("/system/not-a-view");

  await expect(unknownScreen(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: CONTROL_CENTRE.name })).toBeVisible();
  await expect(page.getByRole("link", { name: goHome(home) })).toBeVisible();
  await passesTheAccessibilityGate();
  await skipLinkReachesTheScreen(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: goHome(home) })).toBeFocused();
  await page.keyboard.press("Enter");
  await landedAtHome(page, "Viewer");
});

for (const role of ["Editor", "Viewer"] as const) {
  test(`tells ${aRole(role)} on Ask to ask in Claude meanwhile`, async ({ page, request }) => {
    const home = HOMES[role];
    const view = viewAt(READER_SURFACE, home.defaultView);
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await expect(page.getByRole("navigation", { name: READER_SURFACE.name })).toMatchAriaSnapshot(`
      - navigation ${quoted(READER_SURFACE.name)}:
        - list:
          - /children: equal
          - listitem:
            - link ${quoted(home.name)}
    `);
    await expect(page.getByRole("navigation", { name: CONTROL_CENTRE.name })).toHaveCount(0);
    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main "Screen":
        - heading ${quoted(home.name)} [level=1]
        - heading ${quoted(view?.name ?? "")} [level=2]
        - paragraph: ${quoted(unbuiltLineOf(home))}
    `);
  });

  test(`takes ${aRole(role)} from Ask to Control Centre and back`, async ({ page, request }) => {
    const home = HOMES[role];
    const opening = controlCentreOpensAt(role);
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await firstInThePersonMenu(page, role, CONTROL_CENTRE.name);
    await expect(page).toHaveURL(new RegExp(`${opening.defaultView}$`));
    await expect(page.getByRole("navigation", { name: CONTROL_CENTRE.name })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: opening.name })).toBeVisible();

    await firstInThePersonMenu(page, role, home.name);
    await landedAtHome(page, role);
    await expect(page.getByRole("navigation", { name: READER_SURFACE.name })).toBeVisible();
  });
}

test("draws a Viewer's Ask within a second of a fresh visit", async ({ page, request }) => {
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
