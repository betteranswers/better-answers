import type { APIRequestContext, Page } from "@playwright/test";

import { goHome, unbuiltLineOf, UNKNOWN_SCREEN } from "@/app/words.ts";
import { aRole, ROLES } from "@/features/people/role-meanings.ts";
import { CONTROL_CENTRE, viewAt, type Role } from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  landedAtHome,
  person,
  provision,
  signIn,
  skipLinkReachesTheScreen,
} from "./harness.ts";

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

for (const role of ROLES) {
  const home = CONTROL_CENTRE.homes[role];

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
  const home = CONTROL_CENTRE.homes.Viewer;
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
  test(`tells ${aRole(role)} on Questions to ask in Claude meanwhile`, async ({
    page,
    request,
  }) => {
    const home = CONTROL_CENTRE.homes[role];
    const view = viewAt(CONTROL_CENTRE, home.defaultView);
    await signedInAs(page, request, role);
    await landedAtHome(page, role);

    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main "Screen":
        - heading ${JSON.stringify(home.name)} [level=1]
        - heading ${JSON.stringify(view?.name)} [level=2]
        - paragraph: ${JSON.stringify(unbuiltLineOf(home))}
    `);
  });
}
