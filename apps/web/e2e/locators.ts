import { expect, test, type Locator, type Page } from "@playwright/test";

import { BREADCRUMB, goHome, RAIL, UNKNOWN_PAGE } from "@/app/words.ts";
import { SIGN_IN_WORDS, type CarriedOn } from "@/features/auth/sign-in-words.ts";
import type { RefusalWord } from "@/shared/api/trpc.ts";
import { KEYSTROKE_WORDS, keystrokesOn } from "@/shared/keystroke-words.ts";
import { headingOf, HOMES, type Role, type Area } from "@/shared/navigation.ts";
import { sentenceOf, type Said } from "@/shared/refusal-words.ts";

/** Named for the person, though it shows their initials alone. */
export const avatarOf = (page: Page, who: string): Locator =>
  page.getByRole("banner").getByRole("button", { name: new RegExp(who) });

/** The avatar shows initials alone, so the person's name and role are one disclosure in. */
export const personMenuOpened = async (page: Page, who: string): Promise<Locator> => {
  await avatarOf(page, who).click();
  const menu = page.getByRole("menu", { name: new RegExp(who) });
  await expect(menu).toBeVisible();
  return menu;
};

/** Sign-out is one disclosure in from the band, so a spec that leaves opens the menu first. */
export const signOutFromTheShell = async (page: Page, who: string): Promise<void> => {
  const menu = await personMenuOpened(page, who);
  await menu.getByRole("menuitem", { name: "Sign out" }).click();
};

/** Named for where the person is: the workspace they are reading, or the console. */
export const switcherOf = (page: Page, here: string): Locator =>
  page.getByRole("banner").getByRole("button", { name: here, exact: true });

export const switcherMenuOf = (page: Page, here: string): Locator =>
  page.getByRole("menu", { name: here });

export const railOf = (page: Page): Locator => page.getByRole("navigation", { name: RAIL });

/** The menu, named for the open area. */
export const navOf = (page: Page, area: Area): Locator =>
  page.getByRole("navigation", { name: area.name });

/** The current part is `role="link"` too, so a part that leads somewhere is told by its `href`. */
export const crumbOf = (page: Page, name: string): Locator =>
  page
    .getByRole("banner")
    .getByRole("navigation", { name: BREADCRUMB })
    .getByRole("link", { name, exact: true });

/** Needs a page with nothing focused yet, so the first Tab lands on the skip link. */
export const skipLinkReachesThePage = async (page: Page): Promise<void> => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the page" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
};

/**
 * `eachStop` runs after every press, the one landing on `target` too, but never for the start,
 * which no press reached.
 */
export const tabUntilFocused = async (
  page: Page,
  target: Locator,
  most = 40,
  eachStop: () => Promise<void> = async () => {},
): Promise<void> => {
  for (let pressed = 0; pressed < most; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
    await eachStop();
  }
  await expect(target, "Tab never reached it").toBeFocused();
};

/**
 * A fresh document, so the first Tab starts from the top. Each arrow lands before the next, or
 * the tab's navigation swallows the second.
 */
export const tabOpenedByKeyboard = async (page: Page, path: string, name: string) => {
  await page.goto(path);
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  await skipLinkReachesThePage(page);
  await tabUntilFocused(page, page.getByRole("tab", { selected: true }));

  const names = await tabs.allInnerTexts();
  const from = names.indexOf(await page.getByRole("tab", { selected: true }).innerText());
  for (let at = from + 1; at <= names.indexOf(name); at += 1) {
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(at)).toBeFocused();
  }
  await expect(page.getByRole("tab", { name }), `no tab ${name}`).toHaveAttribute(
    "aria-selected",
    "true",
  );
};

/** A role select in focus reading Viewer, opened, one step up to Editor and picked. */
export const editorPickedByKeyboard = async (page: Page, select: Locator): Promise<void> => {
  await expect(select).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Viewer" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("option", { name: "Editor" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(select).toBeFocused();
};

/** The email step's heading, read off its word table for what the sign-in carries on to. */
export const signInHeading = (page: Page, carriedOn: CarriedOn | "nothing" = "nothing"): Locator =>
  page.getByRole("heading", {
    level: 1,
    name: SIGN_IN_WORDS.emailStep[carriedOn].title,
    exact: true,
  });

/** Quoted as an aria snapshot's template takes a name or a line, so a table's words drop in. */
export const quoted = (words: string): string => JSON.stringify(words);

/**
 * `?` opens the keystrokes of the page `named`, as the navigation list names it, from anywhere on
 * it outside a field.
 */
export const keystrokesListed = async (page: Page, named: string): Promise<Locator> => {
  await page.keyboard.press("?");
  const listed = page.getByRole("dialog", { name: keystrokesOn(named) });
  await expect(listed).toBeVisible();
  return listed;
};

/** The one button opening the list: the rail's or the band's, or a page's outside the shell. */
export const keystrokesButton = (within: Page | Locator): Locator =>
  within.getByRole("button", { name: KEYSTROKE_WORDS.button, exact: true });

/** Focus lands back on the button a task after the list is gone, unless a key has moved it. */
export const keystrokesDismissed = async (page: Page, listed: Locator): Promise<void> => {
  await page.keyboard.press("Escape");
  await expect(listed).toHaveCount(0);
  await expect(keystrokesButton(page)).toBeFocused();
};

/** Read off the navigation list, so moving a role's home breaks no spec. */
export const landedAtHome = async (page: Page, role: Role): Promise<void> => {
  const home = HOMES[role];
  await expect(page).toHaveURL(new RegExp(`${home.path}$`));
  await expect(page.getByRole("heading", { level: 1, name: headingOf(home) })).toBeVisible();
};

/** A page hidden from the role says what an address that never existed says. */
export const notFoundOfferingHome = async (page: Page, role: Role): Promise<void> => {
  await expect(page.getByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading })).toBeVisible();
  await expect(page.getByRole("link", { name: goHome(HOMES[role]) })).toBeVisible();
};

const ACTION_BUDGET_MS = 100;

/**
 * Timed in the page, from the next key to the node at the XPath `at` reading `reads`: a matcher's
 * polling is coarser than the budget.
 */
export const clockTheNextKey = (
  page: Page,
  landed: { readonly at: string; readonly reads: string },
) =>
  page.evaluate((asked) => {
    const reads = () =>
      document
        .evaluate(asked.at, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE)
        .singleNodeValue?.textContent?.includes(asked.reads) === true;
    const clocked = new Promise<number>((resolve) => {
      document.addEventListener(
        "keydown",
        () => {
          const pressedAt = performance.now();
          const observer = new MutationObserver(() => {
            if (!reads()) return;
            observer.disconnect();
            resolve(performance.now() - pressedAt);
          });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        },
        { capture: true, once: true },
      );
    });
    Reflect.set(window, "actionClocked", clocked);
  }, landed);

/** Reads the clock `clockTheNextKey` started, so that call comes before the key it times. */
export const theActionLandedWithinItsBudget = async (page: Page, action: string): Promise<void> => {
  const elapsed = await page.evaluate(() => Reflect.get(window, "actionClocked"));
  test.info().annotations.push({ type: `${action} action`, description: `${elapsed} ms` });
  expect(elapsed, `the ${action} did not read as landed within its budget`).toBeLessThan(
    ACTION_BUDGET_MS,
  );
};

/** The word stays off the page: it is for the logs and the wire. */
export const saysItsSentenceNotItsWord = async <Word extends RefusalWord>(
  alert: Locator,
  refused: { readonly table: Readonly<Record<Word, Said>>; readonly word: Word },
): Promise<void> => {
  const { word } = refused;
  await expect(alert).toHaveText(sentenceOf(refused.table[word]));
  await expect(alert.page().locator("body"), `the page shows the word ${word}`).not.toContainText(
    word,
  );
};

/** The key in fours, as the page writes it out for typing into a phone. */
const KEY_IN_FOURS = /^[A-Z2-7]{4}(?: [A-Z2-7]{1,4})+$/;

/** An authenticator's key, read off the page as a person would type it into their phone. */
export const keyShown = async (page: Page): Promise<string> =>
  (await page.getByText(KEY_IN_FOURS).innerText()).replaceAll(" ", "");

/** A refused code's digits stay selected, so the next code typed replaces them. */
export const refusedDigitsSelected = async (field: Locator): Promise<void> => {
  const selected = await field.evaluate((input) =>
    input instanceof HTMLInputElement ? [input.selectionStart, input.selectionEnd] : [],
  );
  expect(selected, "the refused digits are not selected for retyping").toEqual([0, 6]);
};

/** A design-system token as the browser paints it, so a check compares like with like. */
export const tokenColour = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const painted = getComputedStyle(probe).color;
    probe.remove();
    return painted;
  }, token);
