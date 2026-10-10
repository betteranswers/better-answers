import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";

import { SEARCH_KEYSTROKES as KEY, MATCHES_A_PAGE } from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_WORDS as WORDS } from "@/features/knowledge/knowledge-words.ts";
import { HOMES, KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { NO_RESPONSE_TO_A_READ, sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  aMemberSignedInAt,
  anAddress,
  keystrokesListed,
  landedAtHome,
  navOf,
  provision,
  railOf,
  seedConcepts,
  seedConnectedSources,
  signIn,
  skipLinkReachesThePage,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const browse = menuGroupIn(KNOWLEDGE, "browse");

const SEARCH = pageNamed(browse, "Search");

const searchRegion = (page: Page) => page.getByRole("region", { name: SEARCH.name });

const searchBox = (page: Page) => searchRegion(page).getByRole("searchbox", { name: WORDS.search });

const matchesOf = (page: Page): Locator =>
  searchRegion(page).getByRole("list", { name: WORDS.matches }).getByRole("listitem");

const loadMore = (page: Page) => searchRegion(page).getByRole("button", { name: "Load more" });

const said = (page: Page) => searchRegion(page).getByRole("status");

const passagePanel = (page: Page, title: string) => page.getByRole("dialog", { name: title });

const asked = (query: string): string =>
  `${SEARCH.path}?${new URLSearchParams({ "knowledge.search": query }).toString()}`;

const isAFind = (url: URL): boolean => url.pathname.includes("knowledge.find");

/** A page past the first names its cursor in the batched input. */
const isAFindPastTheFirstPage = (url: URL): boolean =>
  isAFind(url) && (url.searchParams.get("input") ?? "").includes('"cursor"');

const HANDBOOK = "Warehouse handbook";

/** One more than a page, so a second page follows the first. */
const PALLET_PASSAGES = Array.from(
  { length: MATCHES_A_PAGE + 5 },
  (_, index) => `Pallet bay ${index + 1} takes stock wrapped and labelled before it is racked.`,
);

type Seeded = { readonly workspaceId: string; readonly adminId: string };

/** Four concepts by an Admin, one of them Restricted. */
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

/** A handbook no concept cites, so each of its passages matches as a document of its own. */
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

type Seeding = (api: APIRequestContext, workspace: Seeded) => Promise<void>;

/** Each test seeds only what it searches, since a concept's write is a commit of its own. */
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

const searched = async (page: Page, query: string): Promise<void> => {
  await searchBox(page).fill(query);
  await expect(said(page)).toHaveText(new RegExp(`^${WORDS.matched(query, false).slice(0, -1)}`));
};

const handbookMatches = (page: Page) => matchesOf(page).filter({ hasText: HANDBOOK });

test.describe("the Knowledge Search page", () => {
  test("writes the settled query to the address, kept by reload", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Calder Archives", [conceptsSeeded]);

    await searchBox(page).fill("audit log retention");
    await expect(page).toHaveURL(/knowledge\.search=audit(?:\+|%20)log(?:\+|%20)retention/);
    await expect(matchesOf(page).first()).toContainText("Audit Logs Retention");
    const shown = await matchesOf(page).allInnerTexts();

    await page.reload();
    await expect(searchBox(page)).toHaveValue("audit log retention");
    await expect(matchesOf(page).first()).toContainText("Audit Logs Retention");
    expect(await matchesOf(page).allInnerTexts(), "the reload drew other matches").toEqual(shown);
  });

  test("shows the nothing-asked state and sends no request", async ({ page, request }) => {
    const email = anAddress("admin");
    await provision(request, { name: "Aire Valley Records", adminEmail: email });
    await page.goto("/sign-in");
    await signIn(page, request, email);

    const finds: Request[] = [];
    page.on("request", (sent) => {
      if (isAFind(new URL(sent.url()))) finds.push(sent);
    });
    await page.goto(SEARCH.path);

    await expect(searchRegion(page).getByRole("status")).toHaveText(WORDS.nothingAsked);
    await expect(matchesOf(page)).toHaveCount(0);
    expect(finds, "the page asked for matches with nothing asked").toHaveLength(0);
  });

  test("marks each match with its kind and trust word", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Swale Records", [conceptsSeeded]);

    await searched(page, "audit log retention");
    const retention = matchesOf(page).filter({ hasText: "Audit Logs Retention" });
    await expect(retention).toContainText("Answer");
    await expect(retention).toContainText("Verified automatically");
    const committee = matchesOf(page).filter({ hasText: "Audit Committee" });
    await expect(committee).toContainText("Unverified");
  });

  test("loads more, and focus lands on the first new row", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Dales Stores", [handbookSeeded]);

    await searched(page, "pallet");
    await expect(matchesOf(page)).toHaveCount(MATCHES_A_PAGE);
    await expect(said(page)).toHaveText(WORDS.matched("pallet", true));
    await loadMore(page).click();

    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length);
    await expect(
      matchesOf(page).nth(MATCHES_A_PAGE),
      "focus did not land on the first new match",
    ).toBeFocused();
    await expect(loadMore(page)).toHaveCount(0);
  });

  test("drops the old query's rows when More lands late", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Wharfe Stores", [conceptsSeeded, handbookSeeded]);
    await searched(page, "pallet");
    await expect(matchesOf(page)).toHaveCount(MATCHES_A_PAGE);

    const held = Promise.withResolvers<void>();
    const reachedTheRoute = Promise.withResolvers<void>();
    await page.route(isAFindPastTheFirstPage, async (route) => {
      reachedTheRoute.resolve();
      await held.promise;
      await route.continue();
    });
    await loadMore(page).click();
    await reachedTheRoute.promise;

    await searchBox(page).fill("forklift");
    await expect(said(page)).toHaveText(WORDS.matched("forklift", false));
    held.resolve();

    await expect(matchesOf(page)).toHaveText([/Forklift Licences/]);
    await expect(handbookMatches(page)).toHaveCount(0);
  });

  test("shows a Viewer no Restricted match and no count", async ({ page, request }) => {
    const workspace = await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);
    await conceptsSeeded(request, {
      workspaceId: workspace.workspaceId,
      adminId: workspace.admin.id,
    });

    await page.goto(asked("audit"));
    await expect(said(page)).toHaveText(WORDS.matched("audit", false));
    await expect(matchesOf(page).filter({ hasText: "Audit Logs Retention" })).toHaveCount(1);
    await expect(matchesOf(page).filter({ hasText: "Audit Salary Bands" })).toHaveCount(0);

    await page.goto(asked("salary bands"));
    await expect(searchRegion(page).getByRole("status")).toHaveText(
      WORDS.noMatches("salary bands"),
    );
    await expect(page.locator("body"), "the page shows a number").not.toContainText(/\d/);
  });

  test("opens a passage match in the panel without leaving Search", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ryedale Stores", [handbookSeeded]);
    await searched(page, "pallet");

    const first = handbookMatches(page).first();
    await expect(first).toContainText(WORDS.notCompanyKnowledge);
    await expect(first).toContainText("Internal");
    const opener = first.getByRole("button", { name: HANDBOOK });
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await opener.click();

    const panel = passagePanel(page, HANDBOOK);
    await expect(panel).toContainText(PALLET_PASSAGES[0] ?? "");
    await expect(panel.getByRole("heading", { name: HANDBOOK })).toBeFocused();
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(/\/knowledge\/search\?/);

    await searchBox(page).click();
    await expect(panel, "the page behind the panel closed it").toBeVisible();

    await panel.getByRole("heading", { name: HANDBOOK }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("opens a passage inline beneath its match at 320 px", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Holme Stores", [handbookSeeded]);
    await page.setViewportSize({ width: 320, height: 720 });
    await searched(page, "pallet");

    const first = handbookMatches(page).first();
    await first.getByRole("button", { name: HANDBOOK }).click();

    const inline = first.getByRole("region", { name: HANDBOOK });
    await expect(inline).toContainText(PALLET_PASSAGES[0] ?? "");
    await expect(inline.getByRole("heading", { name: HANDBOOK })).toBeFocused();
    const sideways = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sideways, "the page scrolls sideways at 320 px").toBe(0);
  });

  test("says nothing matches, for stop words alone too", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ouse Archives", [conceptsSeeded]);

    await searchBox(page).fill("zzz-nowhere");
    await expect(searchRegion(page).getByRole("status")).toHaveText(WORDS.noMatches("zzz-nowhere"));
    await expect(matchesOf(page)).toHaveCount(0);

    await searchBox(page).fill("the and of");
    await expect(searchRegion(page).getByRole("status")).toHaveText(WORDS.noMatches("the and of"));
  });

  test("offers a retry when the first read fails", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Calder Stores", [handbookSeeded]);
    await page.route(isAFind, (route) => route.abort());

    await searchBox(page).fill("pallet");
    // The query asks twice more before it answers, as it does of any failure with no word.
    await expect(searchRegion(page).getByRole("alert")).toHaveText(
      sentenceOf(NO_RESPONSE_TO_A_READ),
    );
    await page.unroute(isAFind);
    await searchRegion(page).getByRole("button", { name: "Retry" }).click();
    await expect(matchesOf(page)).toHaveCount(MATCHES_A_PAGE);
    await expect(searchRegion(page).getByRole("alert")).toHaveCount(0);
  });

  test("keeps the shown rows when More fails, and retries it", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Aire Stores", [handbookSeeded]);
    await searched(page, "pallet");
    await expect(matchesOf(page)).toHaveCount(MATCHES_A_PAGE);
    await page.route(isAFindPastTheFirstPage, (route) => route.abort());

    await loadMore(page).click();
    await expect(searchRegion(page).getByRole("alert")).toHaveText(
      sentenceOf(NO_RESPONSE_TO_A_READ),
    );
    await expect(matchesOf(page)).toHaveCount(MATCHES_A_PAGE);

    await page.unroute(isAFindPastTheFirstPage);
    await searchRegion(page).getByRole("button", { name: "Retry" }).click();
    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length);
    await expect(searchRegion(page).getByRole("alert")).toHaveCount(0);
  });

  test("renders matches within the list's budget", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ryedale Archives", [handbookSeeded]);

    // A fresh document, so no page of matches is already in the page's cache.
    const started = Date.now();
    await page.goto(asked("pallet"));
    await expect(matchesOf(page)).toHaveCount(MATCHES_A_PAGE);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "search", description: `${elapsed} ms` });
    expect(elapsed, "a page of matches rendered past its budget").toBeLessThan(LIST_BUDGET_MS);
  });

  test("takes a search another place asked for", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Swale Archives", [conceptsSeeded]);

    await page.goto(`${SEARCH.path}?search=forklift`);
    await expect(searchBox(page)).toHaveValue("forklift");
    await expect(matchesOf(page)).toHaveText([/Forklift Licences/]);
    await expect(page).not.toHaveURL(/[?&]search=/);
  });

  test("searches, opens and pages by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtSearch(page, request, "Calder Records", [handbookSeeded]);
    await skipLinkReachesThePage(page);

    const keystrokes = await keystrokesListed(page, SEARCH.name);
    for (const keystroke of Object.values(KEY))
      await expect(keystrokes).toContainText(keystroke.action);
    await page.keyboard.press("Escape");
    await expect(keystrokes).toHaveCount(0);

    await page.keyboard.press(KEY.search.key);
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.type("pallet");
    await expect(page).toHaveURL(/knowledge\.search=pallet/);
    await expect(matchesOf(page)).toHaveCount(MATCHES_A_PAGE);

    await page.keyboard.press("Tab");
    const opener = handbookMatches(page).first().getByRole("button", { name: HANDBOOK });
    await expect(opener).toBeFocused();
    await page.keyboard.press("Enter");
    const panel = passagePanel(page, HANDBOOK);
    await expect(panel.getByRole("heading", { name: HANDBOOK })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();

    await page.keyboard.press(KEY.more.key);
    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length);
    await expect(matchesOf(page).nth(MATCHES_A_PAGE)).toBeFocused();

    await expect(searchRegion(page)).toMatchAriaSnapshot(`
      - region "${SEARCH.name}":
        - heading "${SEARCH.name}" [level=2]
        - searchbox "${WORDS.search}": pallet
        - status: ${WORDS.matched("pallet", false)}
        - list "${WORDS.matches}":
          - listitem:
            - text: ${WORDS.document}
            - button "${HANDBOOK}"
            - text: ${WORDS.notCompanyKnowledge} · Internal
    `);

    await passesTheAccessibilityGate();
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`takes ${role === "Editor" ? "an Editor" : "a Viewer"} to Search from the rail`, async ({
      page,
      request,
    }) => {
      await aMemberSignedInAt(page, request, role, HOMES[role].path);
      await landedAtHome(page, role);

      await railOf(page).getByRole("link", { name: KNOWLEDGE.name }).click();

      await expect(page).toHaveURL(new RegExp(`${SEARCH.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: browse.name })).toBeVisible();
      await expect(navOf(page, KNOWLEDGE).getByRole("link")).toHaveText([SEARCH.name]);
      await expect(searchRegion(page).getByRole("status")).toHaveText(WORDS.nothingAsked);
    });
  }
});
