import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { EMPTY_LINES } from "@/features/people/empty-lines.ts";
import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  askToJoin,
  clockTheNextKey,
  keystrokesListed,
  person,
  provision,
  editorPickedByKeyboard,
  signIn,
  tabOpenedByKeyboard,
  tabUntilFocused,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const MEMBERS_VIEW = "/people/members";

const LONG_UK_DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

const REASON = "I have joined the bids team and need the answer library.";

const NAMES_AN_ORGANISATION = /organi[sz]ation/i;

const requestsRegion = (page: Page) => page.getByRole("region", { name: "Requests" });

/** The header row is a row too, so the requests are the rows with a cell. */
const requestRows = (page: Page): Locator =>
  requestsRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator => requestRows(page).filter({ hasText: name });

const approveDialog = (page: Page, name: string) =>
  page.getByRole("dialog", { name: `Approve the request from ${name}` });

/** Every button whose name starts by inviting, so a second one under another name is counted. */
const invitingButtons = (page: Page) => page.getByRole("button", { name: /^invite/i });

type Asking = { readonly displayName: string; readonly reason?: string };

type Asked = { readonly displayName: string; readonly email: string };

type AtRequests = {
  readonly workspaceId: string;
  readonly slug: string;
  readonly asked: readonly Asked[];
};

const asksToJoin = async (api: APIRequestContext, slug: string, asking: Asking): Promise<Asked> => {
  const email = anAddress(asking.displayName.split(" ")[0]?.toLowerCase() ?? "asker");
  const made = await person(api, email, { displayName: asking.displayName });
  await askToJoin(api, { slug, requesterId: made.id, reason: asking.reason ?? REASON });
  return { displayName: asking.displayName, email };
};

/** Asked one at a time, so the list's oldest-first order is the order given here. */
const anAdminAtRequests = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
  asking: readonly Asking[],
): Promise<AtRequests> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail });
  const asked: Asked[] = [];
  for (const one of asking) asked.push(await asksToJoin(api, workspace.slug, one));

  await page.goto(MEMBERS_VIEW);
  await signIn(page, api, adminEmail);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  return { workspaceId: workspace.workspaceId, slug: workspace.slug, asked };
};

const openRequests = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Requests" }).click();
  await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeVisible();
};

test.describe("the People screen's Requests tab", () => {
  test("an Admin approves a request at a role, inviting them", async ({ page, request }) => {
    const { asked } = await anAdminAtRequests(page, request, "Calder Joinery", [
      { displayName: "Priya Shah" },
    ]);
    const priya = asked[0]?.email ?? "";
    await openRequests(page);

    await expect(requestRows(page)).toHaveCount(1);
    const cells = rowOf(page, "Priya Shah").getByRole("cell");
    await expect(cells.nth(0)).toContainText("Priya Shah");
    await expect(cells.nth(0)).toContainText(priya);
    await expect(cells.nth(1)).toHaveText(REASON);
    await expect(cells.nth(2)).toHaveText("Waiting");
    await expect(cells.nth(3)).toHaveText(LONG_UK_DATE);
    await expect(
      requestsRegion(page).getByText("1 request waiting", { exact: true }),
    ).toBeVisible();

    await rowOf(page, "Priya Shah")
      .getByRole("button", { name: "Approve the request from Priya Shah" })
      .click();
    const approving = approveDialog(page, "Priya Shah");
    await expect(approving).toContainText(`Approving emails ${priya} an invitation`);
    await approving.getByRole("combobox", { name: "Role" }).click();
    await page.getByRole("option", { name: "Editor" }).click();
    await expect(approving).toContainText("Checks concepts, runs question sets and saves Answers.");
    await approving.getByRole("button", { name: "Approve and send the invitation" }).click();

    await expect(approving).toHaveCount(0);
    await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeFocused();
    await expect(requestsRegion(page).getByRole("status").first()).toContainText(
      `Approved. The invitation went to ${priya} as an Editor and lasts until`,
    );
    await expect(requestsRegion(page)).toContainText(EMPTY_LINES.requests);

    await page.getByRole("tab", { name: "Invitations" }).click();
    const invited = page
      .getByRole("region", { name: "Invitations" })
      .getByRole("row")
      .filter({ hasText: priya });
    await expect(invited.getByRole("cell").nth(1)).toHaveText("Editor");
  });

  test("renders the waiting requests within the list's budget", async ({ page, request }) => {
    await anAdminAtRequests(page, request, "Dales Engineering", [
      { displayName: "Sam Okafor" },
      { displayName: "Una Byrne" },
      { displayName: "Ola Nowak" },
    ]);

    // A fresh document, so no list is already in the page's cache.
    const startedAtMs = Date.now();
    await page.goto(MEMBERS_VIEW);
    await openRequests(page);
    await expect(requestRows(page)).toHaveCount(3);
    const elapsedMs = Date.now() - startedAtMs;

    test.info().annotations.push({ type: "requests list", description: `${elapsedMs} ms` });
    expect(elapsedMs, "the list of three requests rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );
    await expect(requestRows(page).nth(0)).toContainText("Sam Okafor");
    await expect(requestRows(page).nth(2)).toContainText("Ola Nowak");
  });

  test("an empty tab says so in one line, inviting once", async ({ page, request }) => {
    await anAdminAtRequests(page, request, "Swale Presswork", []);
    await openRequests(page);

    await expect(requestsRegion(page)).toMatchAriaSnapshot(`
      - region "Requests":
        - /children: equal
        - heading "Requests" [level=2]
        - paragraph: ${EMPTY_LINES.requests}
    `);
    await expect(invitingButtons(page), "the toolbar's act is the one way to invite").toHaveCount(
      1,
    );
    await expect(
      page.getByRole("button", { name: PEOPLE_KEYSTROKES.invite.act, exact: true }),
    ).toBeVisible();
  });

  test("an Admin decides requests by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { asked } = await anAdminAtRequests(page, request, "Calder Castings", [
      { displayName: "Kept Lee", reason: "I bid for the rail framework." },
      { displayName: "Dropped Ray", reason: "Let me in." },
      { displayName: "Approved Kay", reason: "I run the renewals." },
    ]);
    const kay = asked[2]?.email ?? "";
    await tabOpenedByKeyboard(page, MEMBERS_VIEW, "Requests");
    await expect(requestRows(page)).toHaveCount(3);

    await tabUntilFocused(
      page,
      page.getByRole("button", { name: "Approve the request from Dropped Ray" }),
    );
    await clockTheNextKey(page, {
      at: "(//section[.//h2[.='Requests']]//output)[2]",
      reads: "2 requests waiting",
    });
    await page.keyboard.press("d");
    await expect(rowOf(page, "Dropped Ray")).toHaveCount(0);
    await theActLandedWithinItsBudget(page, "decline");
    await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeFocused();
    await expect(requestsRegion(page).getByRole("status").first()).toHaveText(
      "Declined the request from Dropped Ray. They may ask again.",
    );

    const keystrokes = await keystrokesListed(page, "People");
    await expect(keystrokes).toContainText("Approve the request in focus");
    await expect(keystrokes).toContainText("Decline the request in focus");
    await expect(keystrokes, "d removes a member on the Members tab alone").not.toContainText(
      "Remove the member in focus",
    );
    await page.keyboard.press("Escape");

    await tabUntilFocused(
      page,
      page.getByRole("button", { name: "Decline the request from Approved Kay" }),
    );
    await page.keyboard.press("a");
    const approving = approveDialog(page, "Approved Kay");
    await expect(approving.getByRole("combobox", { name: "Role" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(approving).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Decline the request from Approved Kay" }),
    ).toBeFocused();
    await page.keyboard.press("a");
    await editorPickedByKeyboard(page, approving.getByRole("combobox", { name: "Role" }));
    await expect(approving).toContainText("Checks concepts, runs question sets and saves Answers.");
    await tabUntilFocused(
      page,
      approving.getByRole("button", { name: "Approve and send the invitation" }),
    );
    await passesTheAccessibilityGate();
    await clockTheNextKey(page, {
      at: "(//section[.//h2[.='Requests']]//output)[2]",
      reads: "1 request waiting",
    });
    await page.keyboard.press("Enter");
    await expect(approving).toHaveCount(0);
    await theActLandedWithinItsBudget(page, "approve");
    await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeFocused();
    await expect(requestsRegion(page).getByRole("status").first()).toContainText(
      `Approved. The invitation went to ${kay} as an Editor`,
    );
    await expect(requestRows(page)).toHaveCount(1);

    await expect(requestsRegion(page)).toMatchAriaSnapshot(`
      - region "Requests":
        - heading "Requests" [level=2]
        - status: /Approved\\. The invitation went to/
        - status: 1 request waiting
        - paragraph: /Declining sends them nothing, and they may ask again\\./
        - table:
          - caption: /Requests to join this workspace/
          - rowgroup:
            - row "Person Reason State Asked Acts":
              - columnheader "Person"
              - columnheader "Reason"
              - columnheader "State"
              - columnheader "Asked"
              - columnheader "Acts"
          - rowgroup:
            - row /Kept Lee/:
              - cell /Kept Lee/
              - cell "I bid for the rail framework."
              - cell "Waiting"
              - cell /\\d{4}/
              - cell:
                - button "Approve the request from Kept Lee"
                - button "Decline the request from Kept Lee"
    `);
  });

  test("says a request decided meanwhile in its word", async ({ page, context, request }) => {
    await anAdminAtRequests(page, request, "Aire Valley Tooling", [{ displayName: "Priya Shah" }]);
    await openRequests(page);
    await rowOf(page, "Priya Shah")
      .getByRole("button", { name: "Approve the request from Priya Shah" })
      .click();
    const approving = approveDialog(page, "Priya Shah");
    await expect(approving.getByRole("combobox", { name: "Role" })).toBeVisible();

    const elsewhere = await context.newPage();
    await elsewhere.goto(MEMBERS_VIEW);
    await openRequests(elsewhere);
    await rowOf(elsewhere, "Priya Shah")
      .getByRole("button", { name: "Decline the request from Priya Shah" })
      .click();
    await expect(requestsRegion(elsewhere)).toContainText(EMPTY_LINES.requests);
    await elsewhere.close();

    await approving.getByRole("button", { name: "Approve and send the invitation" }).click();

    await expect(approving).toHaveCount(0);
    const refused = requestsRegion(page).getByRole("alert");
    await expect(refused).toContainText("Refused: already-decided.");
    await expect(refused).toContainText(
      "This request was decided while you were deciding it. Read the list again.",
    );
    await expect(requestRows(page)).toHaveCount(0);
    await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeFocused();
    await expect(page.locator("body"), "the refusal").not.toContainText(NAMES_AN_ORGANISATION);
  });

  test("shows an Admin only their own workspace's requests", async ({ page, request }) => {
    const other = await provision(request, { name: "Wharfe Fabrication" });
    await asksToJoin(request, other.slug, { displayName: "Other Asker" });

    await anAdminAtRequests(page, request, "Ryedale Metalwork", [{ displayName: "Own Asker" }]);
    await openRequests(page);

    await expect(requestRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Own Asker")).toHaveCount(1);
    await expect(requestsRegion(page)).not.toContainText("Other Asker");
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`refuses a member at ${role} the requests, in its word`, async ({ page, request }) => {
      const email = anAddress(role.toLowerCase());
      const [member, workspace] = await Promise.all([
        person(request, email, { displayName: `A ${role}` }),
        provision(request, { name: `Wharfe ${role}s` }),
      ]);
      await addMember(request, { role, userId: member.id, workspaceId: workspace.workspaceId });
      await asksToJoin(request, workspace.slug, { displayName: "Priya Shah" });
      await page.goto(MEMBERS_VIEW);
      await signIn(page, request, email);
      await openRequests(page);

      const refused = requestsRegion(page).getByRole("alert");
      await expect(refused).toContainText("Refused: role-forbids.");
      await expect(refused).toContainText(
        "Only an Admin of this workspace sees and decides its access requests.",
      );
      await expect(requestsRegion(page).getByRole("table")).toHaveCount(0);
      await expect(requestsRegion(page)).not.toContainText("Priya Shah");
      await expect(page.locator("body"), "the refusal").not.toContainText(NAMES_AN_ORGANISATION);
    });
  }
});
