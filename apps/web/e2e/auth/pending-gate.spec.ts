import assert from "node:assert/strict";

import type { APIRequestContext, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  ageThePendingHour,
  anAddress,
  authenticatorCodeField,
  catchClaudesRedirect,
  claudesAuthorizeUrl,
  invite,
  landedAtHome,
  person,
  provision,
  saysSomethingNew,
  signIn,
  signInByEmail,
  signInHeading,
  signedInAtHome,
  withAnAuthenticator,
} from "../harness.ts";
import { aVirtualAuthenticator } from "../virtual-authenticator.ts";

const MEMBERS = HOMES.Admin.path;

const GROUPS = "/people/groups";

const confirmHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Confirm It’s You" });

const codeField = (page: Page) => page.getByRole("textbox", { name: "Authenticator Code" });

const landedAt = (page: Page): URL => new URL(page.url());

const anAdminWaiting = async (page: Page, api: APIRequestContext, workspaceName: string) => {
  const workspace = await provision(api, { name: workspaceName });
  const key = await withAnAuthenticator(api, workspace.admin.email);
  await page.goto("/sign-in");
  await signInByEmail(page, api, workspace.admin.email);
  await expect(confirmHeading(page)).toBeVisible();
  return { workspace, key };
};

const confirmedWith = async (page: Page, key: string): Promise<void> => {
  await codeField(page).fill(authenticatorCodeAt(key, new Date()));
};

test("a pending Admin opening Members confirms, then lands back there", async ({
  page,
  request,
}) => {
  const { key } = await anAdminWaiting(page, request, "Calder Joinery");

  await page.goto(MEMBERS);

  await expect(confirmHeading(page)).toBeVisible();
  expect(`${landedAt(page).pathname}${landedAt(page).search}`).toBe(
    `/confirm?redirect=${encodeURIComponent(MEMBERS)}`,
  );
  await expect(codeField(page)).toBeFocused();
  await confirmedWith(page, key);
  await landedAtHome(page, "Admin");
});

test("a pending connection to Claude resumes at the workspace picker", async ({
  page,
  request,
  baseURL,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const { workspace, key } = await anAdminWaiting(page, request, "Pennine Metalwork");
  const second = await provision(request, { name: "Wharfedale Castings" });
  await addMember(request, {
    workspaceId: second.workspaceId,
    userId: workspace.admin.id,
    role: "Admin",
  });
  await catchClaudesRedirect(page);

  await page.goto(claudesAuthorizeUrl(baseURL, { prompt: "consent" }));

  await expect(confirmHeading(page)).toBeVisible();
  expect(
    landedAt(page).searchParams.get("sig"),
    "the detour dropped the signed query",
  ).not.toBeNull();
  expect(landedAt(page).searchParams.get("code")).toBeNull();
  await confirmedWith(page, key);
  await expect(page.getByRole("heading", { level: 1, name: "Your Workspaces" })).toBeVisible();
  expect(landedAt(page).pathname).toBe("/choose-workspace");
  expect(landedAt(page).searchParams.get("sig")).not.toBeNull();
  await page.getByRole("button", { name: second.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
});

for (const [redirect, workspaceName] of [
  ["//evil.example", "Selby Roofing"],
  ["/\t/evil.example", "Selby Glazing"],
] as const) {
  test(`a return address ${JSON.stringify(redirect)} lands on home`, async ({ page, request }) => {
    const { key } = await anAdminWaiting(page, request, workspaceName);

    await page.goto(`/confirm?redirect=${encodeURIComponent(redirect)}`);
    await confirmedWith(page, key);

    await landedAtHome(page, "Admin");
    expect(landedAt(page).origin).not.toBe("https://evil.example");
  });
}

test("an hour unconfirmed ends the sign-in; signing in returns there", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspace } = await anAdminWaiting(page, request, "Keighley Glass");
  await page.goto(GROUPS);
  await expect(confirmHeading(page)).toBeVisible();

  await ageThePendingHour(request, workspace.admin.id);
  await page.reload();

  await expect(signInHeading(page)).toBeVisible();
  expect(`${landedAt(page).pathname}${landedAt(page).search}`).toBe(
    `/sign-in?redirect=${encodeURIComponent(GROUPS)}`,
  );
  await expect(page.getByRole("status"), "the page says nothing of the hour").toHaveText(/\S/);
  const timedOut = await page.getByRole("status").innerText();
  await passesTheAccessibilityGate();
  await signIn(page, request, workspace.admin.email);
  await expect(page).toHaveURL(new RegExp(`${GROUPS}$`));

  await page.context().clearCookies();
  await page.reload();
  await expect(signInHeading(page)).toBeVisible();
  await saysSomethingNew(page.getByRole("status"), timedOut);
});

test("a confirmed session opening confirm goes straight to its return", async ({
  page,
  request,
}) => {
  const { admin } = await provision(request, { name: "Holme Valley Bakery" });
  await signedInAtHome(page, request, admin.email);

  await page.goto(`/confirm?redirect=${encodeURIComponent(GROUPS)}`);

  await expect(page).toHaveURL(new RegExp(`${GROUPS}$`));
  await expect(confirmHeading(page)).toHaveCount(0);
});

const someoneHoldingBoth = async (page: Page, api: APIRequestContext) => {
  const device = await aVirtualAuthenticator(page);
  const email = anAddress("priya");
  const who = await person(api, email, { displayName: "Priya Shah" });
  const key = await withAnAuthenticator(api, email);
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
  const codeNow = authenticatorCodeAt(key, new Date());
  await page.goto("/confirm");
  await authenticatorCodeField(page).fill(codeNow);
  await expect(page).not.toHaveURL(/\/confirm(?:\?|$)/);
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  await page.getByRole("button", { name: "Add a Passkey" }).click();
  const passkey = await page.getByLabel("Passkey Name").inputValue();
  await page.getByRole("button", { name: "Add Passkey" }).click();
  await expect(page.getByRole("listitem", { name: passkey, exact: true })).toBeFocused();
  return { device, who, key, passkey };
};

test("a just-promoted Admin sees what can confirm, gone once confirmed", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { device, who, key, passkey } = await someoneHoldingBoth(page, request);
  const workspace = await provision(request, { name: "Calder Joinery" });
  const invited = await invite(request, {
    workspaceId: workspace.workspaceId,
    email: who.email,
    inviterId: workspace.admin.id,
    role: "Admin",
  });

  await page.goto(`/invitations/${invited.id}`);
  await page.getByRole("button", { name: "Join Workspace" }).click();

  await expect(confirmHeading(page)).toBeVisible();
  const whatConfirms = page.getByRole("main").getByRole("list");
  await expect(whatConfirms, "nothing names the list of what confirms").toHaveAccessibleName(/\S/);
  await expect(whatConfirms.getByRole("listitem")).toContainText([passkey, "Authenticator"]);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Confirm It’s You" [level=1]
      - paragraph
      - paragraph
      - list:
        - listitem
        - listitem
      - paragraph
      - button "Use Your Passkey"
      - textbox "Authenticator Code"
  `);
  await passesTheAccessibilityGate();
  await confirmedWith(page, key);
  await landedAtHome(page, "Admin");

  await page.context().clearCookies();
  await device.leftUnattended();
  await page.goto("/sign-in");
  await signInByEmail(page, request, who.email);
  await expect(codeField(page)).toBeVisible();
  await expect(whatConfirms).toHaveCount(0);
});
