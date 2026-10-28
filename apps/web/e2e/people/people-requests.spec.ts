import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page, Route } from "@playwright/test";

import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  A_ROLE,
  addMember,
  anAddress,
  askToJoin,
  clockTheNextKey,
  countOf,
  editorPickedByKeyboard,
  keyListed,
  keystrokesButton,
  keystrokesListed,
  notFoundOfferingHome,
  person,
  provision,
  saysARefusal,
  signIn,
  tabOpenedByKeyboard,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

const MEMBERS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members").path;

const LONG_UK_DATE = /^\d{1,2} [A-Z][a-z]+ \d{4}$/;

const REASON = "I have joined the bids team and need the answer library.";

const NAMES_AN_ORGANISATION = /organi[sz]ation/i;

const requestsRegion = (page: Page) => page.getByRole("region", { name: "Requests" });

const saidIn = (page: Page): Locator => requestsRegion(page).getByRole("status").last();

const emptyLine = (page: Page): Locator =>
  requestsRegion(page).locator("[data-slot='empty-title']");

const THE_COUNT = "//section[h2='Requests']/div/output";

const requestRows = (page: Page): Locator =>
  requestsRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator => requestRows(page).filter({ hasText: name });

const approveDialog = (page: Page, name: string) =>
  page.getByRole("dialog", { name: `Approve Request from ${name}` });

/** A batch's address names its procedures, so a call is matched by its name alone. */
const asks =
  (procedure: string) =>
  (url: URL): boolean =>
    url.pathname.replace("/trpc/", "").split(",").includes(procedure);

const DECLINE_FORBIDDEN = {
  error: {
    message: "role-forbids",
    code: -32_003,
    data: {
      code: "FORBIDDEN",
      httpStatus: 403,
      refusal: { word: "role-forbids", class: "forbidden" },
    },
  },
};

const heldUntilReleased = async (
  page: Page,
  procedure: string,
  answer: (route: Route) => Promise<void>,
): Promise<() => void> => {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(asks(procedure), async (route) => {
    await released;
    await answer(route);
  });
  return release;
};

const refusingTheDeclineOnRelease = (page: Page) =>
  heldUntilReleased(page, "members.declineRequest", (route) =>
    route.fulfill({ json: [DECLINE_FORBIDDEN] }),
  );

const holdingTheRequestsRead = (page: Page) =>
  heldUntilReleased(page, "members.requests", (route) => route.continue());

const describedAfresh = async (select: Locator, pick: () => Promise<void>): Promise<void> => {
  const described = await select.getAttribute("aria-describedby");
  const before = await select
    .page()
    .locator(`[id="${described ?? ""}"]`)
    .innerText();
  await pick();
  await expect(select).toHaveAccessibleDescription(/\S/);
  await expect(
    select,
    "the role's meaning did not follow the pick",
  ).not.toHaveAccessibleDescription(before);
};

const invitingButtons = (page: Page) => page.getByRole("button", { name: /^invite/i });

type Asking = { readonly displayName: string; readonly reason?: string };

type Asked = { readonly displayName: string; readonly email: string };

type AtRequests = {
  readonly workspaceId: string;
  readonly shortName: string;
  readonly asked: readonly Asked[];
};

const asksToJoin = async (
  api: APIRequestContext,
  shortName: string,
  asking: Asking,
): Promise<Asked> => {
  const email = anAddress(asking.displayName.split(" ")[0]?.toLowerCase() ?? "asker");
  const made = await person(api, email, { displayName: asking.displayName });
  await askToJoin(api, { shortName, requesterId: made.id, reason: asking.reason ?? REASON });
  return { displayName: asking.displayName, email };
};

const anAdminAtRequests = async (
  page: Page,
  api: APIRequestContext,
  workspaceName: string,
  asking: readonly Asking[],
): Promise<AtRequests> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name: workspaceName, adminEmail });
  const asked: Asked[] = [];
  for (const one of asking) asked.push(await asksToJoin(api, workspace.shortName, one));

  await page.goto(MEMBERS_PAGE);
  await signIn(page, api, adminEmail);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  return { workspaceId: workspace.workspaceId, shortName: workspace.shortName, asked };
};

const openRequests = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Requests" }).click();
  await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeVisible();
};

test.describe("the People page's Requests tab", () => {
  test("an Admin approves a request at a role, inviting them", async ({ page, request }) => {
    const { asked } = await anAdminAtRequests(page, request, "Calder Joinery", [
      { displayName: "Priya Shah" },
    ]);
    const priya = asked[0]?.email;
    assert.ok(priya !== undefined, "Priya asked to join");
    await openRequests(page);

    await expect(requestRows(page)).toHaveCount(1);
    const cells = rowOf(page, "Priya Shah").getByRole("cell");
    await expect(cells.nth(0)).toContainText("Priya Shah");
    await expect(cells.nth(0)).toContainText(priya);
    await expect(cells.nth(1)).toHaveText(REASON);
    await expect(cells.nth(2)).toHaveText("Waiting");
    await expect(cells.nth(3)).toHaveText(LONG_UK_DATE);
    await expect(countOf(requestsRegion(page))).toHaveText(/\b1\b/);

    await rowOf(page, "Priya Shah")
      .getByRole("button", { name: "Approve Request from Priya Shah" })
      .click();
    const approving = approveDialog(page, "Priya Shah");
    await expect(approving, "the dialog names no address to email").toContainText(priya);
    const role = approving.getByRole("combobox", { name: "Role" });
    await describedAfresh(role, async () => {
      await role.click();
      await page.getByRole("option", { name: "Editor" }).click();
    });
    await expect(role).toHaveText("Editor");
    await approving.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(approving).toHaveCount(0);
    await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeFocused();
    await expect(saidIn(page)).toContainText(priya);
    await expect(rowOf(page, "Priya Shah")).toHaveCount(0);
    await expect(emptyLine(page)).toHaveText(/\S/);

    await page.getByRole("tab", { name: "Invitations" }).click();
    const invited = page
      .getByRole("region", { name: "Invitations" })
      .getByRole("row")
      .filter({ hasText: priya });
    await expect(invited.getByRole("cell", { name: "Editor", exact: true })).toHaveCount(1);
  });

  test("renders the waiting requests within the list's budget", async ({ page, request }) => {
    await anAdminAtRequests(page, request, "Dales Engineering", [
      { displayName: "Sam Okafor" },
      { displayName: "Una Byrne" },
      { displayName: "Ola Nowak" },
    ]);

    const startedAtMs = Date.now();
    await page.goto(MEMBERS_PAGE);
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

  test("an empty tab says so, inviting once", async ({ page, request }) => {
    await anAdminAtRequests(page, request, "Swale Presswork", []);
    await openRequests(page);

    await expect(requestsRegion(page)).toMatchAriaSnapshot(`
      - region "Requests":
        - heading "Requests" [level=2]
        - status
        - button "Invite a Person"
        - status
        - searchbox "Search by name or address"
        - table:
          - caption
          - rowgroup:
            - row "Person Reason State Asked Actions"
          - rowgroup:
            - row:
              - cell "No requests waiting"
    `);
    await expect(invitingButtons(page), "the head's action is the one way to invite").toHaveCount(
      1,
    );
    await expect(page.getByRole("button", { name: "Invite a Person", exact: true })).toBeVisible();
  });

  test("searches the requests by name and by address", async ({ page, request }) => {
    await anAdminAtRequests(page, request, "Aire Weir", [
      { displayName: "Priya Shah" },
      { displayName: "Sam Okafor" },
      { displayName: "Ola Nowak" },
    ]);
    await openRequests(page);
    await expect(requestRows(page)).toHaveCount(3);

    const search = requestsRegion(page).getByRole("searchbox", {
      name: "Search by name or address",
    });
    await search.fill("Priya");
    await expect(requestRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Priya Shah")).toHaveCount(1);
    await expect(countOf(requestsRegion(page))).toHaveText(/1 of 3 requests match/);
    await expect(page).toHaveURL(/requests\.search=Priya/);

    await search.fill("ola-");
    await expect(requestRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Ola Nowak")).toHaveCount(1);

    await search.fill("");
    await expect(requestRows(page)).toHaveCount(3);
    await expect(countOf(requestsRegion(page))).toHaveText(/3 requests waiting/);
  });

  test("brings a request back when the api refuses its decline", async ({ page, request }) => {
    await anAdminAtRequests(page, request, "Nidd Weir", [{ displayName: "Priya Shah" }]);
    await openRequests(page);
    await expect(rowOf(page, "Priya Shah")).toHaveCount(1);
    const answerTheRead = await holdingTheRequestsRead(page);
    const refuse = await refusingTheDeclineOnRelease(page);

    await rowOf(page, "Priya Shah")
      .getByRole("button", { name: "Decline Request from Priya Shah" })
      .click();
    await expect(rowOf(page, "Priya Shah"), "the row waited for the api").toHaveCount(0);

    refuse();
    await expect(rowOf(page, "Priya Shah"), "the refused decline left the row gone").toHaveCount(1);
    answerTheRead();
    await saysARefusal(requestsRegion(page).getByRole("alert"));
    await expect(rowOf(page, "Priya Shah")).toHaveCount(1);
  });

  test("drops the select-first line once a key approves", async ({ page, request }) => {
    await anAdminAtRequests(page, request, "Calder Asks", [{ displayName: "Kept Lee" }]);
    await openRequests(page);
    await expect(requestRows(page)).toHaveCount(1);
    const said = page
      .getByRole("region", { name: "Requests", includeHidden: true })
      .locator("output:has(+ [role='alert'])");
    await keystrokesButton(page).focus();

    await page.keyboard.press(PEOPLE_KEYSTROKES.approve.key);
    await expect(said, "a with no request in focus said nothing").toHaveText(/\S/);

    await page.getByRole("button", { name: "Approve Request from Kept Lee" }).focus();
    await page.keyboard.press(PEOPLE_KEYSTROKES.approve.key);
    await expect(approveDialog(page, "Kept Lee")).toBeVisible();
    await expect(said, "the select-first line outlived the approve").toHaveText("");
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
    const kay = asked[2]?.email;
    assert.ok(kay !== undefined, "Kay asked to join");
    await tabOpenedByKeyboard(page, MEMBERS_PAGE, "Requests");
    await expect(requestRows(page)).toHaveCount(3);

    await tabUntilFocused(
      page,
      page.getByRole("button", { name: "Approve Request from Dropped Ray" }),
    );
    await clockTheNextKey(page, {
      at: THE_COUNT,
      reads: "2",
    });
    await page.keyboard.press("d");
    await expect(rowOf(page, "Dropped Ray")).toHaveCount(0);
    await theActionLandedWithinItsBudget(page, "decline");
    const landed = requestsRegion(page).getByRole("heading", { name: "Requests" });
    await expect(landed).toBeFocused();
    await expect(
      countOf(requestsRegion(page)).locator(".."),
      "focus landed out of sight",
    ).not.toHaveCSS("box-shadow", "none");
    await expect(saidIn(page)).toContainText("Dropped Ray");

    const keystrokes = await keystrokesListed(page, "Members");
    await expect(keyListed(keystrokes, PEOPLE_KEYSTROKES.approve.key)).toBeVisible();
    await expect(keyListed(keystrokes, PEOPLE_KEYSTROKES.decline.key)).toBeVisible();
    await expect(
      keyListed(keystrokes, PEOPLE_KEYSTROKES.changeRole.key),
      "the Members tab's keystrokes on Requests",
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await tabUntilFocused(
      page,
      page.getByRole("button", { name: "Decline Request from Approved Kay" }),
    );
    await page.keyboard.press("a");
    const approving = approveDialog(page, "Approved Kay");
    await expect(approving.getByRole("combobox", { name: "Role" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(approving).toHaveCount(0);
    await expect(saidIn(page), "an approve key wiped the decline's outcome").toContainText(
      "Dropped Ray",
    );
    await expect(
      page.getByRole("button", { name: "Decline Request from Approved Kay" }),
    ).toBeFocused();
    await page.keyboard.press("a");
    const role = approving.getByRole("combobox", { name: "Role" });
    await describedAfresh(role, () => editorPickedByKeyboard(page, role));
    await tabUntilFocused(page, approving.getByRole("button", { name: "Approve", exact: true }));
    await passesTheAccessibilityGate();
    await clockTheNextKey(page, {
      at: THE_COUNT,
      reads: "1",
    });
    await page.keyboard.press("Enter");
    await expect(approving).toHaveCount(0);
    await theActionLandedWithinItsBudget(page, "approve");
    await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeFocused();
    await expect(saidIn(page)).toContainText(kay);
    await expect(requestRows(page)).toHaveCount(1);

    await expect(requestsRegion(page)).toMatchAriaSnapshot(`
      - region "Requests":
        - heading "Requests" [level=2]
        - status: /\\b1\\b/
        - button "Invite a Person"
        - status: /approved-\\d+/
        - searchbox "Search by name or address"
        - paragraph
        - table:
          - caption
          - rowgroup:
            - row "Person Reason State Asked Actions":
              - columnheader "Person"
              - columnheader "Reason"
              - columnheader "State"
              - columnheader "Asked"
              - columnheader "Actions"
          - rowgroup:
            - row /Kept Lee/:
              - cell /Kept Lee/
              - cell "I bid for the rail framework."
              - cell "Waiting"
              - cell /\\d{4}/
              - cell:
                - button "Approve Request from Kept Lee"
                - button "Decline Request from Kept Lee"
    `);
  });

  test("says a request was decided meanwhile, and what next", async ({
    page,
    context,
    request,
  }) => {
    await anAdminAtRequests(page, request, "Aire Valley Tooling", [{ displayName: "Priya Shah" }]);
    await openRequests(page);
    await rowOf(page, "Priya Shah")
      .getByRole("button", { name: "Approve Request from Priya Shah" })
      .click();
    const approving = approveDialog(page, "Priya Shah");
    await expect(approving.getByRole("combobox", { name: "Role" })).toBeVisible();

    const elsewhere = await context.newPage();
    await elsewhere.goto(MEMBERS_PAGE);
    await openRequests(elsewhere);
    await rowOf(elsewhere, "Priya Shah")
      .getByRole("button", { name: "Decline Request from Priya Shah" })
      .click();
    await expect(rowOf(elsewhere, "Priya Shah")).toHaveCount(0);
    await expect(emptyLine(elsewhere)).toHaveText(/\S/);
    await elsewhere.close();

    const refused = refusalAnswering(page, "members.approveRequest");
    await approving.getByRole("button", { name: "Approve", exact: true }).click();

    expect(await refused).toMatchObject({ word: "already-decided" });
    await expect(approving).toHaveCount(0);
    await saysARefusal(requestsRegion(page).getByRole("alert"));
    await expect(rowOf(page, "Priya Shah")).toHaveCount(0);
    await expect(requestsRegion(page).getByRole("heading", { name: "Requests" })).toBeFocused();
    await expect(page.locator("body"), "the refusal").not.toContainText(NAMES_AN_ORGANISATION);
  });

  test("shows an Admin only their own workspace's requests", async ({ page, request }) => {
    const other = await provision(request, { name: "Wharfe Fabrication" });
    await asksToJoin(request, other.shortName, { displayName: "Other Asker" });

    await anAdminAtRequests(page, request, "Ryedale Metalwork", [{ displayName: "Own Asker" }]);
    await openRequests(page);

    await expect(requestRows(page)).toHaveCount(1);
    await expect(rowOf(page, "Own Asker")).toHaveCount(1);
    await expect(requestsRegion(page)).not.toContainText("Other Asker");
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${A_ROLE[role]} no requests, Members being hidden`, async ({ page, request }) => {
      const email = anAddress(role.toLowerCase());
      const [member, workspace] = await Promise.all([
        person(request, email, { displayName: `A ${role}` }),
        provision(request, { name: `Wharfe ${role}s` }),
      ]);
      await addMember(request, { role, userId: member.id, workspaceId: workspace.workspaceId });
      await asksToJoin(request, workspace.shortName, { displayName: "Priya Shah" });
      await page.goto(MEMBERS_PAGE);
      await signIn(page, request, email);

      await notFoundOfferingHome(page, role);
      await expect(page.getByRole("tab", { name: "Requests" })).toHaveCount(0);
      await expect(requestsRegion(page)).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Priya Shah");
    });
  }
});
