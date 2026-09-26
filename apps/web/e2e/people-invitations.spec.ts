import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { EMPTY_LINES } from "@/features/people/empty-lines.ts";
import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { screenById } from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  invite,
  keystrokesDismissed,
  keystrokesListed,
  person,
  provision,
  editorPickedByKeyboard,
  signIn,
  tabOpenedByKeyboard,
  tabUntilFocused,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const people = screenById("people");

const LIST_BUDGET_MS = 1000;

const MEMBERS_VIEW = "/people/members";

const LONG_UK_DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

const invitationsRegion = (page: Page) => page.getByRole("region", { name: "Invitations" });

/** The header row is a row too, so the invitations are the rows with a cell. */
const invitationRows = (page: Page): Locator =>
  invitationsRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, address: string): Locator =>
  invitationRows(page).filter({ hasText: address });

const INVITE = PEOPLE_KEYSTROKES.invite.act;

const inviteDialog = (page: Page) => page.getByRole("dialog", { name: INVITE });

const inviteAct = (page: Page) => page.getByRole("button", { name: INVITE, exact: true });

/** Every button whose name starts by inviting, so a second one under another name is counted. */
const invitingButtons = (page: Page) => page.getByRole("button", { name: /^invite/i });

type AtInvitations = {
  readonly workspaceId: string;
  readonly adminId: string;
  readonly editor: string;
};

/** The Editor is a member already, so a spec can invite them and be refused. */
const anAdminAtInvitations = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
  seed: (at: AtInvitations) => Promise<void> = async () => {},
): Promise<AtInvitations> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail });
  const editor = anAddress("editor");
  const made = await person(api, editor, { displayName: "Priya Shah" });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: made.id, role: "Editor" });
  const at = { workspaceId: workspace.workspaceId, adminId: workspace.admin.id, editor };
  await seed(at);

  await page.goto(MEMBERS_VIEW);
  await signIn(page, api, adminEmail);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  return at;
};

/** Signed in on People below Admin, so what the tab shows them is a refusal. */
const aMemberBelowAdminAtPeople = async (
  page: Page,
  api: APIRequestContext,
  role: "Editor" | "Viewer",
): Promise<void> => {
  const email = anAddress(role.toLowerCase());
  const [member, workspace] = await Promise.all([
    person(api, email, { displayName: `A ${role}` }),
    provision(api, { name: `Wharfe ${role}s` }),
  ]);
  await addMember(api, { role, userId: member.id, workspaceId: workspace.workspaceId });
  await page.goto(MEMBERS_VIEW);
  await signIn(page, api, email);
};

const openInvitations = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Invitations" }).click();
  await expect(invitationsRegion(page).getByRole("heading", { name: "Invitations" })).toBeVisible();
};

test.describe("the People screen's Invitations tab", () => {
  test("an Admin invites a person by address; the invitation waits", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Calder Joinery");
    await openInvitations(page);
    await expect(invitationsRegion(page)).toContainText(EMPTY_LINES.invitations);
    const address = anAddress("sam");

    await inviteAct(page).click();
    await inviteDialog(page).getByLabel("Email address").fill(address);
    await inviteDialog(page).getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Editor" }).click();
    await expect(inviteDialog(page)).toContainText(
      "Checks concepts, runs question sets and saves Answers.",
    );
    await inviteDialog(page).getByRole("button", { name: "Send the invitation" }).click();

    await expect(inviteDialog(page).getByRole("status")).toContainText(
      `Invited ${address} as an Editor. The email went, and the invitation lasts until`,
    );
    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await expect(inviteDialog(page)).toHaveCount(0);
    await expect(inviteAct(page)).toBeFocused();

    await expect(invitationRows(page)).toHaveCount(1);
    const cells = rowOf(page, address).getByRole("cell");
    await expect(cells.nth(1)).toHaveText("Editor");
    await expect(cells.nth(2)).toHaveText("Waiting");
    await expect(cells.nth(3)).toHaveText(LONG_UK_DATE);
    await expect(cells.nth(4)).toHaveText(LONG_UK_DATE);
    await expect(cells.nth(5)).toHaveText("Test person");
    await expect(invitationsRegion(page).getByText("1 invitation", { exact: true })).toBeVisible();
  });

  test("an empty tab says so in one line, inviting once", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Swale Presswork");
    await openInvitations(page);

    await expect(invitationsRegion(page)).toMatchAriaSnapshot(`
      - region "Invitations":
        - /children: equal
        - heading "Invitations" [level=2]
        - paragraph: ${EMPTY_LINES.invitations}
    `);
    await expect(invitingButtons(page), "the toolbar's act is the one way to invite").toHaveCount(
      1,
    );
    await expect(inviteAct(page)).toBeVisible();
  });

  test("refuses inviting a current member, saying so in its word", async ({ page, request }) => {
    const { editor } = await anAdminAtInvitations(page, request, "Aire Valley Tooling");
    await openInvitations(page);

    await inviteAct(page).click();
    await inviteDialog(page).getByLabel("Email address").fill(editor.toUpperCase());
    await inviteDialog(page).getByRole("button", { name: "Send the invitation" }).click();

    const refused = inviteDialog(page).getByRole("alert");
    await expect(refused).toContainText("Refused: already-a-member.");
    await expect(refused).toContainText(
      "That address belongs to a member of this workspace already. Find them on the Members tab.",
    );
    await expect(inviteDialog(page).getByLabel("Email address")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(invitationRows(page)).toHaveCount(0);
  });

  test("renders the waiting invitations within the list's budget", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Dales Engineering", async (at) => {
      for (const who of ["sam", "una", "ola"]) {
        await invite(request, {
          workspaceId: at.workspaceId,
          email: anAddress(who),
          inviterId: at.adminId,
          role: "Viewer",
        });
      }
    });

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto(MEMBERS_VIEW);
    await openInvitations(page);
    await expect(invitationRows(page)).toHaveCount(3);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "invitations list", description: `${elapsed} ms` });
    expect(elapsed, "the list of three invitations rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  test("an Admin resends and cancels an invitation by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const kept = anAddress("kept");
    const dropped = anAddress("dropped");
    await anAdminAtInvitations(page, request, "Calder Castings", async (at) => {
      for (const [email, role] of [
        [kept, "Admin"],
        [dropped, "Viewer"],
      ] as const) {
        await invite(request, { workspaceId: at.workspaceId, email, inviterId: at.adminId, role });
      }
    });
    await tabOpenedByKeyboard(page, MEMBERS_VIEW, "Invitations");
    await expect(invitationRows(page)).toHaveCount(2);

    await tabUntilFocused(
      page,
      page.getByRole("button", { name: `Resend the invitation to ${dropped}` }),
    );
    await page.keyboard.press("r");
    await expect(invitationsRegion(page).getByRole("status").first()).toContainText(
      `Sent the invitation to ${dropped} again. It lasts until`,
    );

    await clockTheNextKey(page, {
      at: "(//section[.//h2[.='Invitations']]//output)[2]",
      reads: "1 invitation",
    });
    await page.keyboard.press("x");
    await expect(rowOf(page, dropped)).toHaveCount(0);
    await theActLandedWithinItsBudget(page, "cancel");
    await expect(
      invitationsRegion(page).getByRole("heading", { name: "Invitations" }),
    ).toBeFocused();
    await expect(invitationsRegion(page).getByRole("status").first()).toHaveText(
      `Cancelled the invitation to ${dropped}; its link no longer works.`,
    );

    const keystrokes = await keystrokesListed(page, people.name);
    await expect(keystrokes).toContainText(INVITE);
    await expect(keystrokes).toContainText("Resend the invitation in focus");
    await expect(keystrokes).toContainText("Cancel the invitation in focus");
    await keystrokesDismissed(page, keystrokes);

    const invited = anAddress("invited");
    await page.keyboard.press("i");
    await expect(inviteDialog(page).getByLabel("Email address")).toBeFocused();
    await page.keyboard.type(invited);
    await page.keyboard.press("Tab");
    await editorPickedByKeyboard(page, inviteDialog(page).getByRole("combobox", { name: "Role" }));
    await expect(inviteDialog(page)).toContainText(
      "Checks concepts, runs question sets and saves Answers.",
    );
    await page.keyboard.press("Shift+Tab");
    await expect(inviteDialog(page).getByLabel("Email address")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(inviteDialog(page).getByRole("status")).toContainText(
      `Invited ${invited} as an Editor.`,
    );
    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
    await passesTheAccessibilityGate();
    await page.keyboard.press("Enter");
    await expect(inviteDialog(page)).toHaveCount(0);
    await expect(inviteAct(page)).toBeFocused();
    await expect(invitationRows(page)).toHaveCount(2);

    await expect(invitationsRegion(page)).toMatchAriaSnapshot(`
      - region "Invitations":
        - heading "Invitations" [level=2]
        - status: /Cancelled the invitation to/
        - status: 2 invitations
        - table:
          - caption: /Invitations to this workspace/
          - rowgroup:
            - row "Address Role State Sent Expires Invited by Acts":
              - columnheader "Address"
              - columnheader "Role"
              - columnheader "State"
              - columnheader "Sent"
              - columnheader "Expires"
              - columnheader "Invited by"
              - columnheader "Acts"
          - rowgroup:
            - row /invited-/:
              - cell /invited-/
              - cell "Editor"
              - cell "Waiting"
              - cell /\\d{4}/
              - cell /\\d{4}/
              - cell "Test person"
              - cell:
                - button /Resend the invitation to invited-/
                - button /Cancel the invitation to invited-/
            - row /kept-/:
              - cell /kept-/
              - cell "Admin"
              - cell "Waiting"
              - cell /\\d{4}/
              - cell /\\d{4}/
              - cell "Test person"
              - cell:
                - button /Resend the invitation to kept-/
                - button /Cancel the invitation to kept-/
    `);
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`refuses a member at ${role} the invitations, in its word`, async ({ page, request }) => {
      await aMemberBelowAdminAtPeople(page, request, role);
      await openInvitations(page);

      const refused = invitationsRegion(page).getByRole("alert");
      await expect(refused).toContainText("Refused: role-forbids.");
      await expect(refused).toContainText(
        "Only an Admin of this workspace sees and sends its invitations.",
      );
      await expect(invitationsRegion(page).getByRole("table")).toHaveCount(0);
    });
  }
});
