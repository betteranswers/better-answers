import { expect, test } from "./browser.ts";

import { anAddress, provision, revokeCredentials, signIn } from "./harness.ts";

test("sign-out from the shell ends the session", async ({ page, request }) => {
  const email = anAddress("leaving");
  await provision(request, { name: "Leaving", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

  await page.goto("/people");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("an ended session sends the person to sign-in and returns them where they were", async ({
  page,
  context,
  request,
}) => {
  const email = anAddress("returning");
  await provision(request, { name: "Returning", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people\/roles$/);

  await context.clearCookies();
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await signIn(page, request, email);

  await expect(page).toHaveURL(/\/people\/roles$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
});

test("credentials revoked through the harness are refused on the next request", async ({
  page,
  request,
}) => {
  const email = anAddress("revoked");
  const workspace = await provision(request, { name: "Revoked", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page.getByRole("region", { name: "You" }).getByText(workspace.name)).toBeVisible();

  await revokeCredentials(request, workspace.admin.id);

  await page.getByRole("link", { name: "Knowledge" }).click();
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
