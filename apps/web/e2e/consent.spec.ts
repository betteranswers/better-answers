import { createHash, randomBytes } from "node:crypto";

import type { Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import { anAddress, provision, revokeCredentials, signIn } from "./harness.ts";

const CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const aChallenge = (): string =>
  createHash("sha256").update(randomBytes(64).toString("base64url")).digest("base64url");

const authorizeUrl = (
  baseURL: string,
  options: { readonly prompt?: "consent" | undefined; readonly state?: string } = {},
): string => {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: aChallenge(),
    code_challenge_method: "S256",
    resource: `${baseURL}/mcp`,
    scope: "knowledge:read feedback:write offline_access",
    state: options.state ?? "state-from-the-host",
  });
  if (options.prompt !== undefined) query.set("prompt", options.prompt);
  return `/oauth2/authorize?${query.toString()}`;
};

const catchClaudesRedirect = (page: Page) =>
  page.route(`${REDIRECT_URI}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Claude</title><p>The client received the redirect.</p>",
    }),
  );

const landedAt = (page: Page): URL => new URL(page.url());

const consentHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Connect Claude" });

test("sign-in, authorize, consent and the code at Claude's redirect, all on one origin", async ({
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
  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);

  await page.goto(authorizeUrl(origin, { prompt: "consent" }));

  await expect(consentHeading(page)).toBeVisible();
  expect(landedAt(page).origin).toBe(origin);
  expect(landedAt(page).pathname).toBe("/consent");

  await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);

  await expect(page.getByText(`Claude will act as you, at ${workspace.name}.`)).toBeVisible();
  await expect(page.getByText("Read what you can see of the company's knowledge")).toBeVisible();
  await expect(page.getByText("Stay connected until you disconnect it")).toBeVisible();
  await expect(page.getByText("hosted at claude.ai")).toBeVisible();

  await passesTheAccessibilityGate();

  await page.getByRole("button", { name: "Connect" }).click();

  const callback = landedAt(page);
  expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
  expect(callback.searchParams.get("code")).not.toBeNull();
  expect(callback.searchParams.get("state")).toBe("state-from-the-host");
  expect(callback.searchParams.get("iss")).toBe(origin);
  expect(callback.searchParams.get("error")).toBeNull();
});

test("a second authorization from the same client shows consent again when the host asks for it, and skips it when it does not", async ({
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

  await page.goto(authorizeUrl(origin, { prompt: "consent", state: "first" }));
  await expect(consentHeading(page)).toBeVisible();
  await passesTheAccessibilityGate();
  await page.getByRole("button", { name: "Connect" }).click();
  expect(landedAt(page).searchParams.get("state")).toBe("first");

  await page.goto(authorizeUrl(origin, { prompt: "consent", state: "second" }));
  await expect(consentHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/consent");
  await page.getByRole("button", { name: "Connect" }).click();
  expect(landedAt(page).searchParams.get("state")).toBe("second");
  expect(landedAt(page).searchParams.get("code")).not.toBeNull();

  await page.goto(authorizeUrl(origin, { state: "third" }));
  const skipped = landedAt(page);
  expect(`${skipped.origin}${skipped.pathname}`).toBe(REDIRECT_URI);
  expect(skipped.searchParams.get("state")).toBe("third");
  expect(skipped.searchParams.get("code")).not.toBeNull();
  await expect(consentHeading(page)).toHaveCount(0);
});

test("cancelling consent sends the client a refusal and no code", async ({
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
  await page.goto(authorizeUrl(origin, { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();
  await passesTheAccessibilityGate();

  await page.getByRole("button", { name: "Cancel" }).click();

  const callback = landedAt(page);
  expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI);
  expect(callback.searchParams.get("error")).toBe("access_denied");
  expect(callback.searchParams.get("code")).toBeNull();
});

test("consent is refused once the person's credentials are revoked, and no code is sent", async ({
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
  await page.goto(authorizeUrl(origin, { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();
  /* jscpd:ignore-end */

  await revokeCredentials(request, workspace.admin.id);
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in again" })).toBeVisible();
  expect(landedAt(page).origin).toBe(origin);
  expect(landedAt(page).searchParams.get("code")).toBeNull();
});
