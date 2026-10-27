import assert from "node:assert/strict";

import type { APIRequestContext, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  claudesAuthorizeUrl,
  landedAtHome,
  person,
  personMenuOpened,
  provision,
  endEverySignInAndToken,
  saysARefusal,
  saysTheWait,
  signedInAtHome,
  signedInWithNoWorkspace,
  signIn,
  signInHeading,
  signOutFromTheShell,
} from "./harness.ts";
import { aCeilingMet, theNextAskMeetsACeiling } from "./refused-read.ts";

const signInSaysWhy = async (page: Page): Promise<string> => {
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByRole("status"), "the sign-in page says nothing of the arrival").toHaveText(
    /\S/,
  );
  return page.getByRole("status").innerText();
};

const WAIT_SECONDS = 120;

const SIGN_OUT = "/sign-out";

const signedInAtHomeAs = async (page: Page, request: APIRequestContext, who: string) => {
  const email = anAddress(who);
  const workspace = await provision(request, { name: `Signing out ${who}`, adminEmail: email });
  await signedInAtHome(page, request, email);
  return workspace;
};

const bandAlert = (page: Page) => page.getByRole("banner").getByRole("alert");

test("a refused sign-out keeps the page and says the wait", async ({ page, request }) => {
  const workspace = await signedInAtHomeAs(page, request, "refused");
  const home = page.url();
  await theNextAskMeetsACeiling(page, SIGN_OUT, WAIT_SECONDS);

  await signOutFromTheShell(page, workspace.admin.name);

  await saysTheWait(bandAlert(page), WAIT_SECONDS);
  expect(page.url(), "a refused sign-out left the page").toBe(home);
  await landedAtHome(page, "Admin");
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();
});

test("drops a refused sign-out's alert on the next page", async ({ page, request }) => {
  const workspace = await signedInAtHomeAs(page, request, "moving");
  await theNextAskMeetsACeiling(page, SIGN_OUT, WAIT_SECONDS);
  await signOutFromTheShell(page, workspace.admin.name);
  await saysARefusal(bandAlert(page));
  const said = await bandAlert(page).innerText();

  await page.getByRole("link", { name: "Skip to the Page" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(bandAlert(page), "a link within the page dropped the refusal").toHaveText(said);

  await page.getByRole("link", { name: "Audit Log" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  await expect(bandAlert(page), "the band still says the sign-out was refused").toHaveCount(0);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(bandAlert(page), "going back brought the refusal back").toHaveCount(0);
});

test("the session still reads after a refused sign-out", async ({ page, request }) => {
  const workspace = await signedInAtHomeAs(page, request, "kept");
  await theNextAskMeetsACeiling(page, SIGN_OUT, WAIT_SECONDS);
  await signOutFromTheShell(page, workspace.admin.name);
  await saysARefusal(bandAlert(page));

  await page.reload();
  await landedAtHome(page, "Admin");
  const menu = await personMenuOpened(page, workspace.admin.name);
  await menu.getByRole("menuitem", { name: "Account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();

  await signOutFromTheShell(page, workspace.admin.name);
  await signInSaysWhy(page);
});

test("a refused sign-out off the shell says the wait", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "nowhere");
  await theNextAskMeetsACeiling(page, SIGN_OUT, WAIT_SECONDS);
  const signOut = page.getByRole("button", { name: "Sign Out" });

  await signOut.click();

  await saysTheWait(page.getByRole("main").getByRole("alert"), WAIT_SECONDS);
  await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
  await expect(signOut, "a refused sign-out dropped the focus").toBeFocused();
});

test("a refused sign-out keeps the connection the page carries", async ({
  page,
  request,
  baseURL,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const email = anAddress("carrying");
  await person(request, email, { displayName: "Sam Okoro" });
  await page.goto(claudesAuthorizeUrl(baseURL));
  await signIn(page, request, email);
  await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
  const carrying = new URL(page.url()).search;
  expect(new URLSearchParams(carrying).get("sig"), "the page carries no connection").not.toBeNull();
  await theNextAskMeetsACeiling(page, SIGN_OUT, WAIT_SECONDS);

  await page.getByRole("button", { name: "Sign Out" }).click();

  await saysARefusal(page.getByRole("main").getByRole("alert"));
  expect(new URL(page.url()).search, "a refused sign-out dropped the connection").toBe(carrying);
});

test("a refused session read is asked once, not three times", async ({ page, request }) => {
  await signedInAtHomeAs(page, request, "unread");
  let asked = 0;
  await page.route(
    (url) => url.pathname === "/get-session",
    (route) => {
      asked += 1;
      return route.fulfill(aCeilingMet(WAIT_SECONDS));
    },
  );

  await page.goto("/display-name");
  await expect(page.getByRole("heading", { level: 1, name: "Your Name" })).toBeVisible();
  expect(asked, "a refused session read was asked again").toBe(1);
});

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

test("refuses revoked credentials on the next request", async ({ page, request }) => {
  const email = anAddress("revoked");
  const workspace = await provision(request, { name: "Revoked", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();
  await signOutFromTheShell(page, workspace.admin.name);
  const signedOut = await signInSaysWhy(page);
  await signIn(page, request, email);
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();

  await endEverySignInAndToken(request, workspace.admin.id);

  await page.getByRole("link", { name: "Groups" }).click();
  await page.reload();

  expect(await signInSaysWhy(page), "revoked credentials read as a sign-out").not.toBe(signedOut);
});

test("admits a sign-in made straight after the revocation", async ({ page, request }) => {
  const email = anAddress("again");
  const workspace = await provision(request, { name: "Again", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();

  await endEverySignInAndToken(request, workspace.admin.id);
  await page.reload();
  await signIn(page, request, email);

  await page.getByRole("link", { name: "Groups" }).click();
  await page.reload();
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
});
