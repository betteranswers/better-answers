import type { Page } from "@playwright/test";

import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";
import { HOMES } from "@/shared/navigation.ts";

import {
  landedAtHome,
  notFoundOfferingHome,
  railOf,
  signInHeading,
  signOutFromTheShell,
} from "../e2e/locators.ts";
import { theConsoleIsRefused, theSwitcherListsOneWorkspace, type Gate } from "./every-role.ts";
import { expect, test } from "./fixtures.ts";
import { publishedAddressOf, sessionMemberOf } from "./reads.ts";

/** The test workspace may hold no knowledge, so Search is read with nothing asked. */
const searchIsReached = async (page: Page, gate: Gate): Promise<void> => {
  await railOf(page).getByRole("link", { name: "Knowledge" }).click();
  await expect(page).toHaveURL(new RegExp(`${SEARCH.path}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Browse" })).toBeVisible();
  const search = page.getByRole("region", { name: "Search" });
  await expect(search.getByRole("searchbox")).toHaveValue("");
  await expect(search.getByRole("status")).toHaveText(/\S/);
  await gate();
};

/** A release whose page and published resource differ would send a person's assistant nowhere. */
const askShowsThePublishedAddress = async (page: Page): Promise<void> => {
  const address = await publishedAddressOf(page);
  await expect(page.getByRole("main").getByText(address, { exact: true })).toBeVisible();
};

/** An Editor or a Viewer: they reach their home and Search, and an Admin's page says it was never there. */
export const aMembersJourney = async (
  page: Page,
  role: "Editor" | "Viewer",
  gate: Gate,
): Promise<void> => {
  const { workspace, person } = await test.step("Home", async () => {
    await landedAtHome(page, role);
    const member = await sessionMemberOf(page);
    await gate();
    return member;
  });

  await test.step("The address to connect an assistant", () => askShowsThePublishedAddress(page));

  await test.step("The workspace switcher", () =>
    theSwitcherListsOneWorkspace(page, workspace.name, role));

  await test.step("Search", () => searchIsReached(page, gate));

  await test.step("The console", () => theConsoleIsRefused(page, gate));

  await test.step("An Admin's page", async () => {
    await page.goto(HOMES.Admin.path);
    await notFoundOfferingHome(page, role);
    await gate();
    await page.getByRole("link", { name: "Go to Ask" }).click();
    await landedAtHome(page, role);
  });

  await test.step("Sign out", async () => {
    await signOutFromTheShell(page, person.name);
    await expect(signInHeading(page)).toBeVisible();
  });
};
