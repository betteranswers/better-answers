import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { NAMES_WAITING_KEYSTROKES } from "@/features/console/people-keystrokes.ts";
import { CONSOLE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

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

const NAMES_WAITING_PAGE = pageNamed(menuGroupIn(CONSOLE, "people"), "Names Waiting").path;

const INSTANT_WORDS = String.raw`\d{2}:\d{2} · \d{1,2} [A-Z][a-z]+ \d{4}`;

const thePage = (page: Page) => page.getByRole("main", { name: "Page" });

const outcomeOf = (list: Locator): Locator => list.locator("output:has(+ [role='alert'])");

const correctionOf = (name: string): string => `Correct ${name}’s Display Name`;

const dialogToCorrect = (page: Page, name: string): Locator =>
  page.getByRole("dialog", { name: correctionOf(name) });

const nameFieldOf = (dialog: Locator): Locator =>
  dialog.getByRole("textbox", { name: "Display Name" });

const namesWaiting = (page: Page) => page.getByRole("region", { name: "Names Waiting" });

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

test.describe("the console's Names Waiting page", () => {
  test("lists each flagged name with its flags, within budget", async ({
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

    await test.step("renders the list within the constitution's latency budget", async () => {
      const started = Date.now();
      await page.goto(NAMES_WAITING_PAGE);
      await expect(waitingRowOf(page, name)).toBeVisible();
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "names waiting list", description: `${elapsed} ms` });
      expect(elapsed, "the names waiting rendered past their budget").toBeLessThan(LIST_BUDGET_MS);
    });

    await test.step("is keyboard-operable and lists its keystrokes", async () => {
      await skipLinkReachesThePage(page);
      await page.keyboard.press("c");
      await expect(outcomeOf(namesWaiting(page))).toHaveText(/\S/);
      await expect(page.getByRole("dialog"), "a name opened with none in focus").toHaveCount(0);
      const listed = await keystrokesListed(page, "Names Waiting");
      await expect(listed.getByRole("definition")).toHaveText([
        "Search the Names Waiting by Name or Workspace",
        "Correct the Display Name in Focus",
        "Show This List",
        "Jump To",
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

    await test.step("narrows by name or workspace, and says when none match", async () => {
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
      await expect(waitingCount(page)).toHaveText(/\b0\b/);
      await expect(waitingRows(page)).toHaveCount(1);
      await expect(waitingRows(page).getByRole("button")).toHaveText(["Clear Search"]);
      const narrowed = await waitingCount(page).innerText();
      await passesTheAccessibilityGate();

      await page.keyboard.press("Escape");
      await expect(waitingSearch(page)).toHaveValue("");
      await expect(
        waitingSearch(page),
        "Escape cleared the search and lost its place",
      ).toBeFocused();
      await expect(waitingRowOf(page, name)).toBeVisible();
      await expect(waitingCount(page), "the count still says what the search left").not.toHaveText(
        narrowed,
      );
      await expect(waitingCount(page)).toHaveText(/\d/);
    });

    await waitingSearch(page).fill(name);
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(thePage(page)).toMatchAriaSnapshot(`
      - main "Page":
        - heading "People" [level=1]
        - paragraph
        - region "Names Waiting":
          - heading "Names Waiting" [level=2]
          - paragraph
          - status: /\\b1\\b/
          - searchbox "Search by name or workspace": ${JSON.stringify(name)}
          - table:
            - caption
            - rowgroup:
              - row "Person Flagged By Actions":
                - columnheader "Person"
                - columnheader "Flagged By"
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
