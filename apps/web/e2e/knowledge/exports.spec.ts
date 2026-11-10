import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { APIRequestContext, Download, Locator, Page, TestInfo } from "@playwright/test";

import {
  EXPORTS_KEYSTROKES as KEY,
  CONCEPT_TYPES_PAGE,
} from "@/features/knowledge/curation/curation-state.ts";
import { EXPORTS_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { KNOWLEDGE, menuGroupIn, pageById } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  nameOwners,
  notFoundOfferingHome,
  person,
  provision,
  seedConcepts,
  seedGuide,
  seedManifest,
  signOutFromTheShell,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "../harness.ts";
import { knowledgeMenuOpened, listsItsKeystrokes, signedIn } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

const EXPORTS = pageById(CURATION, "exports").path;

const EDITOR = "Ifan Morgan";

const KNOWLEDGE_BASE = WORDS.knowledgeBase.name;

const RECORDS = WORDS.records.name;

const GUIDE = WORDS.guide.name;

const CONCEPTS = [
  { title: "Annual leave", collection: "policy", body: "Everyone takes 25 days of leave." },
  { title: "Expense claims", collection: "policy", body: "Claims go in within 30 days." },
  { title: "Fire drills", collection: "safety", body: "A fire drill runs each quarter." },
] as const;

type Member = { readonly id: string; readonly email: string };

type Exportable = {
  readonly admin: Member;
  readonly editor: Member;
  readonly conceptFiles: readonly string[];
  readonly fileOf: (title: string) => string;
};

const aWorkspaceToExport = async (api: APIRequestContext, name: string): Promise<Exportable> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const { workspaceId } = workspace;
  const userId = workspace.admin.id;
  const editorEmail = anAddress("editor");
  const editor = await person(api, editorEmail, { displayName: EDITOR });
  await addMember(api, { workspaceId, userId: editor.id, role: "Editor" });
  const { concepts } = await seedConcepts(api, { workspaceId, userId, concepts: CONCEPTS });
  await seedGuide(api, { workspaceId, userId, financeUserIds: [] });
  await seedManifest(api, { workspaceId, userId });
  await nameOwners(api, {
    workspaceId,
    userId,
    owners: [{ collection: "policy", personId: editor.id }],
  });
  const files = new Map(concepts.map((concept) => [concept.title, concept.path]));
  return {
    admin: { id: userId, email: adminEmail },
    editor: { id: editor.id, email: editorEmail },
    conceptFiles: concepts.map((concept) => concept.path),
    fileOf: (title) => files.get(title) ?? "",
  };
};

const exportsRegion = (page: Page): Locator => page.getByRole("region", { name: "Exports" });

const downloadNamed = (name: string): string => `${WORDS.download}${WORDS.ofThe(name)}`;

const downloadOf = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: downloadNamed(name) });

const statusOf = (page: Page): Locator => exportsRegion(page).getByRole("status");

const downloadedBy = async (page: Page, act: () => Promise<void>): Promise<Download> => {
  const [download] = await Promise.all([page.waitForEvent("download"), act()]);
  return download;
};

const savedTo = async (download: Download, testInfo: TestInfo): Promise<string> => {
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  return file;
};

const entriesOf = (zip: string): readonly string[] =>
  execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");

const entryOf = (zip: string, entry: string): string =>
  execFileSync("unzip", ["-p", zip, entry], { encoding: "utf8" });

test.describe("Exports", () => {
  test("an Admin downloads each export, and Editors cannot open Exports", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }, testInfo) => {
    test.slow();
    const at = await aWorkspaceToExport(request, "Teme Valley Surveys");

    await test.step("an Editor who owns a collection sees no Exports link and gets the not-found page", async () => {
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
              - link ${JSON.stringify(pageById(menuGroupIn(KNOWLEDGE, "browse"), "knowledge-base").name)}
          - heading "Curation" [level=3]
          - list:
            - listitem:
              - link ${JSON.stringify(pageById(menuGroupIn(KNOWLEDGE, "curation"), "all-knowledge").name)}
            - listitem:
              - link "${CONCEPT_TYPES_PAGE.name}"
            - listitem:
              - link ${JSON.stringify(pageById(menuGroupIn(KNOWLEDGE, "curation"), "collections-and-owners").name)}
      `);
      await page.goto(EXPORTS);
      await notFoundOfferingHome(page, "Editor");
      await signOutFromTheShell(page, EDITOR);
    });

    await signedIn(page, request, at.admin.email);
    await test.step("an Admin finds Exports under Curation", async () => {
      const menu = await knowledgeMenuOpened(page);
      await expect(menu.getByRole("link", { name: "Exports" })).toBeVisible();
    });

    const started = Date.now();
    await page.goto(EXPORTS);
    await expect(downloadOf(page, GUIDE)).toBeVisible();
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "exports", description: `${elapsed} ms` });
    expect(elapsed, "the exports took longer than the list time budget to render").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await expect(exportsRegion(page)).toMatchAriaSnapshot(`
      - region "Exports":
        - heading "Exports" [level=2]
        - status
        - list:
          - listitem "${KNOWLEDGE_BASE}":
            - heading "${KNOWLEDGE_BASE}" [level=3]
            - paragraph
            - button "${downloadNamed(KNOWLEDGE_BASE)}"
          - listitem "${RECORDS}":
            - heading "${RECORDS}" [level=3]
            - paragraph
            - button "${downloadNamed(RECORDS)}"
          - listitem "${GUIDE}":
            - heading "${GUIDE}" [level=3]
            - paragraph
            - combobox "${WORDS.guide.picker}":
              - option /Bid library/ [selected]
            - button "${downloadNamed(GUIDE)}"
    `);

    await test.step("lists the key for each download under ?", async () => {
      await skipLinkReachesThePage(page);
      await listsItsKeystrokes(page, "Exports", KEY, [
        KEY.knowledgeBase.action,
        KEY.records.action,
        KEY.guide.action,
      ]);
    });

    await test.step("an Admin reaches and starts each download by keyboard alone", async () => {
      const knowledgeBase = downloadOf(page, KNOWLEDGE_BASE);
      await tabUntilFocused(page, knowledgeBase);
      const snapshot = await downloadedBy(page, () => page.keyboard.press("Enter"));
      await expect(statusOf(page)).toContainText(snapshot.suggestedFilename());
      await expect(knowledgeBase, "focus left the button of the download that ran").toBeFocused();
      expect(snapshot.suggestedFilename()).toMatch(/^knowledge-base-\d{4}-\d{2}-\d{2}\.zip$/u);
      const snapshotZip = await savedTo(snapshot, testInfo);
      const snapshotFiles = entriesOf(snapshotZip);
      expect(snapshotFiles).toContain("knowledge/manifest.yaml");
      expect(snapshotFiles).toEqual(expect.arrayContaining([...at.conceptFiles]));
      expect(
        snapshotFiles.filter((file) => file.startsWith("guides/")),
        "the Knowledge Base Snapshot contains a guide",
      ).toEqual([]);
      expect(snapshotFiles.filter((file) => !file.startsWith("knowledge/"))).toEqual([]);
      expect(entryOf(snapshotZip, at.fileOf("Annual leave"))).toContain("25 days of leave");

      await page.keyboard.press("Tab");
      await expect(downloadOf(page, RECORDS)).toBeFocused();
      const records = await downloadedBy(page, () => page.keyboard.press("Enter"));
      await expect(statusOf(page)).toContainText(records.suggestedFilename());
      expect(entriesOf(await savedTo(records, testInfo)).toSorted()).toEqual([
        "owners.csv",
        "usage.csv",
        "verifications.csv",
      ]);

      await page.keyboard.press("Tab");
      await expect(exportsRegion(page).getByRole("combobox", { name: "Guide" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(downloadOf(page, GUIDE)).toBeFocused();
      const guide = await downloadedBy(page, () => page.keyboard.press("Enter"));
      await expect(statusOf(page)).toContainText(guide.suggestedFilename());
      expect(guide.suggestedFilename()).toMatch(/^guide-.+-\d{4}-\d{2}-\d{2}\.md$/u);
      const markdown = await savedTo(guide, testInfo);
      expect(readFileSync(markdown, "utf8")).toContain("Not maintained");
    });

    await test.step("starts each download with its own key", async () => {
      await page.getByRole("main").focus();
      const snapshot = await downloadedBy(page, () => page.keyboard.press(KEY.knowledgeBase.key));
      expect(snapshot.suggestedFilename()).toMatch(/\.zip$/u);
      const records = await downloadedBy(page, () => page.keyboard.press(KEY.records.key));
      expect(records.suggestedFilename()).toMatch(/\.zip$/u);
      const guide = await downloadedBy(page, () => page.keyboard.press(KEY.guide.key));
      expect(guide.suggestedFilename()).toMatch(/\.md$/u);
    });

    await test.step("does not use the word bundle", async () => {
      await expect(page.getByRole("main")).not.toContainText(/bundle/iu);
    });

    await passesTheAccessibilityGate();
  });
});
