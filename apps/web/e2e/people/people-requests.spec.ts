import type { APIRequestContext, Locator, Page, Route } from "@playwright/test";

import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  askToJoin,
  keystrokesButton,
  person,
  provision,
  saysARefusal,
  signIn,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const MEMBERS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members").path;

const REASON = "I have joined the bids team and need the answer library.";

const NAMES_AN_ORGANISATION = /organi[sz]ation/i;

const requestsRegion = (page: Page) => page.getByRole("region", { name: "Requests" });

const emptyLine = (page: Page): Locator =>
  requestsRegion(page).locator("[data-slot='empty-title']");

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
});
