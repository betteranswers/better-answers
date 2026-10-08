import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { EMPTY_LINES } from "@/features/people/empty-lines.ts";
import {
  INVITATIONS_WORDS,
  INVITE_REFUSED,
  INVITE_WORDS,
  STATUS_WORDS,
} from "@/features/people/invitation-words.ts";
import { BULK_WORDS } from "@/features/people/member-action-words.ts";
import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { invitationsCeiling, SAID_OF_TICKED_INVITATIONS } from "@/features/people/refusal-words.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import { CONTROL_CENTRE, menuGroupIn, INVITE_A_PERSON, pageNamed } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  emailsSentTo,
  invite,
  keystrokesDismissed,
  keystrokesListed,
  notFoundOfferingHome,
  person,
  provision,
  editorPickedByKeyboard,
  signIn,
  tabOpenedByKeyboard,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
} from "./harness.ts";

const people = menuGroupIn(CONTROL_CENTRE, "people");

const LIST_BUDGET_MS = 1000;

const MEMBERS = pageNamed(people, "Members");

const MEMBERS_PAGE = MEMBERS.path;

const LONG_UK_DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

type Status = keyof typeof STATUS_WORDS;

const invitationsRegion = (page: Page) => page.getByRole("region", { name: "Invitations" });

const invitationsHeading = (page: Page) =>
  invitationsRegion(page).getByRole("heading", { name: "Invitations" });

/** Every invitation names an address, so its row is the one holding an @; the empty state's does not. */
const invitationRows = (page: Page): Locator =>
  invitationsRegion(page).getByRole("row").filter({ hasText: "@" });

const rowOf = (page: Page, address: string): Locator =>
  invitationRows(page).filter({ hasText: address });

const statusChoice = (page: Page, status: Status): Locator =>
  invitationsRegion(page).getByRole("radio", { name: new RegExp(`^${STATUS_WORDS[status]}\\b`) });

const shownUnder = async (page: Page, status: Status): Promise<void> => {
  await statusChoice(page, status).click();
  await expect(statusChoice(page, status)).toBeChecked();
};

const countedUnder = (page: Page, status: Status, count: number) =>
  expect(statusChoice(page, status)).toHaveAccessibleName(`${STATUS_WORDS[status]} ${count}`);

const tickOf = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("checkbox", { name: `Select ${address}`, exact: true });

const menuOf = (page: Page, address: string): Locator =>
  invitationsRegion(page).getByRole("button", { name: `Actions for ${address}` });

const selectionAction = (page: Page, action: string): Locator =>
  page
    .getByRole("toolbar", { name: INVITATIONS_WORDS.selected })
    .getByRole("button", { name: action, exact: true });

const saidInTheTab = (page: Page, words: string): Locator =>
  invitationsRegion(page).getByRole("status").filter({ hasText: words });

const INVITE = PEOPLE_KEYSTROKES.invite.action;

const inviteDialog = (page: Page) => page.getByRole("dialog", { name: INVITE });

const inviteAction = (page: Page) => page.getByRole("button", { name: INVITE, exact: true });

const addressField = (page: Page) => inviteDialog(page).getByLabel(INVITE_WORDS.field);

const sendButton = (page: Page) => inviteDialog(page).getByRole("button", { name: /^Send/ });

const heldAddresses = (page: Page) =>
  inviteDialog(page).getByRole("list", { name: INVITE_WORDS.list }).getByRole("listitem");

const removeOf = (page: Page, address: string) =>
  inviteDialog(page).getByRole("button", { name: INVITE_WORDS.remove(address), exact: true });

/** Every button whose name starts by inviting, so a second one under another name is counted. */
const invitingButtons = (page: Page) => page.getByRole("button", { name: /^invite/i });

/** The capitalised spelling of an address, which the api folds into the lower-cased one. */
const capitalised = (address: string): string =>
  `${address.slice(0, 1).toUpperCase()}${address.slice(1)}`;

/** The browser suite's api delivers nothing to this domain, so its invitations' emails never go. */
const anUnreachableAddress = (who: string): string =>
  anAddress(who).replace("@example.test", "@unreachable.example");

/** A Resend's answer as if its email went, which it never does to that domain. */
const resentAsIfItWent = (page: Page) =>
  page.route(
    (url) => url.pathname.includes("members.resendInvitation"),
    async (route) => {
      const answered = await route.fetch();
      const answers: readonly { readonly result: { readonly data: object } }[] =
        await answered.json();
      await route.fulfill({
        response: answered,
        json: answers.map(({ result }) => ({
          result: { data: { ...result.data, emailSent: true } },
        })),
      });
    },
  );

const unsentIn = (where: Locator): Locator =>
  where.getByRole("region", { name: INVITATIONS_WORDS.unsent });

/** The action as the page's own tRPC client would send it, under the Admin's session. */
const actedAside = async (page: Page, action: string, input: unknown): Promise<number> =>
  (await page.request.post(`/trpc/members.${action}`, { data: input })).status();

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

  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, adminEmail);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  return at;
};

/** Signed in at Members in a role that may not see it. */
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

/** Seeds waiting invitations by address, answering each one's id in the same order. */
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
    await expect(invitationsRegion(page)).toContainText(EMPTY_LINES.invitations);
    const address = anAddress("sam");

    await dialogOpened(page);
    await addressField(page).fill(address);
    await inviteDialog(page).getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Editor" }).click();
    await expect(inviteDialog(page)).toContainText(
      "Checks concepts, asks question sets and saves Answers.",
    );
    await inviteDialog(page)
      .getByRole("button", { name: INVITE_WORDS.send(1) })
      .click();

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(
      `Invited ${address} as an Editor. The email went, and the invitation lasts until`,
    );
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
    await expect(
      invitationsRegion(page).getByText(INVITATIONS_WORDS.counted("waiting", 1), { exact: true }),
    ).toBeVisible();
    await countedUnder(page, "waiting", 1);
    expect(await emailsSentTo(request, address), "the invitation's one email").toBe(1);
  });

  test("an empty tab says so in one line, inviting once", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Swale Presswork");
    await openInvitations(page);

    await expect(invitationsRegion(page)).toMatchAriaSnapshot(`
      - region "Invitations":
        - heading "Invitations" [level=2]
        - searchbox "${INVITATIONS_WORDS.search}"
        - radiogroup "${INVITATIONS_WORDS.status}":
          - radio "Waiting 0" [checked]
          - radio "Accepted 0"
          - radio "Expired 0"
          - radio "Cancelled 0"
        - table:
          - rowgroup:
            - row:
              - columnheader "${INVITATIONS_WORDS.everyOnThePage}":
                - checkbox [disabled]
          - rowgroup:
            - row:
              - cell "${EMPTY_LINES.invitations}"
    `);
    await expect(
      invitingButtons(page),
      "the toolbar's action is the one way to invite",
    ).toHaveCount(1);
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
      INVITE_WORDS.flag["already-a-member"],
    );
    await expect(sendButton(page)).toBeDisabled();
    await addressField(page).press("Enter");
    await expect(removeOf(page, editor.toUpperCase())).toBeFocused();
    await expect(inviteDialog(page).getByRole("alert")).toHaveText(
      sentenceOf(INVITE_REFUSED.flagged),
    );
    await page.keyboard.press("Escape");
    await expect(inviteAction(page)).toBeFocused();
    await expect(invitationRows(page)).toHaveCount(0);
  });

  test("names on its row an address that joined meanwhile", async ({ page, request }) => {
    const at = await anAdminAtInvitations(page, request, "Rye Dale Fabrication");
    await openInvitations(page);
    const joined = anAddress("joined");
    const other = anAddress("other");

    await dialogOpened(page);
    const made = await person(request, joined, { displayName: "Ola Joined" });
    await addMember(request, { workspaceId: at.workspaceId, userId: made.id, role: "Viewer" });
    await addressField(page).fill(`${other}, ${joined}`);
    await sendButton(page).click();

    await expect(inviteDialog(page).getByRole("alert")).toHaveText(
      sentenceOf(INVITE_REFUSED.flagged),
    );
    await expect(removeOf(page, joined)).toBeFocused();
    await expect(removeOf(page, joined)).toHaveAccessibleDescription(
      INVITE_WORDS.flag["already-a-member"],
    );
    await expect(removeOf(page, other)).toHaveAccessibleDescription(INVITE_WORDS.flag.ready);
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
      INVITE_WORDS.flag.malformed,
    );
    await expect(
      inviteDialog(page)
        .getByRole("status")
        .filter({ hasText: INVITE_WORDS.summary(2, 1) }),
    ).toBeVisible();
    await expect(sendButton(page)).toBeDisabled();
    await addressField(page).press("Enter");
    await expect(removeOf(page, "not-an-address")).toBeFocused();
    await expect(inviteDialog(page).getByRole("alert")).toHaveText(
      sentenceOf(INVITE_REFUSED.flagged),
    );
    expect(await emailsSentTo(request, ana), "the flagged send sent nothing").toBe(0);

    await page.keyboard.press("Enter");
    await expect(heldAddresses(page)).toHaveCount(2);
    await expect(removeOf(page, ben), "focus goes to the row that took its place").toBeFocused();
    await expect(sendButton(page)).toBeEnabled();
    await expect(sendButton(page)).toHaveText(INVITE_WORDS.send(2));
    await sendButton(page).click();

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(
      "Invited 2 people as Viewers.",
    );
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
    const late = addresses.at(-1) ?? "";

    await dialogOpened(page);
    await addressField(page).fill(addresses.join(", "));
    await addressField(page).press("Enter");

    await expect(heldAddresses(page)).toHaveCount(50);
    await expect(addressField(page)).toHaveValue(late);
    await expect(inviteDialog(page).getByRole("alert")).toHaveText(
      sentenceOf(INVITE_REFUSED.capped(50)),
    );
    await expect(sendButton(page)).toHaveText(INVITE_WORDS.send(50));
    await sendButton(page).click();

    const sent = inviteDialog(page).getByRole("status").first();
    await expect(sent, "a send holding 50 sends them, though more wait in the field").toContainText(
      "Invited 50 people as Viewers.",
    );
    await expect(sent, "the outcome names what still waits").toContainText(INVITE_WORDS.waiting(1));
    expect(await emailsSentTo(request, late), "the 51st waits, unsent").toBe(0);
    const next = inviteDialog(page).getByRole("button", { name: INVITE, exact: true });
    await expect(next, "the outcome leads to the address waiting, not to Done").toBeFocused();
    await page.keyboard.press("Enter");
    await expect(addressField(page)).toBeFocused();
    await expect(addressField(page), "the next invite starts from what was left").toHaveValue(late);
    await sendButton(page).click();

    await expect(sent).toContainText(`Invited ${late} as a Viewer.`);
    await expect(sent).not.toContainText(INVITE_WORDS.waiting(1));
    const done = inviteDialog(page).getByRole("button", { name: "Done" });
    await expect(done).toBeFocused();
    await done.click();
    await countedUnder(page, "waiting", 51);
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

    await countedUnder(page, "waiting", 0);
    await countedUnder(page, "expired", 1);
    await expect(rowOf(page, old)).toHaveCount(0);
    await expect(invitationsRegion(page)).toContainText(EMPTY_LINES.invitations);

    await shownUnder(page, "expired");
    await expect(rowOf(page, old)).toHaveCount(1);
    await expect(page).toHaveURL(/invitations\.status=expired/);
  });

  test("folds two spellings of one address into one email", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Wensley Forge");
    await openInvitations(page);
    const ana = anAddress("ana");

    await dialogOpened(page);
    await addressField(page).fill(`${capitalised(ana)}, ${ana}`);
    await sendButton(page).click();

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(
      `Invited ${ana} as a Viewer.`,
    );
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await expect(invitationRows(page)).toHaveCount(1);
    expect(await emailsSentTo(request, ana), "one email for the folded address").toBe(1);
  });

  test("re-sends to an address waiting, and says so", async ({ page, request }) => {
    const sam = anAddress("sam");
    await anAdminAtInvitations(page, request, "Ribble Coachworks", (at) =>
      invitedEach(request, at, [sam]).then(() => undefined),
    );
    await openInvitations(page);
    await countedUnder(page, "waiting", 1);

    await dialogOpened(page);
    await addressField(page).fill(sam);
    await sendButton(page).click();

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(
      `Re-sent the invitation to ${sam} as ${aRole("Viewer")}, replacing the one waiting.`,
    );
    await inviteDialog(page).getByRole("button", { name: "Done" }).click();
    await countedUnder(page, "waiting", 1);
    await countedUnder(page, "cancelled", 1);
  });

  test("names an email that did not go, offering a Resend", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Calder Ropeworks");
    await openInvitations(page);
    const offline = anUnreachableAddress("offline");

    await dialogOpened(page);
    await addressField(page).fill(offline);
    await sendButton(page).click();

    await expect(inviteDialog(page).getByRole("alert").first()).toContainText(
      `The email to ${offline} did not go, but its invitation stands.`,
    );
    const resend = inviteDialog(page).getByRole("button", {
      name: INVITATIONS_WORDS.resendTo(offline),
    });
    await resend.click();
    await expect(inviteDialog(page)).toContainText(
      `The invitation to ${offline} stands, but its email did not go again.`,
    );
    await expect(resend).toBeFocused();
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
    await unsent.getByRole("button", { name: INVITATIONS_WORDS.resendTo(offline) }).click();
    await expect(unsent).toContainText(`Sent the invitation to ${offline} again.`);
    await expect(unsent.getByRole("listitem")).toHaveCount(1);
    await expect(
      unsent.getByRole("button", { name: INVITATIONS_WORDS.resendTo(other) }),
    ).toBeVisible();
    await expect(
      unsent.getByRole("heading", { name: INVITATIONS_WORDS.unsent }),
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
    await selectionAction(page, INVITATIONS_WORDS.resend).click();
    const unsent = unsentIn(invitationsRegion(page));
    const resend = unsent.getByRole("button", { name: INVITATIONS_WORDS.resendTo(offline) });
    await expect(resend).toBeVisible();

    await resentAsIfItWent(page);
    await resend.click();
    await expect(unsent).toContainText(`Sent the invitation to ${offline} again.`);
    await expect(resend).toHaveCount(0);
    await expect(
      unsent.getByRole("heading", { name: INVITATIONS_WORDS.unsent }),
      "focus left with the row",
    ).toBeFocused();
  });

  test("names when to try again past an address's email ceiling", async ({ page, request }) => {
    const capped = anAddress("capped");
    let invitationId = "";
    await anAdminAtInvitations(page, request, "Kex Gill Stone", async (at) => {
      [invitationId = ""] = await invitedEach(request, at, [capped]);
    });
    for (let resent = 0; resent < 5; resent += 1) {
      expect(await actedAside(page, "resendInvitation", { invitationId })).toBe(200);
    }
    await openInvitations(page);

    await dialogOpened(page);
    await addressField(page).fill(capped);
    const refused = page.waitForResponse((answer) => answer.url().includes("members.invite"));
    await sendButton(page).click();
    const liftsInSeconds = Number((await refused).headers()["retry-after"]);

    expect(liftsInSeconds, "the ceiling's answer named no wait").toBeGreaterThan(0);
    await expect(inviteDialog(page).getByRole("alert")).toHaveText(
      sentenceOf(invitationsCeiling(liftsInSeconds)),
    );
    await expect(sendButton(page)).toBeFocused();
  });

  test("renders the waiting invitations within the list's budget", async ({ page, request }) => {
    await anAdminAtInvitations(page, request, "Dales Engineering", (at) =>
      invitedEach(request, at, ["sam", "una", "ola"].map(anAddress)).then(() => undefined),
    );

    // A fresh document, so no list is already in the page's cache.
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
    await shownUnder(page, "expired");

    await menuOf(page, old).click();
    await page.getByRole("menuitem", { name: INVITATIONS_WORDS.resend }).click();

    await expect(saidInTheTab(page, `Sent the invitation to ${old} again.`)).toBeVisible();
    await expect(rowOf(page, old)).toHaveCount(0);
    await expect(invitationsHeading(page), "focus left with the row").toBeFocused();
    await countedUnder(page, "expired", 0);
    await countedUnder(page, "waiting", 1);
    await shownUnder(page, "waiting");
    await expect(rowOf(page, old)).toHaveCount(1);
  });

  test("cancelling from a row's menu hands focus to the list", async ({ page, request }) => {
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];
    await anAdminAtInvitations(page, request, "Bishopdale Bells", (at) =>
      invitedEach(request, at, [ana, ben]).then(() => undefined),
    );
    await openInvitations(page);

    await menuOf(page, ana).click();
    await page.getByRole("menuitem", { name: INVITATIONS_WORDS.cancel }).click();

    await expect(rowOf(page, ana)).toHaveCount(0);
    await expect(saidInTheTab(page, INVITATIONS_WORDS.cancelled(ana))).toBeVisible();
    await expect(invitationsHeading(page), "focus left with the row").toBeFocused();
    await countedUnder(page, "cancelled", 1);
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
    await countedUnder(page, "cancelled", 0);

    await tickOf(page, ana).check();
    await tickOf(page, ben).check();
    await selectionAction(page, INVITATIONS_WORDS.cancel).click();

    await expect(invitationRows(page)).toHaveCount(0);
    await expect(
      saidInTheTab(page, INVITATIONS_WORDS.bulk.cancelled(2, 0)),
      "the bulk cancel's outcome",
    ).toBeVisible();
    await countedUnder(page, "cancelled", 2);
    await countedUnder(page, "waiting", 0);
  });

  test("bulk Cancel counts a row cancelled meanwhile as skipped", async ({ page, request }) => {
    const [ana, ben] = [anAddress("ana"), anAddress("ben")];
    let ids: string[] = [];
    await anAdminAtInvitations(page, request, "Coverdale Leather", async (at) => {
      ids = await invitedEach(request, at, [ana, ben]);
    });
    await openInvitations(page);

    await tickOf(page, ana).check();
    await tickOf(page, ben).check();
    expect(await actedAside(page, "cancelInvitation", { invitationId: ids[0] })).toBe(200);
    await page.keyboard.press(`Shift+${PEOPLE_KEYSTROKES.cancelSelected.key}`);

    await expect(saidInTheTab(page, INVITATIONS_WORDS.bulk.cancelled(1, 1))).toBeVisible();
    await countedUnder(page, "cancelled", 2);
  });

  test("an expired invitation resent from the bar waits again", async ({ page, request }) => {
    const old = anAddress("old");
    await anAdminAtInvitations(page, request, "Grassington Glass", (at) =>
      invitedEach(request, at, [old], anEightDayOldInvitation).then(() => undefined),
    );
    await openInvitations(page);
    await shownUnder(page, "expired");

    await tickOf(page, old).check();
    await selectionAction(page, INVITATIONS_WORDS.resend).click();

    await expect(saidInTheTab(page, "Sent 1 invitation again. It lasts until")).toBeVisible();
    await expect(rowOf(page, old)).toHaveCount(0);
    await countedUnder(page, "waiting", 1);
    await countedUnder(page, "expired", 0);
  });

  test("a refused bulk Resend names a row not shown", async ({ page, request }) => {
    const [gone, kept] = [anAddress("gone"), anAddress("kept")];
    let ids: string[] = [];
    await anAdminAtInvitations(page, request, "Arkengarthdale Lead", async (at) => {
      ids = await invitedEach(request, at, [gone, kept]);
    });
    await openInvitations(page);

    await tickOf(page, gone).check();
    await tickOf(page, kept).check();
    await shownUnder(page, "expired");
    await expect(page.getByRole("toolbar", { name: INVITATIONS_WORDS.selected })).toContainText(
      "2 invitations selected, 2 not shown.",
    );
    expect(await actedAside(page, "cancelInvitation", { invitationId: ids[0] })).toBe(200);
    await selectionAction(page, INVITATIONS_WORDS.resend).click();

    const refusal = invitationsRegion(page).getByRole("alert");
    await expect(refusal).toContainText(INVITATIONS_WORDS.bulk.refused(1));
    await expect(refusal).toContainText(
      `${gone}: ${sentenceOf(SAID_OF_TICKED_INVITATIONS["no-such-invitation"])}`,
    );
    await expect(page.getByRole("toolbar", { name: INVITATIONS_WORDS.selected })).toContainText(
      "2 invitations selected, 2 not shown.",
    );
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
    await selectionAction(page, INVITATIONS_WORDS.cancel).click();
    await expect(saidInTheTab(page, INVITATIONS_WORDS.bulk.cancelling(1))).toBeVisible();
    await tickOf(page, ben).check();
    const action = selectionAction(page, INVITATIONS_WORDS.cancel);
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(saidInTheTab(page, BULK_WORDS.stillGoing)).toBeVisible();

    answered.resolve();
    await expect(saidInTheTab(page, INVITATIONS_WORDS.bulk.cancelled(1, 0))).toBeVisible();
    await expect(tickOf(page, ben)).toBeChecked();
    await expect(action).not.toHaveAttribute("aria-disabled", "true");
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

    await shownUnder(page, "accepted");
    await expect(rowOf(page, joined)).toHaveCount(1);
    await expect(tickOf(page, joined)).toHaveCount(0);
    await expect(menuOf(page, joined)).toHaveCount(0);
    await shownUnder(page, "cancelled");
    await expect(rowOf(page, dropped)).toHaveCount(1);
    await expect(tickOf(page, dropped)).toHaveCount(0);
    await expect(menuOf(page, dropped)).toHaveCount(0);
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
    await expect(saidInTheTab(page, `Sent the invitation to ${dropped} again.`)).toBeVisible();

    await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
    await expect(tickOf(page, dropped)).toBeChecked();
    await page.keyboard.press(PEOPLE_KEYSTROKES.tickInvitation.key);
    await expect(tickOf(page, dropped)).not.toBeChecked();

    await clockTheNextKey(page, {
      at: `//section[.//h2[.='Invitations']]//output[.='${INVITATIONS_WORDS.counted("waiting", 1)}']`,
      reads: INVITATIONS_WORDS.counted("waiting", 1),
    });
    await page.keyboard.press(PEOPLE_KEYSTROKES.cancel.key);
    await expect(rowOf(page, dropped)).toHaveCount(0);
    await theActionLandedWithinItsBudget(page, "cancel");
    await expect(
      invitationsRegion(page).getByRole("heading", { name: "Invitations" }),
    ).toBeFocused();
    await expect(saidInTheTab(page, INVITATIONS_WORDS.cancelled(dropped))).toBeVisible();

    const keystrokes = await keystrokesListed(page, MEMBERS.name);
    for (const listed of [
      INVITE,
      PEOPLE_KEYSTROKES.searchInvitations.action,
      PEOPLE_KEYSTROKES.resend.action,
      PEOPLE_KEYSTROKES.cancel.action,
      PEOPLE_KEYSTROKES.tickInvitation.action,
      PEOPLE_KEYSTROKES.resendSelected.action,
      PEOPLE_KEYSTROKES.cancelSelected.action,
      PEOPLE_KEYSTROKES.nextInvitations.action,
    ]) {
      await expect(keystrokes).toContainText(listed);
    }
    await expect(keystrokes, "the Members tab's keystrokes on Invitations").not.toContainText(
      "Open the member in focus",
    );
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
    await expect(inviteDialog(page).getByRole("status").first()).toContainText(
      `Invited ${invited} as an Editor.`,
    );
    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
    await passesTheAccessibilityGate();
    await page.keyboard.press("Enter");
    await expect(inviteDialog(page)).toHaveCount(0);
    await expect(inviteAction(page)).toBeFocused();
    await expect(invitationRows(page)).toHaveCount(2);

    await expect(invitationsRegion(page)).toMatchAriaSnapshot(`
      - region "Invitations":
        - heading "Invitations" [level=2]
        - status: ${INVITATIONS_WORDS.counted("waiting", 2)}
        - status: /Cancelled the invitation to/
        - searchbox "${INVITATIONS_WORDS.search}"
        - radiogroup "${INVITATIONS_WORDS.status}":
          - radio "Waiting 2" [checked]
          - radio "Accepted 0"
          - radio "Expired 0"
          - radio "Cancelled 1"
        - table:
          - caption: /Invitations to this workspace/
          - rowgroup:
            - row:
              - columnheader "${INVITATIONS_WORDS.everyOnThePage}"
              - columnheader "Address"
              - columnheader "Role"
              - columnheader "Sent"
              - columnheader "Expires"
              - columnheader "Invited by"
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
    await expect(page.getByRole("option", { name: INVITE_A_PERSON.name })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(addressField(page)).toBeFocused();

    await page.keyboard.type(`${ana}, ${ben}`);
    await expect(heldAddresses(page)).toHaveCount(1);
    const role = inviteDialog(page).getByRole("combobox", { name: "Role" });
    await tabUntilFocused(page, role);
    await editorPickedByKeyboard(page, role);
    await tabUntilFocused(page, sendButton(page));
    await expect(sendButton(page)).toHaveText(INVITE_WORDS.send(2));
    await page.keyboard.press("Enter");

    await expect(inviteDialog(page).getByRole("status").first()).toContainText(
      "Invited 2 people as Editors.",
    );
    await expect(inviteDialog(page).getByRole("button", { name: "Done" })).toBeFocused();
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
    test(`shows ${aRole(role)} no invitations, Members being hidden`, async ({ page, request }) => {
      await aMemberBelowAdminAtPeople(page, request, role);

      await notFoundOfferingHome(page, role);
      await expect(page.getByRole("tab", { name: "Invitations" })).toHaveCount(0);
      await expect(invitationsRegion(page)).toHaveCount(0);
    });
  }
});
