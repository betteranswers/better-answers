import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { z } from "zod";

import type { CarriedOn } from "@/features/auth/sign-in/sign-in-words.ts";
import type { RefusalWord } from "@/shared/api/trpc.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";

import { actionAnnotationOf } from "./action-timing.ts";

export const avatarOf = (page: Page, who: string): Locator =>
  page.getByRole("banner").getByRole("button", { name: new RegExp(who) });

export const personMenuOpened = async (page: Page, who: string): Promise<Locator> => {
  await avatarOf(page, who).click();
  const menu = page.getByRole("menu", { name: new RegExp(who) });
  await expect(menu).toBeVisible();
  return menu;
};

export const signOutFromTheShell = async (page: Page, who: string): Promise<void> => {
  const menu = await personMenuOpened(page, who);
  await menu.getByRole("menuitem", { name: "Sign Out" }).click();
};

export const switcherOf = (page: Page, here: string): Locator =>
  page.getByRole("banner").getByRole("button", { name: here, exact: true });

export const switcherMenuOf = (page: Page, here: string): Locator =>
  page.getByRole("menu", { name: here });

export const switched = async (page: Page, from: string, to: string): Promise<void> => {
  await switcherOf(page, from).click();
  await switcherMenuOf(page, from).getByRole("menuitemradio").filter({ hasText: to }).click();
};

export const allWorkspacesPicked = async (page: Page, here: string): Promise<void> => {
  await switcherOf(page, here).click();
  await switcherMenuOf(page, here).getByRole("menuitem", { name: "All Workspaces" }).click();
};

export const railOf = (page: Page): Locator => page.getByRole("navigation", { name: "Areas" });

export const navOf = (page: Page, area: string): Locator =>
  page.getByRole("navigation", { name: area });

export const crumbOf = (page: Page, name: string): Locator =>
  page
    .getByRole("banner")
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name, exact: true });

export const countOf = (list: Locator): Locator => list.getByRole("status").first();

export const skipLinkReachesThePage = async (page: Page): Promise<void> => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the Page" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
};

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

export const signInHeading = (page: Page, carriedOn: CarriedOn | "nothing" = "nothing"): Locator =>
  page.getByRole("heading", { level: 1, name: SIGN_IN_HEADINGS[carriedOn], exact: true });

export const emailField = (page: Page): Locator => page.getByLabel("Email Address");

export const sendCodeButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Send Code" });

export const verificationCodeField = (page: Page): Locator =>
  page.getByLabel("Verification Code", { exact: true });

export const authenticatorCodeField = (page: Page): Locator =>
  page.getByLabel("Authenticator Code", { exact: true });

export const keystrokesListed = async (page: Page, named: string): Promise<Locator> => {
  await page.keyboard.press("?");
  const listed = page.getByRole("dialog", { name: `Keyboard Shortcuts on ${named}` });
  await expect(listed).toBeVisible();
  return listed;
};

export const keyListed = (keystrokes: Locator, key: string): Locator =>
  keystrokes.getByRole("term").getByText(key, { exact: true });

export const keystrokesButton = (within: Page | Locator): Locator =>
  within.getByRole("button", { name: "Keyboard Shortcuts", exact: true });

export const keystrokesDismissed = async (page: Page, listed: Locator): Promise<void> => {
  await page.keyboard.press("Escape");
  await expect(listed).toHaveCount(0);
  await expect(keystrokesButton(page)).toBeFocused();
};

export const A_ROLE = {
  Admin: "an Admin",
  Editor: "an Editor",
  Viewer: "a Viewer",
} as const satisfies Readonly<Record<Role, string>>;

const HOME_NAMES = {
  Admin: { heading: "People", link: "Go to Members" },
  Editor: { heading: "Ask", link: "Go to New Question" },
  Viewer: { heading: "Ask", link: "Go to New Question" },
} as const satisfies Readonly<Record<Role, { readonly heading: string; readonly link: string }>>;

export const landedAtHome = async (page: Page, role: Role): Promise<void> => {
  await expect(page).toHaveURL(new RegExp(`${HOMES[role].path}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: HOME_NAMES[role].heading }),
  ).toBeVisible();
};

export const notFoundOfferingHome = async (page: Page, role: Role): Promise<void> => {
  await expect(page.getByRole("heading", { level: 1, name: "Page Not Found" })).toBeVisible();
  await expect(page.getByRole("link", { name: HOME_NAMES[role].link })).toBeVisible();
};

const ACTION_BUDGET_MS = 100;

/** On CI the shared runner's processor sets the number, not the page, so there it is only recorded. */
const BUDGET_ASSERTED = !process.env["CI"];

const ANSWER_HELD_AT_MOST_MS = 2_000;

type Landed = { readonly at: string; readonly reads: string };

type TheServersAnswer = "held" | "sent";

const startTheClock = (page: Page, landed: Landed, answer: TheServersAnswer) =>
  page.evaluate(
    (asked) => {
      const reads = () =>
        document
          .evaluate(asked.at, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE)
          .singleNodeValue?.textContent?.includes(asked.reads) === true;
      const sent = window.fetch;
      const held: (() => void)[] = [];
      const released = () => {
        window.fetch = sent;
        for (const send of held.splice(0)) send();
      };
      const holdTheFetches = () => {
        window.fetch = (...request) =>
          new Promise<void>((send) => held.push(send)).then(() => sent(...request));
      };
      const clocked = new Promise((resolve) => {
        document.addEventListener(
          "keydown",
          () => {
            const pressedAt = performance.now();
            if (asked.answer === "held") holdTheFetches();
            const giveUp = setTimeout(() => {
              const waited = held.length > 0;
              released();
              if (!waited) return;
              observer.disconnect();
              resolve({ kind: "waited", heldMs: asked.heldAtMostMs, reads: asked.reads });
            }, asked.heldAtMostMs);
            const observer = new MutationObserver(() => {
              if (!reads()) return;
              observer.disconnect();
              clearTimeout(giveUp);
              released();
              resolve({ kind: "landed", ms: performance.now() - pressedAt });
            });
            observer.observe(document.body, {
              subtree: true,
              childList: true,
              characterData: true,
            });
          },
          { capture: true, once: true },
        );
      });
      Reflect.set(window, "actionClocked", clocked);
    },
    { ...landed, answer, heldAtMostMs: ANSWER_HELD_AT_MOST_MS },
  );

export const clockTheNextKey = (page: Page, landed: Landed) => startTheClock(page, landed, "held");

export const clockTheNextDraw = (page: Page, landed: Landed) => startTheClock(page, landed, "sent");

export const ACTION_SAMPLES = 5;

const CLOCKED = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("landed"), ms: z.number() }),
  z.object({ kind: z.literal("waited"), heldMs: z.number(), reads: z.string() }),
]);

export const actionClocked = async (page: Page): Promise<number> => {
  const clocked = CLOCKED.parse(
    await page.evaluate((): unknown => Reflect.get(window, "actionClocked")),
  );
  if (clocked.kind === "landed") return clocked.ms;
  throw new Error(
    `the page did not read ${JSON.stringify(clocked.reads)} while the server's answer was held for ${String(clocked.heldMs)} ms: the action waits on a round trip, or the page never reads it`,
  );
};

const medianOf = (samples: readonly number[]): number => {
  const sorted = samples.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? Number.NaN;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? Number.NaN) + upper) / 2;
};

export const theActionsLandedWithinTheirBudget = (
  action: string,
  samples: readonly number[],
): void => {
  expect(samples.length, `the ${action} was never clocked`).toBeGreaterThan(0);
  const median = medianOf(samples);
  test.info().annotations.push({
    type: actionAnnotationOf(action),
    description: `${samples.map((elapsed) => `${String(elapsed)} ms`).join(", ")}; median ${String(median)} ms`,
  });
  if (!BUDGET_ASSERTED) return;
  expect(median, `the ${action} did not read as landed within its budget`).toBeLessThan(
    ACTION_BUDGET_MS,
  );
};

export const theActionLandedWithinItsBudget = async (page: Page, action: string): Promise<void> => {
  theActionsLandedWithinTheirBudget(action, [await actionClocked(page)]);
};

export const saysARefusal = (
  alert: Locator,
  within?: { readonly timeout: number },
): Promise<void> => expect(alert, "the alert says nothing").toHaveText(/\S/, within);

export const saysOfItsRead = (list: Locator): Promise<void> =>
  expect(list.locator('[aria-live="polite"]'), "the list says nothing of its read").toHaveText(
    /\S/,
  );

export const saysSomethingNew = (region: Locator, earlier: string): Promise<void> =>
  expect
    .poll(
      async () => ["", earlier.trim()].includes((await region.innerText()).trim()),
      "the region says nothing, or only what it said before",
    )
    .toBe(false);

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

export const keepsItsWordOffThePage = (page: Page, word: RefusalWord): Promise<void> =>
  expect(page.locator("body"), `the page shows the word ${word}`).not.toContainText(word);

const KEY_IN_FOURS = /^[A-Z2-7]{4}(?: [A-Z2-7]{1,4})+$/;

export const keyShown = async (page: Page): Promise<string> =>
  (await page.getByText(KEY_IN_FOURS).innerText()).replaceAll(" ", "");

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

export const controlEdges = (page: Page): Promise<readonly ControlEdge[]> =>
  page.evaluate(() => {
    type Rgba = readonly [number, number, number, number];
    const SIDES = ["top", "right", "bottom", "left"] as const;
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
    const mixed = (top: Rgba, under: Rgba, share: number): Rgba => {
      const mix = (at: 0 | 1 | 2) => top[at] * share + under[at] * (1 - share);
      return [mix(0), mix(1), mix(2), 1];
    };
    const over = (top: Rgba, under: Rgba): Rgba => mixed(top, under, top[3]);
    const painted = ([red, green, blue]: Rgba) =>
      `rgb(${[red, green, blue].map((channel) => String(Math.round(channel))).join(", ")})`;
    const fillOf = (element: Element) => rgba(getComputedStyle(element).backgroundColor);
    const WHITE: Rgba = [255, 255, 255, 1];
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

export const requestsSent = (page: Page, matches: (url: URL) => boolean): Request[] => {
  const sent: Request[] = [];
  page.on("request", (request) => {
    if (matches(new URL(request.url()))) sent.push(request);
  });
  return sent;
};
