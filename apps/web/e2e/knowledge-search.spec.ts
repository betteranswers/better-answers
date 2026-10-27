import type { APIRequestContext, Locator, Page, Request, Route } from "@playwright/test";

import {
  MATCHES_A_PAGE,
  QUERY_MAX,
  SEARCH_KEYSTROKES as KEY,
} from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";
import { HOMES } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  aMemberSignedInAt,
  anAddress,
  landedAtHome,
  navOf,
  provision,
  railOf,
  saysARefusal,
  saysTheWait,
  seedConcepts,
  seedConnectedSources,
  signIn,
  skipLinkReachesThePage,
} from "./harness.ts";
import {
  heldBack,
  isAFind,
  isAnOpen,
  listsItsKeystrokes,
  matchesAnswered,
  matchesBecome,
  passageBecomes,
  readsCeilingFilled,
  refusedAtACeiling,
  scrolledSideways,
  windowRefocused,
} from "./knowledge.ts";
import { refusalAnswering } from "./refused-read.ts";
import { aVirtualAuthenticator } from "./virtual-authenticator.ts";

const LIST_BUDGET_MS = 1000;

const A_PAGE = 20;

const searchRegion = (page: Page) => page.getByRole("region", { name: "Search" });

const searchBox = (page: Page) =>
  searchRegion(page).getByRole("searchbox", { name: "Search by a word or a question" });

const matchesOf = (page: Page): Locator =>
  searchRegion(page).getByRole("list", { name: "Matches" }).getByRole("listitem");

const loadMore = (page: Page) => searchRegion(page).getByRole("button", { name: "Load More" });

const said = (page: Page) => searchRegion(page).getByRole("status").first();

const alerted = (page: Page) => searchRegion(page).getByRole("alert");

const passagePanel = (page: Page, title: string) => page.getByRole("dialog", { name: title });

const markedAt = (sensitivity: string): RegExp =>
  new RegExp(`Not company knowledge\\W+${sensitivity}`);

const asked = (query: string): string =>
  `${SEARCH.path}?${new URLSearchParams({ "knowledge.search": query }).toString()}`;

const NO_SUCH_DOCUMENT = "01JBZ6Q2V7Y9K3M5N8P0R2T4W6";

const asOfADocumentNobodyHolds = (route: Route): Promise<void> =>
  route.continue({
    url: route
      .request()
      .url()
      .replace(/[0-9A-Z]{26}(?=(?:\/|%2F)chars)/, NO_SUCH_DOCUMENT),
  });

const isAFindPastTheFirstPage = (url: URL): boolean =>
  isAFind(url) && (url.searchParams.get("input") ?? "").includes('"cursor"');

const HANDBOOK = "Warehouse handbook";

const PALLET_PASSAGES = Array.from(
  { length: A_PAGE + 5 },
  (_, index) => `Pallet bay ${index + 1} takes stock wrapped and labelled before it is racked.`,
);

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

const saysNoMatchWasInFocus = async (page: Page, listed: string): Promise<void> => {
  await page.keyboard.press(KEY.open.key);
  await expect(said(page), "the page says nothing of a key that opened nothing").not.toHaveText(
    listed,
  );
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

const moreAskedForAndHeld = async (page: Page) => {
  await searched(page, "pallet");
  await expect(matchesOf(page)).toHaveCount(A_PAGE);
  const more = await heldBack(page, isAFindPastTheFirstPage);
  await loadMore(page).click();
  await more.reached;
  return more;
};

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

    await expect(said(page)).toHaveText(/\S/);
    await expect(matchesOf(page)).toHaveCount(0);
    const nothingAsked = await saidNow(page);

    await searchBox(page).fill("   ");
    await expect(page).toHaveURL(/knowledge\.search=(?:\+|%20){3}/);
    await expect(said(page), "a blank search is not said as nothing asked").toHaveText(
      nothingAsked,
    );
    expect(finds, "the page asked for matches with nothing asked").toHaveLength(0);

    await foundNothing(page, "audit");
    expect(
      finds.map((sent) => new URL(sent.url()).searchParams.get("input")),
      "the page asked for more than the one search typed",
    ).toEqual([expect.stringContaining('"audit"')]);
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

  test("marks each match with its collection, or none", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Nidd Records", [
      async (api, workspace) => {
        await seedConcepts(api, {
          workspaceId: workspace.workspaceId,
          userId: workspace.adminId,
          concepts: [
            {
              title: "Payroll Retention",
              collection: "finance",
              body: "We keep payroll records for six years.",
            },
            { title: "Visitor Retention", body: "We keep visitor records for one year." },
          ],
        });
      },
    ]);

    await searched(page, "retention");
    await expect(matchesOf(page).filter({ hasText: "Payroll Retention" })).toContainText("finance");
    await expect(matchesOf(page).filter({ hasText: "Visitor Retention" })).toContainText(
      "No collection",
    );
  });

  test("loads more, and focus lands on the first new row", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Dales Stores", [handbookSeeded]);

    await searched(page, "pallet");
    await expect(matchesOf(page)).toHaveCount(A_PAGE);
    await expect(loadMore(page)).toBeVisible();
    const whileMoreFollow = await saidNow(page);
    await loadMore(page).click();

    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length);
    await expect(
      matchesOf(page).nth(A_PAGE),
      "focus did not land on the first new match",
    ).toBeFocused();
    await expect(loadMore(page)).toHaveCount(0);
    await expect(said(page), "the status still says more follow").not.toHaveText(whileMoreFollow);
  });

  test("leaves focus where the reader moved it while More loads", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Dales Records", [handbookSeeded]);
    const more = await moreAskedForAndHeld(page);
    await searchBox(page).focus();
    more.release();

    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length);
    await expect(searchBox(page), "the new rows took focus from the search box").toBeFocused();
  });

  test("drops a match the next page repeats", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Dales Archives", [handbookSeeded]);
    const first = page.waitForResponse((answered) => isAFind(new URL(answered.url())));
    await searched(page, "pallet");
    const [repeated] = await matchesAnswered(await first);
    if (repeated === undefined) throw new Error("the first page answered no match");
    await page.route(
      isAFindPastTheFirstPage,
      matchesBecome((matches) => [repeated, ...matches.slice(1)]),
    );

    await loadMore(page).click();

    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length - 1);
    await expect(
      matchesOf(page).nth(A_PAGE),
      "focus did not land on the first match the page added",
    ).toBeFocused();
  });

  test("drops the old query's rows when More lands late", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Wharfe Stores", [conceptsSeeded, handbookSeeded]);
    const more = await moreAskedForAndHeld(page);

    await searchBox(page).fill("forklift");
    await expect(matchesOf(page)).toHaveText([/Forklift Licences/]);
    const landed = page.waitForResponse((answered) =>
      isAFindPastTheFirstPage(new URL(answered.url())),
    );
    more.release();
    await landed;
    await page.evaluate(() => new Promise((drawn) => requestAnimationFrame(drawn)));

    await expect(matchesOf(page)).toHaveText([/Forklift Licences/]);
    await expect(handbookMatches(page)).toHaveCount(0);
    await searchBox(page).fill("pallet");
    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length);
  });

  test("shows a Viewer no Restricted match and no count", async ({ page, request }) => {
    const workspace = await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);
    const seeded = { workspaceId: workspace.workspaceId, adminId: workspace.admin.id };
    await conceptsSeeded(request, seeded);
    await payReviewSeeded(request, seeded);
    const answers: string[] = [];
    page.on("response", (answered) => {
      if (isAFind(new URL(answered.url()))) void answered.text().then((body) => answers.push(body));
    });

    await page.goto(asked("audit"));
    await expect(said(page)).toContainText("audit");
    await expect(matchesOf(page).filter({ hasText: "Audit Logs Retention" })).toHaveCount(1);
    await expect(matchesOf(page).filter({ hasText: "Audit Salary Bands" })).toHaveCount(0);
    await expect(page.locator("body"), "the matches page shows a number").not.toContainText(/\d/);

    await foundNothing(page, "salary bands", () => page.goto(asked("salary bands")));
    await expect(page.locator("body"), "the page shows a number").not.toContainText(/\d/);
    expect(await page.content(), "the page draws the withheld document").not.toContain(PAY_REVIEW);
    await expect.poll(() => answers.length).toBe(2);
    expect(answers.join("\n"), "the read answered with a withheld title").not.toMatch(
      new RegExp(`${PAY_REVIEW}|Audit Salary Bands`),
    );
  });

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

  test("asks for the most the read takes, and no more", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Esk Records", []);
    const statusOf = async (input: { readonly query: string; readonly limit: number }) => {
      const answered = await page.request.get(
        `/trpc/knowledge.find?${new URLSearchParams({ input: JSON.stringify(input) }).toString()}`,
      );
      return answered.status();
    };
    const longest = "a".repeat(QUERY_MAX);

    expect(
      await statusOf({ query: longest, limit: MATCHES_A_PAGE }),
      "the read refuses a search the page sends: QUERY_MAX or MATCHES_A_PAGE is past the read's own",
    ).toBe(200);
    expect(
      await statusOf({ query: `${longest}a`, limit: MATCHES_A_PAGE }),
      "the read takes a longer query than QUERY_MAX lets the box hold",
    ).toBe(400);
    expect(
      await statusOf({ query: "audit", limit: MATCHES_A_PAGE + 1 }),
      "the read gives a larger page than MATCHES_A_PAGE asks for",
    ).toBe(400);
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
    await expect(panel).toContainText(PALLET_PASSAGES[0] ?? "");
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

  for (const width of [320, 1280]) {
    test(`keeps open a passage clicked before settling, at ${String(width)} px`, async ({
      page,
      request,
    }) => {
      await anAdminAtSearch(page, request, `Nidd Stores ${String(width)}`, [forkliftGuideSeeded]);
      await page.setViewportSize({ width, height: 720 });

      const release = await aPassageClickedWhileTheListLoads(page);
      release();

      await expect(matchesOf(page)).toHaveText([new RegExp(FORKLIFT_GUIDE)]);
      await expect(
        page.getByRole("heading", { name: FORKLIFT_GUIDE }),
        "the passage clicked closed as the typed search settled",
      ).toBeFocused();
    });
  }

  test("leaves the reader's focus alone when the pending list lands", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Nidd Gates", [forkliftGuideSeeded]);
    await page.setViewportSize({ width: 320, height: 720 });

    const release = await aPassageClickedWhileTheListLoads(page);
    await searchBox(page).focus();
    release();

    await expect(matchesOf(page).getByRole("region", { name: FORKLIFT_GUIDE })).toBeVisible();
    await expect(searchBox(page), "the landed passage took focus from the reader").toBeFocused();
  });

  test("opens the focused match by key, else says none is", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Nidd Annals", [conceptsSeeded]);
    await searched(page, "forklift");
    const listed = await saidNow(page);

    await searchRegion(page).getByRole("heading", { name: "Search" }).focus();
    await saysNoMatchWasInFocus(page, listed);
    await expect(page).toHaveURL((url) => url.pathname === SEARCH.path);
    await searched(page, "audit");
    await searched(page, "forklift");
    await expect(said(page), "the page still says no match was in focus").toHaveText(listed);

    await matchesOf(page).getByRole("link", { name: "Forklift Licences" }).focus();
    await page.keyboard.press(KEY.open.key);
    await expect(page.getByRole("heading", { level: 2, name: "Forklift Licences" })).toBeVisible();
  });

  test("opens nothing by key after focus leaves the match", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Nidd Ledgers", [forkliftGuideSeeded]);
    await searched(page, "forklift");
    const listed = await saidNow(page);

    await matchesOf(page).getByRole("button", { name: FORKLIFT_GUIDE }).focus();
    await searchRegion(page).getByRole("heading", { name: "Search" }).focus();

    await saysNoMatchWasInFocus(page, listed);
    await expect(passagePanel(page, FORKLIFT_GUIDE)).toHaveCount(0);

    await matchesOf(page).getByRole("button", { name: FORKLIFT_GUIDE }).click();
    await expect(passagePanel(page, FORKLIFT_GUIDE)).toBeVisible();
    await expect(
      said(page),
      "the page still says to select a match beside the one opened",
    ).toHaveText(listed);
  });

  test("opens the match focus landed on after More", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Nidd Shelves", [handbookSeeded]);
    await searched(page, "pallet");
    await searchRegion(page).getByRole("heading", { name: "Search" }).focus();

    await page.keyboard.press(KEY.more.key);
    const landed = matchesOf(page).nth(A_PAGE);
    await expect(landed).toBeFocused();
    await page.keyboard.press(KEY.open.key);

    await expect(landed.getByRole("button", { name: HANDBOOK })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("keeps the typed search for a concept opened before settling", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Nidd Records", [conceptsSeeded]);
    await searched(page, "audit");

    await searchBox(page).fill("forklift");
    await matchesOf(page).getByRole("link", { name: "Audit Committee" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Audit Committee" })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Back to Search" }).click();

    await expect(searchBox(page), "the typed search was lost on the way back").toHaveValue(
      "forklift",
    );
    await expect(matchesOf(page)).toHaveText([/Forklift Licences/]);
    await expect(
      searchRegion(page).getByRole("heading", { name: "Search" }),
      "focus fell to the page on the way back",
    ).toBeFocused();
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

  test("puts focus on Search when Escape closes the panel mid-load", async ({ page, request }) => {
    const { panel, release } = await aPassageOpenedWhileTheListLoads(page, request, "Nidd Racks");

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    release();
    await expect(matchesOf(page)).toHaveText([new RegExp(FORKLIFT_GUIDE)]);
    await expect(
      searchRegion(page).getByRole("heading", { name: "Search" }),
      "Escape left focus on the page",
    ).toBeFocused();
  });

  for (const [width, landsOn] of [
    [320, "Search"],
    [1280, FORKLIFT_GUIDE],
  ] as const) {
    test(`keeps the passage through a failed list, at ${String(width)} px`, async ({
      page,
      request,
    }) => {
      await anAdminAtSearch(page, request, `Nidd Yards ${String(width)}`, [forkliftGuideSeeded]);
      await page.setViewportSize({ width, height: 720 });
      await searched(page, "pallet");
      await expect(matchesOf(page)).toHaveCount(2);
      const typed = Promise.withResolvers<void>();
      const isTheTypedFind = isAFindFor("forklift");
      await page.route(isTheTypedFind, async (route) => {
        typed.resolve();
        await route.abort();
      });

      await searchBox(page).fill("forklift");
      await matchesOf(page).getByRole("button", { name: FORKLIFT_GUIDE }).click();
      await typed.promise;
      await saysARefusal(alerted(page));
      await expect(
        page.getByRole("heading", { name: landsOn, exact: true }),
        "a failed list left focus on the page",
      ).toBeFocused();
      await page.unroute(isTheTypedFind);
      await searchRegion(page).getByRole("button", { name: "Retry" }).click();

      await expect(matchesOf(page)).toHaveText([new RegExp(FORKLIFT_GUIDE)]);
      await expect(
        page.getByRole("heading", { name: FORKLIFT_GUIDE }),
        "a failed list closed the passage it never dropped",
      ).toBeVisible();
    });
  }

  test("closes a passage opened as the search empties", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Nidd Bins", [forkliftGuideSeeded]);
    await expect(said(page)).toHaveText(/\S/);
    const nothingAsked = await saidNow(page);
    await searched(page, "forklift");

    await searchBox(page).fill("");
    await matchesOf(page).getByRole("button", { name: FORKLIFT_GUIDE }).click();

    await expect(
      passagePanel(page, FORKLIFT_GUIDE),
      "a passage stayed open beside an empty search",
    ).toHaveCount(0);
    await expect(said(page), "emptying the search said more than nothing asked").toHaveText(
      nothingAsked,
    );
    await expect(
      searchRegion(page).getByRole("heading", { name: "Search" }),
      "the passage closed under an emptied search left focus on the page",
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

  test("says why a passage went unread, offering a retry", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Wharfe Records", [handbookSeeded]);
    await searched(page, "pallet");
    await page.route(isAnOpen, (route) => route.abort());
    await handbookMatches(page).first().getByRole("button", { name: HANDBOOK }).click();

    const panel = passagePanel(page, HANDBOOK);
    await saysARefusal(panel.getByRole("alert"));
    await page.unroute(isAnOpen);
    await panel.getByRole("button", { name: "Retry" }).click();
    await expect(panel).toContainText(PALLET_PASSAGES[0] ?? "");
    await expect(panel.getByRole("heading", { name: HANDBOOK })).toBeFocused();
  });

  test("says a passage it cannot read is not there", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Holme Records", [handbookSeeded]);
    await searched(page, "pallet");
    await page.route(isAnOpen, asOfADocumentNobodyHolds);
    const refused = refusalAnswering(page, "knowledge.open");
    await handbookMatches(page).first().getByRole("button", { name: HANDBOOK }).click();

    expect(await refused).toMatchObject({ word: "not-found" });
    const panel = passagePanel(page, HANDBOOK);
    await saysARefusal(panel.getByRole("alert"));
    await expect(panel).not.toContainText(PALLET_PASSAGES[0] ?? "");
  });

  test("names and tags the panel from the passage's own read", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Holme Archives", [handbookSeeded]);
    await searched(page, "pallet");
    const renamed = "Warehouse handbook, second edition";
    await page.route(isAnOpen, passageBecomes({ source: renamed, sensitivity: "Restricted" }));
    const first = handbookMatches(page).first();
    await first.getByRole("button", { name: HANDBOOK }).click();

    const panel = passagePanel(page, renamed);
    await expect(panel.getByRole("heading", { name: renamed })).toBeFocused();
    await expect(panel).toContainText(markedAt("Restricted"));
    await expect(panel, "the panel copied the match's sensitivity").not.toContainText("Internal");
    await expect(first).toContainText(markedAt("Internal"));

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await page.unroute(isAnOpen);
    await page.route(isAnOpen, asOfADocumentNobodyHolds);
    const refused = refusalAnswering(page, "knowledge.open");
    await first.getByRole("button", { name: HANDBOOK }).click();
    expect(await refused).toMatchObject({ word: "not-found" });
    await saysARefusal(passagePanel(page, HANDBOOK).getByRole("alert"));
    await expect(page.getByText(renamed), "a refused read kept its earlier title").toHaveCount(0);
  });

  for (const width of [1024, 1280]) {
    test(`closes a passage a re-read drops, at ${String(width)} px`, async ({ page, request }) => {
      await anAdminAtSearch(page, request, `Holme Annals ${String(width)}`, [handbookSeeded]);
      await page.setViewportSize({ width, height: 720 });
      await searched(page, "pallet");
      const whileListed = await saidNow(page);
      await handbookMatches(page).first().getByRole("button", { name: HANDBOOK }).click();
      const heading = page.getByRole("heading", { name: HANDBOOK });
      await expect(heading).toBeFocused();
      await expect(
        passagePanel(page, HANDBOOK).or(matchesOf(page).getByRole("region", { name: HANDBOOK })),
      ).toContainText(PALLET_PASSAGES[0] ?? "");

      let withheld = 1;
      await page.route(
        isAFind,
        matchesBecome((matches) => matches.slice(withheld)),
      );
      await windowRefocused(page);

      await expect(matchesOf(page)).toHaveCount(A_PAGE - 1);
      await expect(heading, "the passage outlived its match").toHaveCount(0);
      await expect(said(page), "the page does not say its passage left").not.toHaveText(
        whileListed,
      );
      const saidItLeft = await saidNow(page);
      await expect(
        searchRegion(page).getByRole("heading", { name: "Search" }),
        "focus fell to the page with the passage",
      ).toBeFocused();

      await handbookMatches(page).first().getByRole("button", { name: HANDBOOK }).click();
      await expect(heading).toBeFocused();
      await expect(said(page), "the page still says a passage left").toHaveText(whileListed);

      await searchBox(page).focus();
      withheld = 2;
      await windowRefocused(page);

      await expect(matchesOf(page)).toHaveCount(A_PAGE - 2);
      await expect(said(page)).toHaveText(saidItLeft);
      await expect(searchBox(page), "focus was taken from where the reader put it").toBeFocused();

      await searchBox(page).fill("forklift");
      await expect(said(page)).toContainText("forklift");
      await expect(matchesOf(page)).toHaveCount(0);
      await searchBox(page).fill("pallet");
      await expect(said(page), "a search come back to still says a passage left").toHaveText(
        whileListed,
      );
    });
  }

  test("focuses Search when a re-read drops the focused match", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Holme Bays", [handbookSeeded]);
    await searched(page, "pallet");
    await handbookMatches(page).first().getByRole("button", { name: HANDBOOK }).focus();

    await page.route(
      isAFind,
      matchesBecome((matches) => matches.slice(1)),
    );
    await windowRefocused(page);

    await expect(matchesOf(page)).toHaveCount(A_PAGE - 1);
    await expect(
      searchRegion(page).getByRole("heading", { name: "Search" }),
      "focus fell to the page with its match",
    ).toBeFocused();
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

      if (panel === null || offer === null) throw new Error("the panel or the offer drew no box");
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
      await expect(inline).toContainText(PALLET_PASSAGES[0] ?? "");
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

  test("says nothing matches, for stop words alone too", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ouse Archives", [conceptsSeeded]);

    await foundNothing(page, "zzz-nowhere");
    await foundNothing(page, "the and of");
  });

  test("says the reads' ceiling and asks no more", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ouse Stores", [handbookSeeded]);
    const first = page.waitForRequest((sent) => isAFind(new URL(sent.url())));
    await searched(page, "pallet");
    await readsCeilingFilled(page, (await first).url());

    const askedQueries: string[] = [];
    page.on("request", (sent) => {
      if (isAFind(new URL(sent.url())) && sent.url().includes("forklift"))
        askedQueries.push(sent.url());
    });
    const refused = refusalAnswering(page, "knowledge.find");
    await searchBox(page).fill("forklift");
    const { status, waitSeconds } = await refused;
    expect(status, "the search met no ceiling").toBe(429);
    await saysTheWait(alerted(page), waitSeconds);
    await windowRefocused(page);
    expect(askedQueries, "the page asked again past the ceiling").toHaveLength(1);
  });

  test("asks a passage at its ceiling again only when pressed", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ouse Records", [handbookSeeded]);
    await searched(page, "pallet");
    const panel = passagePanel(page, HANDBOOK);
    const closed = async (): Promise<void> => {
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
    };
    const read = handbookMatches(page).nth(1).getByRole("button", { name: HANDBOOK });
    const unread = handbookMatches(page).first().getByRole("button", { name: HANDBOOK });
    await read.click();
    await expect(panel.getByRole("blockquote")).toContainText("Pallet bay");
    await closed();
    const opens: string[] = [];
    page.on("request", (sent) => {
      if (isAnOpen(new URL(sent.url()))) opens.push(sent.url());
    });
    await page.route(isAnOpen, refusedAtACeiling);

    for (const opener of [unread, read]) {
      await opener.click();
      await saysTheWait(panel.getByRole("alert"), 60);
      await closed();
      await opener.click();
      await saysTheWait(panel.getByRole("alert"), 60);
      await closed();
    }
    await read.click();
    await saysTheWait(panel.getByRole("alert"), 60);
    await windowRefocused(page);
    expect(opens, "a passage was asked for again while its wait ran").toHaveLength(2);
  });

  test("offers a retry when the first read fails", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Calder Stores", [handbookSeeded]);
    await page.route(isAFind, (route) => route.abort());

    await searchBox(page).fill("pallet");
    await saysARefusal(alerted(page));
    await expect(said(page), "a failed read says something beside its alert").toHaveCount(0);
    await page.unroute(isAFind);
    await searchRegion(page).getByRole("button", { name: "Retry" }).click();
    await expect(matchesOf(page)).toHaveCount(A_PAGE);
    await expect(alerted(page)).toHaveCount(0);
    await expect(searchBox(page), "Retry left focus on the page").toBeFocused();
  });

  test("keeps the shown rows when More fails, and retries it", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Aire Stores", [handbookSeeded]);
    await searched(page, "pallet");
    await expect(matchesOf(page)).toHaveCount(A_PAGE);
    await page.route(isAFindPastTheFirstPage, (route) => route.abort());

    await loadMore(page).click();
    await saysARefusal(alerted(page));
    await expect(matchesOf(page)).toHaveCount(A_PAGE);

    const retry = searchRegion(page).getByRole("button", { name: "Retry" });
    await retry.click();
    await expect(alerted(page)).toHaveCount(0);
    await saysARefusal(alerted(page));
    await expect(retry).toBeFocused();

    await page.unroute(isAFindPastTheFirstPage);
    await searchRegion(page).getByRole("button", { name: "Retry" }).click();
    await expect(matchesOf(page)).toHaveCount(PALLET_PASSAGES.length);
    await expect(alerted(page)).toHaveCount(0);
    await expect(
      matchesOf(page).nth(A_PAGE),
      "the retried page did not land focus on its first match",
    ).toBeFocused();
  });

  test("renders matches within the list's budget", async ({ page, request }) => {
    await anAdminAtSearch(page, request, "Ryedale Archives", [handbookSeeded]);

    const started = Date.now();
    await page.goto(asked("pallet"));
    await expect(matchesOf(page)).toHaveCount(A_PAGE);
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

  for (const role of ["Editor", "Viewer"] as const) {
    test(`takes ${role === "Editor" ? "an Editor" : "a Viewer"} to Search from the rail`, async ({
      page,
      request,
    }) => {
      await aMemberSignedInAt(page, request, role, HOMES[role].path);
      await landedAtHome(page, role);

      await railOf(page).getByRole("link", { name: "Knowledge" }).click();

      await expect(page).toHaveURL(new RegExp(`${SEARCH.path}$`));
      await expect(page.getByRole("heading", { level: 1, name: "Browse" })).toBeVisible();
      await expect(navOf(page, "Knowledge").getByRole("link")).toHaveText([
        "Search",
        "Knowledge Base",
      ]);
      await expect(said(page)).toHaveText(/\S/);
      await expect(matchesOf(page)).toHaveCount(0);
    });
  }
});
