import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page, Route } from "@playwright/test";

import { MEMBER_PAGE_KEYSTROKES, PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  ACTION_SAMPLES,
  actionClocked,
  addMember,
  anAddress,
  askToJoin,
  avatarOf,
  clockTheNextKey,
  confirmedWhenAsked,
  countOf,
  editorPickedByKeyboard,
  invite,
  keepsItsWordOffThePage,
  keyListed,
  keystrokesButton,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  makeGroups,
  memberUnreadUntil,
  person,
  provision,
  removeMember,
  saysARefusal,
  signIn,
  skipLinkReachesThePage,
  switcherMenuOf,
  switcherOf,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
  theActionsLandedWithinTheirBudget,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

const people = menuGroupIn(CONTROL_CENTRE, "people");

const MEMBERS_PAGE = pageNamed(people, "Members").path;

const AUDIT_LOG_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), "Audit Log").path;

const GROUPS_PAGE = pageNamed(people, "Groups").path;

/** Matched by name anywhere in the path, because the tRPC client batches its reads. */
const MEMBER_READ = (url: URL): boolean => url.pathname.includes("session.member");

const droppingTheFirst = () => {
  let dropped = false;
  return (route: Route) => {
    if (dropped) return route.continue();
    dropped = true;
    return route.abort();
  };
};

const roomBetween = async (above: Locator, below: Locator): Promise<number> => {
  const upper = await above.boundingBox();
  const lower = await below.boundingBox();
  return (lower?.y ?? 0) - ((upper?.y ?? 0) + (upper?.height ?? 0));
};

const pageRoom = () => ({
  scrolls: document.documentElement.scrollWidth,
  holds: document.documentElement.clientWidth,
});

const MEMBERS_READ = (url: URL): boolean => url.pathname.includes("members.list");

const REMOVAL = (url: URL): boolean => url.pathname.includes("members.remove");

const answeredChangedMeanwhile = (
  page: Page,
  action: (url: URL) => boolean,
  held: Promise<void> = Promise.resolve(),
  items?: Readonly<Record<string, string>>,
) =>
  page.route(action, async (route) => {
    await held;
    await route.fulfill({
      status: 409,
      json: [
        {
          error: {
            message: "changed-meanwhile",
            code: -32_603,
            data: {
              code: "CONFLICT",
              httpStatus: 409,
              refusal: { word: "changed-meanwhile", class: "conflict", items },
            },
          },
        },
      ],
    });
  });

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

const flagButton = (page: Page): Locator =>
  thePage(page).getByRole("button", { name: "Flag Name" });

const activityOf = (page: Page): Locator => thePage(page).getByRole("region", { name: "Activity" });

const linesOf = (page: Page): Locator => activityOf(page).getByRole("listitem");

const readWithNoLine = async (page: Page, name: string): Promise<void> => {
  await expect(activityOf(page), "the empty Activity says nothing of the member").toContainText(
    name,
  );
  await expect(activityOf(page).getByRole("status")).toHaveCount(0);
  await expect(activityOf(page).getByRole("alert")).toHaveCount(0);
  await expect(linesOf(page)).toHaveCount(0);
};

const linesWithinTheBudget = async (
  page: Page,
  what: string,
  ask: () => Promise<unknown>,
  count: number,
): Promise<void> => {
  const started = Date.now();
  await ask();
  await expect(linesOf(page)).toHaveCount(count);
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: what, description: `${elapsed} ms` });
  expect(elapsed, `${what} drew past the list's budget`).toBeLessThan(LIST_BUDGET_MS);
};

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

const saysTheirRoleNow = (page: Page, role: string): Promise<void> =>
  expect(page.getByRole("status").filter({ hasText: /\S/ })).toHaveText(
    new RegExp(String.raw`\b${role}\b`),
  );

const removedThroughTheirPage = async (page: Page, name: string): Promise<void> => {
  await openedByName(page, name);
  const removal = removalOf(page);
  await removal.getByRole("button", { name: "Remove Member" }).click();
  await removal.getByRole("button", { name: "Remove", exact: true }).click();
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

  test("searches by name or address, and says when none match", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { joined } = await anAdminAtPeople(page, request, "Wharfe Fabrication");
    const sam = joined.find((member) => member.displayName === "Sam Okoro");
    assert.ok(sam !== undefined, "Sam Okoro was joined");

    await searchBox(page).fill("PRIY");
    await clockTheNextKey(page, { at: THE_COUNT, reads: "PRIYA" });
    await searchBox(page).press("A");
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Priya Shah")).toBeVisible();
    await expect(countOf(membersRegion(page)), "the count says one of three match").toHaveText(
      /\b1\b\D+\b3\b/,
    );
    await theActionLandedWithinItsBudget(page, "search");

    await searchBox(page).fill(sam.email.slice(0, 12));
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Sam Okoro")).toBeVisible();

    await searchBox(page).fill("nobody by this name");
    await expect(membersRegion(page).getByRole("link")).toHaveCount(0);
    await expect(membersRegion(page), "the empty list names no search").toContainText(
      "nobody by this name",
    );
    await passesTheAccessibilityGate();
    await membersRegion(page).getByRole("button", { name: "Clear Filters" }).click();

    await expect(memberRows(page)).toHaveCount(3);
    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page)).toBeFocused();
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

const crumbsOf = (page: Page): Locator =>
  page.getByRole("banner").getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem");

const A_PERSON_NOWHERE = "01JBZ6Q2V7Y9K3M5N8P0R2T4W6";

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

  test("names no one at an unknown id, leading to Members", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Swale Ropers");

    await page.goto(memberPageAt(A_PERSON_NOWHERE));

    await namesNoMember(page);
    await expect(crumbsOf(page).last()).toHaveText("Members");
    await passesTheAccessibilityGate();
    await thePage(page).getByRole("link", { name: "Go to Members" }).click();
    await expect(page).toHaveURL(new RegExp(`${MEMBERS_PAGE}$`));
    await expect(memberRows(page)).toHaveCount(3);
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

  test("refuses demoting the last Admin, and says what comes next", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Ure Mill Tools");

    await openedByName(page, "Test person");
    await thePage(page).getByRole("radio", { name: "Viewer", exact: true }).click();
    const refused = refusalAnswering(page, "members.changeRole");
    await changeRoleButton(page).click();

    expect(await refused).toMatchObject({ word: "last-admin" });
    await saysARefusal(rolePickerRegion(page).getByRole("alert"));
    await keepsItsWordOffThePage(page, "last-admin");
    await passesTheAccessibilityGate();
    await expect(changeRoleButton(page)).toHaveAccessibleDescription(/Test person.*Admin/);
    await thePage(page).getByRole("radio", { name: "Admin", exact: true }).click();
    await expect(changeRoleButton(page)).toHaveAccessibleDescription(/Test person.*Admin/);
  });

  test("arriving unread, demoting yourself still lands on Editor's home", async ({
    page,
    request,
  }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Ure Presswork");
    await openedByName(page, "Test person");
    await page.route(MEMBER_READ, droppingTheFirst());
    await page.reload();
    await expect(personHeading(page, "Test person")).toBeVisible();

    await thePage(page).getByRole("radio", { name: "Editor", exact: true }).click();
    await changeRoleButton(page).click();

    await landedAtHome(page, "Editor");
    await saysTheirRoleNow(page, "Editor");
  });

  test("lists Members' keystrokes from the rail's foot, as ? does", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Calder Looms");
    await expect(memberRows(page)).toHaveCount(3);

    await expect(keystrokesButton(page)).toHaveCount(1);
    const inTheRail = page
      .getByRole("navigation", { name: "Areas" })
      .getByRole("button", { name: "Keyboard Shortcuts" });
    await expect(inTheRail).toHaveAttribute("aria-keyshortcuts", "?");

    await inTheRail.click();
    const clicked = page.getByRole("dialog", { name: "Keyboard Shortcuts on Members" });
    await expect(keyListed(clicked, PEOPLE_KEYSTROKES.open.key)).toBeVisible();
    await expect(clicked).toContainText("Jump To");
    await passesTheAccessibilityGate();
    const listedOnClick = await clicked.ariaSnapshot();
    await keystrokesDismissed(page, clicked);

    const pressed = await keystrokesListed(page, "Members");
    expect(await pressed.ariaSnapshot(), "? lists other keystrokes than the button").toBe(
      listedOnClick,
    );
    await keystrokesDismissed(page, pressed);
    await expect(inTheRail).toBeFocused();
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
  test("a role change shows on both members' Activity", async ({ page, request }) => {
    const { workspaceId } = await provision(request, { name: "Swale Brassworks" });
    const hannahAt = anAddress("hannah");
    const hannah = await person(request, hannahAt, { displayName: "Hannah Wright" });
    const priya = await person(request, anAddress("priya"), { displayName: "Priya Shah" });
    await addMember(request, { workspaceId, userId: hannah.id, role: "Admin" });
    await addMember(request, { workspaceId, userId: priya.id, role: "Viewer" });
    await page.goto(memberPageAt(priya.id));
    await signIn(page, request, hannahAt);
    await readWithNoLine(page, "Priya Shah");

    await thePage(page).getByRole("radio", { name: "Editor", exact: true }).click();
    await changeRoleButton(page).click();

    const byHannahToPriya = /Hannah Wright.*Priya Shah.*Editor/;
    await expect(linesOf(page)).toHaveCount(1);
    await expect(linesOf(page)).toContainText(byHannahToPriya);
    const lineOnPriyas = await linesOf(page).textContent();
    assert.ok(lineOnPriyas !== null, "Priya's activity holds a line");
    const saidOnPriyas = lineOnPriyas.replace(/^\d{2}:\d{2}/, "");

    await page.goto(memberPageAt(hannah.id));
    await expect(personHeading(page, "Hannah Wright")).toBeVisible();
    await expect(activityOf(page)).toMatchAriaSnapshot(`
      - region "Activity":
        - heading "Activity" [level=2]
        - heading /\\w+day \\d{1,2} \\w+ \\d{4}/ [level=3]
        - list:
          - listitem:
            - time: /\\d{2}:\\d{2}/
    `);
    await expect(linesOf(page)).toContainText(byHannahToPriya);
    await expect(linesOf(page), "Hannah's page says the line as Priya's does").not.toContainText(
      saidOnPriyas,
    );
  });

  test("Load more lands focus on the first older line", async ({ page, request }) => {
    const { workspaceId, adminId } = await anAdminAtPeople(page, request, "Calder Crewing");
    const names = Array.from({ length: 51 }, (_, index) => `Crew ${String(index + 1)}`);
    await makeGroups(request, { workspaceId, userId: adminId, names });

    await linesWithinTheBudget(page, "activity", () => page.goto(memberPageAt(adminId)), 50);
    const loadMore = activityOf(page).getByRole("button", { name: "Load More" });
    await expect(loadMore).toHaveAttribute(
      "aria-keyshortcuts",
      MEMBER_PAGE_KEYSTROKES.olderActivity.key,
    );

    const { key } = MEMBER_PAGE_KEYSTROKES.olderActivity;
    await linesWithinTheBudget(page, "older activity", () => page.keyboard.press(key), 52);
    await expect(linesOf(page).nth(50), "focus did not land on the first older line").toBeFocused();
    await expect(loadMore).toHaveCount(0);
  });

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

  test("keeps the access request they made before joining", async ({ page, request }) => {
    const { workspaceId, shortName } = await anAdminAtPeople(page, request, "Swale Wheelwrights");
    const asker = await person(request, anAddress("asker"), { displayName: "Ola Asker" });
    await askToJoin(request, {
      shortName,
      requesterId: asker.id,
      reason: "I run the night shift.",
    });
    await addMember(request, { workspaceId, userId: asker.id, role: "Viewer" });

    await page.goto(memberPageAt(asker.id));

    await expect(linesOf(page)).toHaveCount(1);
    await expect(linesOf(page)).toContainText("Ola Asker");
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

  test("says on Members why a removal was refused, row restored", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Rye Ropery");
    await answeredChangedMeanwhile(page, REMOVAL);

    const refused = refusalAnswering(page, "members.remove");
    await removedThroughTheirPage(page, "Priya Shah");

    expect(await refused).toMatchObject({ word: "changed-meanwhile" });
    await expect(page).toHaveURL(new RegExp(`${MEMBERS_PAGE}$`));
    await saysARefusal(membersRegion(page).getByRole("alert"));
    await keepsItsWordOffThePage(page, "changed-meanwhile");
    await expect(rowOf(page, "Priya Shah")).toBeVisible();
    await expect(memberRows(page)).toHaveCount(3);
    await passesTheAccessibilityGate();
  });

  test("refuses removing the last Admin, and keeps them", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Hodder Tools");

    const refused = refusalAnswering(page, "members.remove");
    await removedThroughTheirPage(page, "Test person");

    expect(await refused).toMatchObject({ word: "last-admin", class: "precondition" });
    await saysARefusal(removalOf(page).getByRole("alert"));
    await expect(page).toHaveURL(AT_A_MEMBER_PAGE);
    await expect(changeRoleButton(page)).toHaveAccessibleDescription(/Test person.*Admin/);
    await passesTheAccessibilityGate();
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

test.describe("a member's display name, flagged to better-answers support", () => {
  test("flags a member's name within budget, and again answers alike", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Swale Signworks");
    await openedByName(page, "Sam Okoro");
    const said = displayNameRegion(page).getByRole("status");

    await flagButton(page).focus();
    await expect(said).toHaveText("");
    await clockTheNextKey(page, {
      at: "//section[div[@data-slot='card-header']/h3[normalize-space(.)='Display Name']][.//output[normalize-space(.)!='']]",
      reads: "Display Name",
    });
    await page.keyboard.press("Enter");

    await expect(said).toHaveText(/\S/);
    await theActionLandedWithinItsBudget(page, "name flag");
    await expect(flagButton(page)).toBeFocused();
    const saidOnce = await said.innerText();

    await page.keyboard.press("Enter");
    await expect(said, "a second flag answers as the first did").toHaveText(saidOnce);
    await expect(displayNameRegion(page).getByRole("alert")).toHaveCount(0);
    await expect(personHeading(page, "Sam Okoro")).toBeVisible();
    await passesTheAccessibilityGate();
  });

  test("refuses a member removed meanwhile, saying why and what next", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { workspaceId, joined } = await anAdminAtPeople(page, request, "Swale Stonecraft");
    const sam = joined.find((member) => member.displayName === "Sam Okoro");
    assert.ok(sam !== undefined, "Sam Okoro was joined");
    await page.route(MEMBERS_READ, () => Promise.withResolvers<void>().promise);
    await openedByName(page, "Sam Okoro");
    await removeMember(request, { workspaceId, userId: sam.id });

    const refused = refusalAnswering(page, "members.flagDisplayName");
    await flagButton(page).click();

    expect(await refused).toMatchObject({ word: "no-such-member" });
    await saysARefusal(displayNameRegion(page).getByRole("alert"));
    await expect(displayNameRegion(page).getByRole("status")).toHaveText("");
    await passesTheAccessibilityGate();
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

test.describe("the People page's words", () => {
  test("says workspace, never organisation, on every People page", async ({ page, request }) => {
    const { admin, shortName } = await anAdminAtPeople(page, request, "Ryedale Metalwork");
    const organisation = /organi[sz]ation/i;

    const said = async (where: string) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("body"), where).not.toContainText(organisation);
      expect(await page.locator("body").ariaSnapshot(), where).not.toMatch(organisation);
    };

    for (const each of people.pages.filter((candidate) => candidate.built)) {
      await page.goto(each.path);
      await said(each.path);
    }

    await page.goto(MEMBERS_PAGE);
    await expect(memberRows(page)).toHaveCount(3);
    for (const tab of ["Members", "Invitations", "Requests"]) {
      await page.getByRole("tab", { name: tab }).click();
      await said(`${MEMBERS_PAGE}, the ${tab} tab`);
    }

    await page.getByRole("tab", { name: "Members" }).click();
    await openedByName(page, "Priya Shah");
    await removalOf(page).getByRole("button", { name: "Remove Member" }).click();
    await expect(removalOf(page).getByRole("group")).toBeVisible();
    await said("a member's page");

    await page.goto(AUDIT_LOG_PAGE);
    const auditLog = page.getByRole("region", { name: "Audit Log" });
    await expect(auditLog.getByRole("listitem")).toHaveCount(1);
    await auditLog.getByRole("button", { name: /^Details of/ }).click();
    await expect(auditLog.getByRole("term").first()).toBeVisible();
    await said(`${AUDIT_LOG_PAGE}, an event opened`);
    await auditLog.getByRole("combobox", { name: "Filter by Family" }).click();
    await expect(page.getByRole("listbox"), "the families listed").not.toContainText(organisation);
    await page.keyboard.press("Escape");

    await page.goto(MEMBERS_PAGE);
    await openedByName(page, "Priya Shah");
    await endButton(page).click();
    await expect(accessOf(page)).toContainText(ENDED_AT);
    await said("a revocation");

    await page.goto(AUDIT_LOG_PAGE);
    await expect(auditLog.getByRole("listitem").first()).toContainText(/Test person.*Priya Shah/);
    await said(`${AUDIT_LOG_PAGE}, a revocation logged`);

    // A modal hides the page behind it from the tree, so each one is read on its own.
    const saidIn = async (modal: Locator, where: string) => {
      await expect(modal).toBeVisible();
      await expect(page.locator("body"), where).not.toContainText(organisation);
      expect(await modal.ariaSnapshot(), where).not.toMatch(organisation);
    };

    await page.goto(MEMBERS_PAGE);
    await expect(memberRows(page)).toHaveCount(3);
    const inviting = page.getByRole("dialog", { name: "Invite a Person" });
    await page.getByRole("tab", { name: "Invitations" }).click();
    await page.getByRole("button", { name: "Invite a Person" }).click();
    await saidIn(inviting, "the invite dialog");
    await inviting.getByLabel("Email Addresses").fill(anAddress("invited"));
    await inviting.getByRole("button", { name: "Send Invitation" }).click();
    await expect(inviting.getByRole("button", { name: "Done" })).toBeVisible();
    await saidIn(inviting, "the invite dialog's answer");
    await inviting.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("region", { name: "Invitations" }).getByRole("row")).toHaveCount(2);
    await said("the Invitations tab with an invitation waiting");

    const askerAt = anAddress("asker");
    const asker = await person(request, askerAt, { displayName: "Ola Asker" });
    await askToJoin(request, {
      shortName,
      requesterId: asker.id,
      reason: "I bid for the rail work.",
    });
    await page.getByRole("tab", { name: "Requests" }).click();
    await expect(page.getByRole("region", { name: "Requests" }).getByRole("row")).toHaveCount(2);
    await said("the Requests tab with a request waiting");
    const approving = page.getByRole("dialog", { name: "Approve Request from Ola Asker" });
    await page.getByRole("button", { name: "Approve Request from Ola Asker" }).click();
    await saidIn(approving, "the approve dialog");
    await approving.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(approving).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Requests" }).getByRole("status").last(),
    ).toContainText(askerAt);
    await said("the Requests tab once the request is approved");

    await page.goto(GROUPS_PAGE);
    const creating = page.getByRole("dialog", { name: "Create a Group" });
    await page.getByRole("button", { name: "Create a Group" }).click();
    await creating.getByLabel("New Group Name").fill("Site leads");
    await creating.getByLabel("New Group Name").press("Enter");
    await expect(creating).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Site leads", exact: true })).toBeFocused();
    await said(`${GROUPS_PAGE}, a group created`);
    await page.getByRole("button", { name: "Site leads", exact: true }).click();
    const group = page.getByRole("dialog", { name: "Site leads" });
    await saidIn(group, "a group's sheet");
    await group.getByRole("button", { name: "Delete Group" }).click();
    await saidIn(
      page.getByRole("alertdialog", { name: "Delete Site leads" }),
      "a group's deletion",
    );

    const saidOnTheAcceptPage = async (where: string) => {
      await expect(page.locator("body"), where).not.toContainText(organisation);
      expect(await page.locator("body").ariaSnapshot(), where).not.toMatch(organisation);
    };
    const elsewhere = await provision(request, { name: "Wolds Fabrication" });
    const toJoin = await invite(request, {
      workspaceId: elsewhere.workspaceId,
      email: admin,
      inviterId: elsewhere.admin.id,
      role: "Viewer",
    });
    const forSomeoneElse = await invite(request, {
      workspaceId: elsewhere.workspaceId,
      email: anAddress("someone-else"),
      inviterId: elsewhere.admin.id,
      role: "Viewer",
    });
    await page.goto(`/invitations/${toJoin.id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Your Invitation to Wolds Fabrication" }),
    ).toBeVisible();
    await saidOnTheAcceptPage("the accept page");
    const refused = refusalAnswering(page, "person.invitation");
    await page.goto(`/invitations/${forSomeoneElse.id}`);
    expect(await refused).toMatchObject({ word: "invitation-for-another-address" });
    await saysARefusal(page.getByRole("alert"));
    await saidOnTheAcceptPage("the accept page refusing another address");
  });
});

const PAGE_OF_ROWS = 25;

const tickOf = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("checkbox", { name: `Select ${name}`, exact: true });

const selectionAction = (page: Page, action: string): Locator =>
  selectionBar(page).getByRole("button", { name: action, exact: true });

const refusedLineOf = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("alert").getByRole("listitem").filter({ hasText: name });

const TWO_TICKED = /^\D*2\D*$/;

const BULK_ROLE_CHANGE_ASKED = "members.bulkChangeRole";

/** Matched by name anywhere in the path, because the tRPC client batches its calls. */
const BULK_ROLE_CHANGE = (url: URL): boolean => url.pathname.includes(BULK_ROLE_CHANGE_ASKED);

const aWorkspaceOfThirtyEditors = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
) => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: admin });
  await Promise.all(
    Array.from({ length: 30 }, async (_, index) => {
      const made = await person(api, anAddress(`person-${String(index)}`), {
        displayName: `Person ${String(index + 1).padStart(2, "0")}`,
      });
      await addMember(api, { workspaceId: workspace.workspaceId, userId: made.id, role: "Editor" });
    }),
  );
  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, admin);
  await expect(memberRows(page)).toHaveCount(PAGE_OF_ROWS);
  return workspace;
};

const linesIn = (dialog: Locator): Locator => dialog.getByRole("paragraph");

const MORE_TICKED = [
  ["Person 04", "Person 05", "Person 26"],
  ["Person 06", "Person 07", "Person 28"],
  ["Person 08", "Person 09", "Person 29"],
  ["Person 10", "Person 11", "Person 30"],
] as const;

const rolesChangedAtAKey = async (
  page: Page,
  dialog: Locator,
  onPageTwo: string,
): Promise<number> => {
  await dialog.getByRole("button", { name: "Change Role", exact: true }).focus();
  await clockTheNextKey(page, {
    at: `//tr[.//a[normalize-space(.)='${onPageTwo}']]/td[3]`,
    reads: "Viewer",
  });
  await page.keyboard.press("Enter");
  return actionClocked(page);
};

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
  test("refuses demoting both Admins, naming each, ticks kept", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Calder Gilding");
    await tickOf(page, "Test person").check();
    await tickOf(page, "Ada Hartley").check();

    const dialog = await changeRoleOpened(page, "Change Role for 2 Members");
    await expect(linesIn(dialog), "no line warns that the two include the reader").toHaveCount(3);
    const answered = refusalAnswering(page, BULK_ROLE_CHANGE_ASKED);
    await dialog.getByRole("button", { name: "Change Role", exact: true }).click();

    const { items } = await answered;
    assert.ok(items !== undefined, "the refusal names each member it refused");
    expect(Object.values(items)).toEqual(["last-admin", "last-admin"]);
    const refusal = membersRegion(page).getByRole("alert");
    await expect(refusal.getByRole("paragraph"), "the refusal counts two refused").toHaveText(
      /\b2\b/,
    );
    await expect(refusal.getByRole("listitem")).toHaveCount(2);
    for (const name of ["Test person", "Ada Hartley"]) {
      await expect(refusedLineOf(page, name)).toHaveCount(1);
      await expect(tickOf(page, name)).toBeChecked();
      await expect(rowOf(page, name).getByText("Refused", { exact: true })).toBeVisible();
      await expect(cellOf(page, name, "Role")).toHaveText("Admin");
    }
    await tickOf(page, "Test person").focus();
    await page.keyboard.press(PEOPLE_KEYSTROKES.tick.key);
    await expect(tickOf(page, "Test person")).not.toBeChecked();
    await page.keyboard.press(PEOPLE_KEYSTROKES.tick.key);
    await expect(tickOf(page, "Test person")).toBeChecked();
    await expect(refusal.getByRole("listitem"), "a tick by key wiped the refusal").toHaveCount(2);
    await expect(
      rowOf(page, "Test person").getByText("Refused", { exact: true }),
      "a tick by key wiped the row's mark",
    ).toBeVisible();
    await expect(selectionBar(page).getByRole("status")).toHaveText(TWO_TICKED);
    await passesTheAccessibilityGate();
  });

  test("adds ten to a group, counting two already in", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const admin = anAddress("admin");
    const workspace = await provision(request, { name: "Swale Joinery", adminEmail: admin });
    const joined = await Promise.all(
      Array.from({ length: 9 }, async (_, index) => {
        const made = await person(request, anAddress(`seller-${String(index)}`), {
          displayName: `Seller ${String(index + 1)}`,
        });
        await addMember(request, {
          workspaceId: workspace.workspaceId,
          userId: made.id,
          role: "Viewer",
        });
        return made.id;
      }),
    );
    await makeGroups(request, {
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      names: ["Sales"],
      memberIds: joined.slice(0, 2),
    });
    await page.goto(MEMBERS_PAGE);
    await signIn(page, request, admin);
    await expect(memberRows(page)).toHaveCount(10);

    await membersRegion(page)
      .getByRole("checkbox", { name: "Select every member on this page" })
      .check();
    await expect(selectionBar(page).getByRole("status")).toHaveText(/^\D*10\D*$/);
    await selectionAction(page, "Add to Group").click();
    const dialog = page.getByRole("dialog", { name: "Add 10 Members to a Group" });
    const group = dialog.getByRole("combobox", { name: "Group" });
    await expect(group).toBeFocused();
    await group.click();
    await page.getByRole("option", { name: "Sales", exact: true }).click();
    await dialog.getByRole("button", { name: "Add to Group", exact: true }).click();

    await expect(
      outcomeOf(page),
      "the outcome counts eight added to Sales and two in it",
    ).toHaveText(/\b8\b.*Sales.*\b2\b/);
    await expect(listHeading(page)).toBeFocused();
    await expect(selectionBar(page)).toBeHidden();
    await expect(cellOf(page, "Seller 9", "Groups")).toHaveText("Sales");
    await passesTheAccessibilityGate();
  });

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

  test("changes every ticked role, across two pages, within budget", async ({ page, request }) => {
    await aWorkspaceOfThirtyEditors(page, request, "Ribble Wiring");
    await tickOf(page, "Person 01").check();
    await tickOf(page, "Person 02").check();
    await page.keyboard.press(PEOPLE_KEYSTROKES.nextPage.key);
    await tickOf(page, "Person 27").check();
    await expect(selectionBar(page).getByRole("status")).toHaveText(/\b3\b\D+\b2\b/);

    const dialog = await changeRoleOpened(page, "Change Role for 3 Members");
    await expect(linesIn(dialog), "a line warns three others as it would the reader").toHaveCount(
      2,
    );
    const samples = [await rolesChangedAtAKey(page, dialog, "Person 27")];

    await expect(outcomeOf(page), "the outcome counts three changed, and none skipped").toHaveText(
      /^\D*3\D*$/,
    );
    for (const [first, second, onPageTwo] of MORE_TICKED) {
      await page.keyboard.press(PEOPLE_KEYSTROKES.previousPage.key);
      await tickOf(page, first).check();
      await tickOf(page, second).check();
      await page.keyboard.press(PEOPLE_KEYSTROKES.nextPage.key);
      await tickOf(page, onPageTwo).check();
      await expect(selectionAction(page, "Change Role")).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
      const again = await changeRoleOpened(page, "Change Role for 3 Members");
      samples.push(await rolesChangedAtAKey(page, again, onPageTwo));
    }
    theActionsLandedWithinTheirBudget("bulk role change", samples);
    await page.keyboard.press(PEOPLE_KEYSTROKES.previousPage.key);
    await expect(cellOf(page, "Person 01", "Role")).toHaveText("Viewer");
    await expect(cellOf(page, "Person 02", "Role")).toHaveText("Viewer");
    await expect(cellOf(page, "Person 03", "Role")).toHaveText("Editor");
    await page.reload();
    await expect(cellOf(page, "Person 01", "Role")).toHaveText("Viewer");
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

  test("keyboard alone: tick two, change roles, focus on the list", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await skippedToMembers(page, request, "Calder Spinning");

    const keystrokes = await keystrokesListed(page, "Members");
    await expect(keyListed(keystrokes, PEOPLE_KEYSTROKES.changeSelectedRoles.key)).toBeVisible();
    await expect(keyListed(keystrokes, PEOPLE_KEYSTROKES.tick.key)).toBeVisible();
    await keystrokesDismissed(page, keystrokes);

    await tabUntilFocused(page, tickOf(page, "Priya Shah"));
    await page.keyboard.press("Space");
    await tabUntilFocused(page, memberLink(page, "Sam Okoro"));
    await page.keyboard.press(PEOPLE_KEYSTROKES.tick.key);
    await expect(selectionBar(page).getByRole("status")).toHaveText(TWO_TICKED);

    await page.keyboard.press(`Shift+${PEOPLE_KEYSTROKES.changeSelectedRoles.key}`);
    const dialog = page.getByRole("dialog", { name: "Change Role for 2 Members" });
    const role = dialog.getByRole("combobox", { name: "Role" });
    await expect(role).toBeFocused();
    await editorPickedByKeyboard(page, role);
    await tabUntilFocused(page, dialog.getByRole("button", { name: "Change Role", exact: true }));
    await page.keyboard.press("Enter");

    await expect(listHeading(page)).toBeFocused();
    await expect(outcomeOf(page), "the outcome counts one changed and one skipped").toHaveText(
      /\b1\b\D+\b1\b/,
    );
    await expect(cellOf(page, "Sam Okoro", "Role")).toHaveText("Editor");
    await passesTheAccessibilityGate();
  });

  test("a second action waits on the first, whose refusal lands", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Wharfe Fulling");
    const answered = Promise.withResolvers<void>();
    await answeredChangedMeanwhile(page, BULK_ROLE_CHANGE, answered.promise);
    await tickOf(page, "Priya Shah").check();
    const dialog = await changeRoleOpened(page, "Change Role for 1 Member");
    await dialog.getByRole("button", { name: "Change Role", exact: true }).click();
    await expect(outcomeOf(page), "the pending change counts its one member").toHaveText(/\b1\b/);
    const saidPending = await outcomeOf(page).innerText();

    await tickOf(page, "Sam Okoro").check();
    const action = selectionAction(page, "Change Role");
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(outcomeOf(page)).toHaveText(/\S/);
    await expect(outcomeOf(page), "the second press said nothing of its own").not.toHaveText(
      saidPending,
    );
    await page.keyboard.press(`Shift+${PEOPLE_KEYSTROKES.removeSelected.key}`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await passesTheAccessibilityGate();

    answered.resolve();
    await saysARefusal(membersRegion(page).getByRole("alert"));
    await keepsItsWordOffThePage(page, "changed-meanwhile");
    await expect(tickOf(page, "Priya Shah")).toBeChecked();
    await expect(action).not.toHaveAttribute("aria-disabled", "true");
  });

  test("keeps a search still settling when a name opens", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Nidd Sailcloth");

    await searchBox(page).fill("Priya");
    await memberLink(page, "Priya Shah").click();
    await expect(personHeading(page, "Priya Shah")).toBeVisible();
    await backToMembers(page);

    await expect(searchBox(page)).toHaveValue("Priya");
    await expect(page).toHaveURL(/members\.search=Priya/);
    await expect(memberRows(page)).toHaveCount(1);
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
