import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { ALL_WORKSPACES, FAILED_SCREEN, JUMP_TO, ROLE_UNREAD } from "@/app/words.ts";
import { noLongerAMemberOf, PICK_REFUSED, SWITCHER_UNREAD } from "@/features/auth/refusal-words.ts";
import { PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { CONSOLE, CONTROL_CENTRE, HOMES } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  landedAtHome,
  markTheOperator,
  navOf,
  person,
  provision,
  railOf,
  removeMember,
  signIn,
  signOutFromTheShell,
  switcherMenuOf,
  switcherOf,
} from "./harness.ts";

const SWITCH_BUDGET_MS = 1000;

const WORKSPACES_READ = "**/organization/list";

/** Matched by name anywhere in the path, because the client batches its reads. */
const readOf =
  (procedure: string) =>
  (url: URL): boolean =>
    url.pathname.includes(procedure);

const MEMBERSHIP_READ = readOf("session.membership");

const MEMBERS_READ = readOf("members.list");

const workspacesIn = (menu: Locator): Locator => menu.getByRole("menuitemradio");

const switched = async (page: Page, from: string, to: string): Promise<void> => {
  await switcherOf(page, from).click();
  await workspacesIn(switcherMenuOf(page, from)).filter({ hasText: to }).click();
};

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
const heldBack = async (page: Page, url: Parameters<Page["route"]>[0]): Promise<() => void> => {
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

  await switched(page, first.name, second.name);

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

test("drops the left workspace's members when All workspaces picks another", async ({
  page,
  request,
}) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Esk Castings",
    second: "Derwent Castings",
  });
  await aMemberOnlyOf(request, first.workspaceId, "Only In Esk");
  await aMemberOnlyOf(request, second.workspaceId, "Only In Derwent");
  await page.reload();
  await expect(memberButton(page, "Only In Esk")).toBeVisible();
  // Held, so whatever the screen draws before the new workspace's list lands is on show.
  const release = await heldBack(page, MEMBERS_READ);

  await switcherOf(page, first.name).click();
  await switcherMenuOf(page, first.name).getByRole("menuitem", { name: ALL_WORKSPACES }).click();
  await page.getByRole("button", { name: second.name, exact: true }).click();

  await expect(switcherOf(page, second.name)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
  await expect(memberButton(page, "Only In Esk"), "drew the left workspace's members").toHaveCount(
    0,
  );
  await page.getByRole("banner").getByRole("button", { name: JUMP_TO.name }).click();
  const jumpTo = page.getByRole("dialog", { name: JUMP_TO.name });
  await jumpTo.getByRole("combobox", { name: JUMP_TO.name }).fill("Only In Esk");
  await expect(jumpTo.getByRole("status")).toHaveText(JUMP_TO.membersLoading);
  await expect(
    jumpTo.getByRole("option", { name: /Only In Esk/ }),
    "jump-to offered the left workspace's members",
  ).toHaveCount(0);

  release();
  await page.keyboard.press("Escape");
  await expect(memberButton(page, "Only In Derwent")).toBeVisible();
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

test("says a pending switch's refusal, holding others until it answers", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { email, first, second } = await inTwoWorkspaces(page, request, {
    first: "Settle Castings",
    second: "Giggleswick Castings",
  });
  // The operator, so the menu offers both of its ways out of the shell.
  await markTheOperator(request, email);
  await page.reload();
  await expect(switcherOf(page, first.name)).toBeVisible();
  const switches: string[] = [];
  page.on("request", (sent) => {
    if (sent.url().includes("/organization/set-active")) switches.push(sent.url());
  });
  const release = await heldBack(page, "**/organization/set-active");

  await switched(page, first.name, second.name);
  await expect(saidInTheBand(page)).toHaveText(PICKER_WORDS.opening);

  await switcherOf(page, first.name).click();
  const menu = switcherMenuOf(page, first.name);
  await expect(saidInTheBand(page), "opening the menu forgot the pending switch").toHaveText(
    PICKER_WORDS.opening,
  );
  await expect(workspacesIn(menu)).toHaveText([first.name, second.name]);
  for (const workspace of await workspacesIn(menu).all()) {
    await expect(workspace).toHaveAttribute("aria-disabled", "true");
  }
  await expect(menu.getByRole("menuitem")).toHaveText([ALL_WORKSPACES, CONSOLE.name]);
  for (const wayOut of await menu.getByRole("menuitem").all()) {
    await expect(wayOut, "a way out of the shell is open mid-switch").toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }
  await passesTheAccessibilityGate();
  await page.keyboard.press("Escape");

  await removeMember(request, { workspaceId: second.workspaceId, userId: first.admin.id });
  release();

  await expect(refusedInTheBand(page), "the first switch's refusal was lost").toHaveText(
    sentenceOf(noLongerAMemberOf(second.name)),
  );
  await expect(switcherOf(page, first.name)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
  expect(switches, "a second switch started while the first was pending").toHaveLength(1);
});

/** Unanswered, so the refusal stands in the band's outcome row. */
const unansweredSwitch = async (page: Page, from: string, to: string): Promise<void> => {
  await page.route("**/organization/set-active", (route) => route.abort());
  await switched(page, from, to);
  await expect(refusedInTheBand(page)).toHaveText(sentenceOf(PICK_REFUSED));
};

test("says an unanswered switch in the band, keeping the screen", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Steady Ironworks",
    second: "Unreached Ironworks",
  });

  await unansweredSwitch(page, first.name, second.name);

  await expect(switcherOf(page, first.name)).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
});

/** Layout places each edge to a fraction of a pixel, so two that meet may part by less than one. */
const SUBPIXEL = 0.5;

const boxOf = async (region: Locator) => {
  const box = await region.boundingBox();
  if (box === null) throw new Error(`${String(region)} is not drawn`);
  return box;
};

/** How far `region` starts below the band's foot: below zero, the band covers its top. */
const clearOfTheBand = async (page: Page, region: Locator): Promise<number> => {
  const [band, drawn] = await Promise.all([boxOf(page.getByRole("banner")), boxOf(region)]);
  return drawn.y - (band.y + band.height);
};

test("keeps the rail and nav below the band's refusal", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Marsden Presswork",
    second: "Slaithwaite Presswork",
  });
  // Rows enough that the screen scrolls past the band in a short window.
  for (let row = 1; row <= 4; row += 1) {
    await aMemberOnlyOf(request, first.workspaceId, `Row ${String(row)}`);
  }
  await page.reload();
  await expect(memberButton(page, "Row 4")).toBeVisible();

  await unansweredSwitch(page, first.name, second.name);

  await page.setViewportSize({ width: 1280, height: 240 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const band = await boxOf(page.getByRole("banner"));
  await expect
    .poll(() => page.evaluate(() => window.scrollY), {
      message: "the screen never scrolled past the band",
    })
    .toBeGreaterThan(band.height);

  for (const region of [railOf(page), navOf(page, CONTROL_CENTRE)]) {
    await expect
      .poll(() => clearOfTheBand(page, region), {
        message: `the band's outcome row covers the top of ${String(region)}`,
      })
      .toBeGreaterThanOrEqual(-SUBPIXEL);
  }
});

test("drops the left workspace's name when the membership read fails", async ({
  page,
  request,
}) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Calder Wireworks",
    second: "Spen Wireworks",
  });
  await page.route(MEMBERSHIP_READ, (route) => route.abort());

  await switched(page, first.name, second.name);

  // The switch's read and then the shell's each ask again twice before they give up.
  await expect(switcherOf(page, first.name), "the band still names the workspace left").toHaveCount(
    0,
    { timeout: 15_000 },
  );
  await expect(page.getByRole("heading", { level: 1, name: FAILED_SCREEN.heading })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(ROLE_UNREAD);

  await page.unroute(MEMBERSHIP_READ);
  await page.getByRole("button", { name: FAILED_SCREEN.retry }).click();
  await landedAtHome(page, "Admin");
  await expect(switcherOf(page, second.name)).toBeVisible();
});

test("drops the left workspace's name while the switch waits offline", async ({
  page,
  context,
  request,
}) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Hebden Wireworks",
    second: "Ryburn Wireworks",
  });
  // Offline once the pick has landed, so the membership read is the one that waits.
  await page.route("**/organization/set-active", async (route) => {
    const answered = await route.fetch();
    await context.setOffline(true);
    await route.fulfill({ response: answered });
  });

  await switched(page, first.name, second.name);

  await expect(saidInTheBand(page)).toHaveText(PICKER_WORDS.opening);
  await expect(switcherOf(page, first.name), "the band still names the workspace left").toHaveCount(
    0,
  );

  await context.setOffline(false);
  await landedAtHome(page, "Admin");
  await expect(switcherOf(page, second.name)).toBeVisible();
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
