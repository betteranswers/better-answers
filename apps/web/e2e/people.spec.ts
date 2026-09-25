import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { screenById, viewsOf } from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  person,
  provision,
  signIn,
  skipLinkReachesTheScreen,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const ACT_BUDGET_MS = 100;

const people = screenById("people");

const MEMBERS_VIEW = "/people/members";

const rail = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const membersRegion = (page: Page) => page.getByRole("region", { name: "Members" });

const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search by name or address" });

// The header row is a row too, so the members are the rows with a cell.
const memberRows = (page: Page): Locator =>
  membersRegion(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const rowOf = (page: Page, name: string): Locator => memberRows(page).filter({ hasText: name });

// Timed in the page, from the key to the count that says it: a matcher polls too coarsely.
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

// Another workspace's member is made alongside, so a list that leaked would show them.
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

  test("shows an Admin each member's name, address, role and groups, and no one else", async ({
    page,
    request,
  }) => {
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

  test("finds one person by name or address, and says when no one matches", async ({
    page,
    request,
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
    test(`refuses a member at ${role} the list, saying the refusal in its own word`, async ({
      page,
      request,
    }) => {
      const email = anAddress(role.toLowerCase());
      const member = await person(request, email, { displayName: `A ${role}` });
      const workspace = await provision(request, { name: `Calder ${role}s` });
      await addMember(request, { role, userId: member.id, workspaceId: workspace.workspaceId });

      // Asked for before signing in, so the sign-in screen carries the person back to it.
      await page.goto(MEMBERS_VIEW);
      await signIn(page, request, email);
      await expect(page).toHaveURL(new RegExp(`${MEMBERS_VIEW}$`));

      const refused = membersRegion(page).getByRole("alert");
      await expect(refused).toContainText("Refused: role-forbids.");
      await expect(refused).toContainText("Only an Admin of this workspace sees its members.");
      await expect(membersRegion(page).getByRole("table")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(workspace.admin.email);
    });
  }

  test("is reached and searched by keyboard, and clean under axe", async ({
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
              - cell /Priya Shah/
              - cell "Editor"
              - cell "No group"
              - cell /\\d{4}/
            - row /Sam Okoro/:
              - cell /Sam Okoro/
              - cell "Viewer"
              - cell "No group"
              - cell /\\d{4}/
            - row /Test person/:
              - cell /Test person/
              - cell "Admin"
              - cell "No group"
              - cell /\\d{4}/
    `);

    await passesTheAccessibilityGate();
  });
});

test.describe("the People screen's words", () => {
  // Every People surface joins this test as it is built: the product's word is workspace.
  test("names a workspace and never an organisation, on every People view", async ({
    page,
    request,
  }) => {
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
  });
});
