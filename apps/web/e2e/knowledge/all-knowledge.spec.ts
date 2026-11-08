import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { ALL_KNOWLEDGE_KEYSTROKES as KEY } from "@/features/knowledge/curation/curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  nameOwners,
  notFoundOfferingHome,
  person,
  provision,
  seedConceptIndex,
  seedConcepts,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "../harness.ts";
import { listsItsKeystrokes } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const FIRST_PAGE = 50;

const ALL_KNOWLEDGE = pageNamed(menuGroupIn(KNOWLEDGE, "curation"), "All Knowledge").path;

const OWNING_EDITOR = "Ifan Morgan";

const OWNING_NOTHING = "Dilys Pugh";

const NEW_OWNER = "Rhian Pryce";

const SELECTED = ["Annual leave", "Expense claims", "Fire drills"] as const;

type Reviewed = {
  readonly adminEmail: string;
  readonly owningEditorEmail: string;
  readonly owningNothingEmail: string;
};

const aMember = async (
  api: APIRequestContext,
  workspaceId: string,
  as: { readonly role: "Editor" | "Viewer"; readonly displayName: string },
) => {
  const email = anAddress(as.role.toLowerCase());
  const made = await person(api, email, { displayName: as.displayName });
  await addMember(api, { workspaceId, userId: made.id, role: as.role });
  return { id: made.id, email };
};

const aWorkspaceToReview = async (api: APIRequestContext, name: string): Promise<Reviewed> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const { workspaceId } = workspace;
  const owning = await aMember(api, workspaceId, { role: "Editor", displayName: OWNING_EDITOR });
  const nothing = await aMember(api, workspaceId, { role: "Editor", displayName: OWNING_NOTHING });
  await aMember(api, workspaceId, { role: "Viewer", displayName: NEW_OWNER });
  await seedConcepts(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [
      {
        title: "Annual leave",
        collection: "policy",
        body: "Everyone takes 25 days of leave.",
        trust: "human-reviewed",
      },
      { title: "Expense claims", collection: "policy", body: "Claims go in within 30 days." },
      { title: "Sick pay", collection: "policy", body: "Sick pay starts on the first day." },
      { title: "Fire drills", collection: "safety", body: "A fire drill runs each quarter." },
    ],
  });
  await seedConceptIndex(api, {
    workspaceId,
    batches: [{ collection: "archive", conceptType: "note", count: 60, title: "Zone note" }],
  });
  await nameOwners(api, {
    workspaceId,
    userId: workspace.admin.id,
    owners: [{ collection: "policy", personId: owning.id }],
  });
  return { adminEmail, owningEditorEmail: owning.email, owningNothingEmail: nothing.email };
};

const signedInAt = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const allKnowledge = (page: Page): Locator => page.getByRole("region", { name: "All Knowledge" });

const rowsOf = (page: Page): Locator =>
  allKnowledge(page)
    .getByRole("row")
    .filter({ has: page.getByRole("link") });

const rowOf = (page: Page, title: string): Locator =>
  allKnowledge(page)
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });

const titleOf = (page: Page, title: string): Locator =>
  allKnowledge(page).getByRole("link", { name: title, exact: true });

const tickOf = (page: Page, title: string): Locator =>
  allKnowledge(page).getByRole("checkbox", { name: `Select ${title}`, exact: true });

const selectedBar = (page: Page): Locator =>
  allKnowledge(page).getByRole("toolbar", { name: "Selected concepts" });

const filterOf = (page: Page, name: string): Locator =>
  allKnowledge(page).getByRole("combobox", { name: `Filter by ${name}` });

test.describe("All Knowledge", () => {
  test("shows each role only the concepts they can curate", async ({
    page,
    context,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await aWorkspaceToReview(request, "Teme Valley Surveys");
    await signedInAt(page, request, at.adminEmail);

    const started = Date.now();
    await page.goto(ALL_KNOWLEDGE);
    await expect(rowsOf(page).nth(FIRST_PAGE - 1)).toBeVisible();
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "all knowledge", description: `${elapsed} ms` });
    expect(elapsed, "the first page took longer than the list time budget to render").toBeLessThan(
      LIST_BUDGET_MS,
    );
    await expect(rowsOf(page)).toHaveCount(FIRST_PAGE);
    await expect(page.getByRole("main")).not.toContainText(/bundle/i);

    await expect(allKnowledge(page)).toMatchAriaSnapshot(`
      - region "All Knowledge":
        - heading "All Knowledge" [level=2]
        - status: /\\b64\\b/
        - status
        - combobox "Filter by Collection"
        - combobox "Filter by ${WORDS.filters.type.label}"
        - button "Columns"
        - table:
          - rowgroup:
            - row:
              - columnheader "Select every concept on this page":
                - checkbox "Select every concept on this page"
              - columnheader "Title"
              - columnheader "${WORDS.columns.type}"
              - columnheader "Collection"
              - columnheader "Trust"
              - columnheader "Owner"
              - columnheader "${WORDS.columns.checked}"
        - navigation "${WORDS.pages}"
    `);
    await expect(rowOf(page, "Annual leave")).toContainText(/\d{1,2} \w+ \d{4}/);
    await passesTheAccessibilityGate();

    await test.step("an Admin selects three rows and sets their owner by keyboard alone", async () => {
      await skipLinkReachesThePage(page);
      await listsItsKeystrokes(page, "All Knowledge", KEY, [KEY.setOwner.action]);

      for (const title of SELECTED) {
        await tabUntilFocused(page, titleOf(page, title));
        await page.keyboard.press(KEY.tick.key);
        await expect(tickOf(page, title)).toBeChecked();
      }
      await expect(selectedBar(page)).toBeVisible();
      await passesTheAccessibilityGate();

      await page.keyboard.press(`Shift+${KEY.setOwner.key}`);
      const dialog = page.getByRole("dialog", { name: WORDS.setOwner.action });
      await expect(dialog).toBeVisible();
      const picker = dialog.getByRole("combobox", { name: WORDS.setOwner.newOwner });
      await tabUntilFocused(page, picker);
      await page.keyboard.press(NEW_OWNER.slice(0, 1));
      await expect(picker.locator("option:checked")).toHaveText(NEW_OWNER);
      await tabUntilFocused(page, dialog.getByRole("button", { name: WORDS.setOwner.action }));
      await page.keyboard.press("Enter");

      await expect(dialog).toHaveCount(0);
      for (const title of SELECTED) {
        await expect(rowOf(page, title)).toContainText(NEW_OWNER);
        await expect(tickOf(page, title)).not.toBeChecked();
      }
      await expect(selectedBar(page)).toBeHidden();
      await expect(allKnowledge(page).getByRole("status").nth(1)).toHaveText(/\S/);
      await expect(
        allKnowledge(page).getByRole("heading", { name: "All Knowledge" }),
      ).toBeFocused();

      await page.reload();
      await expect(rowOf(page, "Annual leave")).toContainText(NEW_OWNER);
      await expect(rowOf(page, "Fire drills")).toContainText(NEW_OWNER);
    });

    await test.step("an Editor who owns a collection sees it first and keeps their filter and sort after opening a concept", async () => {
      await context.clearCookies();
      await signedInAt(page, request, at.owningEditorEmail);
      await page.goto(ALL_KNOWLEDGE);

      await expect(rowOf(page, "Sick pay")).toBeVisible();
      await expect(filterOf(page, "Collection")).toContainText("policy");
      await expect(rowsOf(page)).toHaveCount(3);
      await expect(titleOf(page, "Fire drills")).toHaveCount(0);
      await expect(allKnowledge(page).getByRole("checkbox")).toHaveCount(0);
      await expect(selectedBar(page)).toHaveCount(0);
      await expect(rowOf(page, "Annual leave")).toContainText(NEW_OWNER);
      await passesTheAccessibilityGate();

      await filterOf(page, "Collection").click();
      await page.getByRole("option", { name: WORDS.filters.collection.any }).click();
      await expect(titleOf(page, "Fire drills")).toBeVisible();
      await allKnowledge(page).getByRole("button", { name: "Owner", exact: true }).click();
      await expect(page).toHaveURL(/all\.sort/);
      const held = page.url();

      await titleOf(page, "Annual leave").click();
      await expect(page).not.toHaveURL(held);
      await page.getByRole("link", { name: "Back to All Knowledge" }).click();

      await expect(page).toHaveURL(held);
      await expect(titleOf(page, "Fire drills")).toBeVisible();
      await expect(filterOf(page, "Collection")).toContainText(WORDS.filters.collection.any);
      await expect(titleOf(page, "Annual leave")).toBeFocused();
    });

    await test.step("an Editor who owns no collection sees the not-found page", async () => {
      await context.clearCookies();
      await signedInAt(page, request, at.owningNothingEmail);
      await page.goto(ALL_KNOWLEDGE);

      await notFoundOfferingHome(page, "Editor");
      await expect(allKnowledge(page)).toHaveCount(0);
    });
  });
});
