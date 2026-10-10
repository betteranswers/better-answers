import type { Page } from "@playwright/test";

import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  contrastBetween,
  provision,
  signedInAtHome,
  skipLinkReachesThePage,
  tabOpenedByKeyboard,
  tokenColour,
  tokenPainted,
} from "./harness.ts";

/** WCAG 1.4.11: a focus indicator holds 3:1 against the colours next to it. */
const NON_TEXT_CONTRAST = 3;

/** More stops than either page has controls, so a walk reaches every one of them. */
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

/** A ring fades in, and read mid-fade it is the resting shadow. */
const focusSettled = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const running = document.activeElement?.getAnimations({ subtree: true }) ?? [];
    await Promise.all(
      running
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });

/** A part that draws its ring on an inner element, as the counted switch does, is read there. */
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

/** Every stop of a keyboard walk, until focus comes back round to the first. */
const walked = async (page: Page): Promise<readonly Drawn[]> => {
  const edge = await tokenColour(page, "--accent-600");
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

test("shows focus at 3:1 on every sign-in page control", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: SIGN_IN_WORDS.send })).toBeVisible();

  await holdsTheRing(page, await walked(page));
});

test("the primary button's ring holds 3:1 against its own fill", async ({ page }) => {
  await page.goto("/sign-in");
  const send = page.getByRole("button", { name: SIGN_IN_WORDS.send });
  await send.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(send).toBeFocused();
  await focusSettled(page);

  const drawn = await drawnFocus(page, await tokenColour(page, "--accent-600"));
  expect(drawn, "the primary button took no focus").toBeDefined();
  if (drawn === undefined) return;
  expect(
    contrastBetween(drawn.ring, drawn.fill),
    "the ring disappears into the primary fill",
  ).toBeGreaterThanOrEqual(NON_TEXT_CONTRAST);
});

test("draws the token's ring on every shell page control", async ({ page, request }) => {
  const email = anAddress("focus");
  await provision(request, { name: "Calder Joinery", adminEmail: email });
  await signedInAtHome(page, request, email);
  await page.goto(MEMBERS.path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await skipLinkReachesThePage(page);

  await holdsTheRing(page, await walked(page));
});

test("keeps one ring on the invitations' counted switch", async ({ page, request }) => {
  const email = anAddress("focus");
  await provision(request, { name: "Calder Glazing", adminEmail: email });
  await signedInAtHome(page, request, email);
  await tabOpenedByKeyboard(page, MEMBERS.path, "Invitations");
  await expect(page.getByRole("radiogroup").first()).toBeVisible();

  await holdsTheRing(page, await walked(page));
});
