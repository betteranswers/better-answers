import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { z } from "zod";

import { TAB_WORKSPACE_HEADER } from "@better-answers/schema/tab-workspace";

import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  A_ROLE,
  addMember,
  anAddress,
  clockTheNextKey,
  countOf,
  emailsSentTo,
  invite,
  keyListed,
  keystrokesButton,
  keystrokesDismissed,
  keystrokesListed,
  notFoundOfferingHome,
  person,
  provision,
  editorPickedByKeyboard,
  saysARefusal,
  saysTheWait,
  signIn,
  tabOpenedByKeyboard,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const people = menuGroupIn(CONTROL_CENTRE, "people");

const LIST_BUDGET_MS = 1000;

const MEMBERS_PAGE = pageNamed(people, "Members").path;

const LONG_UK_DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

type Status = "Waiting" | "Accepted" | "Expired" | "Cancelled";

const invitationsRegion = (page: Page) => page.getByRole("region", { name: "Invitations" });

const invitationsHeading = (page: Page) =>
  invitationsRegion(page).getByRole("heading", { name: "Invitations" });

const invitationRows = (page: Page): Locator =>
  invitationsRegion(page).getByRole("row").filter({ hasText: "@" });

const rowOf = (page: Page, address: string): Locator =>
  invitationRows(page).filter({ hasText: address });

const statusChoice = (page: Page, status: Status): Locator =>
  invitationsRegion(page).getByRole("radio", { name: new RegExp(`^${status}\\b`) });

const shownUnder = async (page: Page, status: Status): Promise<void> => {
  await statusChoice(page, status).click();
  await expect(statusChoice(page, status)).toBeChecked();
};

const countedUnder = (page: Page, status: Status, count: number) =>
  expect(statusChoice(page, status)).toHaveAccessibleName(`${status} ${count}`);

const tickOf = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("checkbox", { name: `Select ${address}`, exact: true });

const menuOf = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("button", { name: `Actions for ${address}` });

const selectionAction = (page: Page, action: string): Locator =>
  page
    .getByRole("toolbar", { name: "Selected Invitations" })
    .getByRole("button", { name: action, exact: true });

const saidInTheTab = (page: Page, address: string | RegExp): Locator =>
  invitationsRegion(page).getByRole("status").filter({ hasText: address });

const theOneCell = (page: Page): Locator => invitationsRegion(page).getByRole("cell");

const outcomeIn = (page: Page): Locator => invitationsRegion(page).getByRole("status").nth(1);

const selectionSaid = (page: Page): Locator =>
  page.getByRole("toolbar", { name: "Selected Invitations" }).getByRole("status");

const THE_COUNT = "//section[.//h2[.='Invitations']]//output";

const INVITE = "Invite a Person";

const inviteDialog = (page: Page) => page.getByRole("dialog", { name: INVITE });

const inviteAction = (page: Page) => page.getByRole("button", { name: INVITE, exact: true });

const addressField = (page: Page) => inviteDialog(page).getByLabel("Email Addresses");

const sendButton = (page: Page) => inviteDialog(page).getByRole("button", { name: /^Send/ });

const heldAddresses = (page: Page) =>
  inviteDialog(page).getByRole("list", { name: "Addresses to Invite" }).getByRole("listitem");

const removeOf = (page: Page, address: string) =>
  inviteDialog(page).getByRole("button", { name: `Remove ${address}`, exact: true });

const invitingButtons = (page: Page) => page.getByRole("button", { name: /^invite/i });

const anUnreachableAddress = (who: string): string =>
  anAddress(who).replace("@example.test", "@unreachable.example");

const answeredOnceHeld = (page: Page, procedure: string, held: Promise<void>) =>
  page.route(
    (url) => url.pathname.replace("/trpc/", "").split(",").includes(procedure),
    async (route) => {
      await held;
      await route.continue();
    },
  );

const sentToOneWhoJoinedMeanwhile = async (
  page: Page,
  api: APIRequestContext,
  at: AtInvitations,
  addresses: { readonly other: string; readonly joined: string },
) => {
  await dialogOpened(page);
  const made = await person(api, addresses.joined, { displayName: "Ola Joined" });
  await addMember(api, { workspaceId: at.workspaceId, userId: made.id, role: "Viewer" });
  await addressField(page).fill(`${addresses.other}, ${addresses.joined}`);
  const refused = refusalAnswering(page, "members.invite");
  await sendButton(page).click();
  return { refused };
};

const resentAsIfItWent = (page: Page) =>
  page.route(
    (url) => url.pathname.includes("members.resendInvitation"),
    async (route) => {
      const answered = await route.fetch();
      const answers = z
        .array(z.object({ result: z.object({ data: z.object({}).loose() }) }))
        .parse(await answered.json());
      await route.fulfill({
        response: answered,
        json: answers.map(({ result }) => ({
          result: { data: { ...result.data, emailSent: true } },
        })),
      });
    },
  );

const unsentIn = (where: Locator): Locator => where.getByRole("region", { name: "Unsent Emails" });

const actedAside = async (
  page: Page,
  { workspaceId }: AtInvitations,
  action: string,
  input: unknown,
): Promise<number> => {
  const answered = await page.request.post(`/trpc/members.${action}`, {
    data: input,
    headers: { [TAB_WORKSPACE_HEADER]: workspaceId },
  });
  return answered.status();
};

type AtInvitations = {
  readonly workspaceId: string;
  readonly adminId: string;
  readonly editor: string;
};

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

  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, adminEmail);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  return at;
};

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
  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, email);
};

const openInvitations = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Invitations" }).click();
  await expect(invitationsRegion(page).getByRole("heading", { name: "Invitations" })).toBeVisible();
};

const invitedEach = async (
  api: APIRequestContext,
  at: AtInvitations,
  addresses: readonly string[],
  asked: { readonly expiresAt?: Date; readonly status?: "accepted" | "cancelled" } = {},
): Promise<string[]> => {
  const ids: string[] = [];
  for (const email of addresses) {
    const made = await invite(api, {
      workspaceId: at.workspaceId,
      email,
      inviterId: at.adminId,
      role: "Viewer",
      ...asked,
    });
    ids.push(made.id);
  }
  return ids;
};

const anEightDayOldInvitation = { expiresAt: new Date(Date.now() - DAY_MS) };

const dialogOpened = async (page: Page): Promise<void> => {
  await inviteAction(page).click();
  await expect(addressField(page)).toBeFocused();
};

test.describe("the People page's Invitations tab", () => {
  test("an Admin invites a person by address; the invitation waits", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Calder Joinery");
    await openInvitations(page);
    await expect(invitationRows(page)).toHaveCount(0);
    await expect(theOneCell(page)).toHaveText(/\S/);
    const address = anAddress("sam");

    await dialogOpened(page);
    await addressField(page).fill(address);
    const role = inviteDialog(page).getByRole("combobox", { name: "Role" });
    const describedBy = await role.getAttribute("aria-describedby");
    assert.ok(describedBy !== null, "the Role field is described by its meaning");
    const meant = await inviteDialog(page).locator(`[id="${describedBy}"]`).innerText();
    await role.click();
    await page.getByRole("option", { name: "Editor" }).click();
    await expect(role).toHaveText("Editor");
    await expect(role).toHaveAccessibleDescription(/\S/);
    await expect(
      role,
      "the role's meaning did not follow the pick",
    ).not.toHaveAccessibleDescription(meant);
    await inviteDialog(page).getByRole("button", { name: "Send Invitation" }).click();

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(address);
    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await expect(inviteDialog(page)).toHaveCount(0);
    await expect(inviteAction(page)).toBeFocused();

    await expect(invitationRows(page)).toHaveCount(1);
    const cells = rowOf(page, address).getByRole("cell");
    await expect(cells.nth(1)).toHaveText(address);
    await expect(cells.nth(2)).toHaveText("Editor");
    await expect(cells.nth(3)).toHaveText(LONG_UK_DATE);
    await expect(cells.nth(4)).toHaveText(LONG_UK_DATE);
    await expect(cells.nth(5)).toHaveText("Test person");
    await expect(countOf(invitationsRegion(page))).toHaveText(/\b1\b/);
    await expect(
      page.getByRole("main").getByRole("status").filter({ hasText: /\d/ }),
      "a second count, the members', shows on Invitations",
    ).toHaveCount(1);
    await countedUnder(page, "Waiting", 1);
    expect(await emailsSentTo(request, address), "the invitation's one email").toBe(1);
  });

  test("each tab invites by keystroke, giving d its own action", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Nidd Presswork");
    const besideTheSharedKey: string[] = [];

    for (const name of ["Members", "Invitations", "Requests"]) {
      const tab = page.getByRole("tab", { name });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(inviteAction(page)).toBeVisible();
      await tab.blur();

      await page.keyboard.press(PEOPLE_KEYSTROKES.invite.key);
      await expect(addressField(page), `i opened no dialog on ${name}`).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(inviteDialog(page)).toHaveCount(0);
      await expect(inviteAction(page), `focus left the action on ${name}`).toBeFocused();

      const keystrokes = await keystrokesListed(page, "Members");
      const action = keystrokes
        .getByRole("term")
        .filter({ hasText: new RegExp(`^${PEOPLE_KEYSTROKES.remove.key}$`) })
        .locator("xpath=following-sibling::*[1]");
      await expect(action, `${name} lists no action beside the key`).toHaveText(/\S/);
      besideTheSharedKey.push(await action.innerText());
      await keystrokesDismissed(page, keystrokes);
    }

    expect(new Set(besideTheSharedKey).size, "two tabs list one action beside the shared key").toBe(
      3,
    );
  });

  test("an empty tab says so in one line, inviting once", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Swale Presswork");
    await openInvitations(page);

    await expect(invitationsRegion(page)).toMatchAriaSnapshot(`
      - region "Invitations":
        - heading "Invitations" [level=2]
        - searchbox "Search by address"
        - radiogroup "Status":
          - radio "Waiting 0" [checked]
          - radio "Accepted 0"
          - radio "Expired 0"
          - radio "Cancelled 0"
        - table:
          - rowgroup:
            - row:
              - columnheader "Select every invitation on this page":
                - checkbox [disabled]
          - rowgroup:
            - row:
              - cell /\\S/
    `);
    await expect(invitingButtons(page), "the head's action is the one way to invite").toHaveCount(
      1,
    );
    await expect(inviteAction(page)).toBeVisible();
  });

  test("names a member's address inline before anything is sent", async ({ page, request }) => {
    const { editor } = await anAdminAtInvitations(page, request, "Aire Valley Tooling");
    await openInvitations(page);

    await dialogOpened(page);
    await addressField(page).fill(editor.toUpperCase());
    await addressField(page).press("Enter");

    await expect(heldAddresses(page)).toHaveCount(1);
    await expect(removeOf(page, editor.toUpperCase())).toHaveAccessibleDescription(
      "Already a member",
    );
    await expect(sendButton(page)).toBeDisabled();
    await addressField(page).press("Enter");
    await expect(removeOf(page, editor.toUpperCase())).toBeFocused();
    await saysARefusal(inviteDialog(page).getByRole("alert"));
    await page.keyboard.press("Escape");
    await expect(inviteAction(page)).toBeFocused();
    await expect(invitationRows(page)).toHaveCount(0);
  });

  test("names on its row an address that joined meanwhile", async ({ page, request }) => {
    const at = await anAdminAtInvitations(page, request, "Rye Dale Fabrication");
    await openInvitations(page);
    const joined = anAddress("joined");
    const other = anAddress("other");

    const { refused } = await sentToOneWhoJoinedMeanwhile(page, request, at, { other, joined });

    expect((await refused).items).toEqual({ 1: "already-a-member" });
    await saysARefusal(inviteDialog(page).getByRole("alert"));
    await expect(removeOf(page, joined)).toBeFocused();
    await expect(removeOf(page, joined)).toHaveAccessibleDescription("Already a member");
    await expect(removeOf(page, other)).toHaveAccessibleDescription("Ready");
    expect(await emailsSentTo(request, other), "a refused send sent nothing").toBe(0);
  });

  test("names an invalid address inline and sends nothing", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Ure Mill Fittings");
    await openInvitations(page);
    const ana = anAddress("ana");
    const ben = anAddress("ben");

    await dialogOpened(page);
    await addressField(page).fill(`${ana}, not-an-address, ${ben}`);
    await addressField(page).press("Enter");

    await expect(heldAddresses(page)).toHaveCount(3);
    await expect(removeOf(page, "not-an-address")).toHaveAccessibleDescription(
      "Invalid email address",
    );
    await expect(
      inviteDialog(page)
        .getByRole("status")
        .filter({ hasText: /\b2\b\D+\b1\b/ }),
      "the dialog counts two ready and one flagged",
    ).toBeVisible();
    await expect(sendButton(page)).toBeDisabled();
    await addressField(page).press("Enter");
    await expect(removeOf(page, "not-an-address")).toBeFocused();
    await saysARefusal(inviteDialog(page).getByRole("alert"));
    expect(await emailsSentTo(request, ana), "the flagged send sent nothing").toBe(0);

    await page.keyboard.press("Enter");
    await expect(heldAddresses(page)).toHaveCount(2);
    await expect(removeOf(page, ben), "focus goes to the row that took its place").toBeFocused();
    await expect(sendButton(page)).toBeEnabled();
    await expect(sendButton(page)).toHaveText("Send 2 Invitations");
    await sendButton(page).click();

    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeVisible();
    await expect(inviteDialog(page).getByRole("status").first()).toHaveText(/\b2\b/);
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await expect(invitationRows(page)).toHaveCount(2);
  });

  test("removal hands focus to the row before, then the field", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Swaledale Lime");
    await openInvitations(page);
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];

    await dialogOpened(page);
    await addressField(page).fill(`${ana}, ${ben}`);
    await addressField(page).press("Enter");
    await expect(heldAddresses(page)).toHaveCount(2);

    await removeOf(page, ben).focus();
    await page.keyboard.press("Enter");
    await expect(removeOf(page, ana)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(heldAddresses(page)).toHaveCount(0);
    await expect(addressField(page)).toBeFocused();
  });

  test("sends 50 at once, holding a 51st in the field", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Nidd Bridge Tools");
    await openInvitations(page);
    const addresses = Array.from({ length: 51 }, (_, at) => anAddress(`person-${String(at)}`));
    const late = addresses.at(-1);
    assert.ok(late !== undefined, "51 addresses were made");

    await dialogOpened(page);
    await addressField(page).fill(addresses.join(", "));
    await addressField(page).press("Enter");

    await expect(heldAddresses(page)).toHaveCount(50);
    await expect(addressField(page)).toHaveValue(late);
    await saysARefusal(inviteDialog(page).getByRole("alert"));
    await expect(sendButton(page)).toHaveText("Send 50 Invitations");
    await sendButton(page).click();

    const sent = inviteDialog(page).getByRole("status").first();
    await expect(sent, "a send holding 50 sends them, and counts the one still waiting").toHaveText(
      /\b50\b.*\b1\b/,
    );
    const sentFifty = await sent.innerText();
    expect(await emailsSentTo(request, late), "the 51st waits, unsent").toBe(0);
    const next = inviteDialog(page).getByRole("button", { name: INVITE, exact: true });
    await expect(next, "the outcome leads to the address waiting, not to Done").toBeFocused();
    await page.keyboard.press("Enter");
    await expect(addressField(page)).toBeFocused();
    await expect(addressField(page), "the next invite starts from what was left").toHaveValue(late);
    await sendButton(page).click();

    await expect(sent).toContainText(late);
    await expect(sent, "the outcome still tells of the 50").not.toHaveText(sentFifty);
    const done = inviteDialog(page).getByRole("button", { name: "Done" });
    await expect(done).toBeFocused();
    await done.click();
    await countedUnder(page, "Waiting", 51);
  });

  test("shows an eight-day-old invitation under Expired, not Waiting", async ({
    page,
    request,
  }) => {
    const old = anAddress("old");
    await anAdminAtInvitations(page, request, "Swaledale Smiths", (at) =>
      invitedEach(request, at, [old], anEightDayOldInvitation).then(() => undefined),
    );
    await openInvitations(page);

    await countedUnder(page, "Waiting", 0);
    await countedUnder(page, "Expired", 1);
    await expect(invitationRows(page)).toHaveCount(0);
    await expect(theOneCell(page)).toHaveText(/\S/);

    await shownUnder(page, "Expired");
    await expect(rowOf(page, old)).toHaveCount(1);
    await expect(page).toHaveURL(/invitations\.status=expired/);
  });

  test("clears a search that matched nothing, keeping its status", async ({ page, request }) => {
    const lapsed = anAddress("lapsed");
    await anAdminAtInvitations(page, request, "Arkengarth Smiths", (at) =>
      invitedEach(request, at, [lapsed], anEightDayOldInvitation).then(() => undefined),
    );
    await openInvitations(page);
    await shownUnder(page, "Expired");
    const search = invitationsRegion(page).getByRole("searchbox", {
      name: "Search by address",
    });

    const nobody = "nobody-at-this-address";
    await search.fill(nobody);
    await expect(invitationRows(page)).toHaveCount(0);
    await expect(invitationsRegion(page), "the empty list names no search").toContainText(nobody);
    await invitationsRegion(page).getByRole("button", { name: "Clear Search" }).click();

    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(statusChoice(page, "Expired")).toBeChecked();
    await expect(page).toHaveURL(/invitations\.status=expired/);
    await expect(rowOf(page, lapsed)).toHaveCount(1);
  });

  test("re-sends to an address waiting, and says so", async ({ page, request }) => {
    const sam = anAddress("sam");
    await anAdminAtInvitations(page, request, "Ribble Coachworks", (at) =>
      invitedEach(request, at, [sam]).then(() => undefined),
    );
    await openInvitations(page);
    await countedUnder(page, "Waiting", 1);

    await dialogOpened(page);
    await addressField(page).fill(sam);
    await sendButton(page).click();

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(sam);
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await countedUnder(page, "Waiting", 1);
    await countedUnder(page, "Cancelled", 1);
  });

  test("names an email that did not go, offering a Resend", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Calder Ropeworks");
    await openInvitations(page);
    const offline = anUnreachableAddress("offline");

    await dialogOpened(page);
    await addressField(page).fill(offline);
    await sendButton(page).click();

    await expect(inviteDialog(page).getByRole("alert").first()).toContainText(offline);
    await expect(inviteDialog(page).getByRole("status").first()).toHaveText("");
    const unsent = unsentIn(inviteDialog(page));
    const resend = unsent.getByRole("button", { name: `Resend Invitation to ${offline}` });
    await resend.click();
    await expect(unsent.getByRole("alert")).toContainText(offline);
    await expect(unsent.getByRole("status")).toHaveText("");
    await expect(resend).toBeFocused();
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await expect(
      rowOf(page, offline),
      "the invitation stands though its email did not go",
    ).toHaveCount(1);
  });

  for (const tab of ["Members", "Invitations", "Requests"] as const) {
    test(`closed mid-send, the dialog's unsent emails land on ${tab}`, async ({
      page,
      request,
    }) => {
      await anAdminAtInvitations(page, request, `Calder ${tab} Lacemakers`);
      await page.getByRole("tab", { name: tab }).click();
      const region = page.getByRole("region", { name: tab });
      await expect(region.getByRole("heading", { name: tab })).toBeVisible();
      const offline = anUnreachableAddress("offline");
      const answered = Promise.withResolvers<void>();
      await answeredOnceHeld(page, "members.invite", answered.promise);

      await dialogOpened(page);
      await addressField(page).fill(offline);
      await sendButton(page).click();
      await page.keyboard.press("Escape");
      await expect(inviteDialog(page)).toHaveCount(0);
      answered.resolve();

      await expect(
        unsentIn(region).getByRole("button", { name: `Resend Invitation to ${offline}` }),
      ).toBeVisible();
      await expect(region.getByRole("alert").first()).toContainText(offline);
    });
  }

  test("a refusal after the dialog closed names its addresses", async ({ page, request }) => {
    const at = await anAdminAtInvitations(page, request, "Calder Refused Lacemakers");
    await openInvitations(page);
    const [other, joined] = [anAddress("other"), anAddress("joined")];
    const answered = Promise.withResolvers<void>();
    await answeredOnceHeld(page, "members.invite", answered.promise);

    const { refused } = await sentToOneWhoJoinedMeanwhile(page, request, at, { other, joined });
    await page.keyboard.press("Escape");
    await expect(inviteDialog(page)).toHaveCount(0);
    answered.resolve();

    expect((await refused).items).toEqual({ 1: "already-a-member" });
    const said = invitationsRegion(page).getByRole("alert").first();
    await expect(said.getByRole("listitem")).toHaveText([new RegExp(joined)]);
    await inviteAction(page).click();
    await expect(addressField(page), "the dialog holds what was not sent").toHaveValue(
      `${other}, ${joined}`,
    );
  });

  test("the dialog's unsent list drops an address whose Resend went", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Calder Weavers");
    await openInvitations(page);
    const [offline, other] = [anUnreachableAddress("offline"), anUnreachableAddress("other")];

    await dialogOpened(page);
    await addressField(page).fill(`${offline}, ${other}`);
    await sendButton(page).click();
    const unsent = unsentIn(inviteDialog(page));
    await expect(unsent.getByRole("listitem")).toHaveCount(2);

    await resentAsIfItWent(page);
    await unsent.getByRole("button", { name: `Resend Invitation to ${offline}` }).click();
    await expect(unsent.getByRole("status")).toContainText(offline);
    await expect(unsent.getByRole("listitem")).toHaveCount(1);
    await expect(
      unsent.getByRole("button", { name: `Resend Invitation to ${other}` }),
    ).toBeVisible();
    await expect(
      unsent.getByRole("heading", { name: "Unsent Emails" }),
      "focus left with the row",
    ).toBeFocused();
  });

  test("the tab's unsent list drops an address whose Resend went", async ({ page, request }) => {
    const offline = anUnreachableAddress("offline");
    await anAdminAtInvitations(page, request, "Wensleydale Twine", (at) =>
      invitedEach(request, at, [offline]).then(() => undefined),
    );
    await openInvitations(page);

    await tickOf(page, offline).check();
    await selectionAction(page, "Resend").click();
    const unsent = unsentIn(invitationsRegion(page));
    const resend = unsent.getByRole("button", { name: `Resend Invitation to ${offline}` });
    await expect(resend).toBeVisible();

    await resentAsIfItWent(page);
    await resend.click();
    await expect(unsent.getByRole("status")).toContainText(offline);
    await expect(resend).toHaveCount(0);
    await expect(
      unsent.getByRole("heading", { name: "Unsent Emails" }),
      "focus left with the row",
    ).toBeFocused();
  });

  test("names when to try again past an address's email ceiling", async ({ page, request }) => {
    const capped = anAddress("capped");
    let invitationId = "";
    const here = await anAdminAtInvitations(page, request, "Kex Gill Stone", async (at) => {
      [invitationId = ""] = await invitedEach(request, at, [capped]);
    });
    for (let resent = 0; resent < 5; resent += 1) {
      expect(await actedAside(page, here, "resendInvitation", { invitationId })).toBe(200);
    }
    await openInvitations(page);

    await dialogOpened(page);
    await addressField(page).fill(capped);
    const refused = refusalAnswering(page, "members.invite");
    await sendButton(page).click();
    const { status, waitSeconds } = await refused;

    expect(status, "the send met no ceiling").toBe(429);
    await saysTheWait(inviteDialog(page).getByRole("alert"), waitSeconds);
    await expect(sendButton(page)).toBeFocused();
  });

  test("renders the waiting invitations within the list's budget", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Dales Engineering", (at) =>
      invitedEach(request, at, ["sam", "una", "ola"].map(anAddress)).then(() => undefined),
    );

    const started = Date.now();
    await page.goto(MEMBERS_PAGE);
    await openInvitations(page);
    await expect(invitationRows(page)).toHaveCount(3);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "invitations list", description: `${elapsed} ms` });
    expect(elapsed, "the list of three invitations rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
  });

  test("an expired invitation resent from its menu waits again", async ({ page, request }) => {
    const old = anAddress("old");
    await anAdminAtInvitations(page, request, "Hebden Weavers", (at) =>
      invitedEach(request, at, [old], anEightDayOldInvitation).then(() => undefined),
    );
    await openInvitations(page);
    await shownUnder(page, "Expired");

    await menuOf(page, old).click();
    await page.getByRole("menuitem", { name: "Resend" }).click();

    await expect(saidInTheTab(page, new RegExp(`${old}.*\\d{4}`))).toBeVisible();
    await expect(rowOf(page, old)).toHaveCount(0);
    await expect(invitationsHeading(page), "focus left with the row").toBeFocused();
    await countedUnder(page, "Expired", 0);
    await countedUnder(page, "Waiting", 1);
    await shownUnder(page, "Waiting");
    await expect(rowOf(page, old)).toHaveCount(1);
  });

  test("cancelling from a row's menu hands focus to the list", async ({ page, request }) => {
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];
    await anAdminAtInvitations(page, request, "Bishopdale Bells", (at) =>
      invitedEach(request, at, [ana, ben]).then(() => undefined),
    );
    await openInvitations(page);

    await menuOf(page, ana).click();
    await page.getByRole("menuitem", { name: "Cancel" }).click();

    await expect(rowOf(page, ana)).toHaveCount(0);
    await expect(saidInTheTab(page, ana)).toBeVisible();
    await expect(invitationsHeading(page), "focus left with the row").toBeFocused();
    await countedUnder(page, "Cancelled", 1);
  });

  test("bulk Cancel over two waiting invitations moves both to Cancelled", async ({
    page,
    request,
  }) => {
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];
    await anAdminAtInvitations(page, request, "Malham Lime", (at) =>
      invitedEach(request, at, [ana, ben]).then(() => undefined),
    );
    await openInvitations(page);
    await countedUnder(page, "Cancelled", 0);

    await tickOf(page, ana).check();
    await tickOf(page, ben).check();
    await selectionAction(page, "Cancel").click();

    await expect(invitationRows(page)).toHaveCount(0);
    await expect(
      outcomeIn(page),
      "the bulk cancel's outcome counts two, and none skipped",
    ).toHaveText(/^\D*2\D*$/);
    await countedUnder(page, "Cancelled", 2);
    await countedUnder(page, "Waiting", 0);
  });

  test("bulk Cancel counts a row cancelled meanwhile as skipped", async ({ page, request }) => {
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];
    let ids: string[] = [];
    const here = await anAdminAtInvitations(page, request, "Coverdale Leather", async (at) => {
      ids = await invitedEach(request, at, [ana, ben]);
    });
    await openInvitations(page);

    await tickOf(page, ana).check();
    await tickOf(page, ben).check();
    expect(await actedAside(page, here, "cancelInvitation", { invitationId: ids[0] })).toBe(200);
    await page.keyboard.press(`Shift+${PEOPLE_KEYSTROKES.cancelSelected.key}`);

    await expect(outcomeIn(page), "the outcome counts one cancelled and one skipped").toHaveText(
      /\b1\b\D+\b1\b/,
    );
    await countedUnder(page, "Cancelled", 2);
  });

  test("an expired invitation resent from the bar waits again", async ({ page, request }) => {
    const old = anAddress("old");
    await anAdminAtInvitations(page, request, "Grassington Glass", (at) =>
      invitedEach(request, at, [old], anEightDayOldInvitation).then(() => undefined),
    );
    await openInvitations(page);
    await shownUnder(page, "Expired");

    await tickOf(page, old).check();
    await selectionAction(page, "Resend").click();

    await expect(outcomeIn(page)).toHaveText(/\b1\b.*\d{4}/);
    await expect(rowOf(page, old)).toHaveCount(0);
    await countedUnder(page, "Waiting", 1);
    await countedUnder(page, "Expired", 0);
  });

  test("a refused bulk Resend names a row not shown", async ({ page, request }) => {
    const [gone, kept] = [anAddress("gone"), anAddress("kept")];
    const TWO_TICKED_NEITHER_SHOWN = /\b2\b\D+\b2\b/;
    let ids: string[] = [];
    const here = await anAdminAtInvitations(page, request, "Arkengarthdale Lead", async (at) => {
      ids = await invitedEach(request, at, [gone, kept]);
    });
    await openInvitations(page);

    await tickOf(page, gone).check();
    await tickOf(page, kept).check();
    await shownUnder(page, "Expired");
    await expect(selectionSaid(page)).toHaveText(TWO_TICKED_NEITHER_SHOWN);
    expect(await actedAside(page, here, "cancelInvitation", { invitationId: ids[0] })).toBe(200);
    const refused = refusalAnswering(page, "members.bulkResendInvitations");
    await selectionAction(page, "Resend").click();

    const [refusedId] = ids;
    assert.ok(refusedId !== undefined, "an invitation was made");
    expect((await refused).items).toEqual({ [refusedId]: "no-such-invitation" });
    const refusal = invitationsRegion(page).getByRole("alert");
    await expect(refusal.getByRole("paragraph"), "the refusal counts one refused").toHaveText(
      /\b1\b/,
    );
    await expect(refusal.getByRole("listitem")).toHaveText([new RegExp(gone)]);
    await expect(selectionSaid(page)).toHaveText(TWO_TICKED_NEITHER_SHOWN);
    expect(await emailsSentTo(request, kept), "the refused set sent nothing").toBe(0);
  });

  test("a second action waits on the first, whose answer lands", async ({ page, request }) => {
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];
    await anAdminAtInvitations(page, request, "Wharfe Ropery", (at) =>
      invitedEach(request, at, [ana, ben]).then(() => undefined),
    );
    await openInvitations(page);
    const answered = Promise.withResolvers<void>();
    await page.route(
      (url) => url.pathname.includes("members.bulkCancelInvitations"),
      async (route) => {
        await answered.promise;
        await route.continue();
      },
    );

    await tickOf(page, ana).check();
    await selectionAction(page, "Cancel").click();
    const outcome = outcomeIn(page);
    await expect(outcome, "the pending cancel counts its one invitation").toHaveText(/\b1\b/);
    const saidPending = await outcome.innerText();
    await tickOf(page, ben).check();
    const action = selectionAction(page, "Cancel");
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(outcome).toHaveText(/\S/);
    await expect(outcome, "the second press said nothing of its own").not.toHaveText(saidPending);
    const saidWaiting = await outcome.innerText();

    answered.resolve();
    await expect(outcome, "the first action's outcome never landed").not.toHaveText(saidWaiting);
    await expect(outcome).not.toHaveText(saidPending);
    await expect(outcome, "the outcome counts one cancelled, and none skipped").toHaveText(
      /^\D*1\D*$/,
    );
    await expect(rowOf(page, ana)).toHaveCount(0);
    await expect(tickOf(page, ben)).toBeChecked();
    await expect(action).not.toHaveAttribute("aria-disabled", "true");
  });

  test("a tick made mid-act survives the bulk refusal", async ({ page, request }) => {
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];
    let ids: string[] = [];
    const here = await anAdminAtInvitations(page, request, "Wharfe Tannery", async (at) => {
      ids = await invitedEach(request, at, [ana, ben]);
    });
    await openInvitations(page);
    const answered = Promise.withResolvers<void>();
    await answeredOnceHeld(page, "members.bulkResendInvitations", answered.promise);

    await tickOf(page, ana).check();
    expect(await actedAside(page, here, "cancelInvitation", { invitationId: ids[0] })).toBe(200);
    await selectionAction(page, "Resend").click();
    await expect(tickOf(page, ana)).not.toBeChecked();
    await tickOf(page, ben).check();
    const refused = refusalAnswering(page, "members.bulkResendInvitations");
    answered.resolve();

    const [refusedId] = ids;
    assert.ok(refusedId !== undefined, "an invitation was made");
    expect((await refused).items).toEqual({ [refusedId]: "no-such-invitation" });
    await saysARefusal(invitationsRegion(page).getByRole("alert"));
    await expect(tickOf(page, ben), "the tick made meanwhile stays").toBeChecked();
    await expect(selectionSaid(page), "the pressed tick comes back too").toHaveText(/\b2\b/);
  });

  test("accepted and cancelled invitations offer no tick and no actions", async ({
    page,
    request,
  }) => {
    const [joined, dropped] = [anAddress("joined"), anAddress("dropped")];
    await anAdminAtInvitations(page, request, "Littondale Slate", async (at) => {
      await invitedEach(request, at, [joined], { status: "accepted" });
      await invitedEach(request, at, [dropped], { status: "cancelled" });
    });
    await openInvitations(page);

    await shownUnder(page, "Accepted");
    await expect(rowOf(page, joined)).toHaveCount(1);
    await expect(tickOf(page, joined)).toHaveCount(0);
    await expect(menuOf(page, joined)).toHaveCount(0);
    await shownUnder(page, "Cancelled");
    await expect(rowOf(page, dropped)).toHaveCount(1);
    await expect(tickOf(page, dropped)).toHaveCount(0);
    await expect(menuOf(page, dropped)).toHaveCount(0);
  });

  test("drops the select-first line once a key acts", async ({ page, request }) => {
    const held = anAddress("held");
    await anAdminAtInvitations(page, request, "Calder Keys", (at) =>
      invitedEach(request, at, [held]).then(() => undefined),
    );
    await page.getByRole("tab", { name: "Invitations" }).click();
    await expect(invitationRows(page)).toHaveCount(1);
    await keystrokesButton(page).focus();

    await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
    await expect(outcomeIn(page), "x with no invitation in focus said nothing").toHaveText(/\S/);

    await tickOf(page, held).focus();
    await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
    await expect(tickOf(page, held)).toBeChecked();
    await expect(outcomeIn(page), "the select-first line outlived the tick").toHaveText("");
  });

  test("an Admin resends and cancels an invitation by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const kept = anAddress("kept");
    const dropped = anAddress("dropped");
    await anAdminAtInvitations(page, request, "Calder Castings", (at) =>
      invitedEach(request, at, [kept, dropped]).then(() => undefined),
    );
    await tabOpenedByKeyboard(page, MEMBERS_PAGE, "Invitations");
    await expect(invitationRows(page)).toHaveCount(2);

    await tabUntilFocused(page, menuOf(page, dropped));
    await page.keyboard.press(PEOPLE_KEYSTROKES.resend.key);
    await expect(saidInTheTab(page, new RegExp(`${dropped}.*\\d{4}`))).toBeVisible();
    const saidOfTheResend = await outcomeIn(page).innerText();

    await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
    await expect(tickOf(page, dropped)).toBeChecked();
    await expect(outcomeIn(page), "a tick wiped the resend's outcome").toHaveText(saidOfTheResend);
    await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
    await expect(tickOf(page, dropped)).not.toBeChecked();

    await expect(countOf(invitationsRegion(page))).toHaveText(/\b2\b/);
    await clockTheNextKey(page, { at: THE_COUNT, reads: "1" });
    await page.keyboard.press(PEOPLE_KEYSTROKES.cancel.key);
    await expect(rowOf(page, dropped)).toHaveCount(0);
    await theActionLandedWithinItsBudget(page, "cancel");
    await expect(
      invitationsRegion(page).getByRole("heading", { name: "Invitations" }),
    ).toBeFocused();
    await expect(outcomeIn(page)).toContainText(dropped);
    await expect(outcomeIn(page), "the cancel said nothing of its own").not.toHaveText(
      saidOfTheResend,
    );

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
        `the list holds no ${listed.key}`,
      ).toBeVisible();
    }
    await expect(
      keyListed(keystrokes, PEOPLE_KEYSTROKES.open.key),
      "the Members tab's keystrokes on Invitations",
    ).toHaveCount(0);
    await keystrokesDismissed(page, keystrokes);

    const invited = anAddress("invited");
    await page.keyboard.press(PEOPLE_KEYSTROKES.invite.key);
    await expect(addressField(page)).toBeFocused();
    await page.keyboard.type(invited);
    await page.keyboard.press("Tab");
    await editorPickedByKeyboard(page, inviteDialog(page).getByRole("combobox", { name: "Role" }));
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
              - columnheader "Invited By"
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
  });

  test("by keyboard, ⌘K invites two people and focus returns", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Wenning Joinery");
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];

    await page.keyboard.press("Meta+k");
    await page.keyboard.type("invite");
    await expect(page.getByRole("option", { name: INVITE })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(addressField(page)).toBeFocused();

    await page.keyboard.type(`${ana}, ${ben}`);
    await expect(heldAddresses(page)).toHaveCount(1);
    const role = inviteDialog(page).getByRole("combobox", { name: "Role" });
    await tabUntilFocused(page, role);
    await editorPickedByKeyboard(page, role);
    await tabUntilFocused(page, sendButton(page));
    await expect(sendButton(page)).toHaveText("Send 2 Invitations");
    await page.keyboard.press("Enter");

    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
    await expect(inviteDialog(page).getByRole("status").first()).toHaveText(/\b2\b/);
    await page.keyboard.press("Enter");
    await expect(inviteDialog(page)).toHaveCount(0);
    await expect(inviteAction(page)).toBeFocused();
    await openInvitations(page);
    await expect(invitationRows(page)).toHaveCount(2);
  });

  test("fits a 320px page, its actions in view", async ({ page, request }) => {
    const long = anAddress("a-rather-long-name.for-wrapping");
    await anAdminAtInvitations(page, request, "Wensleydale Tanning", (at) =>
      invitedEach(request, at, [long]).then(() => undefined),
    );
    await page.setViewportSize({ width: 320, height: 800 });
    await openInvitations(page);

    await expect(menuOf(page, long)).toBeInViewport();
    await expect(tickOf(page, long)).toBeInViewport();
    const sideways = await page.evaluate(() =>
      [document.documentElement, ...document.querySelectorAll("[data-slot=table-container]")].map(
        (box) => box.scrollWidth - box.clientWidth,
      ),
    );
    expect(sideways, "the page or the table scrolls sideways").toEqual([0, 0]);
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${A_ROLE[role]} no invitations, Members being hidden`, async ({
      page,
      request,
    }) => {
      await aMemberBelowAdminAtPeople(page, request, role);

      await notFoundOfferingHome(page, role);
      await expect(page.getByRole("tab", { name: "Invitations" })).toHaveCount(0);
      await expect(invitationsRegion(page)).toHaveCount(0);
    });
  }
});
