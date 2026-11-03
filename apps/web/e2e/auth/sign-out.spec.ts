import type { Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  landedAtHome,
  provision,
  signIn,
  signInHeading,
  signOutFromTheShell,
} from "../harness.ts";

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
  const elsewhere = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), "Audit Log");
  await page.getByRole("link", { name: "Audit Log" }).click();
  await expect(page).toHaveURL(new RegExp(`${elsewhere.path}$`));

  await context.clearCookies();
  await page.reload();

  const ended = await signInSaysWhy(page);
  await passesTheAccessibilityGate();
  await signIn(page, request, email);

  await expect(page).toHaveURL(new RegExp(`${elsewhere.path}$`));
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  await signOutFromTheShell(page, workspace.admin.name);
  expect(await signInSaysWhy(page), "a sign-out read as an ended session").not.toBe(ended);
});
