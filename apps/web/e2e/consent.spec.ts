import { createHash, randomBytes } from "node:crypto";

import type { Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import { anAddress, provision, revokeCredentials, signIn } from "./harness.ts";

/**
 * T-045's acceptance seam: the MCP consent flow on one origin, in a real browser (ADR
 * 0034). A person signs in on the product, a host sends them to authorize, consent is
 * shown as a page of its own, and the code lands at the client's redirect and nowhere
 * else. Before T-045 this could not be proven here at all: the loopback estate had two
 * hosts and a host-only cookie, so the session made on one never reached the other.
 *
 * The client is Claude's own metadata document, served in process by the api's harness
 * (`apps/api/tests/harness.ts`). Its redirect is `https://claude.ai/…`, which this
 * browser never reaches: the route is intercepted and answered with a blank page, so
 * the navigation completes and the URL the browser landed on — code, state, `iss` — is
 * read off the page rather than followed.
 */

const CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const pkce = () => {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Claude's authorize request, as prototype 61 captured it: CIMD, S256, `resource`, `prompt=consent`. */
const authorizeUrl = (
  baseURL: string,
  options: { readonly prompt?: "consent" | undefined; readonly state?: string } = {},
): string => {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: pkce().challenge,
    code_challenge_method: "S256",
    resource: `${baseURL}/mcp`,
    scope: "knowledge:read feedback:write offline_access",
    state: options.state ?? "state-from-the-host",
  });
  if (options.prompt !== undefined) query.set("prompt", options.prompt);
  return `/oauth2/authorize?${query.toString()}`;
};

/** Answer the client's redirect ourselves, so the browser lands on it and stays there. */
const catchClaudesRedirect = (page: Page) =>
  page.route(`${REDIRECT_URI}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Claude</title><p>The client received the redirect.</p>",
    }),
  );

const landedAt = (page: Page): URL => new URL(page.url());

const consentHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Connect Claude" });

test("sign-in, authorize, consent and the code at Claude's redirect, all on one origin", async ({
  page,
  request,
  baseURL,
}) => {
  const origin = baseURL ?? "";
  const email = anAddress("consenting");
  const workspace = await provision(request, { name: "Consenting Ltd", adminEmail: email });
  await catchClaudesRedirect(page);

  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page).toHaveURL(/\/system$/);

  // The host sends the person to authorize. A member of one workspace has it active
  // already, so the next page is consent — on the origin the browser is on.
  await page.goto(authorizeUrl(origin, { prompt: "consent" }));

  await expect(consentHeading(page)).toBeVisible();
  expect(landedAt(page).origin).toBe(origin);
  expect(landedAt(page).pathname).toBe("/consent");
  // A page of its own, not a screen in the shell: no Control Centre around it.
  await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);
  // Who is granting what, to whom, in the person's words.
  await expect(page.getByText(`Claude will act as you, at ${workspace.name}.`)).toBeVisible();
  await expect(page.getByText("Read what you can see of the company's knowledge")).toBeVisible();
  await expect(page.getByText("Stay connected until you disconnect it")).toBeVisible();
  await expect(page.getByText("hosted at claude.ai")).toBeVisible();

  await page.getByRole("button", { name: "Connect" }).click();

  // The code went to Claude's redirect and nowhere else, with the host's state and the
  // issuer (RFC 9207) — which is this origin.
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
}) => {
  // The one unverified behaviour in T-045's spec, settled here rather than assumed and
  // written into ADR 0034 either way. Better Auth keeps one consent row per person per
  // client; whether that row skips the screen depends on what the host sends.
  const origin = baseURL ?? "";
  const email = anAddress("returning");
  await provision(request, { name: "Returning Ltd", adminEmail: email });
  await catchClaudesRedirect(page);
  await page.goto("/sign-in");
  await signIn(page, request, email);

  await page.goto(authorizeUrl(origin, { prompt: "consent", state: "first" }));
  await expect(consentHeading(page)).toBeVisible();
  await page.getByRole("button", { name: "Connect" }).click();
  expect(landedAt(page).searchParams.get("state")).toBe("first");

  // Claude's own request carries `prompt=consent`, and Better Auth honours it: consent
  // is shown on every authorization from claude.ai, whatever rows exist.
  await page.goto(authorizeUrl(origin, { prompt: "consent", state: "second" }));
  await expect(consentHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/consent");
  await page.getByRole("button", { name: "Connect" }).click();
  expect(landedAt(page).searchParams.get("state")).toBe("second");
  expect(landedAt(page).searchParams.get("code")).not.toBeNull();

  // Without `prompt`, the earlier answer stands: the existing consent row covers the
  // scopes and the resource asked for, so the person is sent straight back to the client
  // with a code and never sees the page.
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
}) => {
  const origin = baseURL ?? "";
  const email = anAddress("declining");
  await provision(request, { name: "Declining Ltd", adminEmail: email });
  await catchClaudesRedirect(page);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(authorizeUrl(origin, { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();

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
  const origin = baseURL ?? "";
  const email = anAddress("revoked");
  const workspace = await provision(request, { name: "Revoked Ltd", adminEmail: email });
  await catchClaudesRedirect(page);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.goto(authorizeUrl(origin, { prompt: "consent" }));
  await expect(consentHeading(page)).toBeVisible();

  // The act the People screen will one day perform, between the page and the click.
  await revokeCredentials(request, workspace.admin.id);
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Sign in again" })).toBeVisible();
  expect(landedAt(page).origin).toBe(origin);
  expect(landedAt(page).searchParams.get("code")).toBeNull();
});
