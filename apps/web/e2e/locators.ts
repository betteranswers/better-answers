import { expect, test, type Locator, type Page } from "@playwright/test";
import { z } from "zod";

import type { CarriedOn } from "@/features/auth/sign-in-words.ts";
import type { RefusalWord } from "@/shared/api/trpc.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";

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
  await menu.getByRole("menuitem", { name: "Sign Out" }).click();
};

/** Named for where the person is: the workspace they are reading, or the console. */
export const switcherOf = (page: Page, here: string): Locator =>
  page.getByRole("banner").getByRole("button", { name: here, exact: true });

export const switcherMenuOf = (page: Page, here: string): Locator =>
  page.getByRole("menu", { name: here });

/** Picks `to` in the switcher's menu and waits for nothing, so a spec meets the switch pending. */
export const switched = async (page: Page, from: string, to: string): Promise<void> => {
  await switcherOf(page, from).click();
  await switcherMenuOf(page, from).getByRole("menuitemradio").filter({ hasText: to }).click();
};

/** The switcher's way to the picker, which lists every workspace the person is in. */
export const allWorkspacesPicked = async (page: Page, here: string): Promise<void> => {
  await switcherOf(page, here).click();
  await switcherMenuOf(page, here).getByRole("menuitem", { name: "All Workspaces" }).click();
};

export const railOf = (page: Page): Locator => page.getByRole("navigation", { name: "Areas" });

/** The menu, named for the open area. */
export const navOf = (page: Page, area: string): Locator =>
  page.getByRole("navigation", { name: area });

/** The current part is `role="link"` too, so a part that leads somewhere is told by its `href`. */
export const crumbOf = (page: Page, name: string): Locator =>
  page
    .getByRole("banner")
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name, exact: true });

/** A list's count is its head's, so it is the first status its region holds. */
export const countOf = (list: Locator): Locator => list.getByRole("status").first();

/** Needs a page with nothing focused yet, so the first Tab lands on the skip link. */
export const skipLinkReachesThePage = async (page: Page): Promise<void> => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the Page" })).toBeFocused();
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

const SIGN_IN_HEADINGS = {
  nothing: "Sign In",
  joining: "Sign In to Join a Workspace",
  connecting: "Sign In to Connect Claude",
} as const satisfies Readonly<Record<CarriedOn | "nothing", string>>;

/** The email step's heading, for what the sign-in carries on to. */
export const signInHeading = (page: Page, carriedOn: CarriedOn | "nothing" = "nothing"): Locator =>
  page.getByRole("heading", { level: 1, name: SIGN_IN_HEADINGS[carriedOn], exact: true });

/**
 * `?` opens the keystrokes of the page `named`, as the navigation list names it, from anywhere on
 * it outside a field.
 */
export const keystrokesListed = async (page: Page, named: string): Promise<Locator> => {
  await page.keyboard.press("?");
  const listed = page.getByRole("dialog", { name: `Keyboard Shortcuts on ${named}` });
  await expect(listed).toBeVisible();
  return listed;
};

/** A keystroke's key in the open list, which sets each action beside its key. */
export const keyListed = (keystrokes: Locator, key: string): Locator =>
  keystrokes.getByRole("term").getByText(key, { exact: true });

/** The one button opening the list: the rail's or the band's, or a page's outside the shell. */
export const keystrokesButton = (within: Page | Locator): Locator =>
  within.getByRole("button", { name: "Keyboard Shortcuts", exact: true });

/** Focus lands back on the button a task after the list is gone, unless a key has moved it. */
export const keystrokesDismissed = async (page: Page, listed: Locator): Promise<void> => {
  await page.keyboard.press("Escape");
  await expect(listed).toHaveCount(0);
  await expect(keystrokesButton(page)).toBeFocused();
};

/** The article a role takes in a test's title. */
export const A_ROLE = {
  Admin: "an Admin",
  Editor: "an Editor",
  Viewer: "a Viewer",
} as const satisfies Readonly<Record<Role, string>>;

/** A role's home: its page's first heading, and the link the not-found page offers back to it. */
const HOME_NAMES = {
  Admin: { heading: "People", link: "Go to Members" },
  Editor: { heading: "Ask", link: "Go to Ask" },
  Viewer: { heading: "Ask", link: "Go to Ask" },
} as const satisfies Readonly<Record<Role, { readonly heading: string; readonly link: string }>>;

/** The address is read off the navigation list, so moving a role's home moves it here. */
export const landedAtHome = async (page: Page, role: Role): Promise<void> => {
  await expect(page).toHaveURL(new RegExp(`${HOMES[role].path}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: HOME_NAMES[role].heading }),
  ).toBeVisible();
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
  await expect(page.getByRole("heading", { level: 1, name: "Page Not Found" })).toBeVisible();
  await expect(page.getByRole("link", { name: HOME_NAMES[role].link })).toBeVisible();
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

/** A refusal's region can stand empty from the first draw, so it shows one only once it holds words. */
export const saysARefusal = (
  alert: Locator,
  within?: { readonly timeout: number },
): Promise<void> => expect(alert, "the alert says nothing").toHaveText(/\S/, within);

/** A list says its read in a live region no role names, apart from its head's standing words. */
export const saysOfItsRead = (list: Locator): Promise<void> =>
  expect(list.locator('[aria-live="polite"]'), "the list says nothing of its read").toHaveText(
    /\S/,
  );

/** A status or an alert already saying something shows the next only by saying something else. */
export const saysSomethingNew = (region: Locator, earlier: string): Promise<void> =>
  expect
    .poll(
      async () => ["", earlier.trim()].includes((await region.innerText()).trim()),
      "the region says nothing, or only what it said before",
    )
    .toBe(false);

/** Said in whole minutes, rounded up, and matched by their number. A wait never named fails. */
export const saysTheWait = async (
  alert: Locator,
  waitSeconds: number | undefined,
): Promise<void> => {
  const minutes = Math.ceil((waitSeconds ?? 0) / 60);
  expect(minutes, "the ceiling's answer named no wait").toBeGreaterThan(0);
  await expect(alert, `the alert does not say a wait of ${String(minutes)} minutes`).toHaveText(
    new RegExp(String.raw`\b${String(minutes)}\b`),
  );
};

/** The word stays off the page: it is for the logs and the wire. */
export const keepsItsWordOffThePage = (page: Page, word: RefusalWord): Promise<void> =>
  expect(page.locator("body"), `the page shows the word ${word}`).not.toContainText(word);

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

/**
 * A wordless wrapper hugging a field lends its fill and hugging sides; a worded checkbox, radio or
 * switch goes by its words. Opacity is composited.
 */
export const controlEdges = (page: Page): Promise<readonly ControlEdge[]> =>
  page.evaluate(() => {
    type Rgba = readonly [number, number, number, number];
    const SIDES = ["top", "right", "bottom", "left"] as const;
    /** A row's rule runs this close to its field; a layout's border stands off by its padding. */
    const HUGS_WITHIN_PX = 8;
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
    /** `share` of `top` over the rest of `under`, which is opaque. */
    const mixed = (top: Rgba, under: Rgba, share: number): Rgba => {
      const mix = (at: 0 | 1 | 2) => top[at] * share + under[at] * (1 - share);
      return [mix(0), mix(1), mix(2), 1];
    };
    const over = (top: Rgba, under: Rgba): Rgba => mixed(top, under, top[3]);
    const painted = ([red, green, blue]: Rgba) =>
      `rgb(${[red, green, blue].map((channel) => String(Math.round(channel))).join(", ")})`;
    const fillOf = (element: Element) => rgba(getComputedStyle(element).backgroundColor);
    const WHITE: Rgba = [255, 255, 255, 1];
    /**
     * `layers` on `element` as shown: a dimmed ancestor shows its share of all painted inside it,
     * and what was behind it for the rest.
     */
    const shownThrough = (element: Element | null, layers: readonly Rgba[]): Rgba => {
      const down: Element[] = [];
      for (let at = element; at !== null; at = at.parentElement) down.unshift(at);
      const from = (depth: number, under: Rgba): Rgba => {
        const at = down[depth];
        if (at === undefined) return layers.reduce((below, layer) => over(layer, below), under);
        const inside = from(depth + 1, over(fillOf(at), under));
        return mixed(inside, under, Number(getComputedStyle(at).opacity));
      };
      return from(0, WHITE);
    };
    type Side = (typeof SIDES)[number];
    const sidesHugging = (field: Element, around: Element): readonly Side[] => {
      const own = field.getBoundingClientRect();
      const box = around.getBoundingClientRect();
      return SIDES.filter((side) => Math.abs(box[side] - own[side]) < HUGS_WITHIN_PX);
    };
    /** Those of `sides` that `element` draws. */
    const sidesOf = (element: Element, sides: readonly Side[] = SIDES): string[] => {
      const style = getComputedStyle(element);
      return sides
        .filter((side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0)
        .map((side) =>
          painted(shownThrough(element, [rgba(style.getPropertyValue(`border-${side}-color`))])),
        );
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
      const wordless =
        parent !== null && parent !== document.body && words(parent) === words(control)
          ? parent
          : undefined;
      const hugged = wordless === undefined ? [] : sidesHugging(control, wordless);
      // A wordless parent no side of which hugs is a layout box: the field is measured against it.
      const wrapper = hugged.length > 0 ? wordless : undefined;
      return {
        control: nameOf(control),
        edges: [...sidesOf(control), ...(wrapper === undefined ? [] : sidesOf(wrapper, hugged))],
        fill: painted(shownThrough(control, [])),
        behind: painted(shownThrough((wrapper ?? control).parentElement, [])),
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
