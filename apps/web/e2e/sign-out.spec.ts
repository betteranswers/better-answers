import { expect, test } from "./browser.ts";

import { anAddress, provision, revokeCredentials, signIn, signOutFromTheShell } from "./harness.ts";

test("sign-out from the shell ends the session", async ({ page, request }) => {
  const email = anAddress("leaving");
  const workspace = await provision(request, { name: "Leaving", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);

  await signOutFromTheShell(page, workspace.admin.name);

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

  await page.goto("/people");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("brings an ended session through sign-in back to its screen", async ({
  page,
  context,
  request,
}) => {
  const email = anAddress("returning");
  await provision(request, { name: "Returning", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people\/members$/);

  await context.clearCookies();
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await signIn(page, request, email);

  await expect(page).toHaveURL(/\/people\/members$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
});

test("refuses revoked credentials on the next request", async ({ page, request }) => {
  const email = anAddress("revoked");
  const workspace = await provision(request, { name: "Revoked", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();

  await revokeCredentials(request, workspace.admin.id);

  await page.getByRole("link", { name: "Knowledge" }).click();
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
