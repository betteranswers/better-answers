import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { JUMP_TO } from "@/app/words.ts";
import { NAMES_WAITING_WORDS } from "@/features/console/list-words.ts";
import { correctWords } from "@/features/console/names-waiting/correcting-words.ts";
import { NAMES_WAITING_KEYSTROKES } from "@/features/console/people-keystrokes.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { DISPLAY_NAME_WORDS } from "@/shared/member/display-name-words.ts";
import { CONSOLE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { CLEAR_WORDS } from "@/shared/words.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  countOf,
  flagTheName,
  keystrokesDismissed,
  keystrokesListed,
  person,
  provision,
  signedInAsTheOperator,
  skipLinkReachesThePage,
  tabUntilFocused,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const NAMES_WAITING_PAGE = pageById(menuGroupIn(CONSOLE, "people"), "flagged-names").path;

const INSTANT_WORDS = String.raw`\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}`;

const thePage = (page: Page) => page.getByRole("main", { name: "Page" });

const outcomeOf = (list: Locator): Locator => list.locator("output:has(+ [role='alert'])");

const correctionOf = (name: string): string => correctWords(name);

const dialogToCorrect = (page: Page, name: string): Locator =>
  page.getByRole("dialog", { name: correctionOf(name) });

const nameFieldOf = (dialog: Locator): Locator =>
  dialog.getByRole("textbox", { name: DISPLAY_NAME_WORDS.label });

const namesWaiting = (page: Page) =>
  page.getByRole("region", {
    name: pageById(menuGroupIn(CONSOLE, "people"), "flagged-names").name,
  });

const waitingCount = (page: Page): Locator => countOf(namesWaiting(page));

const waitingSearch = (page: Page): Locator =>
  namesWaiting(page).getByRole("searchbox", { name: "Search by name or workspace" });

const waitingRows = (page: Page): Locator =>
  namesWaiting(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

const waitingRowOf = (page: Page, name: string): Locator =>
  namesWaiting(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });

const correctButtonOf = (page: Page, name: string): Locator =>
  waitingRowOf(page, name).getByRole("button", { name: correctionOf(name) });

const priyaFlagged = async (page: Page, api: APIRequestContext) => {
  const operators = await signedInAsTheOperator(page, api);
  const name = `Priya Shah ${operators.tag}`;
  const priya = await person(api, anAddress(`${operators.tag}-priya`), { displayName: name });
  await addMember(api, { workspaceId: operators.workspaceId, userId: priya.id, role: "Editor" });
  await flagTheName(api, {
    workspaceId: operators.workspaceId,
    adminId: operators.admin.id,
    personId: priya.id,
  });
  return { operators, priya, name };
};

test.describe("the console's Flagged Names page", () => {
  test("lists each flagged name with every workspace that flagged it", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { operators, priya, name } = await priyaFlagged(page, request);
    const { tag } = operators;
    const beta = await provision(request, { name: `Beta ${tag}` });
    await addMember(request, { workspaceId: beta.workspaceId, userId: priya.id, role: "Viewer" });
    await flagTheName(request, {
      workspaceId: beta.workspaceId,
      adminId: beta.admin.id,
      personId: priya.id,
    });

    await test.step("renders the list within one second", async () => {
      const started = Date.now();
      await page.goto(NAMES_WAITING_PAGE);
      await expect(waitingRowOf(page, name)).toBeVisible();
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "names waiting list", description: `${elapsed} ms` });
      expect(elapsed, "Flagged Names took longer than one second to render").toBeLessThan(
        LIST_BUDGET_MS,
      );
    });

    await test.step("works by keyboard and lists its keyboard shortcuts", async () => {
      await skipLinkReachesThePage(page);
      await page.keyboard.press("c");
      await expect(outcomeOf(namesWaiting(page))).toHaveText(/\S/);
      await expect(
        page.getByRole("dialog"),
        "c opened a dialog when no name had focus",
      ).toHaveCount(0);
      const listed = await keystrokesListed(
        page,
        pageById(menuGroupIn(CONSOLE, "people"), "flagged-names").name,
      );
      await expect(listed.getByRole("definition")).toHaveText([
        NAMES_WAITING_KEYSTROKES.search.action,
        NAMES_WAITING_KEYSTROKES.correct.action,
        KEYSTROKE_WORDS.showTheList,
        JUMP_TO.name,
      ]);
      await keystrokesDismissed(page, listed);

      const correct = correctButtonOf(page, name);
      await tabUntilFocused(page, correct);
      await page.keyboard.press("c");
      const dialog = dialogToCorrect(page, name);
      await expect(nameFieldOf(dialog)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(correct).toBeFocused();
    });

    await test.step("filters by name or workspace and says when nothing matches", async () => {
      await page.keyboard.press(NAMES_WAITING_KEYSTROKES.search.key);
      await expect(waitingSearch(page)).toBeFocused();
      await page.keyboard.type(name.toUpperCase());
      await expect(waitingRows(page)).toHaveCount(1);
      await expect(waitingRowOf(page, name)).toBeVisible();
      await expect(waitingCount(page)).toHaveText(/\b1\b/);

      await waitingSearch(page).fill(operators.name);
      await expect(waitingRows(page)).toHaveCount(1);
      await expect(waitingRowOf(page, name)).toBeVisible();

      await waitingSearch(page).fill(`nobody ${tag}`);
      await expect(waitingCount(page)).toHaveText("");
      await expect(namesWaiting(page)).toContainText(
        NAMES_WAITING_WORDS.noneMatch(`nobody ${tag}`),
      );
      await expect(waitingRows(page)).toHaveCount(1);
      await expect(waitingRows(page).getByRole("button")).toHaveText([CLEAR_WORDS.search]);
      const narrowed = await waitingCount(page).innerText();
      await passesTheAccessibilityGate();

      await page.keyboard.press("Escape");
      await expect(waitingSearch(page)).toHaveValue("");
      await expect(
        waitingSearch(page),
        "focus left the search box after Escape cleared it",
      ).toBeFocused();
      await expect(waitingRowOf(page, name)).toBeVisible();
      await expect(
        waitingCount(page),
        "after Escape, the count still shows the filtered total",
      ).not.toHaveText(narrowed);
      await expect(waitingCount(page)).toHaveText(/\d/);
    });

    await waitingSearch(page).fill(name);
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(thePage(page)).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${JSON.stringify(pageById(menuGroupIn(CONSOLE, "people"), "flagged-names").name)} [level=1]
        - region ${JSON.stringify(pageById(menuGroupIn(CONSOLE, "people"), "flagged-names").name)}:
          - heading ${JSON.stringify(pageById(menuGroupIn(CONSOLE, "people"), "flagged-names").name)} [level=2]
          - status: /\\b1\\b/
          - searchbox "Search by name or workspace": ${JSON.stringify(name)}
          - table:
            - caption
            - rowgroup:
              - row ${JSON.stringify(Object.values(NAMES_WAITING_WORDS.columns).join(" "))}:
                - columnheader "Person"
                - columnheader ${JSON.stringify(NAMES_WAITING_WORDS.columns.flaggedBy)}
                - columnheader "Actions"
            - rowgroup:
              - row /${name}/:
                - cell "${name}"
                - cell:
                  - list:
                    - listitem: /^${operators.name} ${INSTANT_WORDS}$/
                    - listitem: /^Beta ${tag} ${INSTANT_WORDS}$/
                - cell:
                  - button ${JSON.stringify(correctionOf(name))}
    `);
  });
});
