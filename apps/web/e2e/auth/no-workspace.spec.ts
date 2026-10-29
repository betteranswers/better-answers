import assert from "node:assert/strict";

import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  claudesAuthorizeUrl,
  markTheOperator,
  person,
  signIn,
  signInHeading,
  withAnAuthenticator,
} from "../harness.ts";

const landedAt = (page: Page): URL => new URL(page.url());

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No Workspace Yet" });

const claudeLine = (page: Page) => page.getByRole("main").getByText(/\bClaude\b/);

const landedConnecting = async (
  page: Page,
  request: APIRequestContext,
  origin: string,
  email: string,
) => {
  await page.goto(claudesAuthorizeUrl(origin));
  await expect(signInHeading(page, "connecting")).toBeVisible();
  await signIn(page, request, email);

  await expect(noWorkspaceHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/no-workspace");
  expect(
    landedAt(page).searchParams.get("sig"),
    "the picker dropped Claude's query",
  ).not.toBeNull();
};

test("keeps an operator connecting Claude on the no-workspace page", async ({
  page,
  request,
  baseURL,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const email = anAddress("operator");
  await person(request, email);
  await markTheOperator(request, email);
  await withAnAuthenticator(request, email);

  await landedConnecting(page, request, baseURL, email);
  await expect(claudeLine(page)).toBeVisible();
});
