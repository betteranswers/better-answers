import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { KNOWLEDGE_BASE_KEYSTROKES as KEY } from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";
import { HOMES, KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  A_ROLE,
  addMember,
  aMemberSignedInAt,
  anAddress,
  countOf,
  person,
  provision,
  seedConceptIndex,
  signIn,
  skipLinkReachesThePage,
} from "./harness.ts";
import {
  conceptsSeeded,
  knowledgeMenuOpened,
  listsItsKeystrokes,
  scrolledSideways,
} from "./knowledge.ts";

const LIST_BUDGET_MS = 1000;

const A_PAGE = 50;

const KNOWLEDGE_BASE = pageNamed(menuGroupIn(KNOWLEDGE, "browse"), "Knowledge Base").path;

const FLEET = "Fleet insurance";

const PREMISES = "Premises insurance";

const HANDBOOK = "Staff handbook";

const DATASHEET = "Boiler datasheet";

const VISION = "Our purpose";

const DIRECTORS = "Directors cover";

const KEY_PERSON = "Key person cover";

const BOARD_PAY = "Board pay";

type Seeded = Parameters<typeof conceptsSeeded>[1]["concepts"];

const POLICIES: Seeded = [
  {
    title: FLEET,
    collection: "company",
    kind: "Insurance Policy",
    body: "The fleet is insured under one policy.",
  },
  {
    title: PREMISES,
    collection: "company",
    kind: "Insurance Policy",
    body: "The premises are insured each year.",
  },
  { title: HANDBOOK, collection: "company", kind: "Handbook", body: "Staff read it first." },
  { title: DATASHEET, collection: "product", kind: "Datasheet", body: "The boiler runs at 80C." },
  { title: VISION, kind: "Statement", body: "We keep buildings warm." },
];

type Member = { readonly email: string; readonly id: string };

const aMember = async (
  api: APIRequestContext,
  workspaceId: string,
  role: "Editor" | "Viewer",
): Promise<Member> => {
  const email = anAddress(role.toLowerCase());
  const made = await person(api, email, { displayName: `A ${role}` });
  await addMember(api, { workspaceId, userId: made.id, role });
  return { email, id: made.id };
};

const aWorkspaceOf = async (
  api: APIRequestContext,
  name: string,
  concepts: (insider: Member) => Seeded,
) => {
  const workspace = await provision(api, { name, adminEmail: anAddress("admin") });
  const { workspaceId } = workspace;
  const insider = await aMember(api, workspaceId, "Viewer");
  const viewer = await aMember(api, workspaceId, "Viewer");
  const seeded = await conceptsSeeded(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: concepts(insider),
  });
  return { workspaceId, adminId: workspace.admin.id, viewer, seeded };
};

const signedIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const treeOf = (page: Page): Locator =>
  page.getByRole("tree", { name: "Collections and kinds", exact: true });

const itemOf = (page: Page, name: string): Locator =>
  treeOf(page).getByRole("treeitem", { name: new RegExp(`^${name},`) });

const conceptsOf = (page: Page, kind: string, collection: string): Locator =>
  page.getByRole("region", { name: `${kind} in ${collection}`, exact: true });

const rowsOf = (concepts: Locator): Locator =>
  concepts.getByRole("row").filter({ has: concepts.page().getByRole("cell") });

const knowledgeBase = (page: Page): Locator =>
  page.getByRole("region", { name: "Knowledge Base", exact: true });

const atTheKnowledgeBase = async (page: Page): Promise<void> => {
  await page.goto(KNOWLEDGE_BASE);
  await expect(treeOf(page)).toBeVisible();
};

const openedAt = (collection: string, kind: string): string =>
  `${KNOWLEDGE_BASE}?base.collection=${encodeURIComponent(collection)}&base.kind=${encodeURIComponent(kind)}`;

const bottomOf = async (drawn: Locator): Promise<number> => {
  const box = await drawn.boundingBox();
  if (box === null) throw new Error("the part is not drawn");
  return box.y + box.height;
};

const topOf = async (drawn: Locator): Promise<number> => {
  const box = await drawn.boundingBox();
  if (box === null) throw new Error("the part is not drawn");
  return box.y;
};

const clearOfTheBand = async (page: Page, focused: Locator): Promise<void> => {
  await expect(focused).toBeFocused();
  await expect(focused).toBeInViewport();
  expect(await topOf(focused), "the band covers the focused item").toBeGreaterThanOrEqual(
    await bottomOf(page.getByRole("banner")),
  );
};

const countsIn = async (tree: Locator): Promise<readonly number[]> =>
  [
    ...(await tree.ariaSnapshot()).matchAll(/treeitem "[^"]*, (\d+) concepts?"[^\n]*\[level=1\]/gu),
  ].map(([, count]) => Number(count));

test.describe("Knowledge Base", () => {
  test("a Viewer opens a concept from a kind, then returns", async ({ page, request }) => {
    const at = await aWorkspaceOf(request, "Usk Valley Heating", () => POLICIES);
    await signedIn(page, request, at.viewer.email);

    const menu = await knowledgeMenuOpened(page);
    await menu.getByRole("link", { name: "Knowledge Base" }).click();
    await expect(page).toHaveURL(new RegExp(`${KNOWLEDGE_BASE}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Browse" })).toBeVisible();
    await expect(treeOf(page)).toMatchAriaSnapshot(`
      - tree "Collections and kinds":
        - treeitem "company, 3 concepts" [expanded=false] [level=1]
        - treeitem "product, 1 concept" [expanded=false] [level=1]
        - treeitem "No collection, 1 concept" [expanded=false] [level=1]
    `);
    await expect(countOf(knowledgeBase(page))).toHaveText(/\b5\b/);

    await itemOf(page, "company").click();
    await itemOf(page, "Insurance Policy").click();
    const concepts = conceptsOf(page, "Insurance Policy", "company");
    await expect(rowsOf(concepts)).toHaveCount(2);
    await expect(concepts.getByRole("link")).toHaveText([FLEET, PREMISES]);
    await expect(concepts.getByRole("columnheader")).toHaveText(["Title", "Kind", "Trust"]);
    await expect(countOf(concepts)).toHaveText(/\b2\b/);
    await expect(treeOf(page)).toMatchAriaSnapshot(`
      - tree "Collections and kinds":
        - treeitem "company, 3 concepts" [expanded] [level=1]:
          - group:
            - treeitem "Handbook, 1 concept" [level=2]
            - treeitem "Insurance Policy, 2 concepts" [level=2] [selected]
        - treeitem "product, 1 concept" [expanded=false] [level=1]
        - treeitem "No collection, 1 concept" [expanded=false] [level=1]
    `);
    expect(
      await page.getByRole("main").evaluate((main) => main.outerHTML),
      "the page names a bundle",
    ).not.toMatch(/bundle/iu);

    await expect(itemOf(page, "Insurance Policy")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(concepts.getByRole("link", { name: FLEET })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${SEARCH.path}/[0-9A-Z]{26}$`));
    await expect(page.getByRole("article", { name: FLEET })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${KNOWLEDGE_BASE}\\?`));
    await expect(
      itemOf(page, "Insurance Policy"),
      "Back did not land on the open kind",
    ).toBeFocused();
    await expect(itemOf(page, "Insurance Policy")).toHaveAttribute("aria-selected", "true");
    await expect(rowsOf(conceptsOf(page, "Insurance Policy", "company"))).toHaveCount(2);
  });

  test("a Viewer works the tree by keyboard alone", async ({ page, request }) => {
    const at = await aWorkspaceOf(request, "Usk Valley Boilers", () => POLICIES);
    await signedIn(page, request, at.viewer.email);
    await atTheKnowledgeBase(page);

    await skipLinkReachesThePage(page);
    await listsItsKeystrokes(page, "Knowledge Base", KEY, [
      "Go to the Collections and Kinds",
      "Go to the Open Kind’s Concepts",
      "Show More Concepts",
    ]);
    await page.keyboard.press(KEY.tree.key);
    await expect(itemOf(page, "company")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(itemOf(page, "product")).toBeFocused();
    await page.keyboard.press("End");
    await expect(itemOf(page, "No collection")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(itemOf(page, "company")).toBeFocused();
    await page.keyboard.press("p");
    await expect(itemOf(page, "product"), "a typed letter did not move focus").toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowRight");
    await expect(itemOf(page, "company")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowRight");
    await expect(itemOf(page, "Handbook")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const concepts = conceptsOf(page, "Insurance Policy", "company");
    await expect(rowsOf(concepts)).toHaveCount(2);

    await page.keyboard.press("Tab");
    await expect(
      concepts.getByRole("link", { name: FLEET }),
      "one Tab left the tree",
    ).toBeFocused();
    await page.keyboard.press(KEY.concepts.key);
    await expect(
      concepts.getByRole("heading", { name: "Insurance Policy in company" }),
    ).toBeFocused();
    await page.keyboard.press(KEY.tree.key);
    await expect(itemOf(page, "Insurance Policy")).toBeFocused();
    await page.keyboard.press(KEY.concepts.key);
    await expect(itemOf(page, "company"), "the tree let a page key through").toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(itemOf(page, "company")).toHaveAttribute("aria-expanded", "false");
  });

  test("an outside Viewer never sees a withheld concept", async ({ page, request }) => {
    const at = await aWorkspaceOf(request, "Usk Valley Cover", (insider) => [
      { title: FLEET, collection: "company", kind: "Insurance Policy", body: "One policy." },
      {
        title: DIRECTORS,
        collection: "company",
        kind: "Insurance Policy",
        body: "The directors are covered.",
        sensitivity: "Restricted",
      },
      {
        title: KEY_PERSON,
        collection: "company",
        kind: "Insurance Policy",
        body: "Two people are covered.",
        audience: "groups",
        groupMemberIds: [insider.id],
      },
      {
        title: BOARD_PAY,
        collection: "board",
        kind: "Pay Policy",
        body: "The board sets its own pay.",
        sensitivity: "Restricted",
      },
    ]);
    await signedIn(page, request, at.viewer.email);
    await atTheKnowledgeBase(page);

    await expect(treeOf(page).getByRole("treeitem", { level: 1 })).toHaveCount(1);
    await expect(itemOf(page, "board"), "a withheld collection is listed").toHaveCount(0);
    await expect(
      treeOf(page).getByRole("treeitem", { name: "company, 1 concept", exact: true }),
      "the count holds a withheld concept",
    ).toBeVisible();

    await itemOf(page, "company").click();
    await itemOf(page, "Insurance Policy").click();
    const concepts = conceptsOf(page, "Insurance Policy", "company");
    await expect(concepts.getByRole("link")).toHaveText([FLEET]);
    await expect(countOf(concepts)).toHaveText(/\b1\b/);
    for (const withheld of [DIRECTORS, KEY_PERSON, BOARD_PAY]) {
      await expect(page.getByText(withheld), `${withheld} shows`).toHaveCount(0);
    }
  });

  test("lists a concept directly under knowledge under No collection", async ({
    page,
    request,
  }) => {
    const at = await aWorkspaceOf(request, "Usk Valley Purpose", () => POLICIES);
    await signedIn(page, request, at.viewer.email);
    await atTheKnowledgeBase(page);

    await expect(treeOf(page).getByRole("treeitem", { level: 1 }).last()).toHaveAccessibleName(
      "No collection, 1 concept",
    );
    await itemOf(page, "No collection").click();
    await itemOf(page, "Statement").click();
    const concepts = page.getByRole("region", {
      name: "Statement, in no collection",
      exact: true,
    });
    await expect(concepts.getByRole("link")).toHaveText([VISION]);
  });

  for (const role of ["Admin", "Editor", "Viewer"] as const) {
    test(`${A_ROLE[role]} finds Knowledge Base after Search and in jump-to`, async ({
      page,
      request,
    }) => {
      if (role === "Admin") {
        const email = anAddress("admin");
        await provision(request, { name: "Usk Valley Admins", adminEmail: email });
        await signedIn(page, request, email);
        await page.goto(HOMES.Admin.path);
      } else {
        await aMemberSignedInAt(page, request, role, HOMES[role].path);
      }

      const menu = await knowledgeMenuOpened(page);
      await expect(menu.getByRole("heading", { level: 3 }).first()).toHaveText("Browse");
      await expect(menu.getByRole("list").first().getByRole("link")).toHaveText([
        "Search",
        "Knowledge Base",
      ]);

      await page.keyboard.press("Control+k");
      const jumpTo = page.getByRole("dialog", { name: "Jump To" });
      await jumpTo.getByRole("combobox", { name: "Jump To" }).fill("knowledge base");
      const jump = jumpTo.getByRole("option", { name: /^Knowledge Base/ });
      await expect(jump).toBeVisible();
      await jump.click();
      await expect(page).toHaveURL(new RegExp(`${KNOWLEDGE_BASE}$`));
      await expect(countOf(knowledgeBase(page))).toHaveText(/\b0\b/);
      await expect(knowledgeBase(page).getByRole("paragraph").last()).toHaveText(/\S/);
      await expect(treeOf(page)).toHaveCount(0);
    });
  }

  test("a narrow window stacks the list under the tree", async ({ page, request }) => {
    const at = await aWorkspaceOf(request, "Usk Valley Narrows", () => POLICIES);
    await signedIn(page, request, at.viewer.email);
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(openedAt("company", "Insurance Policy"));
    const concepts = conceptsOf(page, "Insurance Policy", "company");
    await expect(rowsOf(concepts)).toHaveCount(2);
    await expect(
      concepts.getByRole("columnheader"),
      "a narrow list repeats the kind its heading names",
    ).toHaveText(["Title", "Trust"]);

    expect(await topOf(concepts), "the list is not under the tree").toBeGreaterThanOrEqual(
      await bottomOf(treeOf(page)),
    );
    expect(await scrolledSideways(page), "the page scrolls sideways at 375 px").toBe(0);

    await page.keyboard.press(KEY.tree.key);
    await expect(itemOf(page, "Insurance Policy")).toBeFocused();
    await page.keyboard.press("Home");
    await clearOfTheBand(page, itemOf(page, "company"));
    await page.keyboard.press("Tab");
    await clearOfTheBand(page, concepts.getByRole("link", { name: FLEET }));
  });

  test("renders the knowledge tree within its budget", async ({ page, request }) => {
    test.slow();
    const email = anAddress("viewer");
    const viewer = await person(request, email, { displayName: "A Viewer" });
    const workspace = await provision(request, { name: "Usk Valley Registry" });
    await addMember(request, {
      workspaceId: workspace.workspaceId,
      userId: viewer.id,
      role: "Viewer",
    });
    await signedIn(page, request, email);
    const collections = [
      "company",
      "estates",
      "finance",
      "fleet",
      "health",
      "legal",
      "people",
      "product",
      "safety",
      "sales",
    ];
    const { seeded } = await seedConceptIndex(request, {
      workspaceId: workspace.workspaceId,
      batches: [
        { collection: "company", kind: "Insurance Policy", count: 400 },
        ...collections.slice(1).map((collection) => ({
          collection,
          kind: "Procedure",
          count: 200,
        })),
        ...collections.map((collection) => ({ collection, kind: "Record", count: 80 })),
      ],
    });
    expect(seeded).toBe(3000);

    const concepts = conceptsOf(page, "Insurance Policy", "company");
    const startedAtMs = Date.now();
    await page.goto(openedAt("company", "Insurance Policy"));
    await expect(itemOf(page, "sales")).toBeVisible();
    await expect(rowsOf(concepts)).toHaveCount(A_PAGE);
    const elapsedMs = Date.now() - startedAtMs;
    test.info().annotations.push({ type: "knowledge tree", description: `${elapsedMs} ms` });
    expect(elapsedMs, "the tree and its first page rendered past the budget").toBeLessThan(
      LIST_BUDGET_MS,
    );

    const counts = await countsIn(treeOf(page));
    expect(counts, "the tree lists ten collections").toHaveLength(collections.length);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(3000);
    await expect(countOf(concepts)).toHaveText(/\b400\b/);
    await expect(concepts.getByRole("link").first()).toHaveText("Insurance Policy 001");

    const more = concepts.getByRole("button", { name: "Load More" });
    for (let shown = A_PAGE; shown < 400; shown += A_PAGE) {
      const pagedAtMs = Date.now();
      await more.click();
      await expect(rowsOf(concepts)).toHaveCount(shown + A_PAGE);
      const pagedMs = Date.now() - pagedAtMs;
      test.info().annotations.push({ type: "next page", description: `${pagedMs} ms` });
      expect(pagedMs, `the page past ${String(shown)} rendered past the budget`).toBeLessThan(
        LIST_BUDGET_MS,
      );
    }
    await expect(more).toHaveCount(0);
    await expect(concepts.getByRole("link").last()).toHaveText("Insurance Policy 400");
  });
});
