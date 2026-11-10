import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { CONCEPT_TYPES_PAGE } from "@/features/knowledge/curation/curation-state.ts";
import { COLLECTIONS_KEYSTROKES as KEY } from "@/features/knowledge/knowledge-state.ts";
import { COLLECTIONS_WORDS as WORDS } from "@/features/knowledge/knowledge-words.ts";
import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  nameOwners,
  person,
  provision,
  seedConcepts,
  signOutFromTheShell,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "../harness.ts";
import {
  knowledgeMenuOpened,
  listsItsKeystrokes,
  scrolledSideways,
  signedIn,
} from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const COLLECTIONS_AND_OWNERS = pageNamed(
  menuGroupIn(KNOWLEDGE, "curation"),
  "Collections and Owners",
).path;

const EDITOR = "Ifan Morgan";

const VIEWER = "Rhian Pryce";

const NARROW = { width: 390, height: 844 } as const;

type Member = { readonly id: string; readonly email: string };

type Curated = {
  readonly workspaceId: string;
  readonly admin: Member;
  readonly editor: Member;
  readonly viewer: Member;
  readonly iriOf: (title: string) => string;
};

type Owned = Parameters<typeof nameOwners>[1]["owners"][number];

const aCuratedWorkspace = async (api: APIRequestContext, name: string): Promise<Curated> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const { workspaceId } = workspace;
  const memberAs = async (role: "Editor" | "Viewer", displayName: string): Promise<Member> => {
    const email = anAddress(role.toLowerCase());
    const made = await person(api, email, { displayName });
    await addMember(api, { workspaceId, userId: made.id, role });
    return { id: made.id, email };
  };
  const editor = await memberAs("Editor", EDITOR);
  const viewer = await memberAs("Viewer", VIEWER);
  const { concepts } = await seedConcepts(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [
      { title: "Annual leave", collection: "policy", body: "Everyone takes 25 days of leave." },
      { title: "Expense claims", collection: "policy", body: "Claims go in within 30 days." },
      { title: "Fire drills", collection: "safety", body: "A fire drill runs each quarter." },
      {
        title: "Board pay",
        collection: "held",
        body: "The board sets its own pay.",
        sensitivity: "Restricted",
      },
    ],
  });
  const iris = new Map(concepts.map((concept) => [concept.title, concept.iri]));
  return {
    workspaceId,
    admin: { id: workspace.admin.id, email: adminEmail },
    editor,
    viewer,
    iriOf: (title) => iris.get(title) ?? "",
  };
};

const ownersNamed = (api: APIRequestContext, at: Curated, owners: readonly Owned[]) =>
  nameOwners(api, { workspaceId: at.workspaceId, userId: at.admin.id, owners });

const collections = (page: Page): Locator =>
  page.getByRole("region", { name: "Collections and Owners" });

const signedInAtThePage = async (page: Page, api: APIRequestContext, email: string) => {
  await signedIn(page, api, email);
  await page.goto(COLLECTIONS_AND_OWNERS);
  await expect(collections(page).getByRole("table")).toBeVisible();
};

const rowOf = (page: Page, collection: string): Locator =>
  collections(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: collectionNameOf(collection), exact: true }) });

const ownerOf = (page: Page, collection: string): Locator =>
  rowOf(page, collection).getByRole("cell").nth(1);

const pickerOf = (page: Page, collection: string, owner: string): Locator =>
  page.getByRole("button", { name: WORDS.ownerOf(collectionNameOf(collection), owner) });

const choosing = async (page: Page, typed: string): Promise<void> => {
  await page.keyboard.press("Enter");
  await page.keyboard.type(typed);
  await page.keyboard.press("Enter");
};

test.describe("Collections and Owners", () => {
  test("a collection-owning Editor finds Collections and Owners under Curation", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await aCuratedWorkspace(request, "Teme Valley Surveys");
    await ownersNamed(request, at, [
      { collection: "policy", personId: at.editor.id },
      { iri: at.iriOf("Expense claims"), personId: at.viewer.id },
    ]);
    await signedIn(page, request, at.editor.email);

    await expect(await knowledgeMenuOpened(page)).toMatchAriaSnapshot(`
      - navigation "Knowledge":
        - /children: deep-equal
        - heading "Browse" [level=3]
        - list:
          - listitem:
            - link "Search"
          - listitem:
            - link "Guides"
          - listitem:
            - link "Knowledge Base"
        - heading "Curation" [level=3]
        - list:
          - listitem:
            - link "All Knowledge"
          - listitem:
            - link "${CONCEPT_TYPES_PAGE.name}"
          - listitem:
            - link "Collections and Owners"
    `);

    const started = Date.now();
    await page.goto(COLLECTIONS_AND_OWNERS);
    await expect(ownerOf(page, "policy")).toContainText(EDITOR);
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "collections", description: `${elapsed} ms` });
    expect(elapsed, "the collections took longer than the list time budget to render").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await expect(collections(page)).toMatchAriaSnapshot(`
      - region "Collections and Owners":
        - heading "Collections and Owners" [level=2]
        - status: /\\b2\\b/
        - table "${WORDS.caption}":
          - rowgroup:
            - row:
              - columnheader "${WORDS.columns.collection}"
              - columnheader "${WORDS.columns.owner}"
              - columnheader "${WORDS.columns.concepts}"
              - columnheader "${WORDS.columns.verified}"
    `);
    await expect(rowOf(page, "policy").getByRole("cell").nth(2)).toHaveText("2");
    await expect(rowOf(page, "policy").getByRole("cell").nth(3)).toHaveText("0%");
    await expect(collections(page).getByRole("button")).toHaveCount(0);
    await passesTheAccessibilityGate();

    await test.step("an Admin changes, clears and undoes collection owners by keyboard alone", async () => {
      await signOutFromTheShell(page, EDITOR);
      await signedInAtThePage(page, request, at.admin.email);

      await skipLinkReachesThePage(page);
      await listsItsKeystrokes(page, "Collections and Owners", KEY, [
        KEY.changeOwner.action,
        KEY.undo.action,
      ]);
      await page.keyboard.press(KEY.changeOwner.key);
      await expect(
        pickerOf(page, "held", WORDS.noOwner),
        "the change-owner key did not move focus to the first owner picker",
      ).toBeFocused();

      await tabUntilFocused(page, pickerOf(page, "policy", EDITOR));
      await choosing(page, WORDS.noOwner);
      await expect(pickerOf(page, "policy", WORDS.noOwner)).toBeFocused();
      await expect(page.getByRole("button", { name: WORDS.undo })).toBeVisible();

      await page.keyboard.press(KEY.undo.key);
      await expect(pickerOf(page, "policy", EDITOR)).toBeVisible();

      await tabUntilFocused(page, pickerOf(page, "safety", WORDS.noOwner));
      await choosing(page, VIEWER);
      await expect(pickerOf(page, "safety", VIEWER)).toBeFocused();

      await page.keyboard.press(KEY.changeOwner.key);
      await expect(
        pickerOf(page, "safety", VIEWER),
        "the change-owner key did not focus the picker of the collection in focus",
      ).toBeFocused();

      await page.reload();
      await expect(pickerOf(page, "policy", EDITOR)).toBeVisible();
      await expect(pickerOf(page, "safety", VIEWER)).toBeVisible();
    });

    await test.step("the table keeps its owner and count on a narrow screen", async () => {
      await page.setViewportSize(NARROW);

      await expect(pickerOf(page, "policy", EDITOR)).toBeVisible();
      await expect(rowOf(page, "policy").getByRole("cell").nth(2)).toHaveText("2");
      await expect
        .poll(() => scrolledSideways(page), { message: "the narrow page scrolled sideways" })
        .toBeLessThanOrEqual(0);
    });
  });
});
