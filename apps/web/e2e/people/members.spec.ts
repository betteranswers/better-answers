import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { INVITATIONS_WORDS, INVITE_WORDS } from "@/features/people/invitation-words.ts";
import {
  BULK_WORDS,
  MEMBER_PAGE_WORDS,
  MEMBERS_WORDS,
} from "@/features/people/member-action-words.ts";
import { MEMBER_PAGE_KEYSTROKES, PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";

import { expect, test } from "../browser.ts";
import {
  ACTION_SAMPLES,
  actionClocked,
  addMember,
  anAddress,
  clockTheNextKey,
  countOf,
  editorPickedByKeyboard,
  invite,
  pageHidesRefusalWord,
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  person,
  provision,
  alertHasText,
  signIn,
  skipLinkReachesThePage,
  tabOpenedByKeyboard,
  tabUntilFocused,
  actionWithinBudget,
  medianActionWithinBudget,
} from "../harness.ts";
import {
  addressField,
  invitationRows,
  invitationsRegion,
  inviteAction,
  inviteDialog,
  MEMBERS_PAGE,
  memberLink,
  memberRows,
  membersRegion,
  openedByName,
  outcomeOf,
  personHeading,
  selectionAction,
  selectionBar,
  thePage,
  tickOf,
} from "../people-pages.ts";
import { refusalAnswering } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

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

const BULK_ROLE_CHANGE_ASKED = "members.bulkChangeRole";

/** Matched by name anywhere in the path, because the tRPC client batches its calls. */
const BULK_ROLE_CHANGE = (url: URL): boolean => url.pathname.includes(BULK_ROLE_CHANGE_ASKED);

const nav = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const describing = async (control: Locator): Promise<string> =>
  control
    .page()
    .locator(`[id="${(await control.getAttribute("aria-describedby")) ?? ""}"]`)
    .innerText();

const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search by name or address" });

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

const listHeading = (page: Page): Locator =>
  membersRegion(page).getByRole("heading", { level: 2, name: "Members" });

const memberPageAt = (personId: string): string => `${MEMBERS_PAGE}/${personId}`;

const accessOf = (page: Page): Locator => thePage(page).getByRole("region", { name: "Access" });

const rolePicker = (page: Page): Locator => thePage(page).getByRole("radiogroup", { name: "Role" });

const rolePickerRegion = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: "Role", exact: true });

const changeRoleButton = (page: Page): Locator =>
  rolePickerRegion(page).getByRole("button", { name: MEMBER_PAGE_WORDS.changeRole });

const THE_ROLE_HELD = "//section[div[@data-slot='card-header']/h3[normalize-space(.)='Role']]//p";

const removalOf = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: "Removal", exact: true });

const confirmationOf = (page: Page, name: string): Locator =>
  removalOf(page).getByRole("group", { name: new RegExp(name) });

const THE_COUNT = "//section[h2='Members']/div/output";

const accessLine = (term: string): string =>
  `//section[h2='Access']//dt[normalize-space(.)='${term}']/following-sibling::dd[1]`;

const displayNameRegion = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: MEMBER_PAGE_WORDS.displayName });

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
  readonly elsewhere: { readonly workspaceId: string; readonly name: string };
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
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  return {
    admin,
    adminId: workspace.admin.id,
    workspaceId: workspace.workspaceId,
    joined,
    stranger,
    shortName: workspace.shortName,
    elsewhere: { workspaceId: elsewhere.workspaceId, name: elsewhere.name },
  };
};

const asksToSelectAMemberAfter = async (page: Page, key: string): Promise<void> => {
  await expect(outcomeOf(page)).toHaveText("");
  await page.keyboard.press(key);
  await expect(outcomeOf(page)).toHaveText(/\S/);
  await expect(page, "the key opened another page").toHaveURL(
    (url) => url.pathname === MEMBERS_PAGE,
  );
  await expect(selectionBar(page), "the key selected a member").toHaveCount(0);
};

const listedAfresh = async (page: Page, count: number): Promise<void> => {
  await page.goto(MEMBERS_PAGE);
  await expect(memberRows(page)).toHaveCount(count);
};

const namesNoMember = async (page: Page): Promise<void> => {
  await expect(thePage(page).getByRole("link", { name: "Go to Members" })).toBeVisible();
  await expect(thePage(page).getByRole("heading", { level: 2 })).toHaveCount(0);
};

const ENDED_AT = /\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}/;

const signOutButton = (page: Page): Locator =>
  thePage(page).getByRole("button", { name: MEMBER_PAGE_WORDS.signOutHere });

const signOutRegion = (page: Page): Locator =>
  thePage(page).getByRole("region", { name: MEMBER_PAGE_WORDS.signOutHere });

const removedAtAKey = async (
  page: Page,
  api: APIRequestContext,
  workspaceId: string,
  staying: number,
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
    const left = staying + names.length - at - 1;
    await page.reload();
    await memberLink(page, name).click();
    await expect(personHeading(page, name)).toBeVisible();
    await removalOf(page).getByRole("button", { name: MEMBER_PAGE_WORDS.removeMember }).click();
    await removalOf(page).getByRole("button", { name: "Remove", exact: true }).focus();
    await clockTheNextKey(page, { at: THE_COUNT, reads: String(left) });
    const answered = page.waitForResponse((response) => REMOVAL(new URL(response.url())));
    await page.keyboard.press("Enter");
    await expect(memberRows(page)).toHaveCount(left);
    samples.push(await actionClocked(page));
    expect((await answered).ok(), `the removal of ${name} failed`).toBe(true);
  }
  return samples;
};

const ONE_GAP_PX = 16;

const bottomOf = async (drawn: Locator): Promise<number> => {
  const box = await drawn.boundingBox();
  return box === null ? Number.NaN : box.y + box.height;
};

const endsUnderItsLastLine = async (card: Locator, lastLine: Locator): Promise<void> => {
  const named = await card.getByRole("heading").innerText();
  await expect(card.getByRole("status"), `${named}: the status region is not empty`).toHaveText("");
  const [cardEnds, lineEnds] = await Promise.all([bottomOf(card), bottomOf(lastLine)]);
  expect(
    cardEnds - lineEnds,
    `${named}: the card has empty space below its last line`,
  ).toBeLessThanOrEqual(ONE_GAP_PX);
};

const changeRoleOpened = async (page: Page, titled: string): Promise<Locator> => {
  await selectionAction(page, MEMBER_PAGE_WORDS.changeRole).click();
  const dialog = page.getByRole("dialog", { name: titled });
  await expect(dialog.getByRole("combobox", { name: "Role" })).toBeFocused();
  return dialog;
};

const invitationRowOf = (page: Page, address: string): Locator =>
  invitationRows(page).filter({ hasText: address });

const invitationTickOf = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("checkbox", { name: `Select ${address}`, exact: true });

const invitationMenuOf = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("button", { name: `Actions for ${address}` });

const saidInTheTab = (page: Page, address: string | RegExp): Locator =>
  invitationsRegion(page).getByRole("status").filter({ hasText: address });

const invitationOutcome = (page: Page): Locator =>
  invitationsRegion(page).getByRole("status").nth(1);

const THE_INVITATIONS_COUNT = "//section[.//h2[.='Invitations']]//output";

const heldAddresses = (page: Page) =>
  inviteDialog(page).getByRole("list", { name: INVITE_WORDS.list }).getByRole("listitem");

test.describe("the People group's Members page", () => {
  test("an Admin manages members and invitations by keyboard, within budget", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    test.slow();
    const kept = anAddress("kept");
    const dropped = anAddress("dropped");
    const { adminId, workspaceId, joined, elsewhere } = await anAdminAtPeople(
      page,
      request,
      "Calder Castings",
    );
    const priya = joined.find((member) => member.displayName === "Priya Shah");
    assert.ok(priya !== undefined, "Priya Shah is not a member");
    await addMember(request, {
      workspaceId: elsewhere.workspaceId,
      userId: priya.id,
      role: "Viewer",
    });
    for (const email of [kept, dropped]) {
      await invite(request, { workspaceId, email, inviterId: adminId, role: "Viewer" });
    }

    await test.step("shows the list of three members within the list time budget", async () => {
      const started = Date.now();
      await page.goto(MEMBERS_PAGE);
      await expect(memberRows(page)).toHaveCount(3);
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "members list", description: `${elapsed} ms` });
      expect(
        elapsed,
        "the list of three members took longer than its time budget to render",
      ).toBeLessThan(LIST_BUDGET_MS);
    });

    await test.step("lets an Admin reach and search members by keyboard alone", async () => {
      await skipLinkReachesThePage(page);

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
          - combobox "Filter by Role": ${MEMBERS_WORDS.anyRole}
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

    await test.step("passes the accessibility gate with a bulk confirmation open", async () => {
      await tickOf(page, "Sam Okoro").check();
      await selectionAction(page, "Remove").click();
      const confirming = page.getByRole("dialog", { name: BULK_WORDS.remove.title(1) });
      await expect(confirming.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
      await passesTheAccessibilityGate();

      await confirming.getByRole("button", { name: "Cancel" }).click();
      await expect(confirming).toHaveCount(0);
      await tickOf(page, "Sam Okoro").uncheck();
      await expect(selectionBar(page)).toHaveCount(0);
    });

    await test.step("at 320 pixels wide shows only the Person and Role columns, and Columns adds Groups back", async () => {
      const desktop = page.viewportSize();
      assert.ok(desktop !== null, "the page has no viewport");
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

      await page.setViewportSize(desktop);
    });

    await test.step("shows a member's role, their groups, and a description of each role", async () => {
      await listedAfresh(page, 3);
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
      expect(new Set(meanings).size, "two of the three roles share a description").toBe(3);
      await expect(thePage(page).getByRole("radio", { name: "Editor", exact: true })).toBeChecked();
      await expect(changeRoleButton(page)).toBeDisabled();
      await expect(
        thePage(page).getByText("Editor", { exact: true }),
        "the role name appears outside the Role card",
      ).toHaveCount(1);
      await expect(accessOf(page).getByRole("term")).toHaveText([
        "Joined",
        MEMBER_PAGE_WORDS.lastSignedOut,
      ]);

      await expect(thePage(page)).toMatchAriaSnapshot(`
        - main "Page":
          - heading "Priya Shah" [level=1]
          - paragraph: /@/
          - navigation ${JSON.stringify(MEMBER_PAGE_WORDS.sections)}:
            - list:
              - listitem:
                - link "Access"
              - listitem:
                - link "Activity"
              - listitem:
                - link ${JSON.stringify(MEMBER_PAGE_WORDS.removeAndSignOut)}
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
              - button ${JSON.stringify(MEMBER_PAGE_WORDS.changeRole)} [disabled]
              - paragraph: /Priya Shah.*Editor/
            - region "Groups":
              - heading "Groups" [level=3]
              - paragraph
              - link "Go to Groups"
            - region ${JSON.stringify(MEMBER_PAGE_WORDS.displayName)}:
              - heading ${JSON.stringify(MEMBER_PAGE_WORDS.displayName)} [level=3]
              - paragraph
              - button ${JSON.stringify(MEMBER_PAGE_WORDS.flagName)}
          - region "Activity":
            - heading "Activity" [level=2]
          - region ${JSON.stringify(MEMBER_PAGE_WORDS.removeAndSignOut)}:
            - heading ${JSON.stringify(MEMBER_PAGE_WORDS.removeAndSignOut)} [level=2]
            - region ${JSON.stringify(MEMBER_PAGE_WORDS.signOutHere)}:
              - heading ${JSON.stringify(MEMBER_PAGE_WORDS.signOutHere)} [level=3]
              - button ${JSON.stringify(MEMBER_PAGE_WORDS.signOutHere)}
              - paragraph: /Priya Shah/
            - region "Removal":
              - heading "Removal" [level=3]
              - button ${JSON.stringify(MEMBER_PAGE_WORDS.removeMember)}
      `);
      await passesTheAccessibilityGate();

      await thePage(page).getByRole("link", { name: MEMBER_PAGE_WORDS.removeAndSignOut }).click();
      await expect(
        thePage(page).getByRole("heading", { level: 2, name: MEMBER_PAGE_WORDS.removeAndSignOut }),
      ).toBeFocused();
      await expect(page, "the section link changed the page URL").toHaveURL(
        new RegExp(`${memberPageAt(priya.id)}$`),
      );
    });

    await test.step("at 320 pixels wide shows the On This Page links below the member's header, with no sideways scrolling", async () => {
      const desktop = page.viewportSize();
      assert.ok(desktop !== null, "the page has no viewport");
      await page.setViewportSize({ width: 320, height: 720 });
      await expect(
        page.getByRole("banner").getByRole("button", { name: "Menu", exact: true }),
        "the shell kept its wide band at 320 pixels",
      ).toBeVisible();

      const sections = thePage(page).getByRole("navigation", { name: MEMBER_PAGE_WORDS.sections });
      await expect
        .poll(() => roomBetween(personHeading(page, "Priya Shah"), sections), {
          message: "the section nav stacks below the header",
        })
        .toBeGreaterThan(0);
      const room = await page.evaluate(pageRoom);
      expect(room.scrolls, "the page scrolls sideways").toBeLessThanOrEqual(room.holds);

      await page.setViewportSize(desktop);
    });

    await test.step("changes a member's role within the action time budget, and the new role stays after a reload", async () => {
      await listedAfresh(page, 3);
      await openedByName(page, "Sam Okoro");
      await thePage(page).getByRole("radio", { name: "Editor", exact: true }).click();
      const commit = changeRoleButton(page);
      await commit.focus();
      await expect(commit).toHaveAccessibleDescription(/Sam Okoro.*Viewer/);
      await clockTheNextKey(page, { at: THE_ROLE_HELD, reads: "Editor" });
      await page.keyboard.press("Enter");

      await expect(rolePickerRegion(page).getByRole("status")).toHaveText(/Sam Okoro.*Editor/);
      await actionWithinBudget(page, "role change");
      await expect(thePage(page).getByRole("radio", { name: "Editor", exact: true })).toBeFocused();

      await page.reload();
      await expect(thePage(page).getByRole("radio", { name: "Editor", exact: true })).toBeChecked();
      await expect(changeRoleButton(page)).toHaveAccessibleDescription(/Sam Okoro.*Editor/);
      await backToMembers(page);
      await expect(cellOf(page, "Sam Okoro", "Role")).toHaveText("Editor");
    });

    await test.step("opens a member and changes their role by keyboard alone", async () => {
      await listedAfresh(page, 3);
      await skipLinkReachesThePage(page);

      await asksToSelectAMemberAfter(page, PEOPLE_KEYSTROKES.changeRole.key);

      const keystrokes = await keystrokesListed(page, "Members");
      for (const { key } of [
        PEOPLE_KEYSTROKES.open,
        PEOPLE_KEYSTROKES.changeRole,
        PEOPLE_KEYSTROKES.signOut,
        PEOPLE_KEYSTROKES.remove,
      ]) {
        await expect(
          keyListed(keystrokes, key),
          `the keystroke list does not include ${key}`,
        ).toBeVisible();
      }
      await expect(
        keyListed(keystrokes, PEOPLE_KEYSTROKES.approve.key),
        "the Members keystroke list has a keystroke from the Requests tab",
      ).toHaveCount(0);
      await keystrokesDismissed(page, keystrokes);

      await tabUntilFocused(page, memberLink(page, "Priya Shah"));
      await page.keyboard.press(PEOPLE_KEYSTROKES.changeRole.key);
      await expect(thePage(page).getByRole("radio", { name: "Editor", exact: true })).toBeFocused();
      // The radio group checks the focused radio one task later, and only while the arrow key is
      // down. Hold ArrowDown until the check lands.
      await page.keyboard.down("ArrowDown");
      await expect(thePage(page).getByRole("radio", { name: "Viewer", exact: true })).toBeChecked();
      await page.keyboard.up("ArrowDown");
      await page.keyboard.press("Tab");
      await expect(changeRoleButton(page)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(rolePickerRegion(page).getByRole("status")).toHaveText(/Priya Shah.*Viewer/);

      const onThePage = await keystrokesListed(page, "Members");
      for (const { key } of Object.values(MEMBER_PAGE_KEYSTROKES)) {
        await expect(
          keyListed(onThePage, key),
          `the keystroke list does not include ${key}`,
        ).toBeVisible();
      }
      await keystrokesDismissed(page, onThePage);
      await page.keyboard.press(MEMBER_PAGE_KEYSTROKES.remove.key);
      await expect(
        removalOf(page).getByRole("button", { name: MEMBER_PAGE_WORDS.removeMember }),
      ).toBeFocused();
      await page.keyboard.press(MEMBER_PAGE_KEYSTROKES.changeRole.key);
      await expect(thePage(page).getByRole("radio", { name: "Viewer", exact: true })).toBeFocused();

      await backToMembers(page);
      await expect(cellOf(page, "Priya Shah", "Role")).toHaveText("Viewer");
    });

    await test.step("signs a member out within the action time budget, and the time stays after a reload", async () => {
      await listedAfresh(page, 3);
      await openedByName(page, "Priya Shah");
      await expect(accessOf(page)).not.toContainText(ENDED_AT);
      const revoke = signOutButton(page);
      await revoke.focus();
      await clockTheNextKey(page, {
        at: accessLine(MEMBER_PAGE_WORDS.lastSignedOut),
        reads: String(new Date().getFullYear()),
      });
      await page.keyboard.press("Enter");

      await expect(signOutRegion(page).getByRole("status")).toContainText("Priya Shah");
      await actionWithinBudget(page, "revocation");
      await expect(revoke).toBeFocused();
      await expect(accessOf(page)).toContainText(ENDED_AT);
      await passesTheAccessibilityGate();
      await expect(page.locator("body")).not.toContainText(elsewhere.name);
      expect(await thePage(page).ariaSnapshot()).not.toContain(elsewhere.name);

      await page.reload();
      await expect(accessOf(page)).toContainText(ENDED_AT);
    });

    await test.step("an Admin resends and cancels an invitation by keyboard alone", async () => {
      await tabOpenedByKeyboard(page, MEMBERS_PAGE, "Invitations");
      await expect(invitationRows(page)).toHaveCount(2);

      await tabUntilFocused(page, invitationMenuOf(page, dropped));
      await page.keyboard.press(PEOPLE_KEYSTROKES.resend.key);
      await expect(saidInTheTab(page, new RegExp(`${dropped}.*\\d{4}`))).toBeVisible();
      const saidOfTheResend = await invitationOutcome(page).innerText();

      await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
      await expect(invitationTickOf(page, dropped)).toBeChecked();
      await expect(
        invitationOutcome(page),
        "selecting the invitation removed the resend message",
      ).toHaveText(saidOfTheResend);
      await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
      await expect(invitationTickOf(page, dropped)).not.toBeChecked();

      await expect(countOf(invitationsRegion(page))).toHaveText(/\b2\b/);
      await clockTheNextKey(page, { at: THE_INVITATIONS_COUNT, reads: "1" });
      await page.keyboard.press(PEOPLE_KEYSTROKES.cancel.key);
      await expect(invitationRowOf(page, dropped)).toHaveCount(0);
      await actionWithinBudget(page, "cancel");
      await expect(
        invitationsRegion(page).getByRole("heading", { name: "Invitations" }),
      ).toBeFocused();
      await expect(invitationOutcome(page)).toContainText(dropped);
      await expect(
        invitationOutcome(page),
        "after the cancel, the status still shows the resend message",
      ).not.toHaveText(saidOfTheResend);

      const keystrokes = await keystrokesListed(page, "Members");
      for (const listed of [
        PEOPLE_KEYSTROKES.invite,
        PEOPLE_KEYSTROKES.searchInvitations,
        PEOPLE_KEYSTROKES.resend,
        PEOPLE_KEYSTROKES.cancel,
        PEOPLE_KEYSTROKES.tickInvitation,
        PEOPLE_KEYSTROKES.resendSelected,
        PEOPLE_KEYSTROKES.cancelSelected,
        PEOPLE_KEYSTROKES.nextInvitations,
      ]) {
        await expect(
          keyListed(keystrokes, listed.key),
          `the keystroke list does not include ${listed.key}`,
        ).toBeVisible();
      }
      await expect(
        keyListed(keystrokes, PEOPLE_KEYSTROKES.open.key),
        "the Invitations keystroke list has a keystroke from the Members tab",
      ).toHaveCount(0);
      await keystrokesDismissed(page, keystrokes);

      const invited = anAddress("invited");
      await page.keyboard.press(PEOPLE_KEYSTROKES.invite.key);
      await expect(addressField(page)).toBeFocused();
      await page.keyboard.type(invited);
      await page.keyboard.press("Tab");
      await editorPickedByKeyboard(
        page,
        inviteDialog(page).getByRole("combobox", { name: "Role" }),
      );
      await page.keyboard.press("Shift+Tab");
      await expect(addressField(page)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(heldAddresses(page)).toHaveCount(1);
      await expect(addressField(page)).toHaveValue("");
      await page.keyboard.press("Enter");
      await expect(inviteDialog(page).getByRole("status").first()).toContainText(invited);
      await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
      await passesTheAccessibilityGate();
      await page.keyboard.press("Enter");
      await expect(inviteDialog(page)).toHaveCount(0);
      await expect(inviteAction(page)).toBeFocused();
      await expect(invitationRows(page)).toHaveCount(2);

      await expect(invitationsRegion(page)).toMatchAriaSnapshot(`
        - region "Invitations":
          - heading "Invitations" [level=2]
          - status: /\\b2\\b/
          - status: /dropped-\\d+/
          - searchbox "Search by address"
          - radiogroup "Status":
            - radio "Waiting 2" [checked]
            - radio "Accepted 0"
            - radio "Expired 0"
            - radio "Cancelled 1"
          - table:
            - caption
            - rowgroup:
              - row:
                - columnheader "Select every invitation on this page"
                - columnheader "Address"
                - columnheader "Role"
                - columnheader "Sent"
                - columnheader "Expires"
                - columnheader ${JSON.stringify(INVITATIONS_WORDS.invitedBy)}
                - columnheader "Actions"
            - rowgroup:
              - row /invited-/:
                - cell:
                  - checkbox /Select invited-/
                - cell /invited-/
                - cell "Editor"
                - cell /\\d{4}/
                - cell /\\d{4}/
                - cell "Test person"
                - cell:
                  - button /Actions for invited-/
              - row /kept-/
      `);
      await passesTheAccessibilityGate();
    });

    await test.step("removes a member by keyboard alone", async () => {
      await listedAfresh(page, 3);
      await skipLinkReachesThePage(page);

      await asksToSelectAMemberAfter(page, PEOPLE_KEYSTROKES.remove.key);

      await tabUntilFocused(page, memberLink(page, "Sam Okoro"));
      await page.keyboard.press(PEOPLE_KEYSTROKES.remove.key);
      const removal = removalOf(page);
      await expect(
        removal.getByRole("button", { name: MEMBER_PAGE_WORDS.removeMember }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(confirmationOf(page, "Sam Okoro").locator("legend")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(removal.getByRole("button", { name: "Remove", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(new RegExp(`${MEMBERS_PAGE}$`));
      await expect(memberRows(page)).toHaveCount(2);
      await expect(listHeading(page)).toBeFocused();
    });

    await test.step("removes a member after a confirmation, within the action time budget", async () => {
      await listedAfresh(page, 2);
      const personHeader = membersRegion(page).getByRole("columnheader", { name: "Person" });
      await personHeader.getByRole("button").click();
      await personHeader.getByRole("button").click();
      await expect(personHeader).toHaveAttribute("aria-sort", "descending");
      const sorted = page.url();

      await openedByName(page, "Priya Shah");
      const priyasPage = page.url();
      const removal = removalOf(page);
      const asked = removal.getByRole("button", { name: MEMBER_PAGE_WORDS.removeMember });
      await asked.click();
      await expect(confirmationOf(page, "Priya Shah").locator("legend")).toBeFocused();
      await removal.getByRole("button", { name: MEMBER_PAGE_WORDS.keepMember }).click();
      await expect(asked).toBeFocused();
      await expect(asked).toHaveAttribute("aria-expanded", "false");

      await asked.click();
      const confirm = removal.getByRole("button", { name: "Remove", exact: true });
      await expect(confirm).toHaveAccessibleDescription(/\S/);
      await expect(removal).toMatchAriaSnapshot(`
        - region "Removal":
          - heading "Removal" [level=3]
          - button ${JSON.stringify(MEMBER_PAGE_WORDS.removeMember)} [expanded]
          - group "Remove Priya Shah":
            - button "Remove"
            - button ${JSON.stringify(MEMBER_PAGE_WORDS.keepMember)}
      `);
      await passesTheAccessibilityGate();

      await confirm.focus();
      await clockTheNextKey(page, { at: THE_COUNT, reads: "1" });
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(sorted);
      await expect(memberRows(page)).toHaveCount(1);
      await expect(personHeader).toHaveAttribute("aria-sort", "descending");
      await expect(listHeading(page)).toBeFocused();
      await expect(outcomeOf(page)).toContainText("Priya Shah");
      const priyas = await actionClocked(page);

      await page.goBack();
      await expect(page).toHaveURL(priyasPage);
      await namesNoMember(page);

      await listedAfresh(page, 1);
      await expect(rowOf(page, "Priya Shah")).toHaveCount(0);

      const more = await removedAtAKey(page, request, workspaceId, 1);
      medianActionWithinBudget("removal", [priyas, ...more]);
    });
  });

  test("shows the heading, tabs, count, then Invite a Person button", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Ribble Castings");
    await expect(memberRows(page)).toHaveCount(3);

    const main = page.getByRole("main", { name: "Page" });
    await expect(main).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Members" [level=1]
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
    await expect(
      main.getByText(/\b3 [a-z]/),
      "the member count does not appear exactly once",
    ).toHaveCount(1);

    const heading = membersRegion(page).getByRole("heading", { level: 2, name: "Members" });
    expect(
      (await heading.boundingBox())?.width,
      "the Members heading is visible beside the Members tab",
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("a member's own page", () => {
  test("draws a square role pill, round avatar, and round radios", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Wharfe Gauges");
    const pill = rowOf(page, "Priya Shah").getByText("Editor", { exact: true });
    await expect(pill, "the role pill has rounded corners").toHaveCSS("border-radius", "0px");

    await openedByName(page, "Priya Shah");
    const avatar = thePage(page).locator("[data-slot='avatar']");
    await expect(avatar, "the avatar is not a circle").toHaveCSS("border-radius", "999px");
    await expect(
      thePage(page).getByRole("radio", { name: "Admin", exact: true }),
      "the Admin radio is not a circle",
    ).toHaveCSS("border-radius", "999px");
  });
});

test.describe("signing a member out of this workspace", () => {
  test("an Admin signs themself out, then signs in again", async ({ page, request }) => {
    const admin = anAddress("admin");
    await provision(request, { name: "Esk Rolling", adminEmail: admin });
    await page.goto(MEMBERS_PAGE);
    await signIn(page, request, admin);
    await expect(memberRows(page)).toHaveCount(1);

    await openedByName(page, "Test person");
    const ownPage = page.url();
    await expect(signOutButton(page)).toHaveAccessibleDescription(/Test person/);
    const refused = refusalAnswering(page, "session.member");
    await signOutButton(page).click();

    expect(await refused).toMatchObject({ word: "credentials-revoked", class: "unauthenticated" });
    await alertHasText(thePage(page).getByRole("alert"));
    await page.reload();
    await signIn(page, request, admin);
    await expect(page).toHaveURL(ownPage);
    await expect(personHeading(page, "Test person")).toBeVisible();
    await expect(accessOf(page)).toContainText(ENDED_AT);
  });
});

test.describe("a member's page before any action", () => {
  test("adds no space under a card with an empty status", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Swale Bookbinders");
    await openedByName(page, "Priya Shah");

    for (const card of [rolePickerRegion(page), signOutRegion(page)]) {
      await endsUnderItsLastLine(card, card.getByRole("paragraph").last());
    }
    await endsUnderItsLastLine(
      displayNameRegion(page),
      displayNameRegion(page).getByRole("button", { name: MEMBER_PAGE_WORDS.flagName }),
    );
    await endsUnderItsLastLine(
      removalOf(page),
      removalOf(page).getByRole("button", { name: MEMBER_PAGE_WORDS.removeMember }),
    );
  });
});

test.describe("bulk actions on selected members", () => {
  test("one click selects a member after a bulk role change", async ({ page, request }) => {
    await anAdminAtPeople(page, request, "Ribble Joinery");
    await tickOf(page, "Priya Shah").check();
    const dialog = await changeRoleOpened(page, BULK_WORDS.changeRole.title(1));
    await dialog.getByRole("button", { name: MEMBER_PAGE_WORDS.changeRole, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(outcomeOf(page), "the message does not say that one member changed").toHaveText(
      /^\D*1\D*$/,
    );
    await expect(listHeading(page)).toBeFocused();
    await expect(
      countOf(membersRegion(page)).locator(".."),
      "focus on the hidden Members heading shows no focus ring",
    ).not.toHaveCSS("box-shadow", "none");

    await tickOf(page, "Sam Okoro").click();
    await expect(
      tickOf(page, "Sam Okoro"),
      "the first click did not select Sam Okoro",
    ).toBeChecked();
  });

  test("a second bulk action waits without hiding the first's refusal", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtPeople(page, request, "Wharfe Fulling");
    const answered = Promise.withResolvers<void>();
    await answeredChangedMeanwhile(page, BULK_ROLE_CHANGE, answered.promise);
    await tickOf(page, "Priya Shah").check();
    const dialog = await changeRoleOpened(page, BULK_WORDS.changeRole.title(1));
    await dialog.getByRole("button", { name: MEMBER_PAGE_WORDS.changeRole, exact: true }).click();
    await expect(
      outcomeOf(page),
      "the pending change message does not count one member",
    ).toHaveText(/\b1\b/);
    const saidPending = await outcomeOf(page).innerText();

    await tickOf(page, "Sam Okoro").check();
    const action = selectionAction(page, MEMBER_PAGE_WORDS.changeRole);
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(outcomeOf(page)).toHaveText(/\S/);
    await expect(outcomeOf(page), "the second press shows no message of its own").not.toHaveText(
      saidPending,
    );
    await page.keyboard.press(`Shift+${PEOPLE_KEYSTROKES.removeSelected.key}`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await passesTheAccessibilityGate();

    answered.resolve();
    await alertHasText(membersRegion(page).getByRole("alert"));
    await pageHidesRefusalWord(page, "changed-meanwhile");
    await expect(tickOf(page, "Priya Shah")).toBeChecked();
    await expect(action).not.toHaveAttribute("aria-disabled", "true");
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
    expect(lines.join(""), "the wrapped lines do not join to make the address").toBe(long);
    expect(
      lines.length,
      "the address fits on one line, so the test cannot check where it wraps",
    ).toBeGreaterThan(1);
    for (const line of lines.slice(0, -1)) {
      expect(line, "a line of the address does not end at an @, a dot, or a hyphen").toMatch(
        /[@.-]$/,
      );
    }
  });
});
