import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { GUIDE_KEYSTROKES as KEY, guidePageOf } from "@/features/knowledge/guides/guide-state.ts";

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
  theActionsLandedWithinTheirBudget,
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
  return { path: guidePageOf(seeded.guideId), admin, editor, viewer };
};

let seededOnce: Promise<Guided> | undefined;

const theGuide = (api: APIRequestContext): Promise<Guided> =>
  (seededOnce ??= aWorkspaceWithAGuide(api, "Tyne Libraries"));

const signedIn = async (page: Page, api: APIRequestContext, member: Member): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, member.email);
};

const sectionOf = (page: Page, heading: string): Locator =>
  page.getByRole("region", { name: heading, exact: true });

const footnotesOf = (section: Locator): Locator =>
  section.getByRole("list", { name: "Footnotes" }).getByRole("listitem");

const chipsOf = (page: Page): Locator => page.locator(FOOTNOTE_CHIP);

const editorOpened = async (page: Page, section: Locator): Promise<Locator> => {
  await section.getByRole("button", { name: "Edit Brief" }).click();
  const text = page.getByRole("textbox", { name: "Brief of section 1" });
  await expect(text).toBeFocused();
  return text;
};

test.describe("the guide page", () => {
  test.describe.configure({ mode: "serial" });

  test("renders the seeded guide within its budget", async ({
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
    expect(elapsedMs, "the guide rendered past its budget").toBeLessThan(LIST_BUDGET_MS);
    await skipLinkReachesThePage(page);

    await test.step("shows eight sections in tree order, each with its trust word", async () => {
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

    await test.step("names the missing fact and its owner beside an action", async () => {
      const insurance = sectionOf(page, INSURANCE);
      await expect(insurance).toContainText("3 of 4");
      const gap = insurance.getByText(EMPLOYERS_LIABILITY);
      await expect(gap).toBeVisible();
      await expect(insurance).toContainText(guided.admin.name);
      await expect(insurance.getByRole("link", { name: "Add This Fact" })).toBeVisible();
      await expect(
        insurance.getByRole("heading", { name: PROFESSIONAL_INDEMNITY }),
        "the Editor in finance reads the restricted concept in the section's Detail",
      ).toBeVisible();
    });

    await test.step("opens the Detail of a section by keyboard, with focus inside it", async () => {
      const first = sectionOf(page, FIRST_SECTION);
      const show = first.getByRole("button", { name: "Show Detail" });
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
      "Show or Hide the Detail of the Section in Focus",
      "Add the Missing Fact of the Section in Focus",
      "Edit the Brief of the Section in Focus",
      "Save the Brief You Are Editing",
    ]);
    await passesTheAccessibilityGate();
  });

  test("acknowledges a Brief save within its budget", async ({
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
    await page.getByRole("button", { name: "Close editor" }).click();
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
      await expect(status).toContainText(`Saved version ${String(sample + 2)}`);
      saved.push(Date.now() - pressedAtMs);
    }
    theActionsLandedWithinTheirBudget("save the Brief", acknowledged);
    test.info().annotations.push({ type: "brief saved", description: `${saved.join(", ")} ms` });
    expect(Math.max(...saved), "a save was not shown within its budget").toBeLessThan(
      SAVED_BUDGET_MS,
    );

    await test.step("announces an unchanged save and writes no version", async () => {
      await editorOpened(page, first);
      await savedByKeystroke();
      await expect(status).toContainText(`Version ${String(ACTION_SAMPLES + 2)} stands`);
      await page.getByRole("button", { name: "Close editor" }).click();
    });

    await test.step("moves a footnote chip by keyboard, and a reload keeps it", async () => {
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
      expect(await labels(), "the cut chip did not move behind the next paragraph's").toEqual([
        before[1],
        before[0],
        before[2],
        before[3],
      ]);
      await savedByKeystroke();
      await expect(status).toContainText(`Saved version ${String(ACTION_SAMPLES + 3)}`);

      await page.reload();
      const notes = footnotesOf(sectionOf(page, FIRST_SECTION));
      await expect(notes.nth(0).getByRole("link", { name: HEADCOUNT })).toBeVisible();
      await expect(notes.nth(1).getByRole("link", { name: REGISTRATION })).toBeVisible();
    });

    await test.step("asks once before a section's draft is left", async () => {
      const again = await editorOpened(page, sectionOf(page, FIRST_SECTION));
      await again.press(END_OF_THE_BRIEF);
      await page.keyboard.type(" Not saved.");
      await page.getByRole("link", { name: "Knowledge Base" }).click();
      const ask = page.getByRole("alertdialog", {
        name: "You have changes to a Brief that are not saved.",
      });
      await expect(ask).toBeVisible();
      await ask.getByRole("button", { name: "Keep editing" }).click();
      await expect(ask).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${guided.path}$`));
    });
  });

  test("withholds a section from a Viewer outside its audience", async ({ page, request }) => {
    test.slow();
    const guided = await theGuide(request);
    await signedIn(page, request, guided.viewer);
    await page.goto(guided.path);
    const first = sectionOf(page, FIRST_SECTION);
    await expect(first).toBeVisible();

    await test.step("reads the first Brief and opens its Detail, with no way to edit", async () => {
      await expect(footnotesOf(first)).toHaveCount(4);
      await expect(page.getByRole("button", { name: "Edit Brief" })).toHaveCount(0);
      await first.getByRole("button", { name: "Show Detail" }).click();
      await expect(first.getByRole("region", { name: "Detail of section 1" })).toBeFocused();
    });

    await test.step("shows the insurance section's heading and coverage, never its text", async () => {
      const insurance = sectionOf(page, INSURANCE);
      await expect(insurance).toContainText("2 of 4");
      await expect(insurance.getByRole("list", { name: "Footnotes" })).toHaveCount(0);
      await expect(insurance.getByRole("button", { name: "Show Detail" })).toHaveCount(0);
      await expect(page.getByText(PROFESSIONAL_INDEMNITY)).toHaveCount(0);
    });
  });
});
