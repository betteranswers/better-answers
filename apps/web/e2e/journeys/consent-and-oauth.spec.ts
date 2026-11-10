import assert from "node:assert/strict";

import type { Page } from "@playwright/test";

import { DISPLAY_NAME_WORDS } from "@/shared/member/display-name-words.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  catchClaudesRedirect,
  CLAUDES_REDIRECT_URI,
  claudesAuthorizeUrl,
  provision,
  signIn,
} from "../harness.ts";

const consentHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Connect Claude" });

const displayNameHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: DISPLAY_NAME_WORDS.heading });

const connectAndGetCallback = async (page: Page): Promise<URL> => {
  await page.getByRole("button", { name: "Connect" }).click();
  const callback = new URL(page.url());
  expect(`${callback.origin}${callback.pathname}`).toBe(CLAUDES_REDIRECT_URI);
  expect(callback.searchParams.get("code")).not.toBeNull();
  return callback;
};

test("a member with a display name goes straight to consent", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts sets no baseURL");
  const email = anAddress("named-connecting");
  await provision(request, { name: "Named Connecting Ltd", adminEmail: email });
  await catchClaudesRedirect(page);

  await page.goto(claudesAuthorizeUrl(baseURL, { prompt: "consent" }));
  await signIn(page, request, email);

  await expect(consentHeading(page)).toBeVisible();
  await expect(displayNameHeading(page)).toHaveCount(0);
  await passesTheAccessibilityGate();
  await connectAndGetCallback(page);
});
