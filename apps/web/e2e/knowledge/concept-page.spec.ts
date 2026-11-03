import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { CONCEPT_KEYSTROKES as KEY } from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";

import { expect, test } from "../browser.ts";
import { anAddress, provision, signIn, skipLinkReachesThePage } from "../harness.ts";
import {
  conceptsSeeded,
  isAFind,
  isAnOpen,
  listsItsKeystrokes,
  scrolledSideways,
} from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const COMMITTEE = "Audit Committee";

const SALARY = "Audit Salary Bands";

const RETENTION = "Audit Logs Retention";

const CALENDAR = "Audit Calendar";

const POLICY = "Records policy";

const MINUTES = "Board minutes";

const MINUTES_DOCUMENT = "Closed session record, March";

const STANDARD = "Retention standard";

const CHARTER = "Committee charter";

const POLICY_PASSAGE = "Audit logs are kept for seven years, then deleted.";

const MINUTES_PASSAGE = "The board fixed the period in closed session.";

const CHARTER_PASSAGE = "The committee meets in the first week of each quarter.";

const CLAIM = "We keep audit logs for seven years, then delete them.";

const IMAGE_HOST = "images.example.test";

const RETENTION_BODY = [
  `${CLAIM}[^source-1]`,
  "",
  "## Who decides",
  "",
  "The audit committee sets the period.[^source-3] The standard gives its page.[^source-4]",
  "",
  "<script>window.ranByABody = true</script>",
  "",
  `![The approval flow](https://${IMAGE_HOST}/approval-flow.png)`,
  "",
  "A [script link](javascript:window.ranByABody=true) stays words.",
].join("\n");

const IRI_PREFIX = "https://better-answers.com/c/";

type Seeded = Awaited<ReturnType<typeof conceptsSeeded>>;

const iriOf = (concepts: Seeded, title: string): string => {
  const iri = concepts.get(title)?.iri;
  if (iri === undefined) throw new Error(`${title} was not seeded`);
  return iri;
};

const pageOf = (concepts: Seeded, title: string): string =>
  `${SEARCH.path}/${iriOf(concepts, title).slice(IRI_PREFIX.length)}`;

const aWorkspaceOfConcepts = async (api: APIRequestContext, name: string) => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const writer = { workspaceId: workspace.workspaceId, userId: workspace.admin.id };
  const first = await conceptsSeeded(api, {
    ...writer,
    concepts: [
      {
        title: COMMITTEE,
        kind: "Team",
        body: "The committee meets each quarter.",
        sources: [{ title: CHARTER, passages: [CHARTER_PASSAGE] }],
      },
      {
        title: SALARY,
        body: "Each salary band is reviewed by the audit committee.",
        sensitivity: "Restricted",
      },
      {
        title: RETENTION,
        body: RETENTION_BODY,
        trust: "machine-confirmed",
        linksTo: [COMMITTEE],
        sources: [
          { title: POLICY, passages: [POLICY_PASSAGE] },
          {
            title: MINUTES_DOCUMENT,
            label: MINUTES,
            passages: [MINUTES_PASSAGE],
            sensitivity: "Restricted",
          },
          { concept: COMMITTEE },
          { title: STANDARD, at: "p.4" },
        ],
        frontmatter: {
          description: "How long audit logs are kept, and who decides.",
          tags: ["audit", "retention"],
          verified: [{ by: "process:records-verifier", at: "2026-03-03T09:41:00Z" }],
          review_cycle: "Yearly",
        },
      },
    ],
  });
  const second = await conceptsSeeded(api, {
    ...writer,
    concepts: [
      {
        title: CALENDAR,
        body: `See [the retention rule](${iriOf(first, RETENTION)}) and [the salary bands](${iriOf(first, SALARY)}).`,
      },
    ],
  });
  return { workspace, adminEmail, concepts: new Map([...first, ...second]) };
};

type Workspace = Awaited<ReturnType<typeof aWorkspaceOfConcepts>>;

const signedInAsTheAdmin = async (page: Page, api: APIRequestContext, seeded: Workspace) => {
  await page.goto("/sign-in");
  await signIn(page, api, seeded.adminEmail);
};

const conceptOf = (page: Page, title: string): Locator =>
  page.getByRole("article", { name: title });

const sourcesOf = (page: Page): Locator => page.getByRole("region", { name: "Sources" });

const sourceLines = (page: Page): Locator => sourcesOf(page).getByRole("listitem");

const markOf = (page: Page, place: number, label: string): Locator =>
  page.getByRole("button", { name: `Source ${String(place)}: ${label}`, exact: true });

const panelOf = (page: Page, title: string): Locator => page.getByRole("dialog", { name: title });

const wayBack = (page: Page): Locator =>
  page.getByRole("main").getByRole("link", { name: "Back to Search" });

const drawsNotFound = async (page: Page): Promise<void> => {
  const main = page.getByRole("main");
  await expect(wayBack(page)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(main.getByRole("alert")).toHaveCount(0);
  await expect(main.getByRole("status").filter({ hasText: /\S/ })).toHaveCount(0);
};

const asked = (query: string): string =>
  `${SEARCH.path}?${new URLSearchParams({ "knowledge.search": query }).toString()}`;

const matchOf = (page: Page, title: string): Locator =>
  page.getByRole("list", { name: "Matches" }).getByRole("link", { name: title, exact: true });

const atTheConcept = async (page: Page, seeded: Workspace, title: string): Promise<Locator> => {
  await page.goto(pageOf(seeded.concepts, title));
  const concept = conceptOf(page, title);
  await expect(concept).toBeVisible();
  return concept;
};

const edges = (drawn: Locator) =>
  drawn.evaluate((node) => {
    const { top, bottom, left, right } = node.getBoundingClientRect();
    return { top, bottom, left, right };
  });

test.describe("the concept page", () => {
  test("draws not found when the api calls the id malformed", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Holme Annals");
    await signedInAsTheAdmin(page, request, seeded);
    const ulid = pageOf(seeded.concepts, RETENTION).slice(SEARCH.path.length + 1);
    await page.route(isAnOpen, (route) =>
      route.continue({ url: route.request().url().replace(ulid, ulid.toLowerCase()) }),
    );
    const answered = page.waitForResponse((response) => isAnOpen(new URL(response.url())));
    await page.goto(pageOf(seeded.concepts, RETENTION));

    expect(await (await answered).text(), "the api did not call the id malformed").toContain(
      '"httpStatus":400',
    );
    await drawsNotFound(page);
  });

  test("leaves focus in the box when its row never drew", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Ouse Annals");
    await signedInAsTheAdmin(page, request, seeded);
    await page.goto(asked("audit"));
    await matchOf(page, RETENTION).click();
    await expect(conceptOf(page, RETENTION)).toBeVisible();
    await page.reload();
    await expect(conceptOf(page, RETENTION)).toBeVisible();
    await page.route(isAFind, (route) => route.abort());
    await wayBack(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await page.unroute(isAFind);

    const box = page.getByRole("searchbox", { name: "Search by a word or a question" });
    await box.fill("audit logs");

    await expect(matchOf(page, RETENTION)).toBeVisible();
    await expect(box, "a row from the search left took focus from the box").toBeFocused();
  });

  for (const width of [320, 1024]) {
    test(`opens a source under its claim at ${String(width)} px`, async ({ page, request }) => {
      const seeded = await aWorkspaceOfConcepts(request, `Holme Registers ${String(width)}`);
      await signedInAsTheAdmin(page, request, seeded);
      await page.setViewportSize({ width, height: 720 });
      const concept = await atTheConcept(page, seeded, RETENTION);

      const mark = markOf(page, 1, POLICY);
      await mark.click();
      const inline = concept.getByRole("region", { name: POLICY });
      await expect(inline).toContainText(POLICY_PASSAGE);
      await expect(inline.getByRole("heading", { name: POLICY })).toBeFocused();
      await expect(panelOf(page, POLICY)).toHaveCount(0);
      const claim = await edges(concept.getByText(CLAIM));
      const next = await edges(concept.getByRole("heading", { name: "Who decides" }));
      const drawn = await edges(inline);
      expect(drawn.top, "the panel is not under its claim").toBeGreaterThanOrEqual(claim.bottom);
      expect(drawn.bottom, "the panel is not above the next block").toBeLessThanOrEqual(next.top);
      expect(await scrolledSideways(page), `the page scrolls sideways at ${String(width)} px`).toBe(
        0,
      );

      await page.keyboard.press("Escape");
      await expect(inline).toHaveCount(0);
      await expect(mark).toBeFocused();

      const listed = sourceLines(page).nth(2).getByRole("button", { name: COMMITTEE });
      await listed.click();
      const listedInline = sourceLines(page).nth(2).getByRole("region", { name: COMMITTEE });
      await expect(listedInline).toContainText("The committee meets each quarter.");
      await listedInline.getByRole("button", { name: "Close" }).click();
      await expect(listedInline).toHaveCount(0);
      await expect(listed).toBeFocused();
    });
  }

  test("renders within its budget, read by keyboard alone", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Calder Registers");
    await signedInAsTheAdmin(page, request, seeded);

    const startedAtMs = Date.now();
    await page.goto(pageOf(seeded.concepts, RETENTION));
    await expect(conceptOf(page, RETENTION).getByText(CLAIM)).toBeVisible();
    const elapsedMs = Date.now() - startedAtMs;
    test.info().annotations.push({ type: "concept page", description: `${elapsedMs} ms` });
    expect(elapsedMs, "the concept rendered past its budget").toBeLessThan(LIST_BUDGET_MS);

    await skipLinkReachesThePage(page);
    await listsItsKeystrokes(page, "Search", KEY, [
      "Go Back to Search",
      "Go to the Concept’s Sources",
      "Go to the Concept’s Links",
    ]);

    await page.keyboard.press(KEY.sources.key);
    await expect(sourcesOf(page).getByRole("heading", { name: "Sources" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sourceLines(page).nth(0).getByRole("button", { name: POLICY })).toBeFocused();
    await page.keyboard.press("Enter");
    const panel = panelOf(page, POLICY);
    await expect(panel.getByRole("heading", { name: POLICY })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      sourceLines(page).nth(0).getByRole("button", { name: POLICY }),
      "Tab off the panel did not reach the page",
    ).toBeFocused();
    await passesTheAccessibilityGate();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    await page.keyboard.press(KEY.links.key);
    await expect(page.getByRole("heading", { name: "Links" })).toBeFocused();
    await page.keyboard.press(KEY.back.key);
    await expect(page).toHaveURL(new RegExp(`${SEARCH.path}$`));
    await expect(
      page.getByRole("searchbox", { name: "Search by a word or a question" }),
    ).toBeVisible();
  });
});
