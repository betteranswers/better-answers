import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { SEARCH_KEYSTROKES as KEY } from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  provision,
  seedConcepts,
  seedConnectedSources,
  signIn,
  skipLinkReachesThePage,
} from "../harness.ts";
import { heldBack, isAFind, listsItsKeystrokes, scrolledSideways } from "../knowledge.ts";
import { aVirtualAuthenticator } from "../virtual-authenticator.ts";

const LIST_BUDGET_MS = 1000;

const A_PAGE = 20;

const searchRegion = (page: Page) => page.getByRole("region", { name: "Search" });

const searchBox = (page: Page) =>
  searchRegion(page).getByRole("searchbox", { name: "Search by a word or a question" });

const matchesOf = (page: Page): Locator =>
  searchRegion(page).getByRole("list", { name: "Matches" }).getByRole("listitem");

const said = (page: Page) => searchRegion(page).getByRole("status").first();

const passagePanel = (page: Page, title: string) => page.getByRole("dialog", { name: title });

const markedAt = (sensitivity: string): RegExp =>
  new RegExp(`Not company knowledge\\W+${sensitivity}`);

const asked = (query: string): string =>
  `${SEARCH.path}?${new URLSearchParams({ "knowledge.search": query }).toString()}`;

const HANDBOOK = "Warehouse handbook";

const palletPassage = (index: number) =>
  `Pallet bay ${index + 1} takes stock wrapped and labelled before it is racked.`;

const PALLET_PASSAGES = Array.from({ length: A_PAGE + 5 }, (_, index) => palletPassage(index));

const FIRST_PALLET_PASSAGE = palletPassage(0);

type Seeded = { readonly workspaceId: string; readonly adminId: string };

const conceptsSeeded = async (api: APIRequestContext, workspace: Seeded): Promise<void> => {
  await seedConcepts(api, {
    workspaceId: workspace.workspaceId,
    userId: workspace.adminId,
    concepts: [
      {
        title: "Audit Logs Retention",
        body: "We keep audit logs for seven years, then delete them.",
        trust: "machine-confirmed",
      },
      { title: "Audit Committee", body: "The committee meets each quarter." },
      {
        title: "Audit Salary Bands",
        body: "Each salary band is reviewed by the audit committee.",
        sensitivity: "Restricted",
      },
      { title: "Forklift Licences", body: "Every forklift driver holds a current licence." },
    ],
  });
};

const handbookSeeded = async (api: APIRequestContext, workspace: Seeded): Promise<void> => {
  await seedConnectedSources(api, {
    workspaceId: workspace.workspaceId,
    connectedSources: [
      {
        name: "Operations drive",
        sensitivity: "Internal",
        published: true,
        sync: "done",
        documents: [{ title: HANDBOOK, passages: PALLET_PASSAGES }],
      },
    ],
  });
};

const PAY_REVIEW = "Pay review minutes";

const payReviewSeeded = async (api: APIRequestContext, workspace: Seeded): Promise<void> => {
  await seedConnectedSources(api, {
    workspaceId: workspace.workspaceId,
    connectedSources: [
      {
        name: "Payroll drive",
        sensitivity: "Restricted",
        published: true,
        sync: "done",
        documents: [
          { title: PAY_REVIEW, passages: ["The salary bands were set at the spring pay review."] },
        ],
      },
    ],
  });
};

const FORKLIFT_GUIDE = "Forklift guide";

const forkliftGuideSeeded = async (api: APIRequestContext, workspace: Seeded): Promise<void> => {
  await seedConnectedSources(api, {
    workspaceId: workspace.workspaceId,
    connectedSources: [
      {
        name: "Yard drive",
        sensitivity: "Internal",
        published: true,
        sync: "done",
        documents: [
          { title: FORKLIFT_GUIDE, passages: ["A forklift lifts each pallet off the racking."] },
          { title: "Racking plan", passages: ["Each pallet bay is racked by row."] },
        ],
      },
    ],
  });
};

const isAFindFor =
  (query: string) =>
  (url: URL): boolean =>
    isAFind(url) && (url.searchParams.get("input") ?? "").includes(`"query":"${query}"`);

type Seeding = (api: APIRequestContext, workspace: Seeded) => Promise<void>;

const anAdminAtSearch = async (
  page: Page,
  api: APIRequestContext,
  name: string,
  seedings: readonly Seeding[],
) => {
  const email = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail: email });
  for (const seeding of seedings) {
    await seeding(api, { workspaceId: workspace.workspaceId, adminId: workspace.admin.id });
  }
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.goto(SEARCH.path);
  await expect(searchBox(page)).toBeVisible();
  return workspace;
};

const saidNow = async (page: Page): Promise<string> => (await said(page).textContent()) ?? "";

const aPassageClickedWhileTheListLoads = async (page: Page): Promise<() => void> => {
  await searched(page, "pallet");
  await expect(matchesOf(page)).toHaveCount(2);
  const typed = await heldBack(page, isAFindFor("forklift"));
  await searchBox(page).fill("forklift");
  await matchesOf(page).getByRole("button", { name: FORKLIFT_GUIDE }).click();
  await typed.reached;
  return typed.release;
};

const aPassageOpenedWhileTheListLoads = async (
  page: Page,
  api: APIRequestContext,
  name: string,
): Promise<{ readonly panel: Locator; readonly release: () => void }> => {
  await anAdminAtSearch(page, api, name, [forkliftGuideSeeded]);
  const release = await aPassageClickedWhileTheListLoads(page);
  const panel = passagePanel(page, FORKLIFT_GUIDE);
  await expect(panel.getByRole("heading", { name: FORKLIFT_GUIDE })).toBeFocused();
  await expect(matchesOf(page), "the opener is still on the page while the list loads").toHaveCount(
    0,
  );
  return { panel, release };
};

const searched = async (page: Page, query: string): Promise<void> => {
  await searchBox(page).fill(query);
  await expect(page, "the typed search has not settled into the address").toHaveURL(
    (url) => url.searchParams.get("knowledge.search") === query,
  );
  await expect(said(page)).toContainText(query);
  await expect(matchesOf(page).first()).toBeVisible();
};

const foundNothing = async (
  page: Page,
  query: string,
  ask: () => Promise<unknown> = () => searchBox(page).fill(query),
): Promise<void> => {
  const find = await heldBack(page, isAFind);
  await ask();
  await find.reached;
  await expect(said(page)).toContainText(query);
  const whileAsking = await saidNow(page);
  find.release();
  await expect(said(page), "the status still says the search is asking").not.toHaveText(
    whileAsking,
  );
  await expect(said(page)).toContainText(query);
  await expect(matchesOf(page)).toHaveCount(0);
};

const handbookMatches = (page: Page) => matchesOf(page).filter({ hasText: HANDBOOK });

test.describe("the Knowledge Search page", () => {
  test("finds an Admin what a Viewer's search withholds", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Esk Archives", [conceptsSeeded, payReviewSeeded]);

    await searched(page, "audit");
    await expect(matchesOf(page).filter({ hasText: "Audit Salary Bands" })).toHaveCount(1);

    await searched(page, "salary bands");
    await expect(matchesOf(page).filter({ hasText: "Audit Salary Bands" })).toHaveCount(1);
    const document = matchesOf(page).filter({ hasText: PAY_REVIEW });
    await expect(document).toHaveCount(1);
    await expect(document).toContainText(markedAt("Restricted"));
  });

  test("opens a passage match in the panel without leaving Search", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ryedale Stores", [handbookSeeded]);
    await searched(page, "pallet");

    const first = handbookMatches(page).first();
    await expect(first).toContainText("Document");
    await expect(first).toContainText("Not company knowledge");
    await expect(first).toContainText("Internal");
    await expect(first, "the match shows its passage's opening line").toContainText(
      "Pallet bay 1 takes stock wrapped and labelled before it is racked.",
    );
    const opener = first.getByRole("button", { name: HANDBOOK });
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await opener.click();

    const panel = passagePanel(page, HANDBOOK);
    await expect(panel).toContainText(FIRST_PALLET_PASSAGE);
    await expect(panel.getByRole("heading", { name: HANDBOOK })).toBeFocused();
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    const panelLeft = await panel.evaluate((drawn) => drawn.getBoundingClientRect().left);
    await expect
      .poll(() => first.evaluate((row) => row.getBoundingClientRect().right), {
        message: "the open panel covers the match beside it",
      })
      .toBeLessThanOrEqual(panelLeft);
    await expect(page).toHaveURL(/\/knowledge\/search\?/);

    await searchBox(page).click();
    await expect(panel, "the page behind the panel closed it").toBeVisible();
    await opener.focus();
    await page.keyboard.press("Escape");
    await expect(panel, "Escape on the page closed the panel").toBeVisible();

    await panel.getByRole("heading", { name: HANDBOOK }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("hands Tab off the panel while the new list loads", async ({ page, request }) => {
    const { panel } = await aPassageOpenedWhileTheListLoads(page, request, "Nidd Bays");

    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      searchRegion(page).getByRole("heading", { name: "Search" }),
      "Tab stayed in the panel while the new list loaded",
    ).toBeFocused();
  });

  test("hands Tab from the open panel back to its opener", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtSearch(page, request, "Swale Stores", [handbookSeeded]);
    await foundNothing(page, "forklift");
    const withNoPassageOpened = await saidNow(page);
    await searched(page, "pallet");
    const opener = handbookMatches(page).first().getByRole("button", { name: HANDBOOK });
    await opener.click();
    const panel = passagePanel(page, HANDBOOK);
    const heading = panel.getByRole("heading", { name: HANDBOOK });
    await expect(heading).toBeFocused();
    await passesTheAccessibilityGate();

    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(opener, "Tab off the panel did not reach the page").toBeFocused();
    await expect(panel).toBeVisible();

    await opener.press("Enter");
    await expect(heading).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(opener).toBeFocused();

    await searchBox(page).fill("forklift");
    await expect(panel, "a new search left the last one's passage open").toHaveCount(0);
    await expect(searchBox(page)).toBeFocused();
    await expect(said(page), "a new search was said to have lost a passage").toHaveText(
      withNoPassageOpened,
    );
  });

  for (const width of [1280, 1536]) {
    test(`keeps the panel off the passkey offer, at ${String(width)} px`, async ({
      page,
      request,
    }) => {
      await aVirtualAuthenticator(page);
      const email = anAddress("admin");
      const workspace = await provision(request, {
        name: `Holme Keys ${String(width)}`,
        adminEmail: email,
      });
      await handbookSeeded(request, {
        workspaceId: workspace.workspaceId,
        adminId: workspace.admin.id,
      });
      await page.setViewportSize({ width, height: 720 });
      await page.goto(asked("pallet"));
      await signIn(page, request, email);
      const dismiss = page.getByRole("button", { name: "Dismiss Passkey Offer" });
      await expect(dismiss).toBeVisible();

      await handbookMatches(page).first().getByRole("button", { name: HANDBOOK }).click();
      const panel = await passagePanel(page, HANDBOOK).boundingBox();
      const offer = await dismiss.boundingBox();

      assert.ok(panel !== null, "the panel drew a box");
      assert.ok(offer !== null, "the passkey offer drew a box");
      expect(
        offer.x + offer.width,
        "the panel covers the passkey offer's Dismiss",
      ).toBeLessThanOrEqual(panel.x);
    });
  }

  for (const width of [320, 1024]) {
    test(`opens a passage inline beneath its match at ${String(width)} px`, async ({
      page,
      request,
    }) => {
      await anAdminAtSearch(page, request, `Holme Stores ${String(width)}`, [handbookSeeded]);
      await page.setViewportSize({ width, height: 720 });
      await searched(page, "pallet");

      const first = handbookMatches(page).first();
      const opener = first.getByRole("button", { name: HANDBOOK });
      await opener.click();
      const inline = first.getByRole("region", { name: HANDBOOK });
      await expect(inline).toContainText(FIRST_PALLET_PASSAGE);
      await expect(inline.getByRole("heading", { name: HANDBOOK })).toBeFocused();
      await expect(passagePanel(page, HANDBOOK)).toHaveCount(0);
      expect(await scrolledSideways(page), `the page scrolls sideways at ${String(width)} px`).toBe(
        0,
      );

      await page.keyboard.press("Escape");
      await expect(inline).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(opener).toHaveAttribute("aria-expanded", "false");

      await opener.click();
      await inline.getByRole("button", { name: "Close" }).click();
      await expect(inline).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  }

  test("renders matches within the list's budget", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ryedale Archives", [handbookSeeded]);

    const started = Date.now();
    await page.goto(asked("pallet"));
    await expect(matchesOf(page)).toHaveCount(A_PAGE);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "search", description: `${elapsed} ms` });
    expect(elapsed, "a page of matches rendered past its budget").toBeLessThan(LIST_BUDGET_MS);
  });

  test("searches, opens and pages by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtSearch(page, request, "Calder Records", [handbookSeeded]);
    await skipLinkReachesThePage(page);

    await listsItsKeystrokes(page, "Search", KEY, [
      "Search This Workspace’s Knowledge",
      "Show More Matches",
      "Open the Match in Focus",
      "Close the Open Passage",
    ]);

    await page.keyboard.press(KEY.search.key);
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.type("pallet");
    await expect(page).toHaveURL(/knowledge\.search=pallet/);
    await expect(matchesOf(page)).toHaveCount(A_PAGE);

    await page.keyboard.press("Tab");
    const opener = handbookMatches(page).first().getByRole("button", { name: HANDBOOK });
    await expect(opener).toBeFocused();
    await page.keyboard.press("Enter");
    const panel = passagePanel(page, HANDBOOK);
    await expect(panel.getByRole("heading", { name: HANDBOOK })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.keyboard.press(KEY.open.key);
    await expect(panel.getByRole("heading", { name: HANDBOOK })).toBeFocused();
    await page.keyboard.press(KEY.close.key);
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();

    await page.keyboard.press(KEY.more.key);
    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length);
    await expect(matchesOf(page).nth(A_PAGE)).toBeFocused();

    await expect(searchRegion(page)).toMatchAriaSnapshot(`
      - region "Search":
        - heading "Search" [level=2]
        - searchbox "Search by a word or a question": pallet
        - status
        - list "Matches":
          - listitem:
            - button "${HANDBOOK}"
    `);

    await passesTheAccessibilityGate();
  });
});
