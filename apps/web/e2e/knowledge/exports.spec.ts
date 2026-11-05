import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { APIRequestContext, Download, Locator, Page, TestInfo } from "@playwright/test";

import { EXPORTS_KEYSTROKES as KEY } from "@/features/knowledge/curation/curation-state.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

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
  signIn,
  signOutFromTheShell,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "../harness.ts";
import { knowledgeMenuOpened, listsItsKeystrokes } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

const EXPORTS = pageNamed(CURATION, "Exports").path;

const EDITOR = "Ifan Morgan";

const KNOWLEDGE_BASE = "Knowledge Base Snapshot";

const RECORDS = "Records";

const GUIDE = "Guide Snapshot";

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

const signedIn = async (page: Page, api: APIRequestContext, member: Member): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, member.email);
};

const exportsRegion = (page: Page): Locator => page.getByRole("region", { name: "Exports" });

const downloadOf = (page: Page, name: string): Locator =>
  page.getByRole("button", { name: `Download the ${name}` });

const said = (page: Page): Locator => exportsRegion(page).getByRole("status").nth(1);

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
  test("an Admin downloads every export, an Editor finds none", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }, testInfo) => {
    test.slow();
    const at = await aWorkspaceToExport(request, "Teme Valley Surveys");

    await test.step("an Editor owning a collection finds no Exports", async () => {
      await signedIn(page, request, at.editor);
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
              - link "Kinds"
            - listitem:
              - link "Collections and Owners"
      `);
      await page.goto(EXPORTS);
      await notFoundOfferingHome(page, "Editor");
      await signOutFromTheShell(page, EDITOR);
    });

    await signedIn(page, request, at.admin);
    await test.step("an Admin finds Exports under Curation", async () => {
      const menu = await knowledgeMenuOpened(page);
      await expect(menu.getByRole("link", { name: "Exports" })).toBeVisible();
    });

    const started = Date.now();
    await page.goto(EXPORTS);
    await expect(downloadOf(page, GUIDE)).toBeVisible();
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "exports", description: `${elapsed} ms` });
    expect(elapsed, "the exports rendered past the list's budget").toBeLessThan(LIST_BUDGET_MS);

    await expect(exportsRegion(page)).toMatchAriaSnapshot(`
      - region "Exports":
        - heading "Exports" [level=2]
        - paragraph
        - status: /\\b3\\b/
        - status
        - list:
          - listitem "Knowledge Base Snapshot":
            - heading "Knowledge Base Snapshot" [level=3]
            - paragraph
            - button "Download the Knowledge Base Snapshot"
          - listitem "Records":
            - heading "Records" [level=3]
            - paragraph
            - button "Download the Records"
          - listitem "Guide Snapshot":
            - heading "Guide Snapshot" [level=3]
            - paragraph
            - combobox "Guide":
              - option /Bid library/ [selected]
            - button "Download the Guide Snapshot"
    `);

    await test.step("lists each download's keystroke under ?", async () => {
      await skipLinkReachesThePage(page);
      await listsItsKeystrokes(page, "Exports", KEY, [
        "Download the Knowledge Base Snapshot",
        "Download the Records",
        "Download the Guide Snapshot",
      ]);
    });

    await test.step("reaches and runs each download by keyboard alone", async () => {
      const knowledgeBase = downloadOf(page, KNOWLEDGE_BASE);
      await tabUntilFocused(page, knowledgeBase);
      const snapshot = await downloadedBy(page, () => page.keyboard.press("Enter"));
      await expect(said(page)).toContainText(snapshot.suggestedFilename());
      await expect(knowledgeBase, "focus left the download that ran").toBeFocused();
      expect(snapshot.suggestedFilename()).toMatch(/^knowledge-base-\d{4}-\d{2}-\d{2}\.zip$/u);
      const snapshotZip = await savedTo(snapshot, testInfo);
      const snapshotFiles = entriesOf(snapshotZip);
      expect(snapshotFiles).toContain("knowledge/manifest.yaml");
      expect(snapshotFiles).toEqual(expect.arrayContaining([...at.conceptFiles]));
      expect(
        snapshotFiles.filter((file) => file.startsWith("guides/")),
        "the snapshot carries a guide",
      ).toEqual([]);
      expect(snapshotFiles.filter((file) => !file.startsWith("knowledge/"))).toEqual([]);
      expect(entryOf(snapshotZip, at.fileOf("Annual leave"))).toContain("25 days of leave");

      await page.keyboard.press("Tab");
      await expect(downloadOf(page, RECORDS)).toBeFocused();
      const records = await downloadedBy(page, () => page.keyboard.press("Enter"));
      await expect(said(page)).toContainText(records.suggestedFilename());
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
      await expect(said(page)).toContainText(guide.suggestedFilename());
      expect(guide.suggestedFilename()).toMatch(/^guide-.+-\d{4}-\d{2}-\d{2}\.md$/u);
      const markdown = await savedTo(guide, testInfo);
      expect(readFileSync(markdown, "utf8")).toContain("Not maintained");
    });

    await test.step("runs each download on its own key", async () => {
      await page.getByRole("main").focus();
      const snapshot = await downloadedBy(page, () => page.keyboard.press(KEY.knowledgeBase.key));
      expect(snapshot.suggestedFilename()).toMatch(/\.zip$/u);
      const records = await downloadedBy(page, () => page.keyboard.press(KEY.records.key));
      expect(records.suggestedFilename()).toMatch(/\.zip$/u);
      const guide = await downloadedBy(page, () => page.keyboard.press(KEY.guide.key));
      expect(guide.suggestedFilename()).toMatch(/\.md$/u);
    });

    await test.step("never says bundle", async () => {
      await expect(page.getByRole("main")).not.toContainText(/bundle/iu);
    });

    await passesTheAccessibilityGate();
  });
});
