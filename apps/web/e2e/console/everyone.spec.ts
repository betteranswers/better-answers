import type { Locator, Page } from "@playwright/test";

import { JUMP_TO } from "@/app/words.ts";
import { EVERYONE_WORDS } from "@/features/console/list-words.ts";
import { CORRECT_DISPLAY_NAME } from "@/features/console/names-waiting/correcting-words.ts";
import { PEOPLE_KEYSTROKES } from "@/features/console/people-keystrokes.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { CONSOLE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  keystrokesListed,
  person,
  signedInAsTheOperator,
  skipLinkReachesThePage,
} from "../harness.ts";
import { everyone, personButton, sheetOf } from "../people-pages.ts";

const LIST_BUDGET_MS = 1000;

const EVERYONE_PAGE = pageNamed(menuGroupIn(CONSOLE, "people"), "Everyone").path;

const thePage = (page: Page) => page.getByRole("main", { name: "Page" });

const outcomeOf = (list: Locator): Locator => list.locator("output:has(+ [role='alert'])");

const searchBox = (page: Page) =>
  everyone(page).getByRole("searchbox", { name: "Search by name or address" });

const personRows = (page: Page): Locator =>
  everyone(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

test.describe("the console's Everyone page", () => {
  test("works by keyboard and is announced as a table", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const operators = await signedInAsTheOperator(page, request);
    const { tag } = operators;
    await person(request, anAddress(`${tag}-priya`), { displayName: "Priya Shah" });

    await test.step("renders the list within one second", async () => {
      const started = Date.now();
      await page.goto(EVERYONE_PAGE);
      await expect(personRows(page).first()).toBeVisible();
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "everyone list", description: `${elapsed} ms` });
      expect(
        elapsed,
        "the first page of Everyone took longer than one second to render",
      ).toBeLessThan(LIST_BUDGET_MS);
    });

    await page.goto(`${EVERYONE_PAGE}?search=${tag}`);
    await expect(personRows(page)).toHaveCount(2);

    await expect(thePage(page)).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Everyone" [level=1]
        - region "Everyone":
          - heading "Everyone" [level=2]
          - status: /\\b2\\b/
          - searchbox "Search by name or address": ${tag}
          - table:
            - caption
            - rowgroup:
              - row ${JSON.stringify(Object.values(EVERYONE_WORDS.columns).join(" "))}:
                - columnheader "Person"
                - columnheader ${JSON.stringify(EVERYONE_WORDS.columns.workspacesAndRoles)}
                - columnheader ${JSON.stringify(EVERYONE_WORDS.columns.lastSignIn)}
            - rowgroup:
              - row /Priya Shah/:
                - cell /Priya Shah/:
                  - button "Priya Shah"
                - cell
                - cell
              - row /Test person/:
                - cell /Test person/:
                  - button "Test person"
                - cell "${operators.name} Admin":
                  - list:
                    - listitem: ${operators.name} Admin
                - cell /\\d{2}:\\d{2} · \\d{1,2} [A-Z][a-z]+ \\d{4}/
    `);
    await expect(
      everyone(page).getByText("Search by name or address", { exact: true }),
      "the search box has a separate visible label",
    ).toHaveCount(0);
    await passesTheAccessibilityGate();

    await skipLinkReachesThePage(page);
    await page.keyboard.press("o");
    await expect(outcomeOf(everyone(page))).toHaveText(/\S/);
    await expect(
      page.getByRole("dialog"),
      "o opened a dialog when no person had focus",
    ).toHaveCount(0);

    const listed = (await keystrokesListed(page, "Everyone")).getByRole("definition");
    await expect(listed).toHaveText([
      PEOPLE_KEYSTROKES.search.action,
      PEOPLE_KEYSTROKES.open.action,
      PEOPLE_KEYSTROKES.revoke.action,
      PEOPLE_KEYSTROKES.correct.action,
      PEOPLE_KEYSTROKES.previous.action,
      PEOPLE_KEYSTROKES.next.action,
      KEYSTROKE_WORDS.showTheList,
      JUMP_TO.name,
    ]);
    await page.keyboard.press("Escape");
    await expect(listed).toHaveCount(0);
    await expect(page.getByRole("button", { name: KEYSTROKE_WORDS.button })).toBeFocused();

    await page.keyboard.press(PEOPLE_KEYSTROKES.search.key);
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(searchBox(page)).toHaveValue("");
    await expect(
      searchBox(page),
      "focus left the search box after Escape cleared it",
    ).toBeFocused();
    await page.keyboard.type(`${tag}-priya`);
    await expect(personRows(page)).toHaveCount(1);

    const priya = personButton(page, "Priya Shah");
    await page.keyboard.press("Tab");
    await expect(priya, "Tab from the search did not reach the person").toBeFocused();
    await page.keyboard.press("o");
    await expect(sheetOf(page, "Priya Shah").getByRole("heading", { level: 2 })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(priya).toBeFocused();

    await page.keyboard.press("c");
    await expect(
      sheetOf(page, "Priya Shah").getByRole("button", { name: CORRECT_DISPLAY_NAME }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(priya).toBeFocused();
  });
});
