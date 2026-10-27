import type { APIRequestContext, Locator, Page, Request } from "@playwright/test";

import { CONCEPT_KEYSTROKES as KEY } from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  crumbOf,
  landedAtHome,
  navOf,
  person,
  provision,
  railOf,
  saysARefusal,
  saysTheWait,
  signIn,
  skipLinkReachesThePage,
  switcherMenuOf,
  switcherOf,
  answersRead,
  requestsSent,
} from "./harness.ts";
import {
  conceptsSeeded,
  heldBack,
  isAFind,
  isAnOpen,
  listsItsKeystrokes,
  readsCeilingFilled,
  scrolledSideways,
  windowRefocused,
} from "./knowledge.ts";
import { refusalAnswering } from "./refused-read.ts";

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

const signedInAsAViewer = async (page: Page, api: APIRequestContext, seeded: Workspace) => {
  const email = anAddress("viewer");
  const viewer = await person(api, email, { displayName: "A Viewer" });
  await addMember(api, {
    workspaceId: seeded.workspace.workspaceId,
    userId: viewer.id,
    role: "Viewer",
  });
  await page.goto("/sign-in");
  await signIn(page, api, email);
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

const THE_OPEN = "knowledge.open";

const breadcrumb = (page: Page): Locator =>
  page.getByRole("banner").getByRole("navigation", { name: "Breadcrumb" });

const asked = (query: string): string =>
  `${SEARCH.path}?${new URLSearchParams({ "knowledge.search": query }).toString()}`;

const matchOf = (page: Page, title: string): Locator =>
  page.getByRole("list", { name: "Matches" }).getByRole("link", { name: title, exact: true });

const opensSentBy = (page: Page): Request[] => {
  const sent: Request[] = [];
  page.on("request", (request) => {
    if (isAnOpen(new URL(request.url()))) sent.push(request);
  });
  return sent;
};

const atTheConcept = async (page: Page, seeded: Workspace, title: string): Promise<Locator> => {
  await page.goto(pageOf(seeded.concepts, title));
  const concept = conceptOf(page, title);
  await expect(concept).toBeVisible();
  return concept;
};

const wentBackTo = async (page: Page, address: string): Promise<void> => {
  for (let entries = 0; entries < 5 && !page.url().endsWith(address); entries += 1) {
    await page.goBack();
  }
  await expect(page).toHaveURL(new RegExp(`${address}$`));
};

const edges = (drawn: Locator) =>
  drawn.evaluate((node) => {
    const { top, bottom, left, right } = node.getBoundingClientRect();
    return { top, bottom, left, right };
  });

test.describe("the concept page", () => {
  test("opens from a match with all the file holds", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Calder Registry");
    await signedInAsTheAdmin(page, request, seeded);
    await page.goto(asked("audit log retention"));

    await matchOf(page, RETENTION).click();

    await expect(page).toHaveURL(new RegExp(`${pageOf(seeded.concepts, RETENTION)}$`));
    const concept = conceptOf(page, RETENTION);
    await expect(concept.getByRole("heading", { level: 2, name: RETENTION })).toBeVisible();
    await expect(concept).toContainText(/Answer\s*Verified automatically/);
    await expect(concept).toContainText(CLAIM);
    await expect(crumbOf(page, RETENTION)).toBeVisible();
    await expect(sourceLines(page)).toHaveText([
      new RegExp(`^\\[1\\]\\s*${POLICY}$`),
      new RegExp(`^\\[2\\]\\s*${MINUTES}$`),
      new RegExp(`^\\[3\\]\\s*${COMMITTEE}$`),
      new RegExp(`^\\[4\\]\\s*${STANDARD}\\W*p\\.4$`),
    ]);

    await expect(concept).toMatchAriaSnapshot(`
      - article "${RETENTION}":
        - paragraph:
          - link "Back to Search"
        - heading "${RETENTION}" [level=2]
        - paragraph: How long audit logs are kept, and who decides.
        - list "Tags":
          - listitem: audit
          - listitem: retention
        - paragraph:
          - superscript:
            - 'button "Source 1: ${POLICY}"'
        - heading "Who decides" [level=3]
        - region "Sources":
          - heading "Sources" [level=3]
          - list:
            - listitem:
              - button "${POLICY}"
            - listitem:
              - button "${MINUTES}"
            - listitem:
              - button "${COMMITTEE}"
            - listitem
        - region "Verification":
          - heading "Verification" [level=3]
          - list:
            - listitem: /3 March 2026/
        - region "Links":
          - heading "Links" [level=3]
          - list:
            - listitem:
              - link "${COMMITTEE}"
        - button "Details from the File"
    `);

    await concept.getByRole("button", { name: "Details from the File" }).click();
    await expect(concept.getByRole("definition").filter({ hasText: "Yearly" })).toBeVisible();
  });

  test("leads and ends its sources with the read's own lines", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Aire Registry");
    await signedInAsAViewer(page, request, seeded);
    const answered = page.waitForResponse((response) => isAnOpen(new URL(response.url())));
    await atTheConcept(page, seeded, RETENTION);
    const read = JSON.stringify(await (await answered).json());

    const [lead, next] = await sourcesOf(page).getByRole("paragraph").allInnerTexts();
    expect(lead, "the sources lead with nothing").toMatch(/\S/);
    expect(read, "the sources do not lead with the read's own lead").toContain(
      `"lead":${JSON.stringify(lead)}`,
    );
    expect(read, "the sources do not end with the read's own next").toContain(
      `"next":${JSON.stringify(next)}`,
    );
  });

  test("opens a cited passage beside its claim", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Swale Registry");
    await signedInAsTheAdmin(page, request, seeded);
    const concept = await atTheConcept(page, seeded, RETENTION);

    const mark = markOf(page, 1, POLICY);
    await expect(mark).toHaveAttribute("aria-expanded", "false");
    await mark.click();

    const panel = panelOf(page, POLICY);
    await expect(panel).toContainText(POLICY_PASSAGE);
    await expect(panel.getByRole("heading", { name: POLICY })).toBeFocused();
    await expect(panel, "a passage a concept rests on is company knowledge").not.toContainText(
      "Not company knowledge",
    );
    await expect(panel.getByText("Internal", { exact: true })).toBeVisible();
    await expect(mark).toHaveAttribute("aria-expanded", "true");
    const panelLeft = (await edges(panel)).left;
    await expect
      .poll(async () => (await edges(mark)).right, { message: "the open panel covers the claim" })
      .toBeLessThanOrEqual(panelLeft);
    await expect(mark, "the claim left the view as its panel opened").toBeInViewport();
    await expect(concept.getByText(CLAIM)).toBeInViewport();

    await mark.focus();
    await page.keyboard.press("Escape");
    await expect(panel, "Escape on the page closed the panel").toBeVisible();

    await panel.getByRole("heading", { name: POLICY }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(mark).toBeFocused();
    await expect(mark).toHaveAttribute("aria-expanded", "false");
  });

  test("opens the same panel from its sources list", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Wharfe Registry");
    await signedInAsTheAdmin(page, request, seeded);
    await atTheConcept(page, seeded, RETENTION);

    const listed = sourceLines(page).nth(0).getByRole("button", { name: POLICY });
    await listed.click();
    const panel = panelOf(page, POLICY);
    await expect(panel).toContainText(POLICY_PASSAGE);
    await expect(listed).toHaveAttribute("aria-expanded", "true");
    await expect(markOf(page, 1, POLICY)).toHaveAttribute("aria-expanded", "false");

    await markOf(page, 1, POLICY).click();
    await expect(panel.getByRole("heading", { name: POLICY })).toBeFocused();
    await expect(panel).toContainText(POLICY_PASSAGE);
    await expect(listed).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Escape");
    await expect(markOf(page, 1, POLICY)).toBeFocused();

    await sourceLines(page).nth(1).getByRole("button", { name: MINUTES }).click();
    const minutes = panelOf(page, MINUTES);
    await expect(minutes).toContainText(MINUTES_PASSAGE);
    await expect(minutes, "the panel does not name the passage's document").toContainText(
      MINUTES_DOCUMENT,
    );
    await expect(minutes.getByText("Restricted", { exact: true })).toBeVisible();
    await expect(minutes).not.toContainText("Not company knowledge");
  });

  test("opens a cited concept in the panel, one level only", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Ouse Registry");
    await signedInAsTheAdmin(page, request, seeded);
    await atTheConcept(page, seeded, RETENTION);

    await markOf(page, 3, COMMITTEE).click();

    const panel = panelOf(page, COMMITTEE);
    await expect(panel.getByRole("heading", { name: COMMITTEE })).toBeFocused();
    await expect(panel).toContainText("The committee meets each quarter.[1]");
    await expect(panel).toContainText("Unverified");
    await expect(panel.getByRole("button", { name: `Source 1: ${CHARTER}` })).toHaveCount(0);
    await passesTheAccessibilityGate();

    await panel.getByRole("link", { name: "Open This Concept’s Page" }).focus();
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      markOf(page, 3, COMMITTEE),
      "Tab off the concept's panel did not reach the page",
    ).toBeFocused();

    await panel.getByRole("link", { name: "Open This Concept’s Page" }).click();
    await expect(page).toHaveURL(new RegExp(`${pageOf(seeded.concepts, COMMITTEE)}$`));
    await expect(conceptOf(page, COMMITTEE)).toBeVisible();
    await expect(panelOf(page, COMMITTEE)).toHaveCount(0);
    await expect(markOf(page, 1, CHARTER)).toBeVisible();
  });

  test("shows a source its reader cannot read as words alone", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Dales Registry");
    await signedInAsAViewer(page, request, seeded);
    const answers = answersRead(page, isAnOpen);
    const concept = await atTheConcept(page, seeded, RETENTION);

    await expect(sourceLines(page).nth(1)).toHaveText(new RegExp(`^\\[2\\]\\s*${MINUTES}$`));
    await expect(sourceLines(page).nth(1).getByRole("button")).toHaveCount(0);
    await expect(markOf(page, 2, MINUTES)).toHaveCount(0);
    await expect(concept).toContainText("stays words.[2]");
    await expect(markOf(page, 1, POLICY)).toBeVisible();

    const withheld = seeded.concepts
      .get(RETENTION)
      ?.documents.find((document) => document.title === MINUTES_DOCUMENT)?.documentId;
    expect(withheld, "the harness named no Restricted document").toEqual(expect.any(String));
    const drawn = await page.content();
    expect(drawn, "the page holds the withheld document's id").not.toContain(withheld);
    expect(drawn, "the page holds the withheld document's title").not.toContain(MINUTES_DOCUMENT);
    expect(drawn, "the page holds the withheld passage").not.toContain(MINUTES_PASSAGE);
    await expect
      .poll(() => answers.length, { message: "the page read nothing" })
      .toBeGreaterThan(0);
    const answered = (await Promise.all(answers)).join("\n");
    expect(answered, "a read answered the withheld document's id").not.toContain(withheld);
    expect(answered, "a read answered the withheld document's title").not.toContain(
      MINUTES_DOCUMENT,
    );
  });

  test("shows a page locator beside its source, opening nothing", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Ryedale Registry");
    await signedInAsAViewer(page, request, seeded);
    const concept = await atTheConcept(page, seeded, RETENTION);

    const standard = sourceLines(page).nth(3);
    await expect(standard).toContainText(STANDARD);
    await expect(standard).toContainText("p.4");
    await expect(standard.getByRole("button")).toHaveCount(0);
    await expect(markOf(page, 4, STANDARD)).toHaveCount(0);
    await expect(concept).toContainText("The standard gives its page.[4]");
  });

  test("draws one not found for malformed, absent and withheld", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Holme Registry");
    await signedInAsAViewer(page, request, seeded);
    const withheld = pageOf(seeded.concepts, SALARY);
    const sent = opensSentBy(page);

    const drawn: string[] = [];
    const answers = answersRead(page, isAnOpen);
    for (const address of [
      `${SEARCH.path}/not-a-concept`,
      withheld.toLowerCase().replace(SEARCH.path.toLowerCase(), SEARCH.path),
      `${SEARCH.path}/01JBZ6Q2V7Y9K3M5N8P0R2T4W6`,
      withheld,
    ]) {
      await page.goto(address);
      await drawsNotFound(page);
      await expect(wayBack(page)).toHaveAttribute("href", SEARCH.path);
      await expect(breadcrumb(page).getByRole("link").last()).toHaveText("Search");
      expect(await page.content(), `${address} names the withheld concept`).not.toContain(SALARY);
      expect(await page.title(), `${address} titles the document`).not.toContain(SALARY);
      drawn.push(await page.getByRole("main").innerHTML());
    }

    expect(new Set(drawn).size, "the four addresses drew different pages").toBe(1);
    expect(sent, "a malformed address asked the api about it").toHaveLength(2);
    await expect.poll(() => answers.length).toBe(2);
    const [absent, notShown] = await Promise.all(answers);
    expect(absent, "the api did not refuse the absent concept").toContain('"httpStatus":404');
    expect(absent, "an absent and a withheld concept were answered apart").toBe(notShown);

    await wayBack(page).click();
    await expect(
      page.getByRole("searchbox", { name: "Search by a word or a question" }),
    ).toBeVisible();
    const kept = await page.evaluate(() => JSON.stringify(history.state));
    expect(kept, "the way back kept the withheld address in history").not.toContain(
      withheld.slice(SEARCH.path.length + 1),
    );
  });

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

  test("sends a body's concept IRI link to its page", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Calder Annals");
    await signedInAsAViewer(page, request, seeded);
    const concept = await atTheConcept(page, seeded, CALENDAR);

    const retention = concept.getByRole("link", { name: "the retention rule" });
    await expect(retention).toHaveAttribute("href", pageOf(seeded.concepts, RETENTION));
    const salary = concept.getByRole("link", { name: "the salary bands" });
    await expect(salary).toHaveAttribute("href", pageOf(seeded.concepts, SALARY));

    const refused = refusalAnswering(page, THE_OPEN);
    await salary.click();
    expect(await refused).toMatchObject({ word: "not-found" });
    await drawsNotFound(page);
    await page.goBack();
    await retention.click();
    await expect(conceptOf(page, RETENTION)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${pageOf(seeded.concepts, RETENTION)}$`));
  });

  test("draws raw HTML as text and fetches no image", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Aire Registers");
    await signedInAsTheAdmin(page, request, seeded);
    const fetched = requestsSent(page, (url) => url.hostname === IMAGE_HOST);
    const concept = await atTheConcept(page, seeded, RETENTION);

    await expect(concept).toContainText("<script>window.ranByABody = true</script>");
    await expect(concept).toContainText("The approval flow");
    await expect(concept.locator("img, script, iframe")).toHaveCount(0);
    await expect(concept).toContainText("A script link stays words.");
    await expect(concept.getByRole("link", { name: "script link" })).toHaveCount(0);
    await expect(concept).toContainText(`See also ${COMMITTEE}.`);
    expect(await page.evaluate(() => "ranByABody" in window), "the body's script ran").toBe(false);
    expect(
      fetched.map((sent) => sent.url()),
      "the body's image was fetched",
    ).toEqual([]);
  });

  test("says a failed read with a retry, not not found", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Swale Registers");
    await signedInAsTheAdmin(page, request, seeded);
    await page.route(isAnOpen, (route) => route.abort());
    await page.goto(pageOf(seeded.concepts, RETENTION));

    const failed = page.getByRole("main").getByRole("alert");
    await saysARefusal(failed);
    await expect(breadcrumb(page)).not.toContainText(RETENTION);

    await page.unroute(isAnOpen);
    await page.getByRole("main").getByRole("button", { name: "Retry" }).click();
    await expect(conceptOf(page, RETENTION)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Browse" })).toBeFocused();
    await expect(failed).toHaveCount(0);
  });

  test("keeps the title's room and no body while it loads", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Wharfe Registers");
    await signedInAsTheAdmin(page, request, seeded);
    const held = Promise.withResolvers<void>();
    await page.route(isAnOpen, async (route) => {
      await held.promise;
      await route.continue();
    });
    await page.goto(pageOf(seeded.concepts, RETENTION));

    const loading = page.getByRole("main").getByRole("status").filter({ hasText: /\S/ });
    await expect(loading).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(breadcrumb(page).getByRole("link").last()).toHaveText("Search");
    const before = (await edges(loading)).top;

    held.resolve();
    const body = conceptOf(page, RETENTION).getByText(CLAIM);
    await expect(body).toBeVisible();
    expect(
      (await edges(body)).top,
      "the body landed above where loading stood",
    ).toBeGreaterThanOrEqual(before);
  });

  test("returns to Search at the query left, on the row", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Ouse Registers");
    await signedInAsTheAdmin(page, request, seeded);
    await page.goto(asked("audit"));
    await expect(matchOf(page, COMMITTEE)).toBeVisible();

    await matchOf(page, RETENTION).click();
    await expect(conceptOf(page, RETENTION)).toBeVisible();
    await page.goBack();

    await expect(page).toHaveURL(/knowledge\.search=audit$/);
    await expect(matchOf(page, RETENTION), "Back left focus off the opened row").toBeFocused();

    await matchOf(page, COMMITTEE).click();
    await expect(conceptOf(page, COMMITTEE)).toBeVisible();
    await expect(wayBack(page)).toHaveAttribute("href", asked("audit"));
    await wayBack(page).click();

    await expect(page).toHaveURL(/knowledge\.search=audit$/);
    await expect(matchOf(page, COMMITTEE), "the way back left focus off its row").toBeFocused();
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

  test("shows not found at its address after a workspace switch", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Dales Registers");
    const other = await provision(request, { name: "Dales Annex" });
    await addMember(request, {
      workspaceId: other.workspaceId,
      userId: seeded.workspace.admin.id,
      role: "Admin",
    });
    await signedInAsTheAdmin(page, request, seeded);
    await page.getByRole("button", { name: seeded.workspace.name, exact: true }).click();
    await landedAtHome(page, "Admin");
    await page.goto(asked("audit"));
    await matchOf(page, RETENTION).click();
    await expect(crumbOf(page, RETENTION)).toBeVisible();
    await wayBack(page).click();
    await expect(matchOf(page, RETENTION)).toBeFocused();

    await switcherOf(page, seeded.workspace.name).click();
    await switcherMenuOf(page, seeded.workspace.name)
      .getByRole("menuitemradio")
      .filter({ hasText: other.name })
      .click();
    await expect(switcherOf(page, other.name)).toBeVisible();
    const refused = refusalAnswering(page, THE_OPEN);
    await page.goBack();

    await expect(page).toHaveURL(new RegExp(`${pageOf(seeded.concepts, RETENTION)}$`));
    expect(await refused).toMatchObject({ word: "not-found" });
    await drawsNotFound(page);
    await expect(breadcrumb(page)).not.toContainText(RETENTION);
    expect(await page.content(), "the page left holds the concept").not.toContain(CLAIM);
  });

  test("draws a self-demoted Admin nothing read before the change", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Esk Registry");
    const successor = await person(request, anAddress("ada"), { displayName: "Ada Hartley" });
    await addMember(request, {
      workspaceId: seeded.workspace.workspaceId,
      userId: successor.id,
      role: "Admin",
    });
    await signedInAsTheAdmin(page, request, seeded);
    await page.goto(asked("salary bands"));
    await matchOf(page, SALARY).click();
    await expect(conceptOf(page, SALARY)).toBeVisible();

    await railOf(page).getByRole("link", { name: "Control Centre" }).click();
    await navOf(page, "Control Centre").getByRole("link", { name: "Members" }).click();
    const people = page.getByRole("main");
    await people.getByRole("link", { name: "Test person", exact: true }).click();
    await people.getByRole("radio", { name: "Viewer", exact: true }).click();
    await people.getByRole("button", { name: "Change Role" }).click();
    await landedAtHome(page, "Viewer");

    const open = await heldBack(page, isAnOpen);
    const find = await heldBack(page, isAFind);
    await wentBackTo(page, pageOf(seeded.concepts, SALARY));
    await open.reached;
    await expect(
      page.getByRole("main").getByRole("status").filter({ hasText: /\S/ }),
      "the concept was drawn before it was read again",
    ).toBeVisible();
    await expect(conceptOf(page, SALARY)).toHaveCount(0);
    await expect(breadcrumb(page)).not.toContainText(SALARY);
    const refused = refusalAnswering(page, THE_OPEN);
    open.release();
    expect(await refused).toMatchObject({ word: "not-found" });
    await drawsNotFound(page);

    await expect(wayBack(page)).toHaveAttribute("href", asked("salary bands"));
    await wayBack(page).click();
    await find.reached;
    const said = page.getByRole("region", { name: "Search" }).getByRole("status");
    await expect(said).toContainText("salary bands");
    await expect(
      page.getByRole("list", { name: "Matches" }),
      "the matches were drawn before they were read again",
    ).toHaveCount(0);
    find.release();
    await expect(matchOf(page, CALENDAR)).toBeVisible();
    expect(await page.content(), "the page draws what an Admin read").not.toContain(SALARY);
  });

  test("says the reads' ceiling and asks no more", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Ryedale Registers");
    await signedInAsTheAdmin(page, request, seeded);
    const found = page.waitForRequest((sent) => isAFind(new URL(sent.url())));
    await page.goto(asked("audit"));
    await matchOf(page, RETENTION).click();
    await expect(conceptOf(page, RETENTION)).toBeVisible();
    await readsCeilingFilled(page, (await found).url());

    const sent = opensSentBy(page);
    const refused = refusalAnswering(page, THE_OPEN);
    await page.reload();

    const { status, waitSeconds } = await refused;
    expect(status, "the read met no ceiling").toBe(429);
    await saysTheWait(page.getByRole("main").getByRole("alert"), waitSeconds);
    await windowRefocused(page);
    expect(sent, "the page asked again past the ceiling").toHaveLength(1);
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
