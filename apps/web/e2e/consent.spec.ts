import type { Page } from "@playwright/test";

import { RAIL } from "@/app/words.ts";
import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace-words.ts";
import { DISPLAY_NAME_WORDS } from "@/shared/display-name-words.ts";
import { THEME_KEPT_UNDER } from "@/shared/theme-switch.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  catchClaudesRedirect,
  CLAUDES_REDIRECT_URI,
  claudesAuthorizeUrl,
  drawnMarks,
  landedAtHome,
  person,
  provision,
  endEverySignInAndToken,
  signIn,
  signInHeading,
  tokenPainted,
} from "./harness.ts";

const landedAt = (page: Page): URL => new URL(page.url());

const consentHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Connect Claude" });

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: DISPLAY_NAME_WORDS.heading });

const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset["theme"]);

/** The api's pages paint their surface on `<body>`, where the SPA paints `<html>`. */
const pagePainted = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const paintsTheDarkPage = async (page: Page, light: string): Promise<void> => {
  expect(await themeOf(page), "the page ignored the theme kept").toBe("dark");
  const painted = await pagePainted(page);
  expect(painted).toBe(await tokenPainted(page, "--surface-page", "background-color"));
  expect(painted, "the dark theme painted the light page").not.toBe(light);
};

const connectedAt = async (page: Page): Promise<URL> => {
  await page.getByRole("button", { name: "Connect" }).click();
  const callback = landedAt(page);
  expect(`${callback.origin}${callback.pathname}`).toBe(CLAUDES_REDIRECT_URI);
  expect(callback.searchParams.get("code")).not.toBeNull();
  return callback;
};

test("carries sign-in through consent to Claude's code on one origin", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  const origin = baseURL ?? "";
  const email = anAddress("consenting");
  const workspace = await provision(request, { name: "Consenting Ltd", adminEmail: email });
  await catchClaudesRedirect(page);

  await page.goto("/sign-in");
  await signIn(page, request, email);
  await landedAtHome(page, "Admin");

  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent" }));

  await expect(consentHeading(page)).toBeVisible();
  expect(landedAt(page).origin).toBe(origin);
  expect(landedAt(page).pathname).toBe("/consent");

  await expect(page.getByRole("navigation", { name: RAIL })).toHaveCount(0);

  await expect(page.getByText(`Claude will act as you, at ${workspace.name}.`)).toBeVisible();
  await expect(page.getByText("Read what you can see of the company’s knowledge")).toBeVisible();
  await expect(page.getByText("Stay connected until you disconnect it")).toBeVisible();
  await expect(page.getByText("hosted at claude.ai")).toBeVisible();

  await passesTheAccessibilityGate();

  const callback = await connectedAt(page);
  expect(callback.searchParams.get("state")).toBe("state-from-the-host");
  expect(callback.searchParams.get("iss")).toBe(origin);
  expect(callback.searchParams.get("error")).toBeNull();
});

test("draws consent in the sign-in pages' card, faces and tokens", async ({
  page,
  request,
  baseURL,
}) => {
  const email = anAddress("drawn");
  await provision(request, { name: "Drawn Ltd", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(claudesAuthorizeUrl(baseURL ?? "", { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();

  expect(await drawnMarks(page), "the card stands for its primary button").toEqual(["card"]);
  const geistLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return (
      document.fonts.check('16px "Geist Variable"') &&
      document.fonts.check('16px "Geist Mono Variable"')
    );
  });
  expect(geistLoaded, "the api serves both faces").toBe(true);
  await expect(consentHeading(page)).toHaveCSS("font-family", /^"Geist Variable"/);

  const connect = page.getByRole("button", { name: "Connect" });
  const fill = await tokenPainted(page, "--control-primary-bg", "background-color");
  expect(fill, "the primary's token resolves").not.toBe("rgba(0, 0, 0, 0)");
  await expect(connect).toHaveCSS("background-color", fill);
  await expect(connect).toHaveCSS("border-radius", "0px");

  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toHaveAttribute("data-variant", "outline");
  await expect(cancel).toHaveCSS("border-top-width", "1px");

  await page.keyboard.press("Tab");
  await expect(connect).toBeFocused();
  const ring = await tokenPainted(page, "--focus-ring", "box-shadow");
  await expect(connect).toHaveCSS("box-shadow", ring);

  await page.setViewportSize({ width: 320, height: 720 });
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, "the page scrolls sideways at 320px").toBe(0);
});

test("draws consent, then its refusal, in the dark theme kept", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const email = anAddress("keeps-dark");
  const workspace = await provision(request, { name: "Keeps Dark Ltd", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(claudesAuthorizeUrl(baseURL ?? "", { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();
  expect(await themeOf(page), "a light device opened a dark page").toBe("light");
  const light = await pagePainted(page);

  await page.evaluate((key) => {
    localStorage.setItem(key, "dark");
  }, THEME_KEPT_UNDER);
  await page.reload();

  await expect(consentHeading(page)).toBeVisible();
  await paintsTheDarkPage(page, light);
  await expect(page.locator("script[src]"), "the consent page loaded the SPA").toHaveCount(0);
  await passesTheAccessibilityGate();

  await endEverySignInAndToken(request, workspace.admin.id);
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in again" })).toBeVisible();
  await paintsTheDarkPage(page, light);
});

test("follows a dark device on consent when nothing is kept", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const email = anAddress("dark-device");
  await provision(request, { name: "Dark Device Ltd", adminEmail: email });
  await catchClaudesRedirect(page);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(claudesAuthorizeUrl(baseURL ?? "", { prompt: "consent" }));

  await expect(consentHeading(page)).toBeVisible();
  expect(await themeOf(page), "a dark device opened a light page").toBe("dark");
  await passesTheAccessibilityGate();
  await connectedAt(page);
});

test("draws a cross-site refusal in the dark theme kept", async ({ page, baseURL }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript((key) => {
    localStorage.setItem(key, "dark");
  }, THEME_KEPT_UNDER);
  await page.route("https://elsewhere.example/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>Elsewhere</title><form method="post" action="${baseURL ?? ""}/consent"><button>Send</button></form>`,
    }),
  );
  await page.goto("https://elsewhere.example/");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Nothing was connected" }),
  ).toBeVisible();
  expect(await themeOf(page), "the refusal ignored the theme kept").toBe("dark");
  expect(await pagePainted(page)).toBe(
    await tokenPainted(page, "--surface-page", "background-color"),
  );
});

test("asks consent again only when the host asks for it", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  const origin = baseURL ?? "";
  const email = anAddress("returning");
  await provision(request, { name: "Returning Ltd", adminEmail: email });
  await catchClaudesRedirect(page);
  await page.goto("/sign-in");
  await signIn(page, request, email);

  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent", state: "first" }));
  await expect(consentHeading(page)).toBeVisible();
  await passesTheAccessibilityGate();
  await page.getByRole("button", { name: "Connect" }).click();
  expect(landedAt(page).searchParams.get("state")).toBe("first");

  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent", state: "second" }));
  await expect(consentHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/consent");
  await page.getByRole("button", { name: "Connect" }).click();
  expect(landedAt(page).searchParams.get("state")).toBe("second");
  expect(landedAt(page).searchParams.get("code")).not.toBeNull();

  await page.goto(claudesAuthorizeUrl(origin, { state: "third" }));
  const skipped = landedAt(page);
  expect(`${skipped.origin}${skipped.pathname}`).toBe(CLAUDES_REDIRECT_URI);
  expect(skipped.searchParams.get("state")).toBe("third");
  expect(skipped.searchParams.get("code")).not.toBeNull();
  await expect(consentHeading(page)).toHaveCount(0);
});

test("cancelling consent sends the assistant a refusal and no code", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  const origin = baseURL ?? "";
  const email = anAddress("declining");
  await provision(request, { name: "Declining Ltd", adminEmail: email });
  await catchClaudesRedirect(page);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();
  await passesTheAccessibilityGate();

  await page.getByRole("button", { name: "Cancel" }).click();

  const callback = landedAt(page);
  expect(`${callback.origin}${callback.pathname}`).toBe(CLAUDES_REDIRECT_URI);
  expect(callback.searchParams.get("error")).toBe("access_denied");
  expect(callback.searchParams.get("code")).toBeNull();
});

test("refuses consent after credentials are revoked, sending no code", async ({
  page,
  request,
  baseURL,
}) => {
  /* jscpd:ignore-start */
  const origin = baseURL ?? "";
  const email = anAddress("revoked");
  const workspace = await provision(request, { name: "Revoked Ltd", adminEmail: email });
  await catchClaudesRedirect(page);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();
  /* jscpd:ignore-end */

  await endEverySignInAndToken(request, workspace.admin.id);
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in again" })).toBeVisible();
  expect(landedAt(page).origin).toBe(origin);
  expect(landedAt(page).searchParams.get("code")).toBeNull();
});

test("takes a named member from connector sign-in straight to consent", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("named-connecting");
  await provision(request, { name: "Named Connecting Ltd", adminEmail: email });
  await catchClaudesRedirect(page);

  await page.goto(claudesAuthorizeUrl(baseURL ?? "", { prompt: "consent" }));
  await signIn(page, request, email);

  await expect(consentHeading(page)).toBeVisible();
  await expect(displayNameHeading(page)).toHaveCount(0);
  await passesTheAccessibilityGate();
  await connectedAt(page);
});

test("asks an unnamed member's name, then carries on through consent", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  const origin = baseURL ?? "";
  const email = anAddress("unnamed");
  const workspace = await provision(request, { name: "Unnamed Ltd" });
  const who = await person(request, email, { displayName: "" });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: who.id, role: "Editor" });
  await catchClaudesRedirect(page);

  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent", state: "named-first" }));
  await expect(signInHeading(page, "connecting")).toBeVisible();
  expect(landedAt(page).pathname).toBe("/sign-in");
  await signIn(page, request, email);

  await expect(displayNameHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/display-name");
  expect(landedAt(page).searchParams.get("sig")).not.toBeNull();
  await passesTheAccessibilityGate();
  await page.getByLabel(DISPLAY_NAME_WORDS.label).fill("Mona Reviewer");
  await page.keyboard.press("Enter");

  await expect(consentHeading(page)).toBeVisible();
  await expect(page.getByText(`Claude will act as you, at ${workspace.name}.`)).toBeVisible();
  const callback = await connectedAt(page);
  expect(callback.searchParams.get("state")).toBe("named-first");
});

test("asks a non-member's name, then says No workspace yet", async ({ page, request, baseURL }) => {
  await page.goto(claudesAuthorizeUrl(baseURL ?? ""));
  await signIn(page, request, anAddress("unplaced"));

  await expect(displayNameHeading(page)).toBeVisible();
  await page.getByLabel(DISPLAY_NAME_WORDS.label).fill("Sam Okoro");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  expect(landedAt(page).searchParams.get("sig")).not.toBeNull();
});
