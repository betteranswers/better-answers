import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { MEMBER_PAGE_KEYSTROKES, PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  ACTION_SAMPLES,
  actionClocked,
  addMember,
  anAddress,
  avatarOf,
  clockTheNextKey,
  confirmedWhenAsked,
  countOf,
  invite,
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  memberUnreadUntil,
  person,
  provision,
  saysARefusal,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
  theActionsLandedWithinTheirBudget,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

const people = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS_PAGE = pageNamed(people, "Members").path;

const roomBetween = async (above: Locator, below: Locator): Promise<number> => {
  const upper = await above.boundingBox();
  const lower = await below.boundingBox();
  return (lower?.y ?? 0) - ((upper?.y ?? 0) + (upper?.height ?? 0));
};

const pageRoom = () => ({
  scrolls: document.documentElement.scrollWidth,
  holds: document.documentElement.clientWidth,
});

const REMOVAL = (url: URL): boolean => url.pathname.includes("members.remove");

const nav = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const membersRegion = (page: Page) => page.getByRole("region", { name: "Members" });

const outcomeOf = (page: Page): Locator => membersRegion(page).getByRole("status").nth(1);

const selectionBar = (page: Page): Locator =>
  page.getByRole("toolbar", { name: "Selected Members" });

const describing = async (control: Locator): Promise<string> =>
  control
    .page()
    .locator(`[id="${(await control.getAttribute("aria-describedby")) ?? ""}"]`)
    .innerText();

const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search by name or address" });

const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator => memberRows(page).filter({ hasText: name });

const COLUMN = { Person: 1, Role: 2, Groups: 3, Joined: 4 } as const;

const cellOf = (page: Page, name: string, column: keyof typeof COLUMN): Locator =>
  rowOf(page, name).getByRole("cell").nth(COLUMN[column]);

const renderedLines = (text: Locator): Promise<string[]> =>
  text.evaluate((element) => {
    const lines: { top: number; text: string }[] = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const characters = node.textContent ?? "";
      for (let at = 0; at < characters.length; at += 1) {
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        const { top } = range.getBoundingClientRect();
        const line = lines.at(-1);
        if (line !== undefined && Math.abs(line.top - top) < 1) line.text += characters.charAt(at);
        else lines.push({ top, text: characters.charAt(at) });
      }
    }
    return lines.map((line) => line.text);
  });

const memberLink = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("link", { name, exact: true });

const listHeading = (page: Page): Locator =>
  membersRegion(page).getByRole("heading", { level: 2, name: "Members" });

const thePage = (page: Page): Locator => page.getByRole("main");

const memberPageAt = (personId: string): string => `${MEMBERS_PAGE}/${personId}`;

const personHeading = (page: Page, name: string): Locator =>
  thePage(page).getByRole("heading", { level: 2, name, exact: true });

const accessOf = (page: Page): Locator => thePage(page).getByRole("region", { name: "Access" });

const rolePicker = (page: Page): Locator => thePage(page).getByRole("radiogroup", { name: "Role" });

const rolePickerRegion = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: "Role", exact: true });

const changeRoleButton = (page: Page): Locator =>
  rolePickerRegion(page).getByRole("button", { name: "Change Role" });

const THE_ROLE_HELD = "//section[div[@data-slot='card-header']/h3[normalize-space(.)='Role']]//p";

const removalOf = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: "Removal", exact: true });

const confirmationOf = (page: Page, name: string): Locator =>
  removalOf(page).getByRole("group", { name: new RegExp(name) });

const THE_COUNT = "//section[h2='Members']/div/output";

const accessLine = (term: string): string =>
  `//section[h2='Access']//dt[normalize-space(.)='${term}']/following-sibling::dd[1]`;

const displayNameRegion = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: "Display Name" });

const activityOf = (page: Page): Locator => thePage(page).getByRole("region", { name: "Activity" });

const linesOf = (page: Page): Locator => activityOf(page).getByRole("listitem");

const AT_A_MEMBER_PAGE = new RegExp(`${MEMBERS_PAGE}/[0-9A-HJKMNP-TV-Z]{26}$`);

const openedByName = async (page: Page, name: string): Promise<void> => {
  await memberLink(page, name).click();
  await expect(page).toHaveURL(AT_A_MEMBER_PAGE);
  await expect(personHeading(page, name)).toBeVisible();
};

const backToMembers = async (page: Page): Promise<void> => {
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${MEMBERS_PAGE}(\\?[^#]*)?(#.*)?$`));
  await expect(listHeading(page)).toBeVisible();
};

type Joined = {
  readonly email: string;
  readonly displayName: string;
  readonly role: "Editor" | "Viewer";
};

const anAdminAtPeople = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
): Promise<{
  readonly admin: string;
  readonly adminId: string;
  readonly workspaceId: string;
  readonly joined: readonly (Joined & { readonly id: string })[];
  readonly stranger: string;
  readonly shortName: string;
}> => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: admin });
  const joining: readonly Joined[] = [
    { email: anAddress("priya"), displayName: "Priya Shah", role: "Editor" },
    { email: anAddress("sam"), displayName: "Sam Okoro", role: "Viewer" },
  ];
  const joined = [];
  for (const member of joining) {
    const made = await person(api, member.email, { displayName: member.displayName });
    await addMember(api, {
      workspaceId: workspace.workspaceId,
      userId: made.id,
      role: member.role,
    });
    joined.push({ ...member, id: made.id });
  }

  const elsewhere = await provision(api, { name: `Not ${workspaceName}` });
  const stranger = anAddress("stranger");
  const strangerMade = await person(api, stranger, { displayName: "Una Elsewhere" });
  await addMember(api, {
    workspaceId: elsewhere.workspaceId,
    userId: strangerMade.id,
    role: "Editor",
  });

  await page.goto("/sign-in");
  await signIn(page, api, admin);
  await nav(page).getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  return {
    admin,
    adminId: workspace.admin.id,
    workspaceId: workspace.workspaceId,
    joined,
    stranger,
    shortName: workspace.shortName,
  };
};

const saysToPickAMemberAfter = async (page: Page, key: string): Promise<void> => {
  await expect(outcomeOf(page)).toHaveText("");
  await page.keyboard.press(key);
  await expect(outcomeOf(page)).toHaveText(/\S/);
  await expect(page, "the keystroke left Members").toHaveURL(
    (url) => url.pathname === MEMBERS_PAGE,
  );
  await expect(selectionBar(page), "the keystroke selected a member").toHaveCount(0);
};

const skippedToMembers = async (page: Page, api: APIRequestContext, workspaceName: string) => {
  await anAdminAtPeople(page, api, workspaceName);
  await page.goto(MEMBERS_PAGE);
  await expect(memberRows(page)).toHaveCount(3);
  await skipLinkReachesThePage(page);
};

const anAdminBesideAnotherAtPeople = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
) => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: admin });
  const successor = await person(api, anAddress("ada"), { displayName: "Ada Hartley" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: successor.id, role: "Admin" });
  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, admin);
  await expect(memberRows(page)).toHaveCount(2);
  return workspace;
};

test.describe("the People group's Members page", () => {
  test("opens Members with its heading, tabs, count, then action", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Ribble Castings");
    await expect(memberRows(page)).toHaveCount(3);

    const main = page.getByRole("main", { name: "Page" });
    await expect(main).toMatchAriaSnapshot(`
      - main "Page":
        - heading "People" [level=1]
        - paragraph
        - tablist "Members":
          - tab "Members" [selected]
          - tab "Invitations"
          - tab "Requests"
        - tabpanel "Members":
          - region "Members":
            - heading "Members" [level=2]
            - status: /\\b3\\b/
            - button "Invite a Person"
            - searchbox "Search by name or address"
    `);
    await expect(main.getByText(/\b3 [a-z]/), "the count is said twice").toHaveCount(1);

    const heading = membersRegion(page).getByRole("heading", { level: 2, name: "Members" });
    expect((await heading.boundingBox())?.width, "the tab's name shows twice").toBeLessThanOrEqual(
      1,
    );
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Dales Engineering");

    const started = Date.now();
    await page.goto(MEMBERS_PAGE);
    await expect(memberRows(page)).toHaveCount(3);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "members list", description: `${elapsed} ms` });
    expect(elapsed, "the list of three members rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  test("lets an Admin reach and search members by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await skippedToMembers(page, request, "Calder Castings");

    const keystrokes = await keystrokesListed(page, "Members");
    await expect(keyListed(keystrokes, PEOPLE_KEYSTROKES.search.key)).toBeVisible();
    await keystrokesDismissed(page, keystrokes);

    await page.keyboard.press("/");
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.type("sam");
    await expect(memberRows(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(searchBox(page)).toHaveValue("");
    await expect(memberRows(page)).toHaveCount(3);

    await expect(membersRegion(page)).toMatchAriaSnapshot(`
      - region "Members":
        - heading "Members" [level=2]
        - status: /\\b3\\b/
        - button "Invite a Person"
        - searchbox "Search by name or address"
        - combobox "Filter by Role": Any Role
        - button "Columns"
        - table:
          - caption
          - rowgroup:
            - row:
              - columnheader "Select every member on this page":
                - checkbox "Select every member on this page"
              - columnheader "Person":
                - button "Person"
              - columnheader "Role":
                - button "Role"
              - columnheader "Groups"
              - columnheader "Joined":
                - button "Joined"
              - columnheader "Actions"
          - rowgroup:
            - row /Priya Shah/:
              - cell:
                - checkbox "Select Priya Shah"
              - cell /Priya Shah/:
                - link "Priya Shah"
              - cell "Editor"
              - cell "No group"
              - cell /\\d{4}/
              - cell:
                - button "Actions for Priya Shah"
            - row /Sam Okoro/:
              - cell:
                - checkbox "Select Sam Okoro"
              - cell /Sam Okoro/:
                - link "Sam Okoro"
              - cell "Viewer"
              - cell "No group"
              - cell /\\d{4}/
              - cell:
                - button "Actions for Sam Okoro"
            - row /Test person/:
              - cell:
                - checkbox "Select Test person"
              - cell /Test person/:
                - link "Test person"
              - cell "Admin"
              - cell "No group"
              - cell /\\d{4}/
              - cell:
                - button "Actions for Test person"
    `);

    await passesTheAccessibilityGate();
  });
});

const namesNoMember = async (page: Page): Promise<void> => {
  await expect(thePage(page).getByRole("link", { name: "Go to Members" })).toBeVisible();
  await expect(thePage(page).getByRole("heading", { level: 2 })).toHaveCount(0);
};

test.describe("a member's own page", () => {
  test("shows a member's role, groups and each role's meaning", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { joined } = await anAdminAtPeople(page, request, "Swale Forge");
    const priya = joined.find((member) => member.displayName === "Priya Shah");
    assert.ok(priya !== undefined, "Priya Shah was joined");

    await memberLink(page, "Priya Shah").focus();
    await page.keyboard.press(PEOPLE_KEYSTROKES.open.key);

    await expect(personHeading(page, "Priya Shah")).toBeFocused();
    await expect(thePage(page)).toContainText(priya.email);
    await expect(rolePicker(page).getByRole("radio")).toHaveCount(3);
    const meanings: string[] = [];
    for (const role of ["Admin", "Editor", "Viewer"]) {
      const radio = thePage(page).getByRole("radio", { name: role, exact: true });
      await expect(radio).toHaveAccessibleDescription(/\S/);
      meanings.push(await describing(radio));
    }
    expect(new Set(meanings).size, "two roles are described alike").toBe(3);
    await expect(thePage(page).getByRole("radio", { name: "Editor", exact: true })).toBeChecked();
    await expect(changeRoleButton(page)).toBeDisabled();
    await expect(
      thePage(page).getByText("Editor", { exact: true }),
      "the role is said outside the Role card",
    ).toHaveCount(1);
    await expect(accessOf(page).getByRole("term")).toHaveText([
      "Joined",
      "Sign-Ins and Personal Tokens Here",
    ]);

    await expect(thePage(page)).toMatchAriaSnapshot(`
      - main "Page":
        - heading "People" [level=1]
        - heading "Priya Shah" [level=2]
        - paragraph: /@/
        - navigation "On This Page":
          - list:
            - listitem:
              - link "Access"
            - listitem:
              - link "Activity"
            - listitem:
              - link "Remove and End Every Sign-In"
        - region "Access":
          - heading "Access" [level=2]
          - term
          - definition: /\\d{4}/
          - term
          - definition
          - region "Role":
            - heading "Role" [level=3]
            - radiogroup "Role":
              - radio "Admin"
              - radio "Editor" [checked]
              - radio "Viewer"
            - button "Change Role" [disabled]
            - paragraph: /Priya Shah.*Editor/
          - region "Groups":
            - heading "Groups" [level=3]
            - paragraph
            - link "Go to Groups"
          - region "Display Name":
            - heading "Display Name" [level=3]
            - paragraph
            - button "Flag Name"
            - paragraph
        - region "Activity":
          - heading "Activity" [level=2]
        - region "Remove and End Every Sign-In":
          - heading "Remove and End Every Sign-In" [level=2]
          - region "Sign-Ins and Personal Tokens":
            - heading "Sign-Ins and Personal Tokens" [level=3]
            - button "End Every Sign-In and Token Here"
            - paragraph: /Priya Shah/
          - region "Removal":
            - heading "Removal" [level=3]
            - paragraph: /Priya Shah/
            - button "Remove Member"
    `);
    await passesTheAccessibilityGate();

    await thePage(page).getByRole("link", { name: "Remove and End Every Sign-In" }).click();
    await expect(
      thePage(page).getByRole("heading", { level: 2, name: "Remove and End Every Sign-In" }),
    ).toBeFocused();
    await expect(page, "a section took an address of its own").toHaveURL(
      new RegExp(`${memberPageAt(priya.id)}$`),
    );
  });

  test("stacks header and sections at 320 pixels, scrolling nothing sideways", async ({
    page,
    request,
  }) => {
    await anAdminAtPeople(page, request, "Ure Ironmongers");
    await openedByName(page, "Priya Shah");
    await page.setViewportSize({ width: 320, height: 720 });

    const sections = thePage(page).getByRole("navigation", { name: "On This Page" });
    await expect
      .poll(() => roomBetween(personHeading(page, "Priya Shah"), sections), {
        message: "the section nav does not stack below the header",
      })
      .toBeGreaterThan(0);
    const room = await page.evaluate(pageRoom);
    expect(room.scrolls, "the page scrolls sideways").toBeLessThanOrEqual(room.holds);
  });

  test("draws a role pill square, the avatar and radios round", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Wharfe Gauges");
    const pill = rowOf(page, "Priya Shah").getByText("Editor", { exact: true });
    await expect(pill, "the kit's rounded-full on a pill").toHaveCSS("border-radius", "0px");

    await openedByName(page, "Priya Shah");
    const avatar = thePage(page).locator("[data-slot='avatar']");
    await expect(avatar, "the avatar, a kept circle").toHaveCSS("border-radius", "999px");
    await expect(
      thePage(page).getByRole("radio", { name: "Admin", exact: true }),
      "a radio, a kept circle",
    ).toHaveCSS("border-radius", "999px");
  });

  test("changes a member's role within its budget, and it holds", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Nidd Valley Casting");

    await openedByName(page, "Sam Okoro");
    await thePage(page).getByRole("radio", { name: "Editor", exact: true }).click();
    const commit = changeRoleButton(page);
    await commit.focus();
    await expect(commit).toHaveAccessibleDescription(/Sam Okoro.*Viewer/);
    await clockTheNextKey(page, { at: THE_ROLE_HELD, reads: "Editor" });
    await page.keyboard.press("Enter");

    await expect(rolePickerRegion(page).getByRole("status")).toHaveText(/Sam Okoro.*Editor/);
    await theActionLandedWithinItsBudget(page, "role change");
    await expect(thePage(page).getByRole("radio", { name: "Editor", exact: true })).toBeFocused();

    await page.reload();
    await expect(thePage(page).getByRole("radio", { name: "Editor", exact: true })).toBeChecked();
    await expect(changeRoleButton(page)).toHaveAccessibleDescription(/Sam Okoro.*Editor/);
    await backToMembers(page);
    await expect(cellOf(page, "Sam Okoro", "Role")).toHaveText("Editor");
  });

  test("opens a member and changes their role by keyboard alone", async ({ page, request }) => {
    await skippedToMembers(page, request, "Calder Rolling");

    await saysToPickAMemberAfter(page, PEOPLE_KEYSTROKES.changeRole.key);

    const keystrokes = await keystrokesListed(page, "Members");
    for (const { key } of [
      PEOPLE_KEYSTROKES.open,
      PEOPLE_KEYSTROKES.changeRole,
      PEOPLE_KEYSTROKES.endEverySignInAndToken,
      PEOPLE_KEYSTROKES.remove,
    ]) {
      await expect(keyListed(keystrokes, key), `the list holds no ${key}`).toBeVisible();
    }
    await expect(
      keyListed(keystrokes, PEOPLE_KEYSTROKES.approve.key),
      "the Requests tab's keystrokes on Members",
    ).toHaveCount(0);
    await keystrokesDismissed(page, keystrokes);

    await tabUntilFocused(page, memberLink(page, "Priya Shah"));
    await page.keyboard.press(PEOPLE_KEYSTROKES.changeRole.key);
    await expect(thePage(page).getByRole("radio", { name: "Editor", exact: true })).toBeFocused();
    // The group checks the radio it moves to, a task later, only while the arrow is still held.
    await page.keyboard.down("ArrowDown");
    await expect(thePage(page).getByRole("radio", { name: "Viewer", exact: true })).toBeChecked();
    await page.keyboard.up("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(changeRoleButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(rolePickerRegion(page).getByRole("status")).toHaveText(/Priya Shah.*Viewer/);

    const onThePage = await keystrokesListed(page, "Members");
    for (const { key } of Object.values(MEMBER_PAGE_KEYSTROKES)) {
      await expect(keyListed(onThePage, key), `the list holds no ${key}`).toBeVisible();
    }
    await keystrokesDismissed(page, onThePage);
    await page.keyboard.press(MEMBER_PAGE_KEYSTROKES.remove.key);
    await expect(removalOf(page).getByRole("button", { name: "Remove Member" })).toBeFocused();
    await page.keyboard.press(MEMBER_PAGE_KEYSTROKES.changeRole.key);
    await expect(thePage(page).getByRole("radio", { name: "Viewer", exact: true })).toBeFocused();

    await backToMembers(page);
    await expect(cellOf(page, "Priya Shah", "Role")).toHaveText("Viewer");
  });
});

test.describe("a member's Activity", () => {
  test("shows only joining, with no Load more", async ({ page, request }) => {
    const workspace = await provision(request, { name: "Holme Joinery" });
    const address = anAddress("ola");
    await person(request, address, { displayName: "Ola Brennan" });
    const invited = await invite(request, {
      workspaceId: workspace.workspaceId,
      email: address,
      inviterId: workspace.admin.id,
      role: "Admin",
    });
    await page.goto(`/invitations/${invited.id}`);
    await signIn(page, request, address);
    await page.getByRole("button", { name: "Join Workspace" }).click();
    await confirmedWhenAsked(page, request, address);
    await landedAtHome(page, "Admin");

    await openedByName(page, "Ola Brennan");

    await expect(linesOf(page)).toHaveCount(1);
    await expect(linesOf(page)).toContainText(/Ola Brennan.*Admin/);
    await expect(activityOf(page).getByRole("button", { name: "Load More" })).toHaveCount(0);
  });
});

const ENDED_AT = /\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}/;

const endButton = (page: Page): Locator =>
  thePage(page).getByRole("button", { name: "End Every Sign-In and Token Here" });

const credentialsRegion = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: "Sign-Ins and Personal Tokens" });

const anAdminWithAMemberOfTwo = async (page: Page, api: APIRequestContext) => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: "Swale Presswork", adminEmail: admin });
  const elsewhere = await provision(api, { name: "Zenith Tooling" });
  const priya = await person(api, anAddress("priya"), { displayName: "Priya Shah" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: priya.id, role: "Editor" });
  await addMember(api, { workspaceId: elsewhere.workspaceId, userId: priya.id, role: "Viewer" });
  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, admin);
  await expect(memberRows(page)).toHaveCount(2);
  return { elsewhere };
};

test.describe("ending every sign-in and token a member holds here", () => {
  test("ends a member's sign-ins within budget, and it holds", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { elsewhere } = await anAdminWithAMemberOfTwo(page, request);

    await openedByName(page, "Priya Shah");
    await expect(accessOf(page)).not.toContainText(ENDED_AT);
    const revoke = endButton(page);
    await revoke.focus();
    await clockTheNextKey(page, {
      at: accessLine("Sign-Ins and Personal Tokens Here"),
      reads: String(new Date().getFullYear()),
    });
    await page.keyboard.press("Enter");

    await expect(credentialsRegion(page).getByRole("status")).toContainText("Priya Shah");
    await theActionLandedWithinItsBudget(page, "revocation");
    await expect(revoke).toBeFocused();
    await expect(accessOf(page)).toContainText(ENDED_AT);
    await passesTheAccessibilityGate();
    await expect(page.locator("body")).not.toContainText(elsewhere.name);
    expect(await thePage(page).ariaSnapshot()).not.toContain(elsewhere.name);

    await page.reload();
    await expect(accessOf(page)).toContainText(ENDED_AT);
  });

  test("ends the Admin's own sign-ins, then admits a fresh one", async ({ page, request }) => {
    const admin = anAddress("admin");
    await provision(request, { name: "Esk Rolling", adminEmail: admin });
    await page.goto(MEMBERS_PAGE);
    await signIn(page, request, admin);
    await expect(memberRows(page)).toHaveCount(1);

    await openedByName(page, "Test person");
    const ownPage = page.url();
    await expect(endButton(page)).toHaveAccessibleDescription(/Test person/);
    const refused = refusalAnswering(page, "session.member");
    await endButton(page).click();

    expect(await refused).toMatchObject({ word: "credentials-revoked", class: "unauthenticated" });
    await saysARefusal(thePage(page).getByRole("alert"));
    await page.reload();
    await signIn(page, request, admin);
    await expect(page).toHaveURL(ownPage);
    await expect(personHeading(page, "Test person")).toBeVisible();
    await expect(accessOf(page)).toContainText(ENDED_AT);
  });
});

const removedAtAKey = async (
  page: Page,
  api: APIRequestContext,
  workspaceId: string,
): Promise<number[]> => {
  const names = Array.from(
    { length: ACTION_SAMPLES - 1 },
    (_unused, at) => `Extra ${String(at + 1)}`,
  );
  for (const displayName of names) {
    const made = await person(api, anAddress("extra"), { displayName });
    await addMember(api, { workspaceId, userId: made.id, role: "Viewer" });
  }
  const samples: number[] = [];
  for (const [at, name] of names.entries()) {
    const left = 1 + names.length - at;
    await page.reload();
    await memberLink(page, name).click();
    await expect(personHeading(page, name)).toBeVisible();
    await removalOf(page).getByRole("button", { name: "Remove Member" }).click();
    await removalOf(page).getByRole("button", { name: "Remove", exact: true }).focus();
    await clockTheNextKey(page, { at: THE_COUNT, reads: String(left) });
    const answered = page.waitForResponse((response) => REMOVAL(new URL(response.url())));
    await page.keyboard.press("Enter");
    await expect(memberRows(page)).toHaveCount(left);
    samples.push(await actionClocked(page));
    expect((await answered).ok(), `the removal of ${name} was refused`).toBe(true);
  }
  return samples;
};

test.describe("removing a member from their page", () => {
  test("removes a member behind a confirmation, within its budget", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { workspaceId } = await anAdminAtPeople(page, request, "Rye Foundry");
    const personHeader = membersRegion(page).getByRole("columnheader", { name: "Person" });
    await personHeader.getByRole("button").click();
    await personHeader.getByRole("button").click();
    await expect(personHeader).toHaveAttribute("aria-sort", "descending");
    const sorted = page.url();

    await openedByName(page, "Priya Shah");
    const priyasPage = page.url();
    const removal = removalOf(page);
    const asked = removal.getByRole("button", { name: "Remove Member" });
    await expect(asked).toHaveAccessibleDescription(/Priya Shah/);
    await asked.click();
    await expect(confirmationOf(page, "Priya Shah").locator("legend")).toBeFocused();
    await removal.getByRole("button", { name: "Keep Member" }).click();
    await expect(asked).toBeFocused();
    await expect(asked).toHaveAttribute("aria-expanded", "false");

    await asked.click();
    const confirm = removal.getByRole("button", { name: "Remove", exact: true });
    await expect(confirm).toHaveAccessibleDescription(/\S/);
    await expect(removal).toMatchAriaSnapshot(`
      - region "Removal":
        - heading "Removal" [level=3]
        - button "Remove Member" [expanded]
        - group "Remove Priya Shah":
          - button "Remove"
          - button "Keep Member"
    `);
    await passesTheAccessibilityGate();

    await confirm.focus();
    await clockTheNextKey(page, { at: THE_COUNT, reads: "2" });
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(sorted);
    await expect(memberRows(page)).toHaveCount(2);
    await expect(personHeader).toHaveAttribute("aria-sort", "descending");
    await expect(listHeading(page)).toBeFocused();
    await expect(outcomeOf(page)).toContainText("Priya Shah");
    const priyas = await actionClocked(page);

    await page.goBack();
    await expect(page).toHaveURL(priyasPage);
    await namesNoMember(page);

    await page.goto(MEMBERS_PAGE);
    await expect(memberRows(page)).toHaveCount(2);
    await expect(rowOf(page, "Priya Shah")).toHaveCount(0);

    const more = await removedAtAKey(page, request, workspaceId);
    theActionsLandedWithinTheirBudget("removal", [priyas, ...more]);
  });

  test("removes a member by keyboard alone", async ({ page, request }) => {
    await skippedToMembers(page, request, "Calder Presswork");

    await saysToPickAMemberAfter(page, PEOPLE_KEYSTROKES.remove.key);

    await tabUntilFocused(page, memberLink(page, "Sam Okoro"));
    await page.keyboard.press(PEOPLE_KEYSTROKES.remove.key);
    const removal = removalOf(page);
    await expect(removal.getByRole("button", { name: "Remove Member" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirmationOf(page, "Sam Okoro").locator("legend")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(removal.getByRole("button", { name: "Remove", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(new RegExp(`${MEMBERS_PAGE}$`));
    await expect(memberRows(page)).toHaveCount(2);
    await expect(listHeading(page)).toBeFocused();
  });
});

const ONE_GAP_PX = 16;

const bottomOf = async (drawn: Locator): Promise<number> => {
  const box = await drawn.boundingBox();
  return box === null ? Number.NaN : box.y + box.height;
};

const endsUnderItsLastLine = async (card: Locator, lastLine: Locator): Promise<void> => {
  const named = await card.getByRole("heading").innerText();
  await expect(card.getByRole("status"), `${named}: the empty outcome region`).toHaveText("");
  const [cardEnds, lineEnds] = await Promise.all([bottomOf(card), bottomOf(lastLine)]);
  expect(
    cardEnds - lineEnds,
    `${named}: an empty band stands under the card's last line`,
  ).toBeLessThanOrEqual(ONE_GAP_PX);
};

test.describe("a member's page before any action's outcome", () => {
  test("ends each card under its last line, its status standing", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Swale Bookbinders");
    await openedByName(page, "Priya Shah");

    for (const card of [rolePickerRegion(page), credentialsRegion(page), displayNameRegion(page)]) {
      await endsUnderItsLastLine(card, card.getByRole("paragraph").last());
    }
    await endsUnderItsLastLine(
      removalOf(page),
      removalOf(page).getByRole("button", { name: "Remove Member" }),
    );
  });
});

const tickOf = (page: Page, name: string) =>
  membersRegion(page).getByRole("checkbox", { name: `Select ${name}`, exact: true });

const selectionAction = (page: Page, action: string): Locator =>
  selectionBar(page).getByRole("button", { name: action, exact: true });

const linesIn = (dialog: Locator): Locator => dialog.getByRole("paragraph");

const changeRoleOpened = async (page: Page, titled: string): Promise<Locator> => {
  await selectionAction(page, "Change Role").click();
  const dialog = page.getByRole("dialog", { name: titled });
  await expect(dialog.getByRole("combobox", { name: "Role" })).toBeFocused();
  return dialog;
};

const removedThroughTheBar = async (page: Page, titled: string): Promise<void> => {
  await selectionAction(page, "Remove").click();
  await page
    .getByRole("dialog", { name: titled })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
};

const removedThemselfThroughTheBar = async (page: Page): Promise<void> => {
  await tickOf(page, "Test person").check();
  await removedThroughTheBar(page, "Remove 1 Member");
};

test.describe("bulk actions on the members ticked", () => {
  test("removing yourself before your membership reads lands on the chooser", async ({
    page,
    request,
  }) => {
    const workspace = await anAdminBesideAnotherAtPeople(page, request, "Esk Cordage");
    for (const name of ["Ure Cordage", "Nidd Cordage"]) {
      const other = await provision(request, { name });
      await addMember(request, {
        workspaceId: other.workspaceId,
        userId: workspace.admin.id,
        role: "Viewer",
      });
    }
    const read = Promise.withResolvers<void>();
    await memberUnreadUntil(page, read.promise);
    await page.reload();
    await expect(memberRows(page)).toHaveCount(2);

    await tickOf(page, "Test person").check();
    await expect(outcomeOf(page)).toHaveText("");
    await selectionAction(page, "Remove").click();
    await expect(outcomeOf(page), "Remove says to wait for your role").toHaveText(/\S/);
    await expect(page.getByRole("dialog"), "no confirmation opens unread").toHaveCount(0);
    read.resolve();
    await expect(avatarOf(page, "Test person")).toBeVisible();

    await removedThemselfThroughTheBar(page);

    await expect(page).toHaveURL(/\/choose-workspace$/);
  });

  test("bulk Remove names the count and opens on Cancel", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Rye Ropeworks");
    await tickOf(page, "Priya Shah").check();
    await tickOf(page, "Sam Okoro").check();

    const remove = selectionAction(page, "Remove");
    await remove.click();
    const dialog = page.getByRole("dialog", { name: "Remove 2 Members" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog).toHaveAccessibleDescription(/\S/);
    await expect(linesIn(dialog), "a line warns two others as it would the reader").toHaveCount(1);
    await passesTheAccessibilityGate();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();
    await expect(memberRows(page)).toHaveCount(3);

    await remove.click();
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(memberRows(page)).toHaveCount(1);
    await expect(outcomeOf(page), "the outcome counts two removed, and none skipped").toHaveText(
      /^\D*2\D*$/,
    );
    await expect(listHeading(page)).toBeFocused();
    await page.reload();
    await expect(memberRows(page)).toHaveCount(1);
  });

  test("ticks at the first click after a bulk role change", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Ribble Joinery");
    await tickOf(page, "Priya Shah").check();
    const dialog = await changeRoleOpened(page, "Change Role for 1 Member");
    await dialog.getByRole("button", { name: "Change Role", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(outcomeOf(page), "the outcome counts one changed").toHaveText(/^\D*1\D*$/);
    await expect(listHeading(page)).toBeFocused();
    await expect(
      countOf(membersRegion(page)).locator(".."),
      "focus on the tab's hidden heading draws no ring",
    ).not.toHaveCSS("box-shadow", "none");

    await tickOf(page, "Sam Okoro").click();
    await expect(tickOf(page, "Sam Okoro"), "the first click ticked nothing").toBeChecked();
  });

  test("at 320 pixels shows person and role, hiding the rest", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Ure Weaving");
    await expect(membersRegion(page).getByRole("columnheader", { name: "Joined" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 720 });

    const heads = membersRegion(page).getByRole("columnheader");
    await expect(heads.filter({ hasText: /^(Person|Role)$/ })).toHaveCount(2);
    await expect(heads.filter({ hasText: /^(Groups|Joined)$/ })).toHaveCount(0);
    const room = await page.evaluate(pageRoom);
    const tableRoom = await page
      .locator('[data-slot="table-container"]')
      .evaluate((table) => ({ scrolls: table.scrollWidth, holds: table.clientWidth }));
    expect(room.scrolls, "the page scrolls sideways").toBeLessThanOrEqual(room.holds);
    expect(tableRoom.scrolls, "the table scrolls sideways").toBeLessThanOrEqual(tableRoom.holds);

    await membersRegion(page).getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Groups" }).click();
    await page.keyboard.press("Escape");
    await expect(heads.filter({ hasText: /^Groups$/ })).toHaveCount(1);
  });

  test("wraps a long address between its parts at 390 pixels", async ({ page, request }) => {
    const { workspaceId } = await anAdminAtPeople(page, request, "Ure Spinning");
    const long = anAddress("oliver.bannerman.accountspayable");
    const made = await person(request, long, { displayName: "Oliver Bannerman" });
    await addMember(request, { workspaceId, userId: made.id, role: "Viewer" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();

    const address = cellOf(page, "Oliver Bannerman", "Person").getByText(long, { exact: true });
    await expect(address).toBeVisible();
    const lines = await renderedLines(address);
    expect(lines.join(""), "the address reads as other text").toBe(long);
    expect(lines.length, "the address fits one line, so no break is shown").toBeGreaterThan(1);
    for (const line of lines.slice(0, -1)) {
      expect(line, "a line of the address ends inside a word").toMatch(/[@.-]$/);
    }
  });
});
