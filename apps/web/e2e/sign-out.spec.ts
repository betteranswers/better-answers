import type { Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, headingOf, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  landedAtHome,
  provision,
  endEverySignInAndToken,
  signIn,
  signInHeading,
  signOutFromTheShell,
} from "./harness.ts";

/** Says why the person is there in the region a status is read from, and answers what it said. */
const signInSaysWhy = async (page: Page): Promise<string> => {
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByRole("status"), "the sign-in page says nothing of the arrival").toHaveText(
    /\S/,
  );
  return page.getByRole("status").innerText();
};

test("sign-out from the shell ends the session", async ({ page, request }) => {
  const email = anAddress("leaving");
  const workspace = await provision(request, { name: "Leaving", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");

  await signOutFromTheShell(page, workspace.admin.name);

  const signedOut = await signInSaysWhy(page);

  await page.goto("/people");
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByRole("status"), "a sign-out read as something else").toHaveText(signedOut);
});

test("brings an ended session through sign-in back to its page", async ({
  page,
  context,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("returning");
  const workspace = await provision(request, { name: "Returning", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  // Not the Admin's home, which sign-in would reach without carrying the page back.
  const elsewhere = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), "Audit log");
  await page.getByRole("link", { name: elsewhere.name }).click();
  await expect(page).toHaveURL(new RegExp(`${elsewhere.path}$`));

  await context.clearCookies();
  await page.reload();

  const ended = await signInSaysWhy(page);
  await passesTheAccessibilityGate();
  await signIn(page, request, email);

  await expect(page).toHaveURL(new RegExp(`${elsewhere.path}$`));
  await expect(page.getByRole("heading", { level: 1, name: headingOf(elsewhere) })).toBeVisible();

  await signOutFromTheShell(page, workspace.admin.name);
  expect(await signInSaysWhy(page), "a sign-out read as an ended session").not.toBe(ended);
});

test("refuses revoked credentials on the next request", async ({ page, request }) => {
  const email = anAddress("revoked");
  const workspace = await provision(request, { name: "Revoked", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();

  await endEverySignInAndToken(request, workspace.admin.id);

  await page.getByRole("link", { name: "Groups" }).click();
  await page.reload();

  await signInSaysWhy(page);
});
