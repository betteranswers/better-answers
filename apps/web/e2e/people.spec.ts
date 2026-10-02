import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { JUMP_TO, RAIL } from "@/app/words.ts";
import { INVITATION_WORDS } from "@/features/auth/invitation-words.ts";
import { SAID_OF_ACCEPTING } from "@/features/auth/refusal-words.ts";
import { NO_WORKSPACE_HEADING, PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import {
  BULK_WORDS,
  homeNowSaid,
  INCLUDES_YOU,
  SELECTED_MEMBERS,
} from "@/features/people/member-act-words.ts";
import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { SAID_OF_A_MEMBER, SAID_OF_TICKED_MEMBERS } from "@/features/people/refusal-words.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import { KEYSTROKE_WORDS, keystrokesOn, SELECT_FIRST } from "@/shared/keystroke-words.ts";
import { CONTROL_CENTRE, groupIn, HOMES, screenNamed } from "@/shared/navigation.ts";
import { SAID_OF_CLASS, sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  notFoundOfferingHome,
  anAddress,
  askToJoin,
  clockTheNextKey,
  editorPickedByKeyboard,
  invite,
  keystrokesButton,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  makeGroups,
  person,
  personMenuOpened,
  provision,
  removeMember,
  saysItsSentenceNotItsWord,
  signIn,
  skipLinkReachesTheScreen,
  switcherMenuOf,
  switcherOf,
  tabUntilFocused,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const ACT_BUDGET_MS = 100;

const people = groupIn(CONTROL_CENTRE, "people");

const MEMBERS = screenNamed(people, "Members");

const MEMBERS_SCREEN = MEMBERS.path;

const AUDIT_LOG_SCREEN = screenNamed(groupIn(CONTROL_CENTRE, "system"), "Audit log").path;

const GROUPS_SCREEN = screenNamed(people, "Groups").path;

/** Matched by name anywhere in the path, because the client batches its reads. */
const MEMBERSHIP_READ = (url: URL): boolean => url.pathname.includes("session.membership");

const nav = (page: Page) => page.getByRole("navigation", { name: CONTROL_CENTRE.name });

const membersRegion = (page: Page) => page.getByRole("region", { name: "Members" });

const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search by name or address" });

/** The header row is a row too, so the members are the rows with a cell. */
const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator => memberRows(page).filter({ hasText: name });

/** A row's first cell is its tick, so a column's cell is counted from the second. */
const COLUMN = { Person: 1, Role: 2, Groups: 3, Joined: 4 } as const;

const cellOf = (page: Page, name: string, column: keyof typeof COLUMN): Locator =>
  rowOf(page, name).getByRole("cell").nth(COLUMN[column]);

const memberButton = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("button", { name, exact: true });

const sheetOf = (page: Page, name: string): Locator => page.getByRole("dialog", { name });

const rolePicker = (sheet: Locator): Locator => sheet.getByRole("radiogroup", { name: "Role" });

const removalOf = (sheet: Locator): Locator => sheet.getByRole("region", { name: "Removal" });

/** The one output the Members region holds as a child of its own: the count of people. */
const THE_COUNT = "//section[h2='Members']/output";

const displayNameRegion = (sheet: Locator): Locator =>
  sheet.getByRole("region", { name: "Display name" });

const flagButton = (sheet: Locator): Locator =>
  sheet.getByRole("button", { name: "Flag the name to the operator" });

const SENT_TO_THE_OPERATOR = "Sent to the operator. The name stands until they correct it.";

const EACH_ROLE_MEANS = {
  Admin: "Manages people and sources, and does everything an Editor does.",
  Editor: "Checks concepts, runs question sets and saves Answers.",
  Viewer: "Asks questions, flags answers and suggests changes.",
};

/** Timed in the page, from the key to the count that says it: a matcher polls too coarsely. */
const clockTheSearch = (page: Page, saying: string) =>
  page.evaluate((expected) => {
    const landed = Promise.withResolvers<number>();
    const watch = (pressed: KeyboardEvent) => {
      const saysIt = new MutationObserver(() => {
        if (!document.body.textContent.includes(expected)) return;
        saysIt.disconnect();
        landed.resolve(performance.now() - pressed.timeStamp);
      });
      saysIt.observe(document.body, { subtree: true, childList: true, characterData: true });
    };
    document.addEventListener("keydown", watch, { capture: true, once: true });
    Reflect.set(window, "searchClocked", landed.promise);
  }, saying);

const theSearchLandedWithinItsBudget = async (page: Page) => {
  const elapsed = await page.evaluate(() => Reflect.get(window, "searchClocked"));
  test.info().annotations.push({ type: "search act", description: `${elapsed} ms` });
  expect(elapsed, "the search did not narrow the list within its budget").toBeLessThan(
    ACT_BUDGET_MS,
  );
};

type Joined = {
  readonly email: string;
  readonly displayName: string;
  readonly role: "Editor" | "Viewer";
};

/** Another workspace's member is made alongside, so a list that leaked would show them. */
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
  readonly slug: string;
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
    slug: workspace.slug,
  };
};

/** A fresh document, so the first Tab starts from the top rather than from the rail's link. */
const skippedToMembers = async (page: Page, api: APIRequestContext, workspaceName: string) => {
  await anAdminAtPeople(page, api, workspaceName);
  await page.goto(MEMBERS_SCREEN);
  await expect(memberRows(page)).toHaveCount(3);
  await skipLinkReachesTheScreen(page);
};

/** The Admin signed in is one of two, so they may demote or remove themself. */
const anAdminBesideAnotherAtPeople = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
) => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: admin });
  const successor = await person(api, anAddress("ada"), { displayName: "Ada Hartley" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: successor.id, role: "Admin" });
  await page.goto(MEMBERS_SCREEN);
  await signIn(page, api, admin);
  await expect(memberRows(page)).toHaveCount(2);
  return workspace;
};

/** The Admin signed in makes themself an Editor through their own sheet, which says so. */
const demotedThemself = async (page: Page): Promise<Locator> => {
  await memberButton(page, "Test person").click();
  const sheet = sheetOf(page, "Test person");
  await sheet.getByRole("radio", { name: "Editor", exact: true }).click();
  await sheet.getByRole("button", { name: "Make Test person an Editor" }).click();
  await expect(sheet.getByRole("status"), "the screen hid mid-act").toHaveText(
    "Test person is an Editor now, from their next request.",
  );
  return sheet;
};

/** The screen was decided on arrival; coming back to it asks again, as an Editor. */
const membersHiddenAfterTheNextMove = async (page: Page): Promise<void> => {
  await page.getByRole("link", { name: HOMES.Editor.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${HOMES.Editor.path}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${MEMBERS_SCREEN}$`));
  await notFoundOfferingHome(page, "Editor");
};

const removedThroughTheirSheet = async (page: Page, name: string): Promise<void> => {
  await memberButton(page, name).click();
  const removal = removalOf(sheetOf(page, name));
  await removal.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
  await removal.getByRole("button", { name: `Remove ${name} from this workspace` }).click();
};

test.describe("the People group's Members screen", () => {
  test("opens People on Members, and no screen is called Roles", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Calder Joinery");

    await expect(page).toHaveURL(new RegExp(`${MEMBERS_SCREEN}$`));
    await expect(nav(page).getByRole("link", { name: "Members" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Groups" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Roles" })).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveText(["Members", "Invitations", "Requests"]);
    await expect(page.getByRole("tab", { name: "Members" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("shows an Admin each member's details, and no one else's", async ({ page, request }) => {
    const { admin, joined, stranger } = await anAdminAtPeople(page, request, "Aire Valley Tooling");

    await expect(memberRows(page)).toHaveCount(3);
    await expect(membersRegion(page).getByText("3 people", { exact: true })).toBeVisible();
    for (const member of joined) {
      await expect(rowOf(page, member.displayName)).toContainText(member.email);
      await expect(cellOf(page, member.displayName, "Role")).toHaveText(member.role);
      await expect(cellOf(page, member.displayName, "Groups")).toHaveText("No group");
    }
    await expect(cellOf(page, admin, "Role")).toHaveText("Admin");
    await expect(cellOf(page, admin, "Joined")).toHaveText(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);

    const everything = page.locator("body");
    await expect(everything).not.toContainText("Una Elsewhere");
    await expect(everything).not.toContainText(stranger);
  });

  test("searches by name or address, and says when none match", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { joined } = await anAdminAtPeople(page, request, "Wharfe Fabrication");
    const sam = joined.find((member) => member.displayName === "Sam Okoro");
    if (sam === undefined) throw new Error("Sam Okoro was joined");

    await searchBox(page).fill("PRIY");
    await clockTheSearch(page, "1 of 3 people match “PRIYA”.");
    await searchBox(page).press("A");
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Priya Shah")).toBeVisible();
    await expect(membersRegion(page).getByText("1 of 3 people match “PRIYA”.")).toBeVisible();
    await theSearchLandedWithinItsBudget(page);

    await searchBox(page).fill(sam.email.slice(0, 12));
    await expect(memberRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Sam Okoro")).toBeVisible();

    await searchBox(page).fill("nobody by this name");
    await expect(memberRows(page)).toHaveCount(1);
    await expect(membersRegion(page)).toContainText("No one matches “nobody by this name”.");
    await passesTheAccessibilityGate();
    await membersRegion(page).getByRole("button", { name: "Clear filters" }).click();

    await expect(memberRows(page)).toHaveCount(3);
    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page)).toBeFocused();
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Dales Engineering");

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto(MEMBERS_SCREEN);
    await expect(memberRows(page)).toHaveCount(3);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "members list", description: `${elapsed} ms` });
    expect(elapsed, "the list of three members rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${aRole(role)} Members as not found, listing no one`, async ({ page, request }) => {
      const workspace = await aMemberSignedInAt(page, request, role, MEMBERS_SCREEN);

      await notFoundOfferingHome(page, role);
      await expect(membersRegion(page)).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(workspace.admin.email);
    });
  }

  test("lets an Admin reach and search members by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await skippedToMembers(page, request, "Calder Castings");

    const keystrokes = await keystrokesListed(page, MEMBERS.name);
    await expect(keystrokes).toContainText("Search the members by name or address");
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
        - status: 3 people
        - searchbox "Search by name or address"
        - combobox "Filter by role": Any role
        - button "Columns"
        - table:
          - caption: /Members of this workspace/
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
              - columnheader "Acts"
          - rowgroup:
            - row /Priya Shah/:
              - cell:
                - checkbox "Select Priya Shah"
              - cell /Priya Shah/:
                - button "Priya Shah"
              - cell "Editor"
              - cell "No group"
              - cell /\\d{4}/
              - cell:
                - button "Acts for Priya Shah"
            - row /Sam Okoro/:
              - cell:
                - checkbox "Select Sam Okoro"
              - cell /Sam Okoro/:
                - button "Sam Okoro"
              - cell "Viewer"
              - cell "No group"
              - cell /\\d{4}/
              - cell:
                - button "Acts for Sam Okoro"
            - row /Test person/:
              - cell:
                - checkbox "Select Test person"
              - cell /Test person/:
                - button "Test person"
              - cell "Admin"
              - cell "No group"
              - cell /\\d{4}/
              - cell:
                - button "Acts for Test person"
    `);

    await passesTheAccessibilityGate();
  });
});

test.describe("a member, opened as a sheet", () => {
  test("shows a member's role, groups and each role's meaning", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { joined } = await anAdminAtPeople(page, request, "Swale Forge");
    const priya = joined.find((member) => member.displayName === "Priya Shah");
    if (priya === undefined) throw new Error("Priya Shah was joined");

    await memberButton(page, "Priya Shah").click();

    const sheet = sheetOf(page, "Priya Shah");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { level: 2, name: "Priya Shah" })).toBeFocused();
    await expect(sheet).toContainText(priya.email);
    await expect(rolePicker(sheet).getByRole("radio")).toHaveCount(3);
    for (const [role, meaning] of Object.entries(EACH_ROLE_MEANS)) {
      await expect(
        sheet.getByRole("radio", { name: role, exact: true }),
      ).toHaveAccessibleDescription(meaning);
    }
    await expect(sheet.getByRole("radio", { name: "Editor", exact: true })).toBeChecked();
    await expect(sheet.getByRole("button", { name: "Make Priya Shah an Editor" })).toBeDisabled();

    await expect(sheet).toMatchAriaSnapshot(`
      - dialog "Priya Shah":
        - heading "Priya Shah" [level=2]
        - paragraph: /@/
        - region "Membership":
          - heading "Membership" [level=3]
          - term: Role
          - definition: Editor
          - term: Groups
          - definition: No group
          - term: Joined
          - definition: /\\d{4}/
          - term: Credentials here
          - definition: Never revoked
        - region "Role":
          - heading "Role" [level=3]
          - radiogroup "Role":
            - radio "Admin"
            - text: Admin Manages people and sources, and does everything an Editor does.
            - radio "Editor" [checked]
            - text: Editor Checks concepts, runs question sets and saves Answers.
            - radio "Viewer"
            - text: Viewer Asks questions, flags answers and suggests changes.
          - button "Make Priya Shah an Editor" [disabled]
          - paragraph: Priya Shah is an Editor. Pick another role to change it.
        - region "Credentials":
          - heading "Credentials" [level=3]
          - button "Revoke Priya Shah's credentials here"
          - paragraph: Every session and token Priya Shah holds for this workspace is refused at once, and a fresh sign-in works. Recorded on the audit log under your name.
        - region "Display name":
          - heading "Display name" [level=3]
          - paragraph: People give their own display name, and no Admin can change one. The operator corrects a name you flag as inappropriate.
          - button "Flag the name to the operator"
          - paragraph: The operator is emailed, and the flag is recorded on the audit log under your name. While a flag from this workspace waits, another adds nothing.
        - button "Close"
    `);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(memberButton(page, "Priya Shah")).toBeFocused();
  });

  test("draws a role pill square, the avatar and radios round", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Wharfe Gauges");
    const pill = rowOf(page, "Priya Shah").getByText("Editor", { exact: true });
    await expect(pill, "the kit's rounded-full on a pill").toHaveCSS("border-radius", "0px");

    await memberButton(page, "Priya Shah").click();
    const sheet = sheetOf(page, "Priya Shah");
    // The avatar is hidden from assistive technology, so no role or name reaches it.
    const avatar = sheet.locator("[data-slot='avatar']");
    await expect(avatar, "the avatar, a kept circle").toHaveCSS("border-radius", "999px");
    await expect(
      sheet.getByRole("radio", { name: "Admin", exact: true }),
      "a radio, a kept circle",
    ).toHaveCSS("border-radius", "999px");
  });

  test("changes a member's role within its budget, and it holds", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Nidd Valley Casting");

    await memberButton(page, "Sam Okoro").click();
    const sheet = sheetOf(page, "Sam Okoro");
    await sheet.getByRole("radio", { name: "Editor", exact: true }).click();
    const commit = sheet.getByRole("button", { name: "Make Sam Okoro an Editor" });
    await commit.focus();
    await clockTheNextKey(page, {
      at: "//tr[.//button[normalize-space(.)='Sam Okoro']]/td[3]",
      reads: "Editor",
    });
    await page.keyboard.press("Enter");

    await expect(sheet.getByRole("status")).toHaveText(
      "Sam Okoro is an Editor now, from their next request.",
    );
    await theActLandedWithinItsBudget(page, "role change");
    await expect(sheet.getByRole("radio", { name: "Editor", exact: true })).toBeFocused();
    await expect(sheet.getByRole("region", { name: "Membership" })).toContainText("Editor");

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(cellOf(page, "Sam Okoro", "Role")).toHaveText("Editor");
  });

  test("refuses demoting the last Admin, and says what comes next", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Ure Mill Tools");

    await memberButton(page, "Test person").click();
    const sheet = sheetOf(page, "Test person");
    await sheet.getByRole("radio", { name: "Viewer", exact: true }).click();
    const commit = sheet.getByRole("button", { name: "Make Test person a Viewer" });
    await commit.click();

    await saysItsSentenceNotItsWord(sheet.getByRole("alert"), {
      table: SAID_OF_A_MEMBER,
      word: "last-admin",
    });
    await expect(sheet.getByRole("region", { name: "Membership" })).toContainText("Admin");
    await passesTheAccessibilityGate();
    await page.keyboard.press("Escape");
    await expect(cellOf(page, "Test person", "Role")).toHaveText("Admin");
  });

  test("an Admin demoting themself sees their new role at once", async ({ page, request }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Esk Presswork");
    await expect(await personMenuOpened(page, "Test person")).toContainText("Admin");
    await page.keyboard.press("Escape");

    const sheet = await demotedThemself(page);
    await page.keyboard.press("Escape");

    await expect(sheet).toHaveCount(0);
    const you = await personMenuOpened(page, "Test person");
    await expect(you).toContainText("Editor");
    await expect(you).not.toContainText("Admin");
    await page.keyboard.press("Escape");
    await expect(membersRegion(page).getByRole("alert")).toHaveText(
      sentenceOf(SAID_OF_A_MEMBER["role-forbids"]),
    );

    await membersHiddenAfterTheNextMove(page);
  });

  test("an Admin arriving unread who demotes themself keeps the confirmation", async ({
    page,
    request,
  }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Ure Presswork");
    let dropped = false;
    await page.route(MEMBERSHIP_READ, (route) => {
      if (dropped) return route.continue();
      dropped = true;
      return route.abort();
    });
    // The shell's read on arrival is dropped, so the role arrives after the screen does.
    await page.reload();
    const controlCentre = page
      .getByRole("navigation", { name: RAIL })
      .getByRole("link", { name: CONTROL_CENTRE.name });
    await expect(controlCentre).toBeVisible();
    await expect(memberRows(page)).toHaveCount(2);

    const sheet = await demotedThemself(page);
    await expect(controlCentre, "the rail did not take the new role").toHaveCount(0);
    await expect(sheet.getByRole("status"), "the screen hid mid-act").toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();

    await membersHiddenAfterTheNextMove(page);
  });

  test("lists Members' keystrokes from the rail's foot, as ? does", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Calder Looms");
    await expect(memberRows(page)).toHaveCount(3);

    // One button, and it is the rail's: no toolbar holds one any more.
    await expect(keystrokesButton(page)).toHaveCount(1);
    const inTheRail = page
      .getByRole("navigation", { name: RAIL })
      .getByRole("button", { name: KEYSTROKE_WORDS.button });
    await expect(inTheRail).toHaveAttribute("aria-keyshortcuts", "?");

    await inTheRail.click();
    const clicked = page.getByRole("dialog", { name: keystrokesOn(MEMBERS.name) });
    await expect(clicked).toContainText("Open the member in focus");
    await expect(clicked).toContainText(JUMP_TO.name);
    await passesTheAccessibilityGate();
    const listedOnClick = await clicked.ariaSnapshot();
    await keystrokesDismissed(page, clicked);

    const pressed = await keystrokesListed(page, MEMBERS.name);
    expect(await pressed.ariaSnapshot(), "? lists other keystrokes than the button").toBe(
      listedOnClick,
    );
    await keystrokesDismissed(page, pressed);
    await expect(inTheRail).toBeFocused();
  });

  test("opens a member and changes their role by keyboard alone", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Calder Rolling");
    await page.goto(MEMBERS_SCREEN);
    await expect(memberRows(page)).toHaveCount(3);

    await page.keyboard.press("c");
    await expect(membersRegion(page)).toContainText(SELECT_FIRST.member);

    const keystrokes = await keystrokesListed(page, MEMBERS.name);
    await expect(keystrokes).toContainText("Open the member in focus");
    await expect(keystrokes).toContainText("Change the role of the member in focus");
    await expect(keystrokes).toContainText("Revoke the credentials here of the member in focus");
    await expect(keystrokes).toContainText("Remove the member in focus");
    await expect(keystrokes, "d declines a request on the Requests tab alone").not.toContainText(
      "Decline the request in focus",
    );
    await keystrokesDismissed(page, keystrokes);

    await memberButton(page, "Priya Shah").focus();
    await page.keyboard.press("o");
    const sheet = sheetOf(page, "Priya Shah");
    await expect(sheet.getByRole("heading", { level: 2, name: "Priya Shah" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(memberButton(page, "Priya Shah")).toBeFocused();

    await page.keyboard.press("c");
    await expect(sheet.getByRole("radio", { name: "Editor", exact: true })).toBeFocused();
    // The group checks the radio it moves to, a task later, only while the arrow is still held.
    await page.keyboard.down("ArrowDown");
    await expect(sheet.getByRole("radio", { name: "Viewer", exact: true })).toBeChecked();
    await page.keyboard.up("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(sheet.getByRole("button", { name: "Make Priya Shah a Viewer" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("status")).toHaveText(
      "Priya Shah is a Viewer now, from their next request.",
    );

    await page.keyboard.press("Escape");
    await expect(memberButton(page, "Priya Shah")).toBeFocused();
    await expect(cellOf(page, "Priya Shah", "Role")).toHaveText("Viewer");
  });
});

const CREDENTIALS_HERE =
  "//div[@role='dialog']//dt[normalize-space(.)='Credentials here']/following-sibling::dd[1]";

const REVOKED_AT = /Revoked\s*\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}/;

const revokeButton = (sheet: Locator, name: string): Locator =>
  sheet.getByRole("button", { name: `Revoke ${name}'s credentials here` });

/** Priya is a member of a second workspace too, so a screen that told of it would name it. */
const anAdminWithAMemberOfTwo = async (page: Page, api: APIRequestContext) => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: "Swale Presswork", adminEmail: admin });
  const elsewhere = await provision(api, { name: "Zenith Tooling" });
  const priya = await person(api, anAddress("priya"), { displayName: "Priya Shah" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: priya.id, role: "Editor" });
  await addMember(api, { workspaceId: elsewhere.workspaceId, userId: priya.id, role: "Viewer" });
  await page.goto(MEMBERS_SCREEN);
  await signIn(page, api, admin);
  await expect(memberRows(page)).toHaveCount(2);
  return { elsewhere };
};

test.describe("revoking a member's credentials here", () => {
  test("revokes a member's credentials within its budget, and it holds", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { elsewhere } = await anAdminWithAMemberOfTwo(page, request);

    await memberButton(page, "Priya Shah").click();
    const sheet = sheetOf(page, "Priya Shah");
    const membership = sheet.getByRole("region", { name: "Membership" });
    await expect(membership).toContainText("Never revoked");
    const revoke = revokeButton(sheet, "Priya Shah");
    await revoke.focus();
    await clockTheNextKey(page, { at: CREDENTIALS_HERE, reads: "Revoked" });
    await page.keyboard.press("Enter");

    await expect(sheet.getByRole("status")).toContainText(
      "Priya Shah's credentials here are revoked.",
    );
    await theActLandedWithinItsBudget(page, "revocation");
    await expect(revoke).toBeFocused();
    await expect(membership).toContainText(REVOKED_AT);
    await passesTheAccessibilityGate();
    await expect(page.locator("body")).not.toContainText(elsewhere.name);
    expect(await sheet.ariaSnapshot()).not.toContain(elsewhere.name);

    await page.keyboard.press("Escape");
    await page.reload();
    await memberButton(page, "Priya Shah").click();
    await expect(
      sheetOf(page, "Priya Shah").getByRole("region", { name: "Membership" }),
    ).toContainText(REVOKED_AT);
  });

  test("revokes the Admin's own credentials, then admits a fresh sign-in", async ({
    page,
    request,
  }) => {
    const admin = anAddress("admin");
    await provision(request, { name: "Esk Rolling", adminEmail: admin });
    await page.goto(MEMBERS_SCREEN);
    await signIn(page, request, admin);
    await expect(memberRows(page)).toHaveCount(1);

    await memberButton(page, "Test person").click();
    const sheet = sheetOf(page, "Test person");
    await expect(sheet).toContainText("Your own session here ends with it.");
    await revokeButton(sheet, "Test person").click();
    await expect(sheet.getByRole("status")).toContainText(
      "Test person's credentials here are revoked.",
    );
    await page.keyboard.press("Escape");

    await expect(membersRegion(page).getByRole("alert")).toHaveText(
      sentenceOf(SAID_OF_CLASS.unauthenticated),
    );
    await page.reload();
    await signIn(page, request, admin);
    await expect(page).toHaveURL(new RegExp(`${MEMBERS_SCREEN}$`));
    await expect(memberRows(page)).toHaveCount(1);
    await expect(membersRegion(page).getByRole("alert")).toHaveCount(0);
  });

  test("opens a member's credentials and revokes them by keyboard alone", async ({
    page,
    request,
  }) => {
    await anAdminAtPeople(page, request, "Nidd Presswork");
    await page.goto(MEMBERS_SCREEN);
    await expect(memberRows(page)).toHaveCount(3);

    await page.keyboard.press("v");
    await expect(membersRegion(page)).toContainText(SELECT_FIRST.member);

    await memberButton(page, "Sam Okoro").focus();
    await page.keyboard.press("v");
    const sheet = sheetOf(page, "Sam Okoro");
    const revoke = revokeButton(sheet, "Sam Okoro");
    await expect(revoke).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("status")).toContainText(
      "Sam Okoro's credentials here are revoked.",
    );
    await expect(revoke).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(memberButton(page, "Sam Okoro")).toBeFocused();
  });
});

test.describe("removing a member from their sheet", () => {
  test("removes a member behind a confirmation, within its budget", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Rye Foundry");

    await memberButton(page, "Priya Shah").click();
    const sheet = sheetOf(page, "Priya Shah");
    const removal = removalOf(sheet);
    const asked = removal.getByRole("button", { name: "Remove Priya Shah", exact: true });
    await expect(asked).toHaveAccessibleDescription(
      "Priya Shah loses access to this workspace on every session and client they hold. Any other workspace they belong to is untouched, and they stay named on what they checked.",
    );
    await asked.click();
    await expect(removal.getByText("Confirm the removal of Priya Shah")).toBeFocused();
    await removal.getByRole("button", { name: "Keep Priya Shah" }).click();
    await expect(asked).toBeFocused();
    await expect(asked).toHaveAttribute("aria-expanded", "false");

    await asked.click();
    const confirm = removal.getByRole("button", { name: "Remove Priya Shah from this workspace" });
    await expect(confirm).toHaveAccessibleDescription(
      "Recorded on the audit log under your name. Their groups here end with the membership.",
    );
    await expect(removal).toMatchAriaSnapshot(`
      - region "Removal":
        - heading "Removal" [level=3]
        - paragraph: /Priya Shah loses access to this workspace/
        - button "Remove Priya Shah" [expanded]
        - group "Confirm the removal of Priya Shah":
          - text: Confirm the removal of Priya Shah
          - paragraph: /Recorded on the audit log/
          - button "Remove Priya Shah from this workspace"
          - button "Keep Priya Shah"
    `);
    await passesTheAccessibilityGate();

    await confirm.focus();
    await clockTheNextKey(page, { at: THE_COUNT, reads: "2 people" });
    await page.keyboard.press("Enter");

    await expect(sheet).toHaveCount(0);
    await expect(memberRows(page)).toHaveCount(2);
    await expect(memberButton(page, "Sam Okoro")).toBeFocused();
    await expect(membersRegion(page).getByRole("status").last()).toHaveText(
      "Priya Shah is no longer a member of this workspace.",
    );
    await theActLandedWithinItsBudget(page, "removal");

    await page.reload();
    await expect(memberRows(page)).toHaveCount(2);
    await expect(rowOf(page, "Priya Shah")).toHaveCount(0);
  });

  test("refuses removing the last Admin, and puts them back", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Hodder Tools");

    await removedThroughTheirSheet(page, "Test person");

    await expect(membersRegion(page).getByRole("alert")).toHaveText(
      sentenceOf(SAID_OF_A_MEMBER["last-admin"]),
    );
    await expect(memberRows(page)).toHaveCount(3);
    await expect(cellOf(page, "Test person", "Role")).toHaveText("Admin");
    await passesTheAccessibilityGate();
  });

  test("an Admin removing themself leaves through the workspace chooser", async ({
    page,
    request,
  }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Esk Tinsmiths");
    await memberButton(page, "Test person").click();
    await expect(
      removalOf(sheetOf(page, "Test person")).getByRole("button", {
        name: "Remove Test person",
        exact: true,
      }),
    ).toHaveAccessibleDescription(/^You lose access to this workspace, People included,/);
    await page.keyboard.press("Escape");

    await removedThroughTheirSheet(page, "Test person");

    // The chooser sends a person who holds no other workspace straight on.
    await expect(page).toHaveURL(/\/no-workspace$/);
    await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  });

  test("removes a member by keyboard alone", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Calder Presswork");
    await page.goto(MEMBERS_SCREEN);
    await expect(memberRows(page)).toHaveCount(3);

    await page.keyboard.press("d");
    await expect(membersRegion(page)).toContainText(SELECT_FIRST.member);

    await memberButton(page, "Sam Okoro").focus();
    await page.keyboard.press("d");
    const sheet = sheetOf(page, "Sam Okoro");
    const removal = removalOf(sheet);
    await expect(
      removal.getByRole("button", { name: "Remove Sam Okoro", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(removal.getByText("Confirm the removal of Sam Okoro")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      removal.getByRole("button", { name: "Remove Sam Okoro from this workspace" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(sheet).toHaveCount(0);
    await expect(memberRows(page)).toHaveCount(2);
    await expect(memberButton(page, "Test person")).toBeFocused();
  });
});

test.describe("a member's display name, flagged to the operator", () => {
  test("flags a member's name within budget, and again answers alike", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Swale Signworks");
    await memberButton(page, "Sam Okoro").click();
    const sheet = sheetOf(page, "Sam Okoro");
    const said = displayNameRegion(sheet).getByRole("status");

    await flagButton(sheet).focus();
    await clockTheNextKey(page, {
      at: "//section[h3[normalize-space(.)='Display name']]//output",
      reads: SENT_TO_THE_OPERATOR,
    });
    await page.keyboard.press("Enter");

    await expect(said).toHaveText(SENT_TO_THE_OPERATOR);
    await theActLandedWithinItsBudget(page, "name flag");
    await expect(flagButton(sheet)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(said).toHaveText(SENT_TO_THE_OPERATOR);
    await expect(displayNameRegion(sheet).getByRole("alert")).toHaveCount(0);
    await expect(sheet.getByRole("heading", { level: 2, name: "Sam Okoro" })).toBeVisible();
    await passesTheAccessibilityGate();
  });

  test("offers no flag for a member with no display name", async ({ page, request }) => {
    const { workspaceId } = await anAdminAtPeople(page, request, "Swale Lettering");
    const unnamed = anAddress("unnamed");
    const made = await person(request, unnamed, { displayName: "" });
    await addMember(request, { workspaceId, userId: made.id, role: "Viewer" });
    await page.reload();

    await memberButton(page, "No display name yet").click();
    const region = displayNameRegion(sheetOf(page, unnamed));

    await expect(region).toContainText(
      `${unnamed} has given no display name yet, so there is none to flag.`,
    );
    await expect(region.getByRole("button")).toHaveCount(0);
  });

  test("refuses a member removed meanwhile, saying why and what next", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { workspaceId, joined } = await anAdminAtPeople(page, request, "Swale Stonecraft");
    const sam = joined.find((member) => member.displayName === "Sam Okoro");
    if (sam === undefined) throw new Error("Sam Okoro was joined");
    await memberButton(page, "Sam Okoro").click();
    const sheet = sheetOf(page, "Sam Okoro");
    await removeMember(request, { workspaceId, userId: sam.id });

    await flagButton(sheet).click();

    await expect(displayNameRegion(sheet).getByRole("alert")).toHaveText(
      sentenceOf(SAID_OF_A_MEMBER["no-such-member"]),
    );
    await expect(displayNameRegion(sheet).getByRole("status")).toHaveCount(0);
    await passesTheAccessibilityGate();
  });

  test("flags a member's name by keyboard alone, from the list", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Swale Carving");

    const keystrokes = await keystrokesListed(page, MEMBERS.name);
    await expect(keystrokes).toContainText("Flag the display name of the member in focus");
    await keystrokesDismissed(page, keystrokes);

    await memberButton(page, "Priya Shah").focus();
    await page.keyboard.press("f");
    const sheet = sheetOf(page, "Priya Shah");
    await expect(flagButton(sheet)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(displayNameRegion(sheet).getByRole("status")).toHaveText(SENT_TO_THE_OPERATOR);

    await page.keyboard.press("Escape");
    await expect(memberButton(page, "Priya Shah")).toBeFocused();
  });
});

test.describe("the People screen's words", () => {
  // Every People surface joins this test as it is built: the product's word is workspace.
  test("says workspace, never organisation, on every People screen", async ({ page, request }) => {
    const { admin, slug } = await anAdminAtPeople(page, request, "Ryedale Metalwork");
    const organisation = /organi[sz]ation/i;

    const said = async (where: string) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("body"), where).not.toContainText(organisation);
      expect(await page.locator("body").ariaSnapshot(), where).not.toMatch(organisation);
    };

    for (const each of people.screens.filter((candidate) => candidate.built)) {
      await page.goto(each.path);
      await said(each.path);
    }

    await page.goto(MEMBERS_SCREEN);
    await expect(memberRows(page)).toHaveCount(3);
    for (const tab of ["Members", "Invitations", "Requests"]) {
      await page.getByRole("tab", { name: tab }).click();
      await said(`${MEMBERS_SCREEN}, the ${tab} tab`);
    }

    await page.getByRole("tab", { name: "Members" }).click();
    await memberButton(page, "Priya Shah").click();
    const sheet = sheetOf(page, "Priya Shah");
    await expect(sheet).toBeVisible();
    await removalOf(sheet).getByRole("button", { name: "Remove Priya Shah", exact: true }).click();
    await expect(removalOf(sheet).getByRole("group")).toBeVisible();
    await expect(page.locator("body"), "a member's sheet").not.toContainText(organisation);
    expect(await sheet.ariaSnapshot(), "a member's sheet").not.toMatch(organisation);

    await page.goto(AUDIT_LOG_SCREEN);
    const auditLog = page.getByRole("region", { name: "Audit log" });
    await expect(auditLog.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveCount(1);
    await auditLog.getByRole("button", { name: /^Details of/ }).click();
    await expect(auditLog).toContainText("platform.workspace.provisioned");
    await said(`${AUDIT_LOG_SCREEN}, an event opened`);
    await auditLog.getByRole("combobox", { name: "Family" }).click();
    await expect(page.getByRole("listbox"), "the families listed").not.toContainText(organisation);
    await page.keyboard.press("Escape");

    await page.goto(MEMBERS_SCREEN);
    await memberButton(page, "Priya Shah").click();
    await revokeButton(sheet, "Priya Shah").click();
    await expect(sheet.getByRole("status")).toContainText("credentials here are revoked");
    await expect(page.locator("body"), "a revocation").not.toContainText(organisation);
    expect(await sheet.ariaSnapshot(), "a revocation").not.toMatch(organisation);

    await page.goto(AUDIT_LOG_SCREEN);
    await expect(auditLog).toContainText("Member credentials revoked");
    await said(`${AUDIT_LOG_SCREEN}, a revocation logged`);

    // A modal hides the page behind it from the tree, so each one is read on its own.
    const saidIn = async (modal: Locator, where: string) => {
      await expect(modal).toBeVisible();
      await expect(page.locator("body"), where).not.toContainText(organisation);
      expect(await modal.ariaSnapshot(), where).not.toMatch(organisation);
    };

    // Last, so the audit log above reads the one event the workspace's provisioning wrote.
    await page.goto(MEMBERS_SCREEN);
    await expect(memberRows(page)).toHaveCount(3);
    const inviting = page.getByRole("dialog", { name: "Invite a person" });
    await page.getByRole("tab", { name: "Invitations" }).click();
    await page.getByRole("button", { name: "Invite a person" }).click();
    await saidIn(inviting, "the invite dialog");
    await inviting.getByLabel("Email address").fill(anAddress("invited"));
    await inviting.getByRole("button", { name: "Send the invitation" }).click();
    await expect(inviting.getByRole("button", { name: "Done" })).toBeVisible();
    await saidIn(inviting, "the invite dialog's answer");
    await inviting.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("region", { name: "Invitations" }).getByRole("row")).toHaveCount(2);
    await said("the Invitations tab with an invitation waiting");

    const asker = await person(request, anAddress("asker"), { displayName: "Ola Asker" });
    await askToJoin(request, { slug, requesterId: asker.id, reason: "I bid for the rail work." });
    await page.getByRole("tab", { name: "Requests" }).click();
    await expect(page.getByRole("region", { name: "Requests" }).getByRole("row")).toHaveCount(2);
    await said("the Requests tab with a request waiting");
    const approving = page.getByRole("dialog", { name: "Approve the request from Ola Asker" });
    await page.getByRole("button", { name: "Approve the request from Ola Asker" }).click();
    await saidIn(approving, "the approve dialog");
    await approving.getByRole("button", { name: "Approve and send the invitation" }).click();
    await expect(approving).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Requests" })).toContainText("Approved.");
    await said("the Requests tab once the request is approved");

    await page.goto(GROUPS_SCREEN);
    const naming = page.getByRole("textbox", { name: "Name of a new group" });
    await naming.fill("Site leads");
    await naming.press("Enter");
    await expect(page.getByRole("button", { name: "Site leads", exact: true })).toBeFocused();
    await said(`${GROUPS_SCREEN}, a group created`);
    await page.getByRole("button", { name: "Site leads", exact: true }).click();
    const group = page.getByRole("dialog", { name: "Site leads" });
    await saidIn(group, "a group's sheet");
    await group.getByRole("button", { name: "Delete Site leads" }).click();
    await saidIn(
      page.getByRole("alertdialog", { name: "Delete Site leads" }),
      "a group's deletion",
    );

    // The accept page stands outside the shell, so it is read without the People heading.
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
      page.getByRole("heading", {
        level: 1,
        name: INVITATION_WORDS.heading("Wolds Fabrication"),
      }),
    ).toBeVisible();
    await saidOnTheAcceptPage("the accept page");
    await page.goto(`/invitations/${forSomeoneElse.id}`);
    await expect(page.getByRole("alert")).toHaveText(
      sentenceOf(SAID_OF_ACCEPTING["invitation-for-another-address"]),
    );
    await saidOnTheAcceptPage("the accept page refusing another address");
  });
});

const PAGE_OF_ROWS = 25;

const tickOf = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("checkbox", { name: `Select ${name}`, exact: true });

const selectionBar = (page: Page): Locator => page.getByRole("toolbar", { name: SELECTED_MEMBERS });

const selectionAct = (page: Page, act: string): Locator =>
  selectionBar(page).getByRole("button", { name: act, exact: true });

const listHeading = (page: Page): Locator =>
  membersRegion(page).getByRole("heading", { level: 2, name: "Members" });

const pagesOf = (page: Page): Locator => page.getByRole("navigation", { name: "Pages of members" });

const saidInTheList = (page: Page, words: string): Locator =>
  membersRegion(page).getByRole("status").filter({ hasText: words });

const refusedLine = (name: string, said: { readonly why: string; readonly next: string }) =>
  `${name}: ${sentenceOf(said)}`;

/** Matched by name anywhere in the path, because the client batches its calls. */
const BULK_ROLE_CHANGE = (url: URL): boolean => url.pathname.includes("members.bulkChangeRole");

/** More members than one page holds, named so the list's own order is their number's. */
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
  await page.goto(MEMBERS_SCREEN);
  await signIn(page, api, admin);
  await expect(memberRows(page)).toHaveCount(PAGE_OF_ROWS);
  return workspace;
};

/** Opens the bar's Change role and answers its dialog, the role select in focus. */
const changeRoleOpened = async (page: Page, count: number): Promise<Locator> => {
  await selectionAct(page, BULK_WORDS.changeRole.act).click();
  const dialog = page.getByRole("dialog", { name: BULK_WORDS.changeRole.title(count) });
  await expect(dialog.getByRole("combobox", { name: "Role" })).toBeFocused();
  return dialog;
};

/** The Admin signed in ticks only themself and confirms the bar's Remove. */
const removedThemselfThroughTheBar = async (page: Page): Promise<void> => {
  await tickOf(page, "Test person").check();
  await selectionAct(page, BULK_WORDS.remove.act).click();
  await page
    .getByRole("dialog", { name: BULK_WORDS.remove.title(1) })
    .getByRole("button", { name: BULK_WORDS.remove.commit(1) })
    .click();
};

test.describe("bulk acts on the members ticked", () => {
  test("AE1: refuses demoting both Admins, naming each, ticks kept", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Calder Gilding");
    await tickOf(page, "Test person").check();
    await tickOf(page, "Ada Hartley").check();

    const dialog = await changeRoleOpened(page, 2);
    await expect(dialog).toContainText(INCLUDES_YOU);
    await dialog.getByRole("button", { name: BULK_WORDS.changeRole.commit(2, "Viewer") }).click();

    const refused = membersRegion(page).getByRole("alert");
    await expect(refused).toContainText(BULK_WORDS.refused(2));
    const lastAdmin = SAID_OF_TICKED_MEMBERS["last-admin"];
    for (const name of ["Test person", "Ada Hartley"]) {
      await expect(refused).toContainText(refusedLine(name, lastAdmin));
      await expect(tickOf(page, name)).toBeChecked();
      await expect(rowOf(page, name)).toContainText(lastAdmin.why);
      await expect(cellOf(page, name, "Role")).toHaveText("Admin");
    }
    await expect(selectionBar(page).getByRole("status")).toHaveText("2 members selected.");
    await passesTheAccessibilityGate();
  });

  test("names a refused person whose row the search hides", async ({ page, request }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Calder Lettering");
    await tickOf(page, "Test person").check();
    await tickOf(page, "Ada Hartley").check();
    await searchBox(page).fill("Ada");
    await expect(memberRows(page)).toHaveCount(1);
    await expect(selectionBar(page).getByRole("status")).toHaveText(
      "2 members selected, 1 not shown.",
    );

    const dialog = await changeRoleOpened(page, 2);
    await dialog.getByRole("button", { name: BULK_WORDS.changeRole.commit(2, "Viewer") }).click();

    await expect(membersRegion(page).getByRole("alert")).toContainText(
      refusedLine("Test person", SAID_OF_TICKED_MEMBERS["last-admin"]),
    );
    await expect(selectionBar(page).getByRole("status")).toHaveText(
      "2 members selected, 1 not shown.",
    );
    await expect(listHeading(page)).toBeFocused();
    await page.keyboard.press(PEOPLE_KEYSTROKES.clearSelection.key);
    await expect(selectionBar(page)).toBeHidden();
    await searchBox(page).clear();
    await expect(tickOf(page, "Test person")).not.toBeChecked();
  });

  test("filters by group and sorts, both held in the address", async ({ page, request }) => {
    const { adminId, workspaceId, joined } = await anAdminAtPeople(page, request, "Wharfe Sorting");
    await makeGroups(request, {
      workspaceId,
      userId: adminId,
      names: ["Site leads"],
      memberIds: joined.filter((member) => member.role === "Viewer").map((member) => member.id),
    });
    await page.reload();
    const names = memberRows(page).getByRole("button", {
      name: /^(Priya Shah|Sam Okoro|Test person)$/,
    });

    await membersRegion(page).getByRole("combobox", { name: "Filter by group" }).click();
    await page.getByRole("option", { name: "Site leads", exact: true }).click();
    await expect(names).toHaveText(["Sam Okoro"]);
    await expect(membersRegion(page).getByText("1 of 3 people match these filters.")).toBeVisible();
    await membersRegion(page).getByRole("combobox", { name: "Filter by group" }).click();
    await page.getByRole("option", { name: "Any group", exact: true }).click();
    await expect(names).toHaveCount(3);

    const person = membersRegion(page).getByRole("columnheader", { name: "Person" });
    await person.getByRole("button").click();
    await expect(person).toHaveAttribute("aria-sort", "ascending");
    await person.getByRole("button").click();
    await expect(person).toHaveAttribute("aria-sort", "descending");
    await expect(names).toHaveText(["Test person", "Sam Okoro", "Priya Shah"]);
    await page.reload();
    await expect(names).toHaveText(["Test person", "Sam Okoro", "Priya Shah"]);
  });

  test("AE8: adds ten to a group, counting two already in", async ({
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
    await page.goto(MEMBERS_SCREEN);
    await signIn(page, request, admin);
    await expect(memberRows(page)).toHaveCount(10);

    await membersRegion(page)
      .getByRole("checkbox", { name: "Select every member on this page" })
      .check();
    await expect(selectionBar(page).getByRole("status")).toHaveText("10 members selected.");
    await selectionAct(page, BULK_WORDS.addToGroup.act).click();
    const dialog = page.getByRole("dialog", { name: BULK_WORDS.addToGroup.title(10) });
    const group = dialog.getByRole("combobox", { name: "Group" });
    await expect(group).toBeFocused();
    await group.click();
    await page.getByRole("option", { name: "Sales", exact: true }).click();
    await dialog.getByRole("button", { name: BULK_WORDS.addToGroup.commit(10, "Sales") }).click();

    await expect(saidInTheList(page, BULK_WORDS.addToGroup.done(8, "Sales", 2))).toBeVisible();
    await expect(listHeading(page)).toBeFocused();
    await expect(selectionBar(page)).toBeHidden();
    await expect(cellOf(page, "Seller 9", "Groups")).toHaveText("Sales");
    await passesTheAccessibilityGate();
  });

  test("AE9: demoting yourself says so, then lands on Editor's home", async ({ page, request }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Esk Gilding");
    await tickOf(page, "Test person").check();

    const dialog = await changeRoleOpened(page, 1);
    await expect(dialog).toContainText(INCLUDES_YOU);
    await editorPickedByKeyboard(page, dialog.getByRole("combobox", { name: "Role" }));
    await dialog.getByRole("button", { name: BULK_WORDS.changeRole.commit(1, "Editor") }).click();

    await landedAtHome(page, "Editor");
    await expect(page.getByRole("status").filter({ hasText: homeNowSaid("Editor") })).toBeVisible();
  });

  test("removing yourself lands on the chooser, without this workspace", async ({
    page,
    request,
  }) => {
    const workspace = await anAdminBesideAnotherAtPeople(page, request, "Esk Ropeworks");
    const others = ["Ure Ropeworks", "Nidd Ropeworks"];
    for (const name of others) {
      const other = await provision(request, { name });
      await addMember(request, {
        workspaceId: other.workspaceId,
        userId: workspace.admin.id,
        role: "Viewer",
      });
    }
    // The switcher holds a list of every workspace, which must not outlive the removal.
    await switcherOf(page, "Esk Ropeworks").click();
    await expect(switcherMenuOf(page, "Esk Ropeworks")).toContainText("Ure Ropeworks");
    await page.keyboard.press("Escape");

    await tickOf(page, "Test person").check();
    await selectionAct(page, BULK_WORDS.remove.act).click();
    const dialog = page.getByRole("dialog", { name: BULK_WORDS.remove.title(1) });
    await expect(dialog).toContainText(INCLUDES_YOU);
    await dialog.getByRole("button", { name: BULK_WORDS.remove.commit(1) }).click();

    await expect(page).toHaveURL(/\/choose-workspace$/);
    await expect(page.getByRole("heading", { level: 1, name: PICKER_WORDS.heading })).toBeVisible();
    for (const name of others) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Esk Ropeworks", exact: true })).toHaveCount(0);
  });

  test("removing yourself, in one other workspace, opens that one", async ({ page, request }) => {
    const workspace = await anAdminBesideAnotherAtPeople(page, request, "Esk Sailmakers");
    const other = await provision(request, { name: "Ure Sailmakers" });
    await addMember(request, {
      workspaceId: other.workspaceId,
      userId: workspace.admin.id,
      role: "Viewer",
    });

    await removedThemselfThroughTheBar(page);

    // The session still names the workspace left, so the chooser must not take it as the open one.
    await landedAtHome(page, "Viewer");
    await expect(switcherOf(page, "Ure Sailmakers")).toBeVisible();
  });

  test("removing yourself, in no other workspace, reaches no-workspace", async ({
    page,
    request,
  }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Esk Netmakers");
    await switcherOf(page, "Esk Netmakers").click();
    await expect(switcherMenuOf(page, "Esk Netmakers")).toBeVisible();
    await page.keyboard.press("Escape");

    await removedThemselfThroughTheBar(page);

    await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  });

  test("bulk Remove names the count and opens on Cancel", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Rye Ropeworks");
    await tickOf(page, "Priya Shah").check();
    await tickOf(page, "Sam Okoro").check();

    const remove = selectionAct(page, BULK_WORDS.remove.act);
    await remove.click();
    const dialog = page.getByRole("dialog", { name: BULK_WORDS.remove.title(2) });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog).toHaveAccessibleDescription(BULK_WORDS.remove.consequence);
    await expect(dialog).not.toContainText(INCLUDES_YOU);
    await passesTheAccessibilityGate();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();
    await expect(memberRows(page)).toHaveCount(3);

    await remove.click();
    await dialog.getByRole("button", { name: BULK_WORDS.remove.commit(2) }).click();
    await expect(memberRows(page)).toHaveCount(1);
    await expect(saidInTheList(page, BULK_WORDS.remove.done(2, 0))).toBeVisible();
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
    await expect(selectionBar(page).getByRole("status")).toHaveText(
      "3 members selected, 2 not shown.",
    );

    const dialog = await changeRoleOpened(page, 3);
    const commit = dialog.getByRole("button", { name: BULK_WORDS.changeRole.commit(3, "Viewer") });
    await commit.focus();
    await clockTheNextKey(page, {
      at: "//tr[.//button[normalize-space(.)='Person 27']]/td[3]",
      reads: "Viewer",
    });
    await page.keyboard.press("Enter");

    await expect(saidInTheList(page, BULK_WORDS.changeRole.done(3, "Viewer", 0))).toBeVisible();
    await theActLandedWithinItsBudget(page, "bulk role change");
    await page.keyboard.press(PEOPLE_KEYSTROKES.previousPage.key);
    await expect(cellOf(page, "Person 01", "Role")).toHaveText("Viewer");
    await expect(cellOf(page, "Person 02", "Role")).toHaveText("Viewer");
    await expect(cellOf(page, "Person 03", "Role")).toHaveText("Editor");
    await page.reload();
    await expect(cellOf(page, "Person 01", "Role")).toHaveText("Viewer");
  });

  test("AE12: page 2 of Editors comes back on Back", async ({ page, request }) => {
    await aWorkspaceOfThirtyEditors(page, request, "Ribble Cabling");
    await membersRegion(page).getByRole("combobox", { name: "Filter by role" }).click();
    await page.getByRole("option", { name: "Editor", exact: true }).click();
    await pagesOf(page).getByRole("button", { name: "Next page" }).click();
    await expect(memberRows(page)).toHaveCount(5);
    await expect(pagesOf(page).getByRole("status")).toHaveText("Showing 26–30 of 30.");

    // A member still opens as a sheet over the list, so the leaving is to another screen.
    await memberButton(page, "Person 27").click();
    await expect(sheetOf(page, "Person 27")).toBeVisible();
    await page.keyboard.press("Escape");
    await nav(page).getByRole("link", { name: "Groups" }).click();
    await expect(page).toHaveURL(new RegExp(`${GROUPS_SCREEN}$`));
    await page.goBack();

    await expect(memberRows(page)).toHaveCount(5);
    await expect(rowOf(page, "Person 26")).toBeVisible();
    await expect(pagesOf(page).getByRole("status")).toHaveText("Showing 26–30 of 30.");
    await expect(membersRegion(page).getByRole("combobox", { name: "Filter by role" })).toHaveText(
      "Editor",
    );
  });

  test("keyboard alone: tick two, act, focus lands on the list", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await skippedToMembers(page, request, "Calder Spinning");

    const keystrokes = await keystrokesListed(page, MEMBERS.name);
    await expect(keystrokes).toContainText(PEOPLE_KEYSTROKES.changeSelectedRoles.act);
    await expect(keystrokes).toContainText(PEOPLE_KEYSTROKES.tick.act);
    await keystrokesDismissed(page, keystrokes);

    await tabUntilFocused(page, tickOf(page, "Priya Shah"));
    await page.keyboard.press("Space");
    await tabUntilFocused(page, memberButton(page, "Sam Okoro"));
    await page.keyboard.press(PEOPLE_KEYSTROKES.tick.key);
    await expect(selectionBar(page).getByRole("status")).toHaveText("2 members selected.");

    await page.keyboard.press(`Shift+${PEOPLE_KEYSTROKES.changeSelectedRoles.key}`);
    const dialog = page.getByRole("dialog", { name: BULK_WORDS.changeRole.title(2) });
    const role = dialog.getByRole("combobox", { name: "Role" });
    await expect(role).toBeFocused();
    await editorPickedByKeyboard(page, role);
    await tabUntilFocused(
      page,
      dialog.getByRole("button", { name: BULK_WORDS.changeRole.commit(2, "Editor") }),
    );
    await page.keyboard.press("Enter");

    await expect(listHeading(page)).toBeFocused();
    await expect(saidInTheList(page, BULK_WORDS.changeRole.done(1, "Editor", 1))).toBeVisible();
    await expect(cellOf(page, "Sam Okoro", "Role")).toHaveText("Editor");
    await passesTheAccessibilityGate();
  });

  test("a ticked person removed meanwhile is named, the rest kept", async ({ page, request }) => {
    const { workspaceId, joined } = await anAdminAtPeople(page, request, "Wharfe Spinning");
    const sam = joined.find((member) => member.displayName === "Sam Okoro");
    if (sam === undefined) throw new Error("Sam Okoro was joined");
    await tickOf(page, "Priya Shah").check();
    await tickOf(page, "Sam Okoro").check();
    await removeMember(request, { workspaceId, userId: sam.id });

    const dialog = await changeRoleOpened(page, 2);
    await dialog.getByRole("button", { name: BULK_WORDS.changeRole.commit(2, "Viewer") }).click();

    const refused = membersRegion(page).getByRole("alert");
    await expect(refused).toContainText(BULK_WORDS.refused(1));
    await expect(refused.getByRole("listitem")).toHaveText([
      refusedLine("Sam Okoro", SAID_OF_TICKED_MEMBERS["no-such-member"]),
    ]);
    await expect(tickOf(page, "Priya Shah")).toBeChecked();
    await expect(cellOf(page, "Priya Shah", "Role")).toHaveText("Editor");
  });

  test("a set answered changed-meanwhile comes back, saying try again", async ({
    page,
    request,
  }) => {
    await anAdminAtPeople(page, request, "Wharfe Weaving");
    await page.route(BULK_ROLE_CHANGE, (route) =>
      route.fulfill({
        status: 409,
        json: [
          {
            error: {
              message: "changed-meanwhile",
              code: -32_603,
              data: {
                code: "CONFLICT",
                httpStatus: 409,
                refusal: { word: "changed-meanwhile", class: "conflict" },
              },
            },
          },
        ],
      }),
    );
    await tickOf(page, "Priya Shah").check();
    await tickOf(page, "Sam Okoro").check();

    const dialog = await changeRoleOpened(page, 2);
    await dialog.getByRole("button", { name: BULK_WORDS.changeRole.commit(2, "Viewer") }).click();

    await saysItsSentenceNotItsWord(membersRegion(page).getByRole("alert"), {
      table: SAID_OF_TICKED_MEMBERS,
      word: "changed-meanwhile",
    });
    await expect(tickOf(page, "Priya Shah")).toBeChecked();
    await expect(tickOf(page, "Sam Okoro")).toBeChecked();
    await expect(cellOf(page, "Priya Shah", "Role")).toHaveText("Editor");
  });

  test("the row menu's Change role acts on its one member", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Nidd Weaving");
    await membersRegion(page).getByRole("button", { name: "Acts for Sam Okoro" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Open",
      "Change role",
      "Add to group",
      "Remove",
    ]);
    await menu.getByRole("menuitem", { name: "Change role" }).click();

    const sheet = sheetOf(page, "Sam Okoro");
    await expect(sheet.getByRole("radio", { name: "Viewer", exact: true })).toBeFocused();
    await sheet.getByRole("radio", { name: "Editor", exact: true }).click();
    await sheet.getByRole("button", { name: "Make Sam Okoro an Editor" }).click();
    await expect(sheet.getByRole("status")).toHaveText(
      "Sam Okoro is an Editor now, from their next request.",
    );
    await page.keyboard.press("Escape");
    await expect(cellOf(page, "Sam Okoro", "Role")).toHaveText("Editor");
    await expect(selectionBar(page)).toBeHidden();
  });

  test("at 320 pixels shows person and role, hiding the rest", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Ure Weaving");
    await expect(membersRegion(page).getByRole("columnheader", { name: "Joined" })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 720 });

    const heads = membersRegion(page).getByRole("columnheader");
    await expect(heads.filter({ hasText: /^(Person|Role)$/ })).toHaveCount(2);
    await expect(heads.filter({ hasText: /^(Groups|Joined)$/ })).toHaveCount(0);
    const room = await page.evaluate(() => {
      const table = document.querySelector('[data-slot="table-container"]');
      return {
        page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
        table: [table?.scrollWidth ?? 0, table?.clientWidth ?? 0],
      };
    });
    expect(room.page[0], "the page scrolls sideways").toBeLessThanOrEqual(room.page[1] ?? 0);
    expect(room.table[0], "the table scrolls sideways").toBeLessThanOrEqual(room.table[1] ?? 0);

    await membersRegion(page).getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Groups" }).click();
    await page.keyboard.press("Escape");
    await expect(heads.filter({ hasText: /^Groups$/ })).toHaveCount(1);
  });
});
