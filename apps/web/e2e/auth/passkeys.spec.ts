import type { APIRequestContext, Page } from "@playwright/test";

import { passkeyNameFor } from "@/features/auth/account-words.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  emailsSentTo,
  landedAtHome,
  person,
  provision,
  railOf,
  saysSomethingNew,
  signedInAtHome,
  signedInWithNoWorkspace,
  signIn,
  signInHeading,
  signOutFromTheShell,
} from "../harness.ts";
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

const saysNoPasskeyWasUsed = async (page: Page, saidBefore: string): Promise<void> => {
  await saysSomethingNew(page.getByRole("status"), saidBefore);
  await expect(page.getByRole("button", { name: "Sign In with a Passkey" })).toHaveAttribute(
    "aria-disabled",
    "false",
  );
  await saysSomethingNew(page.getByRole("status"), saidBefore);
  await expect(
    page.getByRole("alert", { includeHidden: true }),
    "an unused passkey read as a refusal",
  ).toBeEmpty();
};

test("a cancelled passkey prompt leaves the email step unchanged", async ({ page }) => {
  await aVirtualAuthenticator(page);
  await page.goto("/sign-in");
  const address = anAddress("cancelled");
  await page.getByLabel("Email Address").fill(address);

  await page.getByRole("button", { name: "Sign In with a Passkey" }).click();

  await saysNoPasskeyWasUsed(page, "");
  await expect(page.getByLabel("Email Address")).toHaveValue(address);
  await expect(page.getByRole("button", { name: "Sign In with a Passkey" })).toBeFocused();
});

const offerOf = (page: Page) => page.getByRole("button", { name: "Dismiss Passkey Offer" });

const thePage = (page: Page) => page.getByRole("main", { name: "Page" });

const secondFactorRead = (page: Page) =>
  page.waitForResponse((answer) => answer.url().includes("person.secondFactor"));

const aViewerOffered = async (page: Page, api: APIRequestContext) => {
  await aVirtualAuthenticator(page);
  const email = anAddress("offered");
  const viewer = await person(api, email, { displayName: "Vera Offered" });
  const workspace = await provision(api, { name: "Offered Once Ltd" });
  await addMember(api, { role: "Viewer", userId: viewer.id, workspaceId: workspace.workspaceId });
  await signedInAtHome(page, api, email, "Viewer");
  await expect(offerOf(page)).toBeVisible();
  return { email, name: viewer.name };
};

const signedInAgain = async (
  page: Page,
  api: APIRequestContext,
  viewer: { readonly email: string; readonly name: string },
): Promise<void> => {
  await signOutFromTheShell(page, viewer.name);
  await expect(signInHeading(page)).toBeVisible();
  const read = secondFactorRead(page);
  await signIn(page, api, viewer.email);
  await landedAtHome(page, "Viewer");
  await read;
};

const movedOnWithoutTheOffer = async (page: Page): Promise<void> => {
  await railOf(page).getByRole("link", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Browse" })).toBeVisible();
  await expect(offerOf(page), "the offer followed the Viewer to the next page").toHaveCount(0);
};

test("a Viewer is offered a passkey once per sign-in", async ({ page, request }) => {
  const viewer = await aViewerOffered(page, request);

  await movedOnWithoutTheOffer(page);

  const read = secondFactorRead(page);
  await page.reload();
  await read;
  await expect(thePage(page)).toBeVisible();
  await expect(offerOf(page), "the offer came back on a reload").toHaveCount(0);

  await signedInAgain(page, request, viewer);
  await expect(offerOf(page), "the next sign-in was not offered a passkey").toBeVisible();
});
