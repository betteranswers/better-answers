import type { Page } from "@playwright/test";

import {
  ACCOUNT_HEADING,
  ACT_LANDED,
  PASSKEY_WORDS,
  passkeyNameFor,
  RECOVERY_CODE_WORDS,
  removePasskeyTitle,
} from "@/features/auth/account-words.ts";
import {
  PASSKEY_HELD,
  PASSKEY_UNKNOWN,
  SAID_OF_SECOND_FACTOR,
} from "@/features/auth/refusal-words.ts";
import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";
import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace-words.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  aMemberSignedInAt,
  anAddress,
  emailsSentTo,
  provision,
  signedInAtHome,
  signedInWithNoWorkspace,
  tabUntilFocused,
} from "./harness.ts";
import { aVirtualAuthenticator, withoutWebAuthn } from "./virtual-authenticator.ts";

const accountHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: ACCOUNT_HEADING });

const rowOf = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

const theNoWorkspaceScreen = (page: Page) =>
  page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING });

/** The name the page suggests, read from the browser it runs in. */
const suggestedName = (page: Page): Promise<string> =>
  page.evaluate(() => navigator.userAgent).then(passkeyNameFor);

/** From the Account page: open the add, keep the suggested name, and add it. */
const passkeyAdded = async (page: Page): Promise<string> => {
  const name = await suggestedName(page);
  await page.getByRole("button", { name: PASSKEY_WORDS.add }).click();
  await expect(page.getByLabel(PASSKEY_WORDS.nameField)).toHaveValue(name);
  await page.getByRole("button", { name: PASSKEY_WORDS.addCommit }).click();
  return name;
};

const accountOpened = async (page: Page): Promise<void> => {
  await page.goto("/account");
  await expect(accountHeading(page)).toBeVisible();
};

/** Sign out by dropping the session's cookie, so the next sign-in starts with nothing held. */
const signedOut = async (page: Page): Promise<void> => {
  await page.context().clearCookies();
  await page.goto("/sign-in");
};

/** A person in no workspace whose device holds the one passkey they added on the Account page. */
const withAPasskey = async (
  page: Page,
  api: Parameters<typeof signedInWithNoWorkspace>[1],
  who: string,
) => {
  const device = await aVirtualAuthenticator(page);
  const person = await signedInWithNoWorkspace(page, api, who);
  await accountOpened(page);
  const name = await passkeyAdded(page);
  await expect(rowOf(page, name)).toBeFocused();
  return { device, person, name };
};

/** Rename opened on the passkey's row, its field holding `typed`. */
const renameTyped = async (page: Page, name: string, typed: string): Promise<void> => {
  await rowOf(page, name).getByRole("button", { name: PASSKEY_WORDS.rename }).click();
  await page.getByRole("textbox", { name: PASSKEY_WORDS.nameField }).fill(typed);
};

test("a person adds a passkey, then signs in without email", async ({ page, request }) => {
  await aVirtualAuthenticator(page);
  const person = await signedInWithNoWorkspace(page, request, "passkey");
  await accountOpened(page);

  const name = await passkeyAdded(page);

  await expect(page.getByText(ACT_LANDED.passkeyAdded(name, person.email))).toBeVisible();
  await expect(rowOf(page, name)).toBeFocused();
  await expect(rowOf(page, name)).toContainText(PASSKEY_WORDS.notUsed);
  const emailsBefore = await emailsSentTo(request, person.email);

  await signedOut(page);

  await expect(theNoWorkspaceScreen(page)).toBeVisible();
  expect(await emailsSentTo(request, person.email), "the passkey sign-in sent an email").toBe(
    emailsBefore,
  );
});

test("a renamed passkey shows its name, and its last use", async ({ page, request }) => {
  const { name } = await withAPasskey(page, request, "rename");

  await renameTyped(page, name, "   ");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    sentenceOf(SAID_OF_SECOND_FACTOR["passkey-name-empty"]),
  );
  await page.getByRole("textbox", { name: PASSKEY_WORDS.nameField }).fill("Work laptop");
  await page.keyboard.press("Enter");

  await expect(rowOf(page, "Work laptop")).toBeVisible();
  await expect(
    rowOf(page, "Work laptop").getByRole("button", { name: PASSKEY_WORDS.rename }),
  ).toBeFocused();
  await signedOut(page);
  await expect(theNoWorkspaceScreen(page)).toBeVisible();
  await accountOpened(page);
  await expect(rowOf(page, "Work laptop")).toContainText("Last used");
});

test("Escape puts a passkey's name back", async ({ page, request }) => {
  const { name } = await withAPasskey(page, request, "escape");

  await renameTyped(page, name, "Not this");
  await page.keyboard.press("Escape");

  await expect(rowOf(page, name).getByRole("button", { name: PASSKEY_WORDS.rename })).toBeFocused();
});

test("a passkey removed stops signing in", async ({ page, request }) => {
  const { device, person, name } = await withAPasskey(page, request, "removed");

  await rowOf(page, name).getByRole("button", { name: PASSKEY_WORDS.remove }).click();
  const dialog = page.getByRole("dialog", { name: removePasskeyTitle(name) });
  await dialog.getByRole("button", { name: PASSKEY_WORDS.removeCommit }).click();

  await expect(page.getByText(ACT_LANDED.passkeyRemoved(name, person.email))).toBeVisible();
  await expect(rowOf(page, name)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: PASSKEY_WORDS.heading })).toBeFocused();
  expect(await device.held(), "the device should still hold the removed passkey").toBe(1);

  await signedOut(page);

  await expect(page.getByRole("alert")).toContainText(sentenceOf(PASSKEY_UNKNOWN));
  await expect(page.getByLabel(SIGN_IN_WORDS.emailField)).toBeVisible();
});

test("a second passkey from the same device is refused", async ({ page, request }) => {
  await withAPasskey(page, request, "twice");

  await passkeyAdded(page);

  await expect(page.getByRole("alert")).toContainText(sentenceOf(PASSKEY_HELD));
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: PASSKEY_WORDS.addCommit })).toBeFocused();
});

test("an Admin keeps their only passkey, told why beside Remove", async ({ page, request }) => {
  await aVirtualAuthenticator(page);
  const { admin } = await provision(request, { name: "Passkeys Ltd" });
  await signedInAtHome(page, request, admin.email);
  await accountOpened(page);

  const name = await passkeyAdded(page);

  await expect(page.getByRole("heading", { name: RECOVERY_CODE_WORDS.saveHeading })).toBeFocused();
  await page.getByRole("checkbox", { name: RECOVERY_CODE_WORDS.saved }).check();
  await page.getByRole("button", { name: RECOVERY_CODE_WORDS.done }).click();
  const remove = rowOf(page, name).getByRole("button", { name: PASSKEY_WORDS.remove });
  await expect(remove).toHaveAttribute("aria-disabled", "true");
  await expect(remove).toHaveAccessibleDescription(
    sentenceOf(SAID_OF_SECOND_FACTOR["last-second-factor"]),
  );
});

test("a device whose user check fails signs nothing in", async ({ page, request }) => {
  const { device } = await withAPasskey(page, request, "unverified");
  await device.stopsVerifying();

  await signedOut(page);
  await page.getByRole("button", { name: SIGN_IN_WORDS.passkey }).click();

  await expect(page.getByText(SIGN_IN_WORDS.passkeyNotUsed)).toBeVisible();
  await expect(page.getByLabel(SIGN_IN_WORDS.emailField)).toBeVisible();
});

test("a cancelled passkey prompt leaves the email step unchanged", async ({ page }) => {
  await aVirtualAuthenticator(page);
  await page.goto("/sign-in");
  const address = anAddress("cancelled");
  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(address);

  await page.getByRole("button", { name: SIGN_IN_WORDS.passkey }).click();

  await expect(page.getByText(SIGN_IN_WORDS.passkeyNotUsed)).toBeVisible();
  await expect(page.getByLabel(SIGN_IN_WORDS.emailField)).toHaveValue(address);
  await expect(page.getByRole("button", { name: SIGN_IN_WORDS.passkey })).toBeFocused();
});

test("the email step reads email, send, then the passkey", async ({ page }) => {
  await aVirtualAuthenticator(page);
  await page.goto("/sign-in");
  const email = page.getByLabel(SIGN_IN_WORDS.emailField);
  await expect(email).toHaveAttribute("autocomplete", "username webauthn");

  await tabUntilFocused(page, email);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: SIGN_IN_WORDS.send })).toBeFocused();
  await page.keyboard.press("Tab");

  await expect(page.getByRole("button", { name: SIGN_IN_WORDS.passkey })).toBeFocused();
});

test("the offer shows on a shell screen until dismissed", async ({ page, request }) => {
  await aVirtualAuthenticator(page);
  await aMemberSignedInAt(page, request, "Viewer", "/ask");
  const offer = page.getByText(PASSKEY_WORDS.offer);
  await expect(offer).toBeVisible();
  const dismissed = page.waitForResponse((answer) => answer.url().includes("dismissPasskeyOffer"));

  await page.getByRole("button", { name: PASSKEY_WORDS.dismissOffer }).click();

  await expect(offer).toHaveCount(0);
  await expect(page.getByRole("main", { name: "Screen" })).toBeFocused();
  expect((await dismissed).ok(), "the dismissal was not kept").toBe(true);
  await page.reload();
  await expect(page.getByRole("main", { name: "Screen" })).toBeVisible();
  await expect(offer).toHaveCount(0);
});

test("the offer's link lands on the Account page's add", async ({ page, request }) => {
  await aVirtualAuthenticator(page);
  await aMemberSignedInAt(page, request, "Editor", "/ask");

  await page.getByRole("link", { name: PASSKEY_WORDS.add }).click();

  await expect(accountHeading(page)).toBeVisible();
  await expect(page.getByRole("button", { name: PASSKEY_WORDS.add })).toBeFocused();
  await expect(page.getByText(PASSKEY_WORDS.offer)).toHaveCount(0);
});

test("a browser without WebAuthn keeps the email path alone", async ({ page, request }) => {
  await withoutWebAuthn(page);
  await aMemberSignedInAt(page, request, "Viewer", "/ask");
  await expect(page.getByText(PASSKEY_WORDS.offer)).toHaveCount(0);

  await signedOut(page);
  await expect(page.getByLabel(SIGN_IN_WORDS.emailField)).toBeVisible();
  await expect(page.getByRole("button", { name: SIGN_IN_WORDS.passkey })).toHaveCount(0);
  await signedInWithNoWorkspace(page, request, "no-webauthn");
  await accountOpened(page);

  await expect(page.getByText(PASSKEY_WORDS.noWebAuthn)).toBeVisible();
});
