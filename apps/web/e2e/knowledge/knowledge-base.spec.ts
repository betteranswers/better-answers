import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { KNOWLEDGE_BASE_KEYSTROKES as KEY } from "@/features/knowledge/knowledge-state.ts";
import { KNOWLEDGE_BASE_WORDS as WORDS } from "@/features/knowledge/knowledge-words.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  countOf,
  person,
  provision,
  seedConceptIndex,
  signIn,
  skipLinkReachesThePage,
} from "../harness.ts";
import { listsItsKeystrokes, scrolledSideways } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const A_PAGE = 50;

const KNOWLEDGE_BASE = pageNamed(menuGroupIn(KNOWLEDGE, "browse"), "Knowledge Base").path;

const signedIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const treeOf = (page: Page): Locator => page.getByRole("tree", { name: WORDS.tree, exact: true });

const itemOf = (page: Page, name: string): Locator =>
  treeOf(page).getByRole("treeitem", { name: new RegExp(`^${name},`) });

const conceptsOf = (page: Page, conceptType: string, collection: string): Locator =>
  page.getByRole("region", { name: `${conceptType} in ${collection}`, exact: true });

const rowsOf = (concepts: Locator): Locator =>
  concepts.getByRole("row").filter({ has: concepts.page().getByRole("cell") });

const atTheKnowledgeBase = async (page: Page): Promise<void> => {
  await page.goto(KNOWLEDGE_BASE);
  await expect(treeOf(page)).toBeVisible();
};

const openedAt = (collection: string, conceptType: string): string =>
  `${KNOWLEDGE_BASE}?base.collection=${encodeURIComponent(collection)}&base.kind=${encodeURIComponent(conceptType)}`;

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

const focusedBelowTheBanner = async (page: Page, focused: Locator): Promise<void> => {
  await expect(focused).toBeFocused();
  await expect(focused).toBeInViewport();
  expect(await topOf(focused), "the page banner covers the focused item").toBeGreaterThanOrEqual(
    await bottomOf(page.getByRole("banner")),
  );
};

const countsIn = async (tree: Locator): Promise<readonly number[]> =>
  [
    ...(await tree.ariaSnapshot()).matchAll(/treeitem "[^"]*, (\d+) concepts?"[^\n]*\[level=1\]/gu),
  ].map(([, count]) => Number(count));

const COLLECTIONS = [
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

const CONCEPTS = 3000;

const A_KIND = 400;

test.describe("Knowledge Base", () => {
  test("a Viewer browses 3,000 concepts by keyboard at two widths", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
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
    const { seeded } = await seedConceptIndex(request, {
      workspaceId: workspace.workspaceId,
      batches: [
        { collection: "company", conceptType: "Insurance Policy", count: A_KIND },
        ...COLLECTIONS.slice(1).map((collection) => ({
          collection,
          conceptType: "Procedure",
          count: 200,
        })),
        ...COLLECTIONS.map((collection) => ({ collection, conceptType: "Record", count: 80 })),
      ],
    });
    expect(seeded).toBe(CONCEPTS);
    const concepts = conceptsOf(page, "Insurance Policy", "company");

    await test.step("shows the tree and each page of concepts within the list time budget", async () => {
      const startedAtMs = Date.now();
      await page.goto(openedAt("company", "Insurance Policy"));
      await expect(itemOf(page, "sales")).toBeVisible();
      await expect(rowsOf(concepts)).toHaveCount(A_PAGE);
      const elapsedMs = Date.now() - startedAtMs;
      test.info().annotations.push({ type: "knowledge tree", description: `${elapsedMs} ms` });
      expect(
        elapsedMs,
        "the tree and the first page of concepts took longer than the time budget to render",
      ).toBeLessThan(LIST_BUDGET_MS);

      const counts = await countsIn(treeOf(page));
      expect(counts, "the tree does not list ten collections").toHaveLength(COLLECTIONS.length);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(CONCEPTS);
      await expect(countOf(concepts)).toHaveText(/\b400\b/);
      await expect(concepts.getByRole("link").first()).toHaveText("Insurance Policy 001");

      const more = concepts.getByRole("button", { name: "Load More" });
      for (let shown = A_PAGE; shown < A_KIND; shown += A_PAGE) {
        const pagedAtMs = Date.now();
        await more.click();
        await expect(rowsOf(concepts)).toHaveCount(shown + A_PAGE);
        const pagedMs = Date.now() - pagedAtMs;
        test.info().annotations.push({ type: "next page", description: `${pagedMs} ms` });
        expect(
          pagedMs,
          `the page after concept ${String(shown)} took longer than the time budget to render`,
        ).toBeLessThan(LIST_BUDGET_MS);
      }
      await expect(more).toHaveCount(0);
      await expect(concepts.getByRole("link").last()).toHaveText("Insurance Policy 400");
    });

    await test.step("a Viewer moves through the tree and the concept list by keyboard alone", async () => {
      await atTheKnowledgeBase(page);

      await skipLinkReachesThePage(page);
      await listsItsKeystrokes(page, "Knowledge Base", KEY, [
        KEY.tree.action,
        KEY.concepts.action,
        KEY.more.action,
      ]);
      await page.keyboard.press(KEY.tree.key);
      await expect(itemOf(page, "company")).toBeFocused();

      await page.keyboard.press("ArrowDown");
      await expect(itemOf(page, "estates")).toBeFocused();
      await page.keyboard.press("End");
      await expect(itemOf(page, "sales")).toBeFocused();
      await page.keyboard.press("Home");
      await expect(itemOf(page, "company")).toBeFocused();
      await page.keyboard.press("e");
      await expect(itemOf(page, "estates"), "a typed letter did not move focus").toBeFocused();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowRight");
      await expect(itemOf(page, "company")).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("ArrowRight");
      await expect(itemOf(page, "Insurance Policy")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(itemOf(page, "Record")).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await expect(rowsOf(concepts)).toHaveCount(A_PAGE);

      await page.keyboard.press("Tab");
      await expect(
        concepts.getByRole("link").first(),
        "one Tab did not move focus from the tree to the first concept",
      ).toBeFocused();
      await page.keyboard.press(KEY.concepts.key);
      await expect(
        concepts.getByRole("heading", { name: "Insurance Policy in company" }),
      ).toBeFocused();
      await page.keyboard.press(KEY.tree.key);
      await expect(itemOf(page, "Insurance Policy")).toBeFocused();
      await page.keyboard.press(KEY.concepts.key);
      await expect(
        itemOf(page, "company"),
        "the tree did not treat the concepts key as a typed letter",
      ).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(itemOf(page, "company")).toHaveAttribute("aria-expanded", "false");
      await passesTheAccessibilityGate();
    });

    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(openedAt("company", "Insurance Policy"));
    await expect(rowsOf(concepts)).toHaveCount(A_PAGE);
    await expect(
      concepts.getByRole("columnheader"),
      "the narrow list keeps the Kind column that its heading already names",
    ).toHaveText(["Title", "Trust"]);

    expect(await topOf(concepts), "the list is not under the tree").toBeGreaterThanOrEqual(
      await bottomOf(treeOf(page)),
    );
    expect(await scrolledSideways(page), "the page scrolls sideways at 375 px").toBe(0);

    await page.keyboard.press(KEY.tree.key);
    await expect(itemOf(page, "Insurance Policy")).toBeFocused();
    await page.keyboard.press("Home");
    await focusedBelowTheBanner(page, itemOf(page, "company"));
    await page.keyboard.press("Tab");
    await focusedBelowTheBanner(page, concepts.getByRole("link").first());
  });
});
