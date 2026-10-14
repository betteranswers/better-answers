import type { APIRequestContext, Page } from "@playwright/test";

import { passkeyNameFor } from "@/features/auth/account-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  allWorkspacesPicked,
  aMemberSignedInAt,
  anAddress,
  emailsSentTo,
  landedAtHome,
  person,
  provision,
  railOf,
  saysARefusal,
  saysSomethingNew,
  signedInAtHome,
  signedInWithNoWorkspace,
  signIn,
  signInByEmail,
  signInHeading,
  signOutFromTheShell,
  switcherMenuOf,
  switcherOf,
  tabUntilFocused,
} from "./harness.ts";
import { authAnswering } from "./refused-read.ts";
import { aVirtualAuthenticator, withoutWebAuthn } from "./virtual-authenticator.ts";

const accountHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Account" });

const rowOf = (page: Page, name: string) => page.getByRole("listitem", { name, exact: true });

const theNoWorkspacePage = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No Workspace Yet" });

/** The status an action's outcome is said in: the one holding words. */
const outcomeOf = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });

/** A passkey's last use is shown to the minute, and the day it was added as a day alone. */
const A_TIME_OF_USE = /\b\d{1,2}:\d{2}\b/;

/** The name the page suggests, read from the browser it runs in. */
const suggestedName = (page: Page): Promise<string> =>
  page.evaluate(() => navigator.userAgent).then(passkeyNameFor);

/** From the Account page: open the add, keep the suggested name, and add it. */
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
  await rowOf(page, name).getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Passkey Name" }).fill(typed);
};

test("a person adds a passkey, then signs in without email", async ({ page, request }) => {
  await aVirtualAuthenticator(page);
  const person = await signedInWithNoWorkspace(page, request, "passkey");
  await accountOpened(page);

  const name = await passkeyAdded(page);

  await expect(outcomeOf(page), "the page says nothing of the add").toBeVisible();
  await expect(rowOf(page, name)).toBeFocused();
  await expect(rowOf(page, name), "an unused passkey shows a time of use").not.toContainText(
    A_TIME_OF_USE,
  );
  const emailsBefore = await emailsSentTo(request, person.email);

  await signedOut(page);

  await expect(theNoWorkspacePage(page)).toBeVisible();
  expect(await emailsSentTo(request, person.email), "the passkey sign-in sent an email").toBe(
    emailsBefore,
  );
});

test("a renamed passkey shows its name, and its last use", async ({ page, request }) => {
  const { name } = await withAPasskey(page, request, "rename");

  await renameTyped(page, name, "   ");
  await page.keyboard.press("Enter");
  await saysARefusal(page.getByRole("alert"));
  await page.getByRole("textbox", { name: "Passkey Name" }).fill("Work laptop");
  await page.keyboard.press("Enter");

  await expect(rowOf(page, "Work laptop")).toBeVisible();
  await expect(rowOf(page, "Work laptop").getByRole("button", { name: "Rename" })).toBeFocused();
  await signedOut(page);
  await expect(theNoWorkspacePage(page)).toBeVisible();
  await accountOpened(page);
  await expect(rowOf(page, "Work laptop")).toContainText(A_TIME_OF_USE);
});

test("Escape puts a passkey's name back", async ({ page, request }) => {
  const { name } = await withAPasskey(page, request, "escape");

  await renameTyped(page, name, "Not this");
  await page.keyboard.press("Escape");

  await expect(rowOf(page, name).getByRole("button", { name: "Rename" })).toBeFocused();
});

test("a passkey's rename field and Save share one height", async ({ page, request }) => {
  const { name } = await withAPasskey(page, request, "height");
  const row = rowOf(page, name);
  const renameField = row.getByRole("textbox", { name: "Passkey Name" });
  await row.getByRole("button", { name: "Rename" }).click();
  await expect(renameField).toBeVisible();

  const [field, button] = await Promise.all([
    renameField.boundingBox(),
    row.getByRole("button", { name: "Save", exact: true }).boundingBox(),
  ]);

  expect(field, "the rename field has no box to measure").not.toBeNull();
  expect(field?.height, "the rename field and Save differ in height").toBe(button?.height);
});

test("a passkey removed stops signing in", async ({ page, request }) => {
  const { device, name } = await withAPasskey(page, request, "removed");
  const saidOfTheAdd = await outcomeOf(page).innerText();

  await rowOf(page, name).getByRole("button", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Remove Passkey “${name}”` });
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();

  await expect
    .poll(() => outcomeOf(page).innerText(), "the page says nothing new of the removal")
    .not.toBe(saidOfTheAdd);
  await expect(rowOf(page, name)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Passkeys" })).toBeFocused();
  expect(await device.held(), "the device should still hold the removed passkey").toBe(1);

  const refused = authAnswering(page, "/passkeys/sign-in");
  await signedOut(page);

  expect(await refused).toMatchObject({ status: 401, word: "passkey-unknown" });
  await saysARefusal(page.getByRole("alert"));
  await expect(page.getByLabel("Email Address")).toBeVisible();
});

test("a second passkey from the same device is refused", async ({ page, request }) => {
  await withAPasskey(page, request, "twice");

  await passkeyAdded(page);

  await saysARefusal(page.getByRole("alert"));
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add Passkey" })).toBeFocused();
});

test("an Admin keeps their only passkey, told why beside Remove", async ({ page, request }) => {
  await aVirtualAuthenticator(page);
  const { admin } = await provision(request, { name: "Passkeys Ltd" });
  // An Admin holding no factor sets their first one up before anything else.
  await page.goto("/sign-in");
  await signInByEmail(page, request, admin.email);
  const name = await suggestedName(page);
  await expect(page.getByLabel("Passkey Name")).toHaveValue(name);
  await page.getByRole("button", { name: "Add a Passkey" }).click();

  await expect(page.getByRole("heading", { name: "Save Your Recovery Codes" })).toBeFocused();
  await page.getByRole("checkbox", { name: "I have saved these codes" }).check();
  await page.getByRole("button", { name: "Finish Setup" }).click();
  await landedAtHome(page, "Admin");
  await accountOpened(page);
  const remove = rowOf(page, name).getByRole("button", { name: "Remove", exact: true });
  await expect(remove).toHaveAttribute("aria-disabled", "true");
  await expect(remove).toHaveAccessibleDescription(/\S/);
});

/**
 * A prompt that used no passkey is no refusal. Waiting says something too, so the status is read
 * again once the button is free.
 */
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

test("a device whose user check fails signs nothing in", async ({ page, request }) => {
  const { device } = await withAPasskey(page, request, "unverified");
  await device.stopsVerifying();

  await signedOut(page);
  // The page already says the session ended, so an unused passkey shows by what is said next.
  await expect(page.getByRole("status")).toHaveText(/\S/);
  const saidOnArriving = await page.getByRole("status").innerText();
  await page.getByRole("button", { name: "Sign In with a Passkey" }).click();

  await saysNoPasskeyWasUsed(page, saidOnArriving);
  await expect(page.getByLabel("Email Address")).toBeVisible();
});

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

test("the email step reads email, send, then the passkey", async ({ page }) => {
  await aVirtualAuthenticator(page);
  await page.goto("/sign-in");
  const email = page.getByLabel("Email Address");
  await expect(email).toHaveAttribute("autocomplete", "username webauthn");

  await tabUntilFocused(page, email);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send Code" })).toBeFocused();
  await page.keyboard.press("Tab");

  await expect(page.getByRole("button", { name: "Sign In with a Passkey" })).toBeFocused();
});

/** The offer, found by the one control it alone draws. */
const offerOf = (page: Page) => page.getByRole("button", { name: "Dismiss Passkey Offer" });

const thePage = (page: Page) => page.getByRole("main", { name: "Page" });

/** Asked for before the page loads or signs in, so an absence asserted after it is the read's answer. */
const secondFactorRead = (page: Page) =>
  page.waitForResponse((answer) => answer.url().includes("person.secondFactor"));

/** A Viewer holding no passkey, on Ask from their sign-in, who signs in again by the address answered. */
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

/** Through the avatar menu, so the sign-in after it happens in the page that showed the offer. */
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

/** On to another page, where the offer must not follow. */
const movedOnWithoutTheOffer = async (page: Page): Promise<void> => {
  await railOf(page).getByRole("link", { name: "Knowledge" }).click();
  // Knowledge's first group heads the page its rail link opens.
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

test("a dismissed offer stays away after the next sign-in", async ({ page, request }) => {
  const viewer = await aViewerOffered(page, request);
  const dismissed = page.waitForResponse((answer) => answer.url().includes("dismissPasskeyOffer"));

  await offerOf(page).click();

  await expect(offerOf(page)).toHaveCount(0);
  await expect(thePage(page)).toBeFocused();
  expect((await dismissed).ok(), "the dismissal was not kept").toBe(true);

  await signedInAgain(page, request, viewer);
  await expect(thePage(page)).toBeVisible();
  await expect(offerOf(page), "a dismissed offer came back with the next sign-in").toHaveCount(0);
});

/** A Viewer of two workspaces, each homed on Ask, offered a passkey on the home of the first. */
const aViewerOfTwoOffered = async (page: Page, api: APIRequestContext) => {
  await aVirtualAuthenticator(page);
  const email = anAddress("offered-in-two");
  const viewer = await person(api, email, { displayName: "Vera Offered" });
  const first = await provision(api, { name: "Offered Here Ltd" });
  const second = await provision(api, { name: "Offered There Ltd" });
  await addMember(api, { role: "Viewer", userId: viewer.id, workspaceId: first.workspaceId });
  await addMember(api, { role: "Viewer", userId: viewer.id, workspaceId: second.workspaceId });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.getByRole("button", { name: first.name }).click();
  await landedAtHome(page, "Viewer");
  await expect(offerOf(page)).toBeVisible();
  return { first, second };
};

test("a Viewer's offer survives a switch to the same address", async ({ page, request }) => {
  const { first, second } = await aViewerOfTwoOffered(page, request);

  await switcherOf(page, first.name).click();
  await switcherMenuOf(page, first.name).getByRole("menuitemradio", { name: second.name }).click();

  await expect(switcherOf(page, second.name)).toBeVisible();
  await landedAtHome(page, "Viewer");
  await expect(offerOf(page), "the offer ended as the switch drew its page again").toBeVisible();

  await movedOnWithoutTheOffer(page);

  await railOf(page).getByRole("link", { name: "Ask", exact: true }).click();
  await landedAtHome(page, "Viewer");
  await expect(offerOf(page), "the offer came back with the Viewer").toHaveCount(0);
});

test("a Viewer's offer ends on a trip through All workspaces", async ({ page, request }) => {
  const { first, second } = await aViewerOfTwoOffered(page, request);

  await allWorkspacesPicked(page, first.name);
  // A pick drops the second factor's read, so the home it opens reads it again.
  const read = secondFactorRead(page);
  await page.getByRole("button", { name: second.name }).click();

  await read;
  await expect(switcherOf(page, second.name)).toBeVisible();
  await landedAtHome(page, "Viewer");
  await expect(offerOf(page), "the offer was drawn twice in one sign-in").toHaveCount(0);
});

test("the offer's link lands on the Account page's add", async ({ page, request }) => {
  await aVirtualAuthenticator(page);
  await aMemberSignedInAt(page, request, "Editor", "/ask");

  await page.getByRole("link", { name: "Add a Passkey" }).click();

  await expect(accountHeading(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a Passkey" })).toBeFocused();
  await expect(offerOf(page)).toHaveCount(0);
});

test("a browser without WebAuthn keeps the email path alone", async ({ page, request }) => {
  await withoutWebAuthn(page);
  await aMemberSignedInAt(page, request, "Viewer", "/ask");
  await expect(offerOf(page)).toHaveCount(0);

  await signedOut(page);
  await expect(page.getByLabel("Email Address")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In with a Passkey" })).toHaveCount(0);
  await signedInWithNoWorkspace(page, request, "no-webauthn");
  await accountOpened(page);

  // The add's place holds a line more than a list with no passkey shows, and no button.
  const passkeys = page.getByRole("region", { name: "Passkeys" });
  await expect(passkeys.getByRole("paragraph"), "nothing stands in the add's place").toHaveCount(2);
  await expect(passkeys.getByRole("button", { name: "Add a Passkey" })).toHaveCount(0);
});
