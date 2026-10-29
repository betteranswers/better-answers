import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, HOMES, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  allWorkspacesPicked,
  anAddress,
  inTwoWorkspaces,
  landedAtHome,
  markTheOperator,
  person,
  removeMember,
  saysARefusal,
  signOutFromTheShell,
  switched,
  switcherMenuOf,
  switcherOf,
} from "../harness.ts";
import { authAnswering } from "../refused-read.ts";

const SWITCH_BUDGET_MS = 1000;

const MEMBERS = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members");

const readOf =
  (procedure: string) =>
  (url: URL): boolean =>
    url.pathname.includes(procedure);

const MEMBER_READ = readOf("session.member");

const MEMBERS_READ = readOf("members.list");

const workspacesIn = (menu: Locator): Locator => menu.getByRole("menuitemradio");

const listedAs = (name: string, role: "Admin" | "Viewer"): string => `${name} ${role}`;

const saidInTheBand = (page: Page): Locator =>
  page.getByRole("banner").getByRole("status", { includeHidden: true });

const refusedInTheBand = (page: Page): Locator =>
  page.getByRole("banner").getByRole("alert", { includeHidden: true });

const NOT_A_MEMBER = "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION";

const memberLink = (page: Page, name: string): Locator =>
  page.getByRole("main").getByRole("link", { name, exact: true });

const aMemberOnlyOf = async (api: APIRequestContext, workspaceId: string, name: string) => {
  const member = await person(api, anAddress("only"), { displayName: name });
  await addMember(api, { workspaceId, userId: member.id, role: "Viewer" });
  return member.id;
};

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

test("lists the operator's workspaces and Console, others none", async ({ page, request }) => {
  const operator = await inTwoWorkspaces(page, request, {
    first: "Airedale Castings",
    second: "Nidderdale Tools",
  });
  await markTheOperator(request, operator.email);
  await page.reload();

  await switcherOf(page, operator.first.name).click();
  const menu = switcherMenuOf(page, operator.first.name);
  await expect(workspacesIn(menu)).toHaveText([
    listedAs(operator.first.name, "Admin"),
    listedAs(operator.second.name, "Admin"),
  ]);
  await expect(workspacesIn(menu).first()).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitem")).toHaveText(["All Workspaces", "Console"]);
  await page.keyboard.press("Escape");
  await expect(switcherOf(page, operator.first.name)).toBeFocused();
  await signOutFromTheShell(page, operator.first.admin.name);

  const other = await inTwoWorkspaces(page, request, {
    first: "Calder Presswork",
    second: "Colne Valley Forge",
  });
  await switcherOf(page, other.first.name).click();
  const theirs = switcherMenuOf(page, other.first.name);
  await expect(workspacesIn(theirs)).toHaveText([
    listedAs(other.first.name, "Admin"),
    listedAs(other.second.name, "Admin"),
  ]);
  await expect(theirs.getByRole("menuitem")).toHaveText(["All Workspaces"]);
});

test("switches to another workspace's home, reading its members", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Wharfe Joinery",
    second: "Aire Joinery",
  });
  await aMemberOnlyOf(request, first.workspaceId, "Only In Wharfe");
  await aMemberOnlyOf(request, second.workspaceId, "Only In Aire");
  await page.reload();
  await expect(memberLink(page, "Only In Wharfe")).toBeVisible();

  await switcherOf(page, first.name).click();
  const started = Date.now();
  await workspacesIn(switcherMenuOf(page, first.name)).filter({ hasText: second.name }).click();

  await expect(memberLink(page, "Only In Aire")).toBeVisible();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "switching workspace", description: `${elapsed} ms` });
  expect(elapsed, "the switch took longer than its second").toBeLessThan(SWITCH_BUDGET_MS);

  await landedAtHome(page, "Admin");
  await expect(memberLink(page, "Only In Wharfe")).toHaveCount(0);
  await expect(switcherOf(page, second.name)).toBeVisible();
  await expect(switcherOf(page, first.name)).toHaveCount(0);
  await expect(switcherOf(page, second.name)).toBeFocused();
});

test("switching from a member page lands home, showing no one", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Wharfe Ropery",
    second: "Aire Ropery",
  });
  const left = await aMemberOnlyOf(request, first.workspaceId, "Only In Wharfe");
  await page.goto(`${MEMBERS.path}/${left}`);
  await expect(
    page.getByRole("main").getByRole("heading", { level: 2, name: "Only In Wharfe" }),
  ).toBeVisible();

  await switched(page, first.name, second.name);

  await landedAtHome(page, "Admin");
  await expect(switcherOf(page, second.name)).toBeVisible();
  await expect(page.locator("body"), "drew a person from the left workspace").not.toContainText(
    "Only In Wharfe",
  );
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
  await expect(memberLink(page, "Only In Esk")).toBeVisible();
  const release = await heldBack(page, MEMBERS_READ);

  await allWorkspacesPicked(page, first.name);
  await page.getByRole("button", { name: second.name, exact: true }).click();

  await expect(switcherOf(page, second.name)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
  await expect(memberLink(page, "Only In Esk"), "drew the left workspace's members").toHaveCount(0);
  await page.getByRole("banner").getByRole("button", { name: "Jump To" }).click();
  const jumpTo = page.getByRole("dialog", { name: "Jump To" });
  await jumpTo.getByRole("combobox", { name: "Jump To" }).fill("Only In Esk");
  await expect(jumpTo.getByRole("status"), "jump-to says nothing of its read").toHaveText(/\S/);
  await expect(jumpTo.getByRole("status")).not.toContainText("Only In Esk");
  const members = jumpTo.getByRole("group", { name: "Members" });
  await expect(members, "jump-to offered the left workspace's members").toHaveCount(0);

  release();
  await jumpTo.getByRole("combobox", { name: "Jump To" }).fill("Only In Derwent");
  await expect(members).toContainText("Only In Derwent");
  await page.keyboard.press("Escape");
  await expect(memberLink(page, "Only In Derwent")).toBeVisible();
});

test("says a refused switch in the band, keeping the page", async ({
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
  await expect(memberLink(page, "Only In Kept")).toBeVisible();

  await switcherOf(page, first.name).click();
  const leaving = workspacesIn(switcherMenuOf(page, first.name)).filter({ hasText: second.name });
  await expect(leaving).toBeVisible();
  await removeMember(request, { workspaceId: second.workspaceId, userId: first.admin.id });
  const refused = authAnswering(page, "/organization/set-active");
  await leaving.click();

  expect(await refused).toMatchObject({ status: 403, code: NOT_A_MEMBER });
  await expect(refusedInTheBand(page)).toContainText(second.name);
  await expect(switcherOf(page, first.name), "focus left the switcher").toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
  await expect(memberLink(page, "Only In Kept")).toBeVisible();
  await passesTheAccessibilityGate();

  await switcherOf(page, first.name).click();
  await expect(workspacesIn(switcherMenuOf(page, first.name))).toHaveText([
    listedAs(first.name, "Admin"),
  ]);
});

const unansweredSwitch = async (page: Page, from: string, to: string): Promise<void> => {
  await page.route("**/organization/set-active", (route) => route.abort());
  await switched(page, from, to);
  await saysARefusal(refusedInTheBand(page));
};

test("says an unanswered switch in the band, keeping the page", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Steady Ironworks",
    second: "Unreached Ironworks",
  });

  await unansweredSwitch(page, first.name, second.name);

  await expect(switcherOf(page, first.name)).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Admin.path}$`));
});

test("drops the left workspace's name when the member read fails", async ({ page, request }) => {
  const { first, second } = await inTwoWorkspaces(page, request, {
    first: "Calder Wireworks",
    second: "Spen Wireworks",
  });
  await page.route(MEMBER_READ, (route) => route.abort());

  await switched(page, first.name, second.name);

  await expect(switcherOf(page, first.name), "the band still names the workspace left").toHaveCount(
    0,
    { timeout: 15_000 },
  );
  await expect(page.getByRole("heading", { level: 1, name: "This Page Didn’t Load" })).toBeVisible({
    timeout: 15_000,
  });
  await saysARefusal(page.getByRole("main").getByRole("alert"));

  await page.unroute(MEMBER_READ);
  await page.getByRole("button", { name: "Try Again" }).click();
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
  await page.route("**/organization/set-active", async (route) => {
    const answered = await route.fetch();
    await context.setOffline(true);
    await route.fulfill({ response: answered });
  });

  await switched(page, first.name, second.name);

  await expect(saidInTheBand(page), "the band says nothing of the switch").toHaveText(/\S/);
  await expect(switcherOf(page, first.name), "the band still names the workspace left").toHaveCount(
    0,
  );

  await context.setOffline(false);
  await landedAtHome(page, "Admin");
  await expect(switcherOf(page, second.name)).toBeVisible();
});
