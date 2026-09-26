import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { screenById, viewsOf } from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextKey,
  person,
  provision,
  signIn,
  skipLinkReachesTheScreen,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const ACT_BUDGET_MS = 100;

const people = screenById("people");

const MEMBERS_VIEW = "/people/members";

const AUDIT_LOG_VIEW = "/people/audit-log";

const rail = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const membersRegion = (page: Page) => page.getByRole("region", { name: "Members" });

const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search by name or address" });

/** The header row is a row too, so the members are the rows with a cell. */
const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator => memberRows(page).filter({ hasText: name });

const memberButton = (page: Page, name: string): Locator =>
  membersRegion(page).getByRole("button", { name, exact: true });

const sheetOf = (page: Page, name: string): Locator => page.getByRole("dialog", { name });

const rolePicker = (sheet: Locator): Locator => sheet.getByRole("radiogroup", { name: "Role" });

const removalOf = (sheet: Locator): Locator => sheet.getByRole("region", { name: "Removal" });

/** The one output the Members region holds as a child of its own: the count of people. */
const THE_COUNT = "//section[h2='Members']/output";

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
  readonly joined: readonly Joined[];
  readonly stranger: string;
}> => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: admin });
  const joined: readonly Joined[] = [
    { email: anAddress("priya"), displayName: "Priya Shah", role: "Editor" },
    { email: anAddress("sam"), displayName: "Sam Okoro", role: "Viewer" },
  ];
  for (const member of joined) {
    const made = await person(api, member.email, { displayName: member.displayName });
    await addMember(api, {
      workspaceId: workspace.workspaceId,
      userId: made.id,
      role: member.role,
    });
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
  await rail(page).getByRole("link", { name: "People" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  return { admin, joined, stranger };
};

/** The Admin signed in is one of two, so they may demote or remove themself. */
const anAdminBesideAnotherAtPeople = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
): Promise<void> => {
  const admin = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail: admin });
  const successor = await person(api, anAddress("ada"), { displayName: "Ada Hartley" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: successor.id, role: "Admin" });
  await page.goto(MEMBERS_VIEW);
  await signIn(page, api, admin);
  await expect(memberRows(page)).toHaveCount(2);
};

const removedThroughTheirSheet = async (page: Page, name: string): Promise<void> => {
  await memberButton(page, name).click();
  const removal = removalOf(sheetOf(page, name));
  await removal.getByRole("button", { name: `Remove ${name}`, exact: true }).click();
  await removal.getByRole("button", { name: `Remove ${name} from this workspace` }).click();
};

test.describe("the People screen's Members view", () => {
  test("opens People on Members, and no view is called Roles", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Calder Joinery");

    await expect(page).toHaveURL(new RegExp(`${MEMBERS_VIEW}$`));
    await expect(page.getByRole("navigation", { name: "People" }).getByRole("link")).toHaveText([
      "Members",
      "Groups",
      "Owners",
      "Thresholds",
      "Erasure and suppression",
      "Tokens",
      "Audit log",
    ]);
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
      const row = rowOf(page, member.displayName);
      await expect(row).toContainText(member.email);
      await expect(row.getByRole("cell").nth(1)).toHaveText(member.role);
      await expect(row.getByRole("cell").nth(2)).toHaveText("No group");
    }
    await expect(rowOf(page, admin).getByRole("cell").nth(1)).toHaveText("Admin");
    await expect(rowOf(page, admin).getByRole("cell").nth(3)).toHaveText(
      /^\d{1,2} [A-Z][a-z]+ \d{4}$/,
    );

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
    await membersRegion(page).getByRole("button", { name: "Clear the search" }).click();

    await expect(memberRows(page)).toHaveCount(3);
    await expect(searchBox(page)).toHaveValue("");
    await expect(searchBox(page)).toBeFocused();
  });

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Dales Engineering");

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto(MEMBERS_VIEW);
    await expect(memberRows(page)).toHaveCount(3);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "members list", description: `${elapsed} ms` });
    expect(elapsed, "the list of three members rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`refuses a member at ${role} the list, in its word`, async ({ page, request }) => {
      const workspace = await aMemberSignedInAt(page, request, role, MEMBERS_VIEW);

      const refused = membersRegion(page).getByRole("alert");
      await expect(refused).toContainText("Refused: role-forbids.");
      await expect(refused).toContainText("Only an Admin of this workspace sees its members.");
      await expect(membersRegion(page).getByRole("table")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(workspace.admin.email);
    });
  }

  test("lets an Admin reach and search members by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Calder Castings");
    // A fresh document, so the first Tab starts from the top rather than from the rail's link.
    await page.goto(MEMBERS_VIEW);
    await expect(memberRows(page)).toHaveCount(3);

    await skipLinkReachesTheScreen(page);

    await page.keyboard.press("?");
    const keystrokes = page.getByRole("dialog", { name: "Keystrokes on People" });
    await expect(keystrokes).toContainText("Search the members by name or address");
    await page.keyboard.press("Escape");
    await expect(keystrokes).toHaveCount(0);
    // Focus returns to the button a task after the list is gone, taking it from wherever a sooner
    // `/` moved it.
    await expect(page.getByRole("button", { name: "Keystrokes", exact: true })).toBeFocused();

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
        - table:
          - caption: /Members of this workspace/
          - rowgroup:
            - row "Person Role Groups Joined":
              - columnheader "Person"
              - columnheader "Role"
              - columnheader "Groups"
              - columnheader "Joined"
          - rowgroup:
            - row /Priya Shah/:
              - cell /Priya Shah/:
                - button "Priya Shah"
              - cell "Editor"
              - cell "No group"
              - cell /\\d{4}/
            - row /Sam Okoro/:
              - cell /Sam Okoro/:
                - button "Sam Okoro"
              - cell "Viewer"
              - cell "No group"
              - cell /\\d{4}/
            - row /Test person/:
              - cell /Test person/:
                - button "Test person"
              - cell "Admin"
              - cell "No group"
              - cell /\\d{4}/
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
        - button "Close"
    `);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(memberButton(page, "Priya Shah")).toBeFocused();
  });

  test("changes a member's role within its budget, and it holds", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Nidd Valley Casting");

    await memberButton(page, "Sam Okoro").click();
    const sheet = sheetOf(page, "Sam Okoro");
    await sheet.getByRole("radio", { name: "Editor", exact: true }).click();
    const commit = sheet.getByRole("button", { name: "Make Sam Okoro an Editor" });
    await commit.focus();
    await clockTheNextKey(page, {
      at: "//tr[.//button[normalize-space(.)='Sam Okoro']]/td[2]",
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
    await expect(rowOf(page, "Sam Okoro").getByRole("cell").nth(1)).toHaveText("Editor");
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

    const refused = sheet.getByRole("alert");
    await expect(refused).toContainText("Refused: last-admin.");
    await expect(refused).toContainText("Make someone else an Admin first.");
    await expect(sheet.getByRole("region", { name: "Membership" })).toContainText("Admin");
    // The refusal re-enables the button mid-fade from its disabled look; an audit inside that fade
    // reads a contrast nobody settles on.
    await expect(commit).toHaveCSS("opacity", "1");
    await passesTheAccessibilityGate();
    await page.keyboard.press("Escape");
    await expect(rowOf(page, "Test person").getByRole("cell").nth(1)).toHaveText("Admin");
  });

  test("an Admin demoting themself sees their new role at once", async ({ page, request }) => {
    await anAdminBesideAnotherAtPeople(page, request, "Esk Presswork");
    const bar = page.getByRole("banner");
    await expect(bar).toContainText("Admin");

    await memberButton(page, "Test person").click();
    const sheet = sheetOf(page, "Test person");
    await sheet.getByRole("radio", { name: "Editor", exact: true }).click();
    await sheet.getByRole("button", { name: "Make Test person an Editor" }).click();
    await expect(sheet.getByRole("status")).toHaveText(
      "Test person is an Editor now, from their next request.",
    );
    await page.keyboard.press("Escape");

    await expect(bar).toContainText("Editor");
    await expect(bar).not.toContainText("Admin");
    await expect(membersRegion(page).getByRole("alert")).toContainText("Refused: role-forbids.");
  });

  test("opens a member and changes their role by keyboard alone", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Calder Rolling");
    await page.goto(MEMBERS_VIEW);
    await expect(memberRows(page)).toHaveCount(3);

    await page.keyboard.press("c");
    await expect(membersRegion(page)).toContainText(
      "Move focus to a member first: the keystroke acts on the member in focus.",
    );

    await page.keyboard.press("?");
    const keystrokes = page.getByRole("dialog", { name: "Keystrokes on People" });
    await expect(keystrokes).toContainText("Open the member in focus");
    await expect(keystrokes).toContainText("Change the role of the member in focus");
    await expect(keystrokes).toContainText("Revoke the credentials here of the member in focus");
    await expect(keystrokes).toContainText("Remove the member in focus");
    await page.keyboard.press("Escape");

    await memberButton(page, "Priya Shah").focus();
    await page.keyboard.press("o");
    const sheet = sheetOf(page, "Priya Shah");
    await expect(sheet.getByRole("heading", { level: 2, name: "Priya Shah" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(memberButton(page, "Priya Shah")).toBeFocused();

    await page.keyboard.press("c");
    await expect(sheet.getByRole("radio", { name: "Editor", exact: true })).toBeFocused();
    // The group checks the radio it moves to only while the arrow is held, as a person's is.
    await page.keyboard.press("ArrowDown", { delay: 50 });
    await expect(sheet.getByRole("radio", { name: "Viewer", exact: true })).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(sheet.getByRole("button", { name: "Make Priya Shah a Viewer" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("status")).toHaveText(
      "Priya Shah is a Viewer now, from their next request.",
    );

    await page.keyboard.press("Escape");
    await expect(memberButton(page, "Priya Shah")).toBeFocused();
    await expect(rowOf(page, "Priya Shah").getByRole("cell").nth(1)).toHaveText("Viewer");
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
  await page.goto(MEMBERS_VIEW);
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
    await page.goto(MEMBERS_VIEW);
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

    const refused = membersRegion(page).getByRole("alert");
    await expect(refused).toContainText("Refused: credentials-revoked.");
    await expect(refused).toContainText("Sign in again.");
    await page.reload();
    await signIn(page, request, admin);
    await expect(page).toHaveURL(new RegExp(`${MEMBERS_VIEW}$`));
    await expect(memberRows(page)).toHaveCount(1);
    await expect(membersRegion(page).getByRole("alert")).toHaveCount(0);
  });

  test("opens a member's credentials and revokes them by keyboard alone", async ({
    page,
    request,
  }) => {
    await anAdminAtPeople(page, request, "Nidd Presswork");
    await page.goto(MEMBERS_VIEW);
    await expect(memberRows(page)).toHaveCount(3);

    await page.keyboard.press("v");
    await expect(membersRegion(page)).toContainText(
      "Move focus to a member first: the keystroke acts on the member in focus.",
    );

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

    const refused = membersRegion(page).getByRole("alert");
    await expect(refused).toContainText("Refused: last-admin.");
    await expect(refused).toContainText("Make someone else an Admin first.");
    await expect(memberRows(page)).toHaveCount(3);
    await expect(rowOf(page, "Test person").getByRole("cell").nth(1)).toHaveText("Admin");
    await passesTheAccessibilityGate();
  });

  test("an Admin removing themself is refused the list at once", async ({ page, request }) => {
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

    const refused = membersRegion(page).getByRole("alert");
    await expect(refused).toContainText("Refused: not-a-member.");
    await expect(refused).toContainText("You are not a member of this workspace.");
    await expect(membersRegion(page)).toContainText(
      "Test person is no longer a member of this workspace.",
    );
  });

  test("removes a member by keyboard alone", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Calder Presswork");
    await page.goto(MEMBERS_VIEW);
    await expect(memberRows(page)).toHaveCount(3);

    await page.keyboard.press("d");
    await expect(membersRegion(page)).toContainText(
      "Move focus to a member first: the keystroke acts on the member in focus.",
    );

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

test.describe("the People screen's words", () => {
  // Every People surface joins this test as it is built: the product's word is workspace.
  test("says workspace, never organisation, on every People view", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Ryedale Metalwork");
    const organisation = /organi[sz]ation/i;

    const said = async (where: string) => {
      await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
      await expect(page.locator("body"), where).not.toContainText(organisation);
      expect(await page.locator("body").ariaSnapshot(), where).not.toMatch(organisation);
    };

    for (const view of viewsOf(people)) {
      await page.goto(view.path);
      await said(view.path);
    }

    await page.goto(MEMBERS_VIEW);
    await expect(memberRows(page)).toHaveCount(3);
    for (const tab of ["Members", "Invitations", "Requests"]) {
      await page.getByRole("tab", { name: tab }).click();
      await said(`${MEMBERS_VIEW}, the ${tab} tab`);
    }

    await page.getByRole("tab", { name: "Members" }).click();
    await memberButton(page, "Priya Shah").click();
    const sheet = sheetOf(page, "Priya Shah");
    await expect(sheet).toBeVisible();
    await removalOf(sheet).getByRole("button", { name: "Remove Priya Shah", exact: true }).click();
    await expect(removalOf(sheet).getByRole("group")).toBeVisible();
    await expect(page.locator("body"), "a member's sheet").not.toContainText(organisation);
    expect(await sheet.ariaSnapshot(), "a member's sheet").not.toMatch(organisation);

    await page.goto(AUDIT_LOG_VIEW);
    const auditLog = page.getByRole("region", { name: "Audit log" });
    await expect(auditLog.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveCount(1);
    await auditLog.getByRole("button", { name: /^Details of/ }).click();
    await expect(auditLog).toContainText("platform.workspace.provisioned");
    await said(`${AUDIT_LOG_VIEW}, an event opened`);
    await auditLog.getByRole("combobox", { name: "Family" }).click();
    await expect(page.getByRole("listbox"), "the families listed").not.toContainText(organisation);
    await page.keyboard.press("Escape");

    await page.goto(MEMBERS_VIEW);
    await memberButton(page, "Priya Shah").click();
    await revokeButton(sheet, "Priya Shah").click();
    await expect(sheet.getByRole("status")).toContainText("credentials here are revoked");
    await expect(page.locator("body"), "a revocation").not.toContainText(organisation);
    expect(await sheet.ariaSnapshot(), "a revocation").not.toMatch(organisation);

    await page.goto(AUDIT_LOG_VIEW);
    await expect(auditLog).toContainText("Member credentials revoked");
    await said(`${AUDIT_LOG_VIEW}, a revocation logged`);

    // Last, so the audit log above reads the one event the workspace's provisioning wrote.
    await page.goto(MEMBERS_VIEW);
    await expect(memberRows(page)).toHaveCount(3);
    // A modal hides the page behind it from the tree, so the dialog is read on its own.
    const inviting = page.getByRole("dialog", { name: "Invite a person" });
    const saidInTheDialog = async (where: string) => {
      await expect(page.locator("body"), where).not.toContainText(organisation);
      expect(await inviting.ariaSnapshot(), where).not.toMatch(organisation);
    };
    await page.getByRole("tab", { name: "Invitations" }).click();
    await page.getByRole("button", { name: "Invite a person" }).click();
    await saidInTheDialog("the invite dialog");
    await inviting.getByLabel("Email address").fill(anAddress("invited"));
    await inviting.getByRole("button", { name: "Send the invitation" }).click();
    await expect(inviting.getByRole("button", { name: "Done" })).toBeVisible();
    await saidInTheDialog("the invite dialog's answer");
    await inviting.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("region", { name: "Invitations" }).getByRole("row")).toHaveCount(2);
    await said("the Invitations tab with an invitation waiting");
  });
});
