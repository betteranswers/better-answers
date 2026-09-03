import { expect, test } from "./browser.ts";

import { anAddress, provision, revokeCredentials, signIn } from "./harness.ts";

/**
 * What ends a session, and what an ended session does to the person reading (user stories
 * 6, 7 and 8). Every one of these is a fact about the shell, so every one is read from the
 * shell.
 */

test("sign-out from the shell ends the session", async ({ page, request }) => {
  const email = anAddress("leaving");
  await provision(request, { name: "Leaving", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page).toHaveURL(/\/system$/);

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  // And it is the session that ended, not the tab: the shell's own address refuses.
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
  await expect(page).toHaveURL(/\/people$/);

  // The session ends underneath them, as it does when it expires.
  await context.clearCookies();
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await signIn(page, request, email);

  // Back where they were, not at the front door: an expired session costs one step.
  await expect(page).toHaveURL(/\/people$/);
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

  // The act the People screen will one day perform: the instant is written, the sessions
  // made before it end, and the tokens minted before it are revoked (ADR 0018).
  await revokeCredentials(request, workspace.admin.id);

  await page.getByRole("link", { name: "Knowledge" }).click();
  await page.reload();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
