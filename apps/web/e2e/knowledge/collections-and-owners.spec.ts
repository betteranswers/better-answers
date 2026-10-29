import type { APIRequestContext, APIResponse, Locator, Page } from "@playwright/test";
import { z } from "zod";

import { TAB_WORKSPACE_HEADER } from "@better-answers/schema/tab-workspace";

import { COLLECTIONS_KEYSTROKES as KEY } from "@/features/knowledge/knowledge-state.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  nameOwners,
  person,
  provision,
  removeMember,
  saysARefusal,
  seedConcepts,
  signIn,
  skipLinkReachesThePage,
} from "../harness.ts";
import { knowledgeMenuOpened, listsItsKeystrokes } from "../knowledge.ts";
import { refusalAnswering } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

const COLLECTIONS_AND_OWNERS = pageNamed(
  menuGroupIn(KNOWLEDGE, "curation"),
  "Collections and Owners",
).path;

const EDITOR = "Ifan Morgan";

const VIEWER = "Rhian Pryce";

const NAME_OWNER = "knowledge.nameOwner";

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

const signedIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const collections = (page: Page): Locator =>
  page.getByRole("region", { name: "Collections and Owners" });

const signedInAtThePage = async (page: Page, api: APIRequestContext, email: string) => {
  await signedIn(page, api, email);
  await page.goto(COLLECTIONS_AND_OWNERS);
  await expect(collections(page).getByRole("list")).toBeVisible();
};

const ownerAt = (collection: string): string =>
  `(//li[.//h3[.='${collection}']]//dt[.='Owner'])[1]/following-sibling::dd[1]`;

const ownerOf = (page: Page, collection: string): Locator => page.locator(ownerAt(collection));

const pickerOf = (page: Page, collection: string): Locator =>
  page.getByRole("combobox", { name: `New Owner of ${collection}` });

const saveOf = (page: Page, collection: string): Locator =>
  page.getByRole("button", { name: `Save the new owner of ${collection}` });

const said = (page: Page): Locator => collections(page).getByRole("status").nth(1);

const aRefusal = z.object({
  error: z.object({ data: z.object({ refusal: z.object({ word: z.string() }) }) }),
});

const refusedWith = async (answered: APIResponse) => ({
  status: answered.status(),
  word: aRefusal.safeParse(await answered.json()).data?.error.data.refusal.word,
});

test.describe("Collections and Owners", () => {
  test("an Editor owning a collection finds it under Curation", async ({ page, request }) => {
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
            - link "Knowledge Base"
        - heading "Curation" [level=3]
        - list:
          - listitem:
            - link "Collections and Owners"
    `);

    const started = Date.now();
    await page.goto(COLLECTIONS_AND_OWNERS);
    await expect(ownerOf(page, "policy")).toHaveText(EDITOR);
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "collections", description: `${elapsed} ms` });
    expect(elapsed, "the collections rendered past the list's budget").toBeLessThan(LIST_BUDGET_MS);

    await expect(collections(page)).toMatchAriaSnapshot(`
      - region "Collections and Owners":
        - /children: equal
        - heading "Collections and Owners" [level=2]
        - paragraph
        - status: /\\b2\\b/
        - status
        - list:
          - /children: equal
          - listitem "policy":
            - heading "policy" [level=3]
            - term: Owner
            - definition: ${JSON.stringify(EDITOR)}
            - term: Concepts with Their Own Owner
            - definition: /\\b1\\b/
          - listitem "safety":
            - heading "safety" [level=3]
            - term: Owner
            - definition
            - term: Concepts with Their Own Owner
            - definition
    `);
  });

  test("rolls back a naming the api refuses, saying why", async ({ page, request }) => {
    const at = await aCuratedWorkspace(request, "Arrow Valley Joinery");
    await signedInAtThePage(page, request, at.admin.email);
    await pickerOf(page, "policy").selectOption({ label: VIEWER });
    await removeMember(request, { workspaceId: at.workspaceId, userId: at.viewer.id });

    const refused = refusalAnswering(page, NAME_OWNER);
    await saveOf(page, "policy").press("Enter");

    expect((await refused).word).toBe("no-such-member");
    await saysARefusal(collections(page).getByRole("alert"));
    await expect(ownerOf(page, "policy")).not.toContainText(VIEWER);
    await expect(pickerOf(page, "policy")).toHaveValue("");
  });

  test("a Viewer named owner reads their collection with no picker", async ({ page, request }) => {
    const at = await aCuratedWorkspace(request, "Clun Forest Herbs");
    await ownersNamed(request, at, [{ collection: "policy", personId: at.viewer.id }]);
    await signedIn(page, request, at.viewer.email);

    const menu = await knowledgeMenuOpened(page);
    await expect(menu.getByRole("heading", { level: 3 })).toHaveText(["Browse", "Curation"]);
    await menu.getByRole("link", { name: "Collections and Owners" }).click();

    await expect(ownerOf(page, "policy")).toHaveText(VIEWER);
    await expect(pickerOf(page, "policy")).toHaveCount(0);
    await expect(collections(page).getByRole("combobox")).toHaveCount(0);
    await expect(collections(page).getByRole("button")).toHaveCount(0);
  });

  test("an Admin names and clears owners by keyboard alone", async ({ page, request }) => {
    const at = await aCuratedWorkspace(request, "Teme Bridge Bakery");
    await ownersNamed(request, at, [{ collection: "policy", personId: at.viewer.id }]);
    await signedInAtThePage(page, request, at.admin.email);

    await skipLinkReachesThePage(page);
    await listsItsKeystrokes(page, "Collections and Owners", KEY, [
      "Change the Owner of the Collection in Focus",
    ]);
    await page.keyboard.press(KEY.changeOwner.key);
    await expect(pickerOf(page, "held"), "the key did not reach the first picker").toBeFocused();

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(pickerOf(page, "policy")).toBeFocused();
    await page.keyboard.press("n");
    await expect(pickerOf(page, "policy")).toHaveValue("");
    await page.keyboard.press("Tab");
    await expect(saveOf(page, "policy")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(ownerOf(page, "policy")).not.toContainText(VIEWER);
    await expect(said(page)).toHaveText(/\S/);

    await page.keyboard.press("Tab");
    await expect(pickerOf(page, "safety")).toBeFocused();
    await page.keyboard.press("r");
    await expect(pickerOf(page, "safety")).toHaveValue(at.viewer.id);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(ownerOf(page, "safety")).toHaveText(VIEWER);

    await page.keyboard.press(KEY.changeOwner.key);
    await expect(pickerOf(page, "safety"), "the key left the row in focus").toBeFocused();
  });

  test("refuses an Editor owning nothing the list and naming", async ({ page, request }) => {
    const at = await aCuratedWorkspace(request, "Kemp Valley Builders");
    await ownersNamed(request, at, [{ collection: "policy", personId: at.viewer.id }]);
    await signedIn(page, request, at.editor.email);

    const listed = await page.request.get("/trpc/knowledge.collections");
    expect(await refusedWith(listed)).toEqual({ status: 403, word: "owner-forbids" });

    const named = await page.request.post(`/trpc/${NAME_OWNER}`, {
      data: { collection: "policy", personId: at.editor.id },
      headers: { [TAB_WORKSPACE_HEADER]: at.workspaceId },
    });
    expect(await refusedWith(named)).toEqual({ status: 403, word: "role-forbids" });
  });
});
