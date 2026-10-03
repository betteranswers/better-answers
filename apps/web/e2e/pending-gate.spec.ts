import type { APIRequestContext, Page } from "@playwright/test";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { ACCOUNT_HEADING, PASSKEY_WORDS } from "@/features/auth/account-words.ts";
import { INVITATION_WORDS } from "@/features/auth/invitation-words.ts";
import {
  CONFIRM_WORDS,
  passkeyThatConfirms,
  PROMOTION_WORDS,
} from "@/features/auth/second-factor-words.ts";
import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";
import { NO_WORKSPACE_HEADING, PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  ageThePendingHour,
  anAddress,
  catchClaudesRedirect,
  claudesAuthorizeUrl,
  invite,
  landedAtHome,
  person,
  provision,
  quoted,
  signIn,
  signInByEmail,
  signInHeading,
  signedInAtHome,
  withAnAuthenticator,
} from "./harness.ts";
import { aVirtualAuthenticator } from "./virtual-authenticator.ts";

const MEMBERS = HOMES.Admin.path;

const GROUPS = "/people/groups";

const confirmHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: CONFIRM_WORDS.heading });

const codeField = (page: Page) => page.getByRole("textbox", { name: CONFIRM_WORDS.codeField });

const landedAt = (page: Page): URL => new URL(page.url());

/** An Admin holding the harness's authenticator, signed in by email and waiting on confirm. */
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
  const { workspace, key } = await anAdminWaiting(page, request, "Pennine Metalwork");
  const second = await provision(request, { name: "Wharfedale Castings" });
  await addMember(request, {
    workspaceId: second.workspaceId,
    userId: workspace.admin.id,
    role: "Admin",
  });
  await catchClaudesRedirect(page);

  await page.goto(claudesAuthorizeUrl(baseURL ?? "", { prompt: "consent" }));

  await expect(confirmHeading(page)).toBeVisible();
  expect(
    landedAt(page).searchParams.get("sig"),
    "the detour dropped the signed query",
  ).not.toBeNull();
  expect(landedAt(page).searchParams.get("code")).toBeNull();
  await confirmedWith(page, key);
  await expect(page.getByRole("heading", { level: 1, name: PICKER_WORDS.heading })).toBeVisible();
  expect(landedAt(page).pathname).toBe("/choose-workspace");
  expect(landedAt(page).searchParams.get("sig")).not.toBeNull();
  await page.getByRole("button", { name: second.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
});

test("a return address on another origin lands on home", async ({ page, request }) => {
  const { key } = await anAdminWaiting(page, request, "Selby Roofing");

  await page.goto(`/confirm?redirect=${encodeURIComponent("//evil.example")}`);
  await confirmedWith(page, key);

  await landedAtHome(page, "Admin");
  expect(landedAt(page).origin).not.toBe("https://evil.example");
});

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
  await expect(page.getByRole("status").filter({ hasText: /\S/ })).toHaveText(
    SIGN_IN_WORDS.arrived["confirm-timed-out"],
  );
  await passesTheAccessibilityGate();
  await signIn(page, request, workspace.admin.email);
  await expect(page).toHaveURL(new RegExp(`${GROUPS}$`));
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

/** A person in no workspace holding a passkey from this device and the harness's authenticator. */
const someoneHoldingBoth = async (page: Page, api: APIRequestContext) => {
  const device = await aVirtualAuthenticator(page);
  const email = anAddress("priya");
  const who = await person(api, email, { displayName: "Priya Shah" });
  const key = await withAnAuthenticator(api, email);
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_HEADING })).toBeVisible();
  await page.getByRole("button", { name: PASSKEY_WORDS.add }).click();
  const passkey = await page.getByLabel(PASSKEY_WORDS.nameField).inputValue();
  await page.getByRole("button", { name: PASSKEY_WORDS.addCommit }).click();
  // Codes come only with a first factor, and the harness's authenticator came first.
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
  await page.getByRole("button", { name: INVITATION_WORDS.join(workspace.name) }).click();

  await expect(confirmHeading(page)).toBeVisible();
  const lead = page.getByRole("list", { name: PROMOTION_WORDS.lead });
  await expect(lead.getByRole("listitem")).toHaveText([
    passkeyThatConfirms(passkey, new Date().toISOString()),
    PROMOTION_WORDS.authenticator,
  ]);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(CONFIRM_WORDS.heading)} [level=1]
      - paragraph: ${quoted(CONFIRM_WORDS.whyAnAdmin)}
      - paragraph: ${quoted(PROMOTION_WORDS.lead)}
      - list ${quoted(PROMOTION_WORDS.lead)}:
        - listitem: ${quoted(passkeyThatConfirms(passkey, new Date().toISOString()))}
        - listitem: ${quoted(PROMOTION_WORDS.authenticator)}
      - paragraph: ${quoted(PROMOTION_WORDS.after)}
      - button ${quoted(CONFIRM_WORDS.passkey)}
      - textbox ${quoted(CONFIRM_WORDS.codeField)}
  `);
  await passesTheAccessibilityGate();
  await confirmedWith(page, key);
  await landedAtHome(page, "Admin");

  await page.context().clearCookies();
  await device.leftUnattended();
  await page.goto("/sign-in");
  await signInByEmail(page, request, who.email);
  await expect(codeField(page)).toBeVisible();
  await expect(lead).toHaveCount(0);
});
