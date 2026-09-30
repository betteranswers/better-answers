import type { Page } from "@playwright/test";

import { SIGN_IN_WORDS, type Arrival } from "@/features/auth/sign-in-words.ts";
import { CONTROL_CENTRE, groupIn, headingOf, screenNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  landedAtHome,
  provision,
  revokeCredentials,
  signIn,
  signInHeading,
  signOutFromTheShell,
} from "./harness.ts";

/** Says why the person is there in the region a status is read from. */
const signInSays = async (page: Page, arrival: Arrival): Promise<void> => {
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(SIGN_IN_WORDS.arrived[arrival]);
};

test("sign-out from the shell ends the session", async ({ page, request }) => {
  const email = anAddress("leaving");
  const workspace = await provision(request, { name: "Leaving", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");

  await signOutFromTheShell(page, workspace.admin.name);

  await signInSays(page, "signed-out");

  await page.goto("/people");
  await signInSays(page, "signed-out");
});

test("brings an ended session through sign-in back to its screen", async ({
  page,
  context,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("returning");
  await provision(request, { name: "Returning", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  // Not the Admin's home, which sign-in would reach without carrying the screen back.
  const elsewhere = screenNamed(groupIn(CONTROL_CENTRE, "system"), "Audit log");
  await page.getByRole("link", { name: elsewhere.name }).click();
  await expect(page).toHaveURL(new RegExp(`${elsewhere.path}$`));

  await context.clearCookies();
  await page.reload();

  await signInSays(page, "session-ended");
  await passesTheAccessibilityGate();
  await signIn(page, request, email);

  await expect(page).toHaveURL(new RegExp(`${elsewhere.path}$`));
  await expect(page.getByRole("heading", { level: 1, name: headingOf(elsewhere) })).toBeVisible();
});

test("refuses revoked credentials on the next request", async ({ page, request }) => {
  const email = anAddress("revoked");
  const workspace = await provision(request, { name: "Revoked", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();

  await revokeCredentials(request, workspace.admin.id);

  await page.getByRole("link", { name: "Groups" }).click();
  await page.reload();

  await signInSays(page, "session-ended");
});
