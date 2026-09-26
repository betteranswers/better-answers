import type { Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  catchClaudesRedirect,
  CLAUDES_REDIRECT_URI,
  claudesAuthorizeUrl,
  person,
  provision,
  revokeCredentials,
  signIn,
} from "./harness.ts";

const landedAt = (page: Page): URL => new URL(page.url());

const consentHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Connect Claude" });

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Your display name" });

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
  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);

  await page.goto(claudesAuthorizeUrl(origin, { prompt: "consent" }));

  await expect(consentHeading(page)).toBeVisible();
  expect(landedAt(page).origin).toBe(origin);
  expect(landedAt(page).pathname).toBe("/consent");

  await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);

  await expect(page.getByText(`Claude will act as you, at ${workspace.name}.`)).toBeVisible();
  await expect(page.getByText("Read what you can see of the company's knowledge")).toBeVisible();
  await expect(page.getByText("Stay connected until you disconnect it")).toBeVisible();
  await expect(page.getByText("hosted at claude.ai")).toBeVisible();

  await passesTheAccessibilityGate();

  const callback = await connectedAt(page);
  expect(callback.searchParams.get("state")).toBe("state-from-the-host");
  expect(callback.searchParams.get("iss")).toBe(origin);
  expect(callback.searchParams.get("error")).toBeNull();
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

  await revokeCredentials(request, workspace.admin.id);
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
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  expect(landedAt(page).pathname).toBe("/sign-in");
  await signIn(page, request, email);

  await expect(displayNameHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/display-name");
  expect(landedAt(page).searchParams.get("sig")).not.toBeNull();
  await passesTheAccessibilityGate();
  await page.getByLabel("Display name").fill("Mona Reviewer");
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
  await page.getByLabel("Display name").fill("Sam Okoro");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "No workspace yet" })).toBeVisible();
});
