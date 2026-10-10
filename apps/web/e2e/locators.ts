import { expect, test, type Locator, type Page } from "@playwright/test";
import { z } from "zod";

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

/** A deployment whose page and published resource differ fails here. */
export const askShowsTheServedAddress = async (page: Page): Promise<string> => {
  const answer = await page.request.get("/.well-known/oauth-protected-resource/mcp");
  expect(answer.ok(), `the protected-resource document answered ${answer.status()}`).toBe(true);
  const { resource } = z.object({ resource: z.string() }).parse(await answer.json());
  await expect(page.getByRole("main").getByText(resource, { exact: true })).toBeVisible();
  return resource;
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

/** A design-system token as the browser paints it in a property, so a check compares like with like. */
export const tokenPainted = (page: Page, token: string, property: string): Promise<string> =>
  page.evaluate(
    ([name, painted]) => {
      const probe = document.createElement("span");
      probe.style.setProperty(painted, `var(${name})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(painted);
      probe.remove();
      return value;
    },
    [token, property] as const,
  );

export const tokenColour = (page: Page, token: string): Promise<string> =>
  tokenPainted(page, token, "color");

/** The registration marks a person sees, by their part: a mark inside a marked parent is never drawn. */
export const drawnMarks = (page: Page): Promise<readonly string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-marks]")]
      .filter(
        (marked) =>
          marked.checkVisibility() && getComputedStyle(marked, "::before").content !== "none",
      )
      .map((marked) => marked.dataset["slot"] ?? marked.tagName.toLowerCase()),
  );

const channels = (colour: string): readonly number[] => {
  const parts = /rgba?\(([^)]+)\)/
    .exec(colour)?.[1]
    ?.split(/[ ,/]+/)
    .map(Number);
  if (parts === undefined || parts.length < 3) throw new Error(`not an rgb() colour: ${colour}`);
  return parts.slice(0, 3);
};

const luminance = (colour: string): number => {
  const [red = 0, green = 0, blue = 0] = channels(colour).map((channel) => {
    const share = channel / 255;
    return share <= 0.040_45 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

/** WCAG's contrast ratio between two painted `rgb()` colours, as a browser reports them. */
export const contrastBetween = (one: string, other: string): number => {
  const [lighter, darker] = [luminance(one), luminance(other)].toSorted((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
};

export type ControlEdge = {
  readonly control: string;
  readonly edges: readonly string[];
  readonly fill: string;
  readonly behind: string;
};

/** A see-through `rgba()` colour as it paints over an opaque one. */
export const paintedOver = (top: string, under: string): string => {
  const [alpha = 1] = (/rgba\([^)]*?([\d.]+)\)$/.exec(top)?.slice(1) ?? []).map(Number);
  const below = channels(under);
  const mixed = channels(top).map((channel, at) =>
    Math.round(channel * alpha + (below[at] ?? 0) * (1 - alpha)),
  );
  return `rgb(${mixed.join(", ")})`;
};

/** A wordless wrapper draws a field's edge too; a checkbox, radio or switch with words is found by them. */
export const controlEdges = (page: Page): Promise<readonly ControlEdge[]> =>
  page.evaluate(() => {
    type Rgba = readonly [number, number, number, number];
    // A computed colour can be `oklab()` or `color()`, which Tailwind's `/50` writes; a canvas reads any.
    const pixel = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    const rgba = (colour: string): Rgba => {
      if (pixel === null) throw new Error("the page has no canvas to read a colour with");
      pixel.clearRect(0, 0, 1, 1);
      pixel.fillStyle = colour;
      pixel.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0, alpha = 0] = pixel.getImageData(0, 0, 1, 1).data;
      return [red, green, blue, alpha / 255];
    };
    const over = (top: Rgba, under: Rgba): Rgba => {
      const mix = (at: 0 | 1 | 2) => top[at] * top[3] + under[at] * (1 - top[3]);
      return [mix(0), mix(1), mix(2), 1];
    };
    const painted = ([red, green, blue]: Rgba) =>
      `rgb(${[red, green, blue].map((channel) => String(Math.round(channel))).join(", ")})`;
    const fillOf = (element: Element) => rgba(getComputedStyle(element).backgroundColor);
    const canvas = over(fillOf(document.documentElement), [255, 255, 255, 1]);
    const behind = (node: Element | null): Rgba => {
      const layers: Rgba[] = [];
      for (let at = node; at !== null && layers.at(-1)?.[3] !== 1; at = at.parentElement) {
        if (fillOf(at)[3] > 0) layers.push(fillOf(at));
      }
      return layers.toReversed().reduce((under, layer) => over(layer, under), canvas);
    };
    const sidesOf = (element: Element, fill: Rgba): string[] => {
      const style = getComputedStyle(element);
      return ["top", "right", "bottom", "left"]
        .filter((side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0)
        .map((side) => painted(over(rgba(style.getPropertyValue(`border-${side}-color`)), fill)));
    };
    const words = (element: Element) => element.textContent.trim();
    const seen = (control: HTMLElement): boolean =>
      control.getBoundingClientRect().width > 1 &&
      control.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
      control.closest("[aria-hidden=true], [inert]") === null &&
      !control.matches(":disabled, [aria-disabled=true], [data-disabled]");
    const nameOf = (control: HTMLElement) => {
      const label = control instanceof HTMLInputElement ? control.labels?.[0]?.textContent : null;
      const named =
        control.getAttribute("aria-label") ?? label ?? control.getAttribute("placeholder");
      const role = control.getAttribute("role");
      return `${control.tagName.toLowerCase()}${role === null ? "" : `[role=${role}]`} "${(named ?? "").trim()}"`;
    };
    const measured = (control: HTMLElement) => {
      const parent = control.parentElement;
      const wrapper =
        parent !== null && parent !== document.body && words(parent) === words(control)
          ? parent
          : undefined;
      const back = behind((wrapper ?? control).parentElement);
      const wrapperFill = wrapper === undefined ? back : over(fillOf(wrapper), back);
      const fill = over(fillOf(control), wrapperFill);
      const wrapperSides = wrapper === undefined ? [] : sidesOf(wrapper, wrapperFill);
      return {
        control: nameOf(control),
        edges: [...sidesOf(control, fill), ...wrapperSides],
        fill: painted(fill),
        behind: painted(back),
      };
    };
    const BY_EDGE =
      "input:not([type=hidden], [type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=image], [type=file], [type=range], [type=color]), textarea, select, [role=combobox]";
    const BY_EDGE_UNLESS_WORDED =
      "input[type=checkbox], input[type=radio], [role=checkbox], [role=radio], [role=switch]";
    return [
      ...document.querySelectorAll<HTMLElement>(BY_EDGE),
      ...[...document.querySelectorAll<HTMLElement>(BY_EDGE_UNLESS_WORDED)].filter(
        (control) => words(control) === "",
      ),
    ]
      .filter(seen)
      .map(measured);
  });
