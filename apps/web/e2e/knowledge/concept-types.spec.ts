import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { collectionNameOf } from "@better-answers/schema/collection-name";

import {
  CONCEPT_TYPES_KEYSTROKES as KEY,
  CONCEPT_TYPES_LIST,
  CONCEPT_TYPES_PAGE,
} from "@/features/knowledge/curation/curation-state.ts";
import { CONCEPT_TYPES_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { EMPTY_WORDS } from "@/shared/knowledge/concept-words.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  dismissedThePasskeyOffer,
  nameOwners,
  person,
  provision,
  seedConcepts,
  skipLinkReachesThePage,
} from "../harness.ts";
import { listsItsKeystrokes, signedIn } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const CONCEPT_TYPES = CONCEPT_TYPES_PAGE.path;

const EDITOR = "Ifan Morgan";

type Member = { readonly id: string; readonly email: string };

type Curated = { readonly admin: Member; readonly editor: Member };

const aWorkspaceOfConceptTypes = async (api: APIRequestContext, name: string): Promise<Curated> => {
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
      {
        title: "Annual leave",
        conceptType: "Policy",
        collection: "hr",
        body: "Everyone takes 25 days.",
      },
      {
        title: "Expense claims",
        conceptType: "Policy",
        collection: "hr",
        body: "Claims go in monthly.",
      },
      {
        title: "Salary bands",
        conceptType: "Policy",
        collection: "hr",
        body: "Bands are set each April.",
        sensitivity: "Restricted",
      },
      { title: "Notice period", conceptType: "Term", collection: "hr", body: "Four weeks." },
      {
        title: "Fire drills",
        conceptType: "Procedure",
        collection: "safety",
        body: "Each quarter.",
      },
      { title: "Visitor passes", conceptType: "Procedure", body: "Passes are signed for." },
      {
        title: "Board minutes",
        conceptType: "Minutes",
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

const conceptTypes = (page: Page): Locator =>
  page.getByRole("region", { name: CONCEPT_TYPES_PAGE.name });

const conceptTypesDrawn = async (page: Page): Promise<Locator> => {
  await page.goto(CONCEPT_TYPES);
  await expect(conceptTypes(page).getByRole("table")).toBeVisible();
  return conceptTypes(page);
};

const disclosureOf = (page: Page, conceptType: string): Locator =>
  conceptTypes(page).getByRole("button", { name: new RegExp(`^${conceptType}`) });

const collectionsOf = (page: Page, conceptType: string): Locator =>
  conceptTypes(page).getByRole("list", { name: WORDS.collectionsOf(conceptType) });

const rowTexts = async (page: Page): Promise<string[]> =>
  (await conceptTypes(page).locator("tbody tr").allInnerTexts()).map((row) =>
    row.replace("by collection", "").replace(/\s+/gu, " ").trim(),
  );

const filter = (page: Page): Locator =>
  conceptTypes(page).getByRole("button", { name: WORDS.tail });

test.describe("Concept Types", () => {
  test("an Admin filters, sorts, and opens types by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await aWorkspaceOfConceptTypes(request, "Teme Valley Surveys");
    await dismissedThePasskeyOffer(request, at.admin.email);
    await signedIn(page, request, at.admin.email);

    const started = Date.now();
    await page.goto(CONCEPT_TYPES);
    await expect(conceptTypes(page).getByRole("table")).toBeVisible();
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "concept types", description: `${elapsed} ms` });
    expect(elapsed, "the types took longer than the list time budget to render").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await expect(conceptTypes(page)).toMatchAriaSnapshot(`
      - region "${CONCEPT_TYPES_PAGE.name}":
        - /children: equal
        - heading "${CONCEPT_TYPES_PAGE.name}" [level=2]
        - status: ${WORDS.count(3, 3)}
        - status
        - button "${WORDS.tail}"
        - table "${WORDS.caption}":
          - /children: equal
          - caption
          - rowgroup:
            - /children: equal
            - row "${WORDS.columns.type} ${WORDS.columns.concepts}":
              - /children: equal
              - columnheader "${WORDS.columns.type}":
                - button "${WORDS.columns.type}"
              - columnheader "${WORDS.columns.concepts}":
                - button "${WORDS.columns.concepts}"
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
    await expect(
      conceptTypes(page).getByRole("columnheader", { name: WORDS.columns.type }),
    ).toHaveAttribute("aria-sort", "ascending");
    await passesTheAccessibilityGate();

    await skipLinkReachesThePage(page);

    await test.step("turns the Types With Two or Fewer Concepts filter on and off by keyboard alone", async () => {
      await page.keyboard.press("Tab");
      await expect(filter(page)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(filter(page)).toHaveAttribute("aria-pressed", "true");
      await expect(
        filter(page).locator("svg"),
        "the pressed toggle drew no mark beside its name",
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${CONCEPT_TYPES_LIST}\\.tail=small`));
      expect(await rowTexts(page)).toEqual(["Procedure 2", "Term 1"]);
      await page.keyboard.press("Enter");
      await expect(filter(page)).toHaveAttribute("aria-pressed", "false");
      await expect(filter(page).locator("svg")).toHaveCount(0);
      expect(await rowTexts(page)).toHaveLength(3);
    });

    await test.step("sorts by the Concepts column by keyboard alone", async () => {
      await page.keyboard.press("Tab");
      await expect(
        conceptTypes(page).getByRole("button", { name: WORDS.columns.type, exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      const concepts = conceptTypes(page).getByRole("button", { name: "Concepts", exact: true });
      await expect(concepts).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${CONCEPT_TYPES_LIST}\\.sort=count`));
      expect(await rowTexts(page)).toEqual(["Term 1", "Procedure 2", "Policy 3"]);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${CONCEPT_TYPES_LIST}\\.sort=-count`));
      await expect(concepts).toBeFocused();
      expect(await rowTexts(page)).toEqual(["Policy 3", "Procedure 2", "Term 1"]);
    });

    await test.step("opens and closes a type by keyboard alone", async () => {
      await page.keyboard.press("Tab");
      await expect(disclosureOf(page, "Policy")).toBeFocused();
      await page.keyboard.press(KEY.open.key);
      await expect(disclosureOf(page, "Policy")).toHaveAttribute("aria-expanded", "true");
      await expect(collectionsOf(page, "Policy").getByRole("listitem")).toHaveText([
        `${collectionNameOf("hr")}3`,
      ]);
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
      expect(await rowTexts(page)).toEqual(["Procedure 2", "Term 1"]);
      await expect(
        conceptTypes(page).getByRole("columnheader", { name: "Concepts" }),
      ).toHaveAttribute("aria-sort", "descending");
    });

    await listsItsKeystrokes(page, CONCEPT_TYPES_PAGE.name, KEY, [
      KEY.tail.action,
      KEY.open.action,
    ]);
  });

  test("a collection-owning Editor's counts include only concepts they can read", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await aWorkspaceOfConceptTypes(request, "Wye Valley Tools");
    await signedIn(page, request, at.editor.email);
    await conceptTypesDrawn(page);

    expect(await rowTexts(page), "the counts include withheld concepts").toEqual([
      "Policy 2",
      "Procedure 2",
      "Term 1",
    ]);
    await expect(conceptTypes(page).getByText(WORDS.count(3, 3))).toBeVisible();
    await expect(conceptTypes(page).getByText("Minutes")).toHaveCount(0);
    await expect(conceptTypes(page).getByText("board")).toHaveCount(0);
    await expect(page.getByText(/bundle/iu)).toHaveCount(0);

    await test.step("shows all three types when the Types With Two or Fewer Concepts filter is on", async () => {
      await filter(page).click();
      await expect(filter(page)).toHaveAttribute("aria-pressed", "true");
      expect(await rowTexts(page)).toEqual(["Policy 2", "Procedure 2", "Term 1"]);
      await expect(conceptTypes(page).getByText(WORDS.count(3, 3))).toBeVisible();
    });

    await test.step("counts each type in each collection the Editor can read", async () => {
      await disclosureOf(page, "Policy").click();
      await expect(collectionsOf(page, "Policy").getByRole("listitem")).toHaveText([
        `${collectionNameOf("hr")}2`,
      ]);
      await disclosureOf(page, "Procedure").click();
      await expect(collectionsOf(page, "Procedure").getByRole("listitem")).toHaveText([
        `${collectionNameOf("safety")}1`,
        `${EMPTY_WORDS.collection}1`,
      ]);
      await disclosureOf(page, "Term").click();
      await expect(collectionsOf(page, "Term").getByRole("listitem")).toHaveText([
        `${collectionNameOf("hr")}1`,
      ]);
      await passesTheAccessibilityGate();
    });
  });
});
