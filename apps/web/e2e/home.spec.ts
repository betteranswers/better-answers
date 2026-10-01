import type { APIRequestContext, Page } from "@playwright/test";

import { goHome, RAIL, unbuiltLineOf, UNKNOWN_SCREEN } from "@/app/words.ts";
import { aRole, ROLES } from "@/features/people/role-meanings.ts";
import { CONTROL_CENTRE, headingOf, HOMES, type Role } from "@/shared/navigation.ts";

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

test("offers a Viewer's home from an unknown screen, shell kept", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const home = HOMES.Viewer;
  await signedInAs(page, request, "Viewer");
  await landedAtHome(page, "Viewer");

  await page.goto("/system/not-a-screen");

  await expect(unknownScreen(page)).toBeVisible();
  await expect(page.getByRole("navigation", { name: RAIL })).toBeVisible();
  await expect(page.getByRole("link", { name: goHome(home) })).toBeVisible();
  await passesTheAccessibilityGate();
  await skipLinkReachesTheScreen(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: goHome(home) })).toBeFocused();
  await page.keyboard.press("Enter");
  await landedAtHome(page, "Viewer");
});

for (const role of ["Editor", "Viewer"] as const) {
  test(`shows ${aRole(role)} Ask alone, on its way (AE2)`, async ({ page, request }) => {
    const home = HOMES[role];
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await expect(page.getByRole("navigation", { name: RAIL })).toMatchAriaSnapshot(`
      - navigation ${quoted(RAIL)}:
        - list:
          - /children: equal
          - listitem:
            - link ${quoted(home.name)}
    `);
    await expect(page.getByRole("navigation", { name: CONTROL_CENTRE.name })).toHaveCount(0);
    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main "Screen":
        - heading ${quoted(headingOf(home))} [level=1]
        - paragraph: ${quoted(unbuiltLineOf(home))}
    `);
  });

  test(`shows ${aRole(role)} Members as if it never existed (AE9)`, async ({ page, request }) => {
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await page.goto("/people/not-a-screen");
    await expect(page.getByRole("link", { name: goHome(HOMES[role]) })).toBeVisible();
    const neverExisted = await page.getByRole("main").ariaSnapshot();

    await page.goto(HOMES.Admin.path);

    await expect(page.getByRole("link", { name: goHome(HOMES[role]) })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
    expect(await page.getByRole("main").ariaSnapshot(), "a hidden screen gives itself away").toBe(
      neverExisted,
    );
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: CONTROL_CENTRE.name })).toHaveCount(0);

    await personMenu(page, role).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Sign out"]);
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
