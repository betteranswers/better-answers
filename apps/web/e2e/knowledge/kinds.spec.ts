import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  KINDS_KEYSTROKES as KEY,
  KINDS_LIST,
} from "@/features/knowledge/curation/curation-state.ts";
import { KINDS_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  nameOwners,
  person,
  provision,
  seedConcepts,
  skipLinkReachesThePage,
} from "../harness.ts";
import { listsItsKeystrokes, signedIn } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const KINDS = pageNamed(menuGroupIn(KNOWLEDGE, "curation"), "Kinds").path;

const EDITOR = "Ifan Morgan";

type Member = { readonly id: string; readonly email: string };

type Curated = { readonly admin: Member; readonly editor: Member };

const aWorkspaceOfKinds = async (api: APIRequestContext, name: string): Promise<Curated> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const { workspaceId } = workspace;
  const editorEmail = anAddress("editor");
  const made = await person(api, editorEmail, { displayName: EDITOR });
  await addMember(api, { workspaceId, userId: made.id, role: "Editor" });
  await seedConcepts(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [
      { title: "Annual leave", kind: "Policy", collection: "hr", body: "Everyone takes 25 days." },
      { title: "Expense claims", kind: "Policy", collection: "hr", body: "Claims go in monthly." },
      {
        title: "Salary bands",
        kind: "Policy",
        collection: "hr",
        body: "Bands are set each April.",
        sensitivity: "Restricted",
      },
      { title: "Notice period", kind: "Term", collection: "hr", body: "Four weeks." },
      { title: "Fire drills", kind: "Procedure", collection: "safety", body: "Each quarter." },
      { title: "Visitor passes", kind: "Procedure", body: "Passes are signed for." },
      {
        title: "Board minutes",
        kind: "Minutes",
        collection: "board",
        body: "The secretary keeps them.",
        audience: "groups",
        groupMemberIds: [],
      },
    ],
  });
  await nameOwners(api, {
    workspaceId,
    userId: workspace.admin.id,
    owners: [{ collection: "hr", personId: made.id }],
  });
  return {
    admin: { id: workspace.admin.id, email: adminEmail },
    editor: { id: made.id, email: editorEmail },
  };
};

const kinds = (page: Page): Locator => page.getByRole("region", { name: "Kinds" });

const kindsDrawn = async (page: Page): Promise<Locator> => {
  await page.goto(KINDS);
  await expect(kinds(page).getByRole("table")).toBeVisible();
  return kinds(page);
};

const disclosureOf = (page: Page, kind: string): Locator =>
  kinds(page).getByRole("button", { name: new RegExp(`^${kind}`) });

const collectionsOf = (page: Page, kind: string): Locator =>
  kinds(page).getByRole("list", { name: WORDS.collectionsOf(kind) });

const listed = async (page: Page): Promise<string[]> =>
  (await kinds(page).locator("tbody tr").allInnerTexts()).map((row) =>
    row.replace(WORDS.byCollection, "").replace(/\s+/gu, " ").trim(),
  );

const filter = (page: Page): Locator => kinds(page).getByRole("button", { name: WORDS.tail });

test.describe("Kinds", () => {
  test("an Admin filters, sorts, and opens kinds by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await aWorkspaceOfKinds(request, "Teme Valley Surveys");
    await signedIn(page, request, at.admin.email);

    const started = Date.now();
    await page.goto(KINDS);
    await expect(kinds(page).getByRole("table")).toBeVisible();
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "kinds", description: `${elapsed} ms` });
    expect(elapsed, "the kinds took longer than the list time budget to render").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await expect(kinds(page)).toMatchAriaSnapshot(`
      - region "Kinds":
        - /children: equal
        - heading "Kinds" [level=2]
        - paragraph
        - status: 3 kinds
        - status
        - button "Kinds With Two or Fewer Concepts"
        - table "Kinds of concept in the knowledge base, with how many concepts hold each.":
          - /children: equal
          - caption
          - rowgroup:
            - /children: equal
            - row "Kind Concepts":
              - /children: equal
              - columnheader "Kind":
                - button "Kind"
              - columnheader "Concepts":
                - button "Concepts"
          - rowgroup:
            - /children: equal
            - row "Policy by collection 3":
              - /children: equal
              - cell "Policy by collection":
                - button "Policy by collection"
              - cell "3"
            - row "Procedure by collection 2":
              - /children: equal
              - cell "Procedure by collection":
                - button "Procedure by collection"
              - cell "2"
            - row "Term by collection 1":
              - /children: equal
              - cell "Term by collection":
                - button "Term by collection"
              - cell "1"
    `);
    await expect(kinds(page).getByRole("columnheader", { name: "Kind" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await passesTheAccessibilityGate();

    await skipLinkReachesThePage(page);

    await test.step("turns the Kinds With Two or Fewer Concepts filter on and off by keyboard alone", async () => {
      await page.keyboard.press("Tab");
      await expect(filter(page)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(filter(page)).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(new RegExp(`${KINDS_LIST}\\.tail=small`));
      expect(await listed(page)).toEqual(["Procedure 2", "Term 1"]);
      await page.keyboard.press("Enter");
      await expect(filter(page)).toHaveAttribute("aria-pressed", "false");
      expect(await listed(page)).toHaveLength(3);
    });

    await test.step("sorts by the Concepts column by keyboard alone", async () => {
      await page.keyboard.press("Tab");
      await expect(kinds(page).getByRole("button", { name: "Kind", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      const concepts = kinds(page).getByRole("button", { name: "Concepts", exact: true });
      await expect(concepts).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${KINDS_LIST}\\.sort=count`));
      expect(await listed(page)).toEqual(["Term 1", "Procedure 2", "Policy 3"]);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${KINDS_LIST}\\.sort=-count`));
      await expect(concepts).toBeFocused();
      expect(await listed(page)).toEqual(["Policy 3", "Procedure 2", "Term 1"]);
    });

    await test.step("opens and closes a kind by keyboard alone", async () => {
      await page.keyboard.press("Tab");
      await expect(disclosureOf(page, "Policy")).toBeFocused();
      await page.keyboard.press(KEY.open.key);
      await expect(disclosureOf(page, "Policy")).toHaveAttribute("aria-expanded", "true");
      await expect(collectionsOf(page, "Policy").getByRole("listitem")).toHaveText(["hr3"]);
      await passesTheAccessibilityGate();
      await page.keyboard.press("Enter");
      await expect(disclosureOf(page, "Policy")).toHaveAttribute("aria-expanded", "false");
      await expect(collectionsOf(page, "Policy")).toHaveCount(0);
    });

    await test.step("keeps the filter and the sort after a reload", async () => {
      await page.keyboard.press(KEY.tail.key);
      await expect(filter(page)).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(filter(page)).toHaveAttribute("aria-pressed", "true");
      expect(await listed(page)).toEqual(["Procedure 2", "Term 1"]);
      await expect(kinds(page).getByRole("columnheader", { name: "Concepts" })).toHaveAttribute(
        "aria-sort",
        "descending",
      );
    });

    await listsItsKeystrokes(page, "Kinds", KEY, [
      "Switch Between Every Kind and Kinds With Two or Fewer Concepts",
      "Open or Close the Collections of the Kind in Focus",
    ]);
  });

  test("a collection-owning Editor's counts include only concepts they can read", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await aWorkspaceOfKinds(request, "Wye Valley Tools");
    await signedIn(page, request, at.editor.email);
    await kindsDrawn(page);

    expect(await listed(page), "the counts include withheld concepts").toEqual([
      "Policy 2",
      "Procedure 2",
      "Term 1",
    ]);
    await expect(kinds(page).getByText("3 kinds")).toBeVisible();
    await expect(kinds(page).getByText("Minutes")).toHaveCount(0);
    await expect(kinds(page).getByText("board")).toHaveCount(0);
    await expect(page.getByText(/bundle/iu)).toHaveCount(0);

    await test.step("shows all three kinds when the Kinds With Two or Fewer Concepts filter is on", async () => {
      await filter(page).click();
      await expect(filter(page)).toHaveAttribute("aria-pressed", "true");
      expect(await listed(page)).toEqual(["Policy 2", "Procedure 2", "Term 1"]);
      await expect(kinds(page).getByText("3 kinds")).toBeVisible();
    });

    await test.step("counts each kind in each collection the Editor can read", async () => {
      await disclosureOf(page, "Policy").click();
      await expect(collectionsOf(page, "Policy").getByRole("listitem")).toHaveText(["hr2"]);
      await disclosureOf(page, "Procedure").click();
      await expect(collectionsOf(page, "Procedure").getByRole("listitem")).toHaveText([
        "safety1",
        "No collection1",
      ]);
      await disclosureOf(page, "Term").click();
      await expect(collectionsOf(page, "Term").getByRole("listitem")).toHaveText(["hr1"]);
      await passesTheAccessibilityGate();
    });
  });
});
