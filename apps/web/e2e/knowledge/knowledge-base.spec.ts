import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { KNOWLEDGE_BASE_KEYSTROKES as KEY } from "@/features/knowledge/knowledge-state.ts";
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
import { conceptsSeeded, listsItsKeystrokes, scrolledSideways } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const A_PAGE = 50;

const KNOWLEDGE_BASE = pageNamed(menuGroupIn(KNOWLEDGE, "browse"), "Knowledge Base").path;

const FLEET = "Fleet insurance";

const PREMISES = "Premises insurance";

const HANDBOOK = "Staff handbook";

const DATASHEET = "Boiler datasheet";

const VISION = "Our purpose";

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
