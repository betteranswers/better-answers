import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { GUIDE_KEYSTROKES as KEY, guidePageOf } from "@/features/knowledge/guides/guide-state.ts";
import { BRIEF_WORDS, GUIDE_WORDS } from "@/features/knowledge/guides/guide-words.ts";

import { expect, test } from "../browser.ts";
import {
  ACTION_SAMPLES,
  actionClocked,
  addMember,
  anAddress,
  clockTheNextKey,
  nameOwners,
  person,
  provision,
  seedGuide,
  signIn,
  skipLinkReachesThePage,
  medianActionWithinBudget,
  usageOf,
} from "../harness.ts";
import { listsItsKeystrokes } from "../knowledge.ts";

const LIST_BUDGET_MS = 1000;

const SAVED_BUDGET_MS = 1000;

const SECTIONS = [
  ["1", "Company overview"],
  ["2", "What we offer"],
  ["3", "Insurance and financial standing"],
  ["4", "Certifications"],
  ["5", "Data protection"],
  ["6", "Information security"],
  ["6.1", "Security testing"],
  ["7", "Support and service levels"],
] as const;

const FIRST_SECTION = "1. Company overview";

const INSURANCE = "3. Insurance and financial standing";

const INSURANCE_PROMPT = "Insurance and financial standing";

const COPIED_BUDGET_MS = 1000;

const REGISTRATION = "Registered company number";

const HEADCOUNT = "Staff headcount";

const PROFESSIONAL_INDEMNITY = "Professional indemnity policy";

const EMPLOYERS_LIABILITY = "Employers' liability insurance";

const STATUS_OF_THE_GUIDE = "//article//output";

const FOOTNOTE_CHIP = "sup[data-footnote-reference]";

const ON_A_MAC = process.platform === "darwin";

const START_OF_THE_BRIEF = ON_A_MAC ? "Meta+ArrowUp" : "Control+Home";

const END_OF_THE_BRIEF = ON_A_MAC ? "Meta+ArrowDown" : "Control+End";

type Member = { readonly id: string; readonly email: string; readonly name: string };

type Guided = {
  readonly path: string;
  readonly workspaceId: string;
  readonly writeUps: ReadonlyMap<string, string>;
  readonly admin: Member;
  readonly editor: Member;
  readonly viewer: Member;
};

const joinedAs = async (
  api: APIRequestContext,
  workspaceId: string,
  role: "Editor" | "Viewer",
  displayName: string,
): Promise<Member> => {
  const { id, email } = await person(api, anAddress(role.toLowerCase()), { displayName });
  await addMember(api, { workspaceId, userId: id, role });
  return { id, email, name: displayName };
};

const aWorkspaceWithAGuide = async (api: APIRequestContext, name: string): Promise<Guided> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const { workspaceId } = workspace;
  const editor = await joinedAs(api, workspaceId, "Editor", "Nadia Editor");
  const viewer = await joinedAs(api, workspaceId, "Viewer", "Victor Viewer");
  const admin = { id: workspace.admin.id, email: adminEmail, name: workspace.admin.name };
  const seeded = await seedGuide(api, {
    workspaceId,
    userId: admin.id,
    financeUserIds: [editor.id],
  });
  await nameOwners(api, {
    workspaceId,
    userId: admin.id,
    owners: [{ collection: "company", personId: admin.id }],
  });
  return {
    path: guidePageOf(seeded.guideId),
    workspaceId,
    writeUps: new Map(seeded.sections.map((section) => [section.prompt, section.writeUpId])),
    admin,
    editor,
    viewer,
  };
};

let seededOnce: Promise<Guided> | undefined;

const theGuide = (api: APIRequestContext): Promise<Guided> =>
  (seededOnce ??= aWorkspaceWithAGuide(api, "Tyne Libraries"));

const writeUpOf = (guided: Guided, prompt: string): string => {
  const found = guided.writeUps.get(prompt);
  if (found === undefined) throw new Error(`the seeded guide holds no section ${prompt}`);
  return found;
};

const signedIn = async (page: Page, api: APIRequestContext, member: Member): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, member.email);
};

const sectionOf = (page: Page, heading: string): Locator =>
  page.getByRole("region", { name: heading, exact: true });

const footnotesOf = (section: Locator): Locator =>
  section.getByRole("list", { name: "Footnotes" }).getByRole("listitem");

const chipsOf = (page: Page): Locator => page.locator(FOOTNOTE_CHIP);

const namesVersion = (version: number): RegExp => new RegExp(`\\b${String(version)}\\b`, "u");

const editorOpened = async (page: Page, section: Locator): Promise<Locator> => {
  await section.getByRole("button", { name: "Edit Brief" }).click();
  const text = page.getByRole("textbox", { name: "Brief of section 1" });
  await expect(text).toBeFocused();
  return text;
};

test.describe("the guide page", () => {
  test.describe.configure({ mode: "serial" });

  test("shows the seeded guide to an Editor", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    test.slow();
    const guided = await theGuide(request);
    await signedIn(page, request, guided.editor);

    const startedAtMs = Date.now();
    await page.goto(guided.path);
    await expect(
      page.getByRole("heading", { name: "7. Support and service levels" }),
    ).toBeVisible();
    const elapsedMs = Date.now() - startedAtMs;
    test.info().annotations.push({ type: "guide page", description: `${elapsedMs} ms` });
    expect(elapsedMs, "the guide took longer than its time budget to render").toBeLessThan(
      LIST_BUDGET_MS,
    );
    await skipLinkReachesThePage(page);

    await test.step("shows the eight sections in order, each with its trust status", async () => {
      const headings = SECTIONS.map(([number, prompt]) => `${number}. ${prompt}`);
      for (const heading of headings) await expect(sectionOf(page, heading)).toBeVisible();
      await expect(sectionOf(page, FIRST_SECTION)).toContainText("Unverified");
      await expect(sectionOf(page, INSURANCE)).toContainText("Verified by");
    });

    await test.step("numbers the first Brief's footnotes from 1, each linking to its concept", async () => {
      const notes = footnotesOf(sectionOf(page, FIRST_SECTION));
      await expect(notes).toHaveCount(4);
      await expect(notes.nth(0).getByRole("link", { name: REGISTRATION })).toBeVisible();
      await expect(notes.nth(1).getByRole("link", { name: HEADCOUNT })).toBeVisible();
    });

    await test.step("shows the missing fact, its owner, and an Add This Fact link", async () => {
      const insurance = sectionOf(page, INSURANCE);
      await expect(insurance).toContainText("3 of 4");
      const gap = insurance.getByText(EMPLOYERS_LIABILITY);
      await expect(gap).toBeVisible();
      await expect(insurance).toContainText(guided.admin.name);
      await expect(insurance.getByRole("link", { name: GUIDE_WORDS.addFact })).toBeVisible();
      await expect(
        insurance.getByRole("heading", { name: PROFESSIONAL_INDEMNITY }),
        "the Editor in finance cannot read the restricted concept in the section's Detail",
      ).toBeVisible();
    });

    await test.step("opens a section's Detail by keyboard and moves focus into it", async () => {
      const first = sectionOf(page, FIRST_SECTION);
      const show = first.getByRole("button", { name: GUIDE_WORDS.showDetail });
      await expect(show).toHaveAttribute("aria-expanded", "false");
      await show.focus();
      await page.keyboard.press("Enter");
      const detail = first.getByRole("region", { name: "Detail of section 1" });
      await expect(detail).toBeFocused();
      await expect(detail.getByRole("heading", { name: REGISTRATION })).toBeVisible();
      await page.keyboard.press(KEY.showDetail.key);
      await expect(detail).toHaveCount(0);
    });

    await listsItsKeystrokes(page, "Guides", KEY, [
      KEY.showDetail.action,
      KEY.addFact.action,
      KEY.editBrief.action,
      KEY.saveBrief.action,
      KEY.copyBrief.action,
    ]);
    await passesTheAccessibilityGate();
  });

  test("an Editor saves a Brief and sees the save confirmed", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    test.slow();
    const guided = await theGuide(request);
    await signedIn(page, request, guided.editor);
    await page.goto(guided.path);
    const first = sectionOf(page, FIRST_SECTION);
    await expect(first).toBeVisible();

    const status = page.locator(STATUS_OF_THE_GUIDE);
    const savedByKeystroke = async (): Promise<void> => {
      await page.keyboard.down("Control");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Control");
    };

    const opening = await editorOpened(page, first);
    await expect(chipsOf(page)).toHaveCount(4);
    await passesTheAccessibilityGate();
    await opening.press("Escape");
    await page.getByRole("button", { name: BRIEF_WORDS.close }).click();
    await expect(opening).toHaveCount(0);

    const acknowledged: number[] = [];
    const saved: number[] = [];
    for (let sample = 1; sample <= ACTION_SAMPLES; sample += 1) {
      const text = await editorOpened(page, first);
      await text.press(END_OF_THE_BRIEF);
      await page.keyboard.type(` Sample ${String(sample)}.`);

      await page.keyboard.down("Control");
      await clockTheNextKey(page, { at: STATUS_OF_THE_GUIDE, reads: "Saving the Brief." });
      await page.keyboard.press("Enter");
      await page.keyboard.up("Control");
      acknowledged.push(await actionClocked(page));

      const pressedAtMs = Date.now();
      await expect(status, "the status never named the new version").toContainText(
        namesVersion(sample + 2),
      );
      saved.push(Date.now() - pressedAtMs);
    }
    medianActionWithinBudget("save the Brief", acknowledged);
    test.info().annotations.push({ type: "brief saved", description: `${saved.join(", ")} ms` });
    expect(
      Math.max(...saved),
      "a saved version took longer than its time budget to appear",
    ).toBeLessThan(SAVED_BUDGET_MS);

    await test.step("saving an unchanged Brief keeps the same version", async () => {
      await editorOpened(page, first);
      const before = await status.innerText();
      await savedByKeystroke();
      await expect(status, "the status did not answer the unchanged save").not.toHaveText(before);
      await expect(status, "the unchanged save did not name the current version").toContainText(
        namesVersion(ACTION_SAMPLES + 2),
      );
      await page.getByRole("button", { name: BRIEF_WORDS.close }).click();
    });

    await test.step("an Editor cuts and pastes a footnote chip, and the new order stays after a reload", async () => {
      const text = await editorOpened(page, first);
      const labels = async () =>
        chipsOf(page).evaluateAll((chips) =>
          chips.map((chip) => chip.getAttribute("data-footnote-reference")),
        );
      const before = await labels();
      await text.press(START_OF_THE_BRIEF);
      await chipsOf(page).nth(0).click();
      await page.keyboard.press("ControlOrMeta+x");
      await chipsOf(page).nth(0).click();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ControlOrMeta+v");
      expect(await labels(), "the cut footnote chip did not move to after the next chip").toEqual([
        before[1],
        before[0],
        before[2],
        before[3],
      ]);
      await savedByKeystroke();
      await expect(
        status,
        "the save after the unchanged one did not make the next version",
      ).toContainText(namesVersion(ACTION_SAMPLES + 3));

      await page.reload();
      const notes = footnotesOf(sectionOf(page, FIRST_SECTION));
      await expect(notes.nth(0).getByRole("link", { name: HEADCOUNT })).toBeVisible();
      await expect(notes.nth(1).getByRole("link", { name: REGISTRATION })).toBeVisible();
    });

    await test.step("asks the Editor to confirm before they leave a Brief with unsaved changes", async () => {
      const again = await editorOpened(page, sectionOf(page, FIRST_SECTION));
      await again.press(END_OF_THE_BRIEF);
      await page.keyboard.type(" Not saved.");
      await page.getByRole("link", { name: "Knowledge Base" }).click();
      const ask = page.getByRole("alertdialog");
      await expect(ask).toBeVisible();
      await ask.getByRole("button", { name: BRIEF_WORDS.keepEditing }).click();
      await expect(ask).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${guided.path}$`));
    });
  });

  test("an Editor copies a Brief and sees the copy confirmed", async ({
    page,
    request,
    context,
    passesTheAccessibilityGate,
  }) => {
    test.slow();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const guided = await theGuide(request);
    const writeUpId = writeUpOf(guided, INSURANCE_PROMPT);
    const usage = async () =>
      (await usageOf(request, { workspaceId: guided.workspaceId, writeUpId })).usage;
    await signedIn(page, request, guided.editor);
    await page.goto(guided.path);
    const insurance = sectionOf(page, INSURANCE);
    await expect(insurance).toBeVisible();
    const before = (await usage()).length;
    const status = page.locator(STATUS_OF_THE_GUIDE);

    const acknowledged: number[] = [];
    const copied: number[] = [];
    for (let sample = 1; sample <= ACTION_SAMPLES; sample += 1) {
      await insurance.getByRole("button", { name: "Copy" }).focus();
      await clockTheNextKey(page, { at: STATUS_OF_THE_GUIDE, reads: "Copying section 3." });
      await page.keyboard.press(KEY.copyBrief.key);
      acknowledged.push(await actionClocked(page));

      const pressedAtMs = Date.now();
      await expect(status, "the copy confirmation did not count 4 footnotes").toContainText(
        /\b4\b/u,
      );
      copied.push(Date.now() - pressedAtMs);
    }
    medianActionWithinBudget("copy", acknowledged);
    test.info().annotations.push({ type: "brief copied", description: `${copied.join(", ")} ms` });
    expect(
      Math.max(...copied),
      "a copy confirmation took longer than its time budget to appear",
    ).toBeLessThan(COPIED_BUDGET_MS);

    await test.step("records one usage row per copy, with the version and the person who copied it", async () => {
      const rows = await usage();
      expect(rows).toHaveLength(before + ACTION_SAMPLES);
      expect(rows.at(-1)).toMatchObject({
        act: "copied",
        actor: `human:${guided.editor.id}`,
        writeUpId,
        version: 2,
        iri: null,
      });
    });

    await test.step("puts superscript footnotes and a Sources list in the copied HTML, and bracketed numbers in the copied plain text", async () => {
      const held = await page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        const textOf = async (type: string) => (await item?.getType(type))?.text();
        return { html: await textOf("text/html"), text: await textOf("text/plain") };
      });
      expect(held.html).toContain("<sup>4</sup>");
      expect(held.html).toContain("Sources");
      expect(held.text).toMatch(/\n\nSources\n\[1\] .+\n\[2\] .+\n\[3\] .+\n\[4\] .+$/u);
      expect(held.text).toContain("Source: Northgate company records, register entry.");
    });

    await test.step("pasting into a rich text field keeps the superscripts, and pasting into a plain text field keeps the brackets", async () => {
      await page.goto(guided.path);
      await page.setContent(
        '<div id="rich" contenteditable="true" style="min-height:4em"></div><textarea id="plain"></textarea>',
      );
      await page.locator("#rich").focus();
      await page.keyboard.press("ControlOrMeta+v");
      await page.locator("#plain").focus();
      await page.keyboard.press("ControlOrMeta+v");
      await expect(page.locator("#rich sup")).toHaveCount(4);
      await expect(page.locator("#rich ol li")).toHaveCount(4);
      await expect(page.locator("#plain")).toHaveValue(/\n\nSources\n\[1\] /u);
    });

    await page.goto(guided.path);
    await expect(sectionOf(page, INSURANCE)).toBeVisible();
    await passesTheAccessibilityGate();
  });

  test("withholds a section from a Viewer outside its audience", async ({ page, request }) => {
    test.slow();
    const guided = await theGuide(request);
    await signedIn(page, request, guided.viewer);
    await page.goto(guided.path);
    const first = sectionOf(page, FIRST_SECTION);
    await expect(first).toBeVisible();

    await test.step("a Viewer reads the first Brief and opens its Detail but sees no Edit Brief button", async () => {
      await expect(footnotesOf(first)).toHaveCount(4);
      await expect(page.getByRole("button", { name: "Edit Brief" })).toHaveCount(0);
      await first.getByRole("button", { name: GUIDE_WORDS.showDetail }).click();
      await expect(first.getByRole("region", { name: "Detail of section 1" })).toBeFocused();
    });

    await test.step("shows the insurance section's heading and coverage but not its text", async () => {
      const insurance = sectionOf(page, INSURANCE);
      await expect(insurance).toContainText("2 of 4");
      await expect(insurance.getByRole("list", { name: "Footnotes" })).toHaveCount(0);
      await expect(insurance.getByRole("button", { name: GUIDE_WORDS.showDetail })).toHaveCount(0);
      await expect(page.getByText(PROFESSIONAL_INDEMNITY)).toHaveCount(0);
    });

    await test.step("shows the Viewer no Copy button", async () => {
      await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
    });
  });
});
