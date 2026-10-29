import type { APIRequestContext, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  landedAtHome,
  provision,
  saysTheWait,
  signedInAtHome,
  signedInWithNoWorkspace,
  signIn,
  signInHeading,
  signOutFromTheShell,
} from "../harness.ts";
import { aCeilingMet, theNextAskMeetsACeiling } from "../refused-read.ts";

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

test("a refused sign-out off the shell says the wait", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "nowhere");
  await theNextAskMeetsACeiling(page, SIGN_OUT, WAIT_SECONDS);
  const signOut = page.getByRole("button", { name: "Sign Out" });

  await signOut.click();

  await saysTheWait(page.getByRole("main").getByRole("alert"), WAIT_SECONDS);
  await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
  await expect(signOut, "a refused sign-out dropped the focus").toBeFocused();
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
