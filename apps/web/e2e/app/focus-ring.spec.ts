import type { Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { THEME_KEPT_UNDER } from "@/shared/theme/theme-switch.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  contrastBetween,
  provision,
  signedInAtHome,
  skipLinkReachesThePage,
  tokenPainted,
} from "../harness.ts";

const NON_TEXT_CONTRAST = 3;

const STOPS = 60;

const MEMBERS = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members");

type Drawn = {
  readonly again: boolean;
  readonly rings: number;
  readonly name: string;
  readonly shadow: string;
  readonly ring: string;
  readonly edge: string;
  readonly fill: string;
  readonly behind: string;
};

const focusSettled = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const running = document.activeElement?.getAnimations({ subtree: true }) ?? [];
    await Promise.all(
      running
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });

const drawnFocus = (page: Page, edge: string): Promise<Drawn | undefined> =>
  page.evaluate((inked) => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return undefined;
    // A browser reports an opaque colour as `rgb()`, and anything see-through as `rgba()`.
    const opaque = (colour: string) => !colour.startsWith("rgba");
    const surfaceBehind = (element: HTMLElement) => {
      let parent = element.parentElement;
      while (parent !== null && !opaque(getComputedStyle(parent).backgroundColor)) {
        parent = parent.parentElement;
      }
      return parent === null ? "rgb(255, 255, 255)" : getComputedStyle(parent).backgroundColor;
    };
    // A ring is the element whose shadow carries the ink edge; a utility pads it with clear layers.
    const ringed = [focused, ...focused.querySelectorAll<HTMLElement>("*")].filter((element) =>
      getComputedStyle(element).boxShadow.includes(inked),
    );
    const drawing = ringed[0] ?? focused;
    const shadow = getComputedStyle(drawing)
      .boxShadow.split(/,(?![^(]*\))\s*/)
      .filter((layer) => !layer.startsWith("rgba(0, 0, 0, 0)"))
      .join(", ");
    const layers = (painted: string) => {
      const colours = painted.match(/rgba?\([^)]+\)/g) ?? [];
      return { ring: colours[0] ?? "", edge: colours.at(-1) ?? "" };
    };
    const behind = surfaceBehind(drawing);
    const own = getComputedStyle(drawing).backgroundColor;
    const fill = [own, behind].find(opaque);
    const again = focused.dataset["focusWalked"] === "";
    focused.dataset["focusWalked"] = "";
    const label = focused.getAttribute("aria-label") ?? focused.textContent;
    return {
      again,
      rings: ringed.length,
      name: `${focused.tagName.toLowerCase()} "${label.trim().slice(0, 40)}"`,
      shadow,
      ...layers(shadow),
      fill: fill ?? behind,
      behind,
    };
  }, edge);

const inkOf = async (page: Page): Promise<string> =>
  (await tokenPainted(page, "--focus-ring", "box-shadow")).match(/rgba?\([^)]+\)/g)?.at(-1) ?? "";

const inTheDark = (page: Page) =>
  page.addInitScript((key) => {
    localStorage.setItem(key, "dark");
  }, THEME_KEPT_UNDER);

const withNoThemeKept = (_page: Page): Promise<void> => Promise.resolve();

const walked = async (page: Page): Promise<readonly Drawn[]> => {
  const edge = await inkOf(page);
  const seen: Drawn[] = [];
  for (let stop = 0; stop < STOPS; stop += 1) {
    await page.keyboard.press("Tab");
    await focusSettled(page);
    const drawn = await drawnFocus(page, edge);
    if (drawn?.again === true) return seen;
    if (drawn !== undefined) seen.push(drawn);
  }
  throw new Error(
    `focus never came back round in ${String(STOPS)} stops, so the controls past them were never measured`,
  );
};

const holdsTheRing = async (page: Page, stops: readonly Drawn[]): Promise<void> => {
  const token = await tokenPainted(page, "--focus-ring", "box-shadow");
  expect(stops.length, "the walk reached no control").toBeGreaterThan(2);
  for (const stop of stops) {
    expect(stop.rings, `${stop.name} draws ${String(stop.rings)} rings`).toBe(1);
    expect(stop.shadow, `${stop.name} draws a ring that is not the token's`).toBe(token);
    const edge = contrastBetween(stop.edge, stop.behind);
    test
      .info()
      .annotations.push({ type: "focus edge", description: `${stop.name}: ${edge.toFixed(2)}:1` });
    expect(edge, `${stop.name}'s focus edge on ${stop.behind}`).toBeGreaterThanOrEqual(
      NON_TEXT_CONTRAST,
    );
  }
};

for (const [theme, themeKept] of [
  ["", withNoThemeKept],
  [" dark", inTheDark],
] as const) {
  test(`draws the token's${theme} ring on every shell page control`, async ({ page, request }) => {
    await themeKept(page);
    const email = anAddress("focus");
    await provision(request, { name: "Calder Joinery", adminEmail: email });
    await signedInAtHome(page, request, email);
    await page.goto(MEMBERS.path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await skipLinkReachesThePage(page);

    await holdsTheRing(page, await walked(page));
  });
}
