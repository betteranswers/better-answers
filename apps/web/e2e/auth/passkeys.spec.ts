import type { Page } from "@playwright/test";

import { passkeyNameFor } from "@/features/auth/account-words.ts";

import { expect, test } from "../browser.ts";
import { emailsSentTo, signedInWithNoWorkspace } from "../harness.ts";
import { aVirtualAuthenticator } from "../virtual-authenticator.ts";

const accountHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Account" });

const rowOf = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

const theNoWorkspacePage = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No Workspace Yet" });

const outcomeOf = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });

const A_TIME_OF_USE = /\b\d{1,2}:\d{2}\b/;

const suggestedName = (page: Page): Promise<string> =>
  page.evaluate(() => navigator.userAgent).then(passkeyNameFor);

const passkeyAdded = async (page: Page): Promise<string> => {
  const name = await suggestedName(page);
  await page.getByRole("button", { name: "Add a Passkey" }).click();
  await expect(page.getByLabel("Passkey Name")).toHaveValue(name);
  await page.getByRole("button", { name: "Add Passkey" }).click();
  return name;
};

const accountOpened = async (page: Page): Promise<void> => {
  await page.goto("/account");
  await expect(accountHeading(page)).toBeVisible();
};

const signedOut = async (page: Page): Promise<void> => {
  await page.context().clearCookies();
  await page.goto("/sign-in");
};

test("a person adds a passkey, then signs in without email", async ({ page, request }) => {
  await aVirtualAuthenticator(page);
  const signedIn = await signedInWithNoWorkspace(page, request, "passkey");
  await accountOpened(page);

  const name = await passkeyAdded(page);

  await expect(outcomeOf(page), "the page says nothing of the add").toBeVisible();
  await expect(rowOf(page, name)).toBeFocused();
  await expect(rowOf(page, name), "an unused passkey shows a time of use").not.toContainText(
    A_TIME_OF_USE,
  );
  const emailsBefore = await emailsSentTo(request, signedIn.email);

  await signedOut(page);

  await expect(theNoWorkspacePage(page)).toBeVisible();
  expect(await emailsSentTo(request, signedIn.email), "the passkey sign-in sent an email").toBe(
    emailsBefore,
  );
});
