import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { ALL_WORKSPACES } from "@/app/words.ts";
import { noLongerAMemberOf, PICK_REFUSED, SWITCHER_UNREAD } from "@/features/auth/refusal-words.ts";
import { PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { CONSOLE, HOMES } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  landedAtHome,
  markTheOperator,
  person,
  provision,
  removeMember,
  signIn,
  signOutFromTheShell,
  switcherMenuOf,
  switcherOf,
} from "./harness.ts";

const SWITCH_BUDGET_MS = 1000;

const WORKSPACES_READ = "**/organization/list";

const workspacesIn = (menu: Locator): Locator => menu.getByRole("menuitemradio");

/** Standing while empty, so the regions are found before they have anything to say. */
const saidInTheBand = (page: Page): Locator =>
  page.getByRole("banner").getByRole("status", { includeHidden: true });

const refusedInTheBand = (page: Page): Locator =>
  page.getByRole("banner").getByRole("alert", { includeHidden: true });

const memberButton = (page: Page, name: string): Locator =>
  page.getByRole("main").getByRole("button", { name, exact: true });

/** A member of one workspace alone, so a row names the workspace it was read from. */
const aMemberOnlyOf = async (api: APIRequestContext, workspaceId: string, name: string) => {
  const member = await person(api, anAddress("only"), { displayName: name });
  await addMember(api, { workspaceId, userId: member.id, role: "Viewer" });
};

/** The Admin of `first`, holding `role` in `second`, signed in and reading `first`. */
const inTwoWorkspaces = async (
  page: Page,
  api: APIRequestContext,
  names: { readonly first: string; readonly second: string },
  role: "Admin" | "Viewer" = "Admin",
) => {
  const email = anAddress("switching");
  const first = await provision(api, { name: names.first, adminEmail: email });
  const second = await provision(api, { name: names.second });
  await addMember(api, { workspaceId: second.workspaceId, userId: first.admin.id, role });

  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.getByRole("button", { name: first.name, exact: true }).click();
  await landedAtHome(page, "Admin");
  await expect(switcherOf(page, first.name)).toBeVisible();
  return { email, first, second };
};

/** Held until the returned call, so the page meets the read while it is still pending. */
const heldBack = async (page: Page, url: string): Promise<() => void> => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    await released;
    await route.continue();
  });
  return release;
};

test("lists the operator's workspaces and Console, others none (AE5)", async ({
  page,
  request,
}) => {
  const operator = await inTwoWorkspaces(page, request, {
    first: "Airedale Castings",
    second: "Nidderdale Tools",
  });
  await markTheOperator(request, operator.email);
  await page.reload();

  await switcherOf(page, operator.first.name).click();
  const menu = switcherMenuOf(page, operator.first.name);
  await expect(workspacesIn(menu)).toHaveText([operator.first.name, operator.second.name]);
  await expect(workspacesIn(menu).first()).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitem")).toHaveText([ALL_WORKSPACES, CONSOLE.name]);
  await page.keyboard.press("Escape");
  await expect(switcherOf(page, operator.first.name)).toBeFocused();
  await signOutFromTheShell(page, operator.first.admin.name);

  const other = await inTwoWorkspaces(page, request, {
    first: "Calder Presswork",
    second: "Colne Valley Forge",
  });
  await switcherOf(page, other.first.name).click();
  const theirs = switcherMenuOf(page, other.first.name);
  await expect(workspacesIn(theirs)).toHaveText([other.first.name, other.second.name]);
  await expect(theirs.getByRole("menuitem")).toHaveText([ALL_WORKSPACES]);
});

test("switches to another workspace's home, reading its members", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Wharfe Joinery",
    second: "Aire Joinery",
  });
  await aMemberOnlyOf(request, first.workspaceId, "Only In Wharfe");
  await aMemberOnlyOf(request, second.workspaceId, "Only In Aire");
  await page.reload();
  await expect(memberButton(page, "Only In Wharfe")).toBeVisible();

  await switcherOf(page, first.name).click();
  const started = Date.now();
  await workspacesIn(switcherMenuOf(page, first.name)).filter({ hasText: second.name }).click();

  await expect(memberButton(page, "Only In Aire")).toBeVisible();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "switching workspace", description: `${elapsed} ms` });
  expect(elapsed, "the switch took longer than its second").toBeLessThan(SWITCH_BUDGET_MS);

  await landedAtHome(page, "Admin");
  await expect(memberButton(page, "Only In Wharfe")).toHaveCount(0);
  await expect(switcherOf(page, second.name)).toBeVisible();
  await expect(switcherOf(page, first.name)).toHaveCount(0);
  await expect(switcherOf(page, second.name)).toBeFocused();
});

test("lands a switch on the role's home in that workspace", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(
    page,
    request,
    { first: "Holme Pressings", second: "Holme Viewing" },
    "Viewer",
  );

  await switcherOf(page, first.name).click();
  await workspacesIn(switcherMenuOf(page, first.name)).filter({ hasText: second.name }).click();

  await landedAtHome(page, "Viewer");
  await expect(switcherOf(page, second.name)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Control Centre" })).toHaveCount(0);
});

test("takes All workspaces to the picker", async ({ page, request }) => {
  const { first } = await inTwoWorkspaces(page, request, {
    first: "Ribble Wireworks",
    second: "Hodder Wireworks",
  });

  await switcherOf(page, first.name).click();
  await switcherMenuOf(page, first.name).getByRole("menuitem", { name: ALL_WORKSPACES }).click();

  await expect(page).toHaveURL("/choose-workspace");
  await expect(page.getByRole("heading", { level: 1, name: PICKER_WORDS.heading })).toBeVisible();
});

test("says it reads the list, filling the open menu", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { email, first, second } = await inTwoWorkspaces(page, request, {
    first: "Pendle Castings",
    second: "Bowland Castings",
  });
  await markTheOperator(request, email);
  await page.reload();
  await expect(switcherOf(page, first.name)).toBeVisible();
  const release = await heldBack(page, WORKSPACES_READ);

  await switcherOf(page, first.name).click();
  const menu = switcherMenuOf(page, first.name);
  await expect(workspacesIn(menu)).toHaveText([first.name]);
  await expect(menu.getByRole("menuitem")).toHaveText([ALL_WORKSPACES, CONSOLE.name]);
  await expect(saidInTheBand(page)).toHaveText(PICKER_WORDS.reading);
  await passesTheAccessibilityGate();

  release();

  await expect(workspacesIn(menu)).toHaveText([first.name, second.name]);
  await expect(menu).toBeVisible();
  await expect(saidInTheBand(page)).toBeEmpty();
});

test("says a refused switch in the band, keeping the screen", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Kept Foundry",
    second: "Left Foundry",
  });
  await aMemberOnlyOf(request, first.workspaceId, "Only In Kept");
  await page.reload();
  await expect(memberButton(page, "Only In Kept")).toBeVisible();

  await switcherOf(page, first.name).click();
  const leaving = workspacesIn(switcherMenuOf(page, first.name)).filter({ hasText: second.name });
  await expect(leaving).toBeVisible();
  await removeMember(request, { workspaceId: second.workspaceId, userId: first.admin.id });
  await leaving.click();

  await expect(refusedInTheBand(page)).toHaveText(sentenceOf(noLongerAMemberOf(second.name)));
  await expect(switcherOf(page, first.name), "focus left the switcher").toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
  await expect(memberButton(page, "Only In Kept")).toBeVisible();
  await passesTheAccessibilityGate();

  await switcherOf(page, first.name).click();
  await expect(workspacesIn(switcherMenuOf(page, first.name))).toHaveText([first.name]);
});

test("says an unanswered switch in the band, keeping the screen", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Steady Ironworks",
    second: "Unreached Ironworks",
  });
  await page.route("**/organization/set-active", (route) => route.abort());

  await switcherOf(page, first.name).click();
  await workspacesIn(switcherMenuOf(page, first.name)).filter({ hasText: second.name }).click();

  await expect(refusedInTheBand(page)).toHaveText(sentenceOf(PICK_REFUSED));
  await expect(switcherOf(page, first.name)).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
});

test("says an unread list, and how to read it again", async ({ page, request }) => {
  const { first } = await inTwoWorkspaces(page, request, {
    first: "Lune Toolmaking",
    second: "Wenning Toolmaking",
  });
  // A fresh document, so no list the picker read is held.
  await page.reload();
  await expect(switcherOf(page, first.name)).toBeVisible();
  await page.route(WORKSPACES_READ, (route) => route.abort());

  await switcherOf(page, first.name).click();

  await expect(refusedInTheBand(page)).toHaveText(sentenceOf(SWITCHER_UNREAD), {
    timeout: 15_000,
  });
  await expect(workspacesIn(switcherMenuOf(page, first.name))).toHaveText([first.name]);
});
