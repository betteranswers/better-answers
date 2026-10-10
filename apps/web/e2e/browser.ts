import { AxeBuilder } from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

import { holdTitle } from "@better-answers/schema/testing/test-title";

import { contrastBetween, controlEdges, drawnMarks } from "./locators.ts";

let issued = 0;

/** `CLIENT_IP_HEADER`, named not imported: `apps/web` takes nothing from `apps/api` at runtime. */
const CLIENT_IP_HEADER = "cf-connecting-ip";

/**
 * RFC 2544's benchmarking block. A caller with no address shares the bucket Better Auth warns of.
 */
const anAddress = (workerIndex: number): string => {
  issued += 1;
  return `198.18.${workerIndex % 250}.${issued % 250}`;
};

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Axe reads colours mid-fade, which no one settles on. A spinner never ends, so an endless
 * animation is audited running.
 */
const transitionsHaveEnded = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const ending = (): Animation[] =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        );
    for (let running = ending(); running.length > 0; running = ending()) {
      await Promise.allSettled(running.map(async (animation) => animation.finished));
    }
  });
};

/** The design system's rationing: if everything is registered, nothing is. */
const MOST_MARKED = 3;

/** Axe reads an image under text as an undecided colour, so a texture or mark hides contrast. */
const TEXTURES_ASIDE =
  "[data-grid-pattern], [data-dot-pattern] { background-image: none !important; } [data-marks]::before { content: none !important; }";

/** Axe's keys for a contrast it could not decide because of what was painted behind the text. */
const UNDECIDED_BEHIND = new Set(["bgImage", "bgGradient", "pseudoContent"]);

const undecidedBehind = (check: { readonly data: unknown }): boolean => {
  const { data } = check;
  return (
    typeof data === "object" &&
    data !== null &&
    "messageKey" in data &&
    UNDECIDED_BEHIND.has(String(data.messageKey))
  );
};

/** WCAG 1.4.11's floor for what tells a person a control is there. */
const CONTROL_EDGE = 3;

const faintEdges = async (page: Page): Promise<readonly string[]> =>
  (await controlEdges(page)).flatMap(({ control, edges, fill, behind }) => {
    const ratio = Math.max(...[fill, ...edges].map((painted) => contrastBetween(painted, behind)));
    return ratio < CONTROL_EDGE ? [`${control} at ${ratio.toFixed(2)}:1`] : [];
  });

const auditIn = async (page: Page, theme: string): Promise<void> => {
  await transitionsHaveEnded(page);
  const where = `${page.url()} in ${theme}`;
  const marked = await drawnMarks(page);
  expect(
    marked.length,
    `${where} marks ${String(marked.length)} objects: ${marked.join(" ")}`,
  ).toBeLessThanOrEqual(MOST_MARKED);

  const aside = await page.addStyleTag({ content: TEXTURES_ASIDE });
  const audit = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await aside.evaluate((style) => {
    style.parentNode?.removeChild(style);
  });

  expect(audit.violations, `axe found violations on ${where}`).toEqual([]);
  const undecided = audit.incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) => result.nodes)
    .filter((node) => node.any.some(undecidedBehind))
    .map((node) => node.target.join(" "));
  expect(undecided, `axe could not decide contrast over a texture on ${where}`).toEqual([]);
  expect(await faintEdges(page), `controls drawn under 3:1 on ${where}`).toEqual([]);
};

/** The switch the page itself throws; undefined on a page with no theme of ours. */
const themeOf = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => document.documentElement.dataset["theme"]);

const themeSet = (page: Page, theme: string | undefined): Promise<void> =>
  page.evaluate((next) => {
    if (next === undefined) delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = next;
  }, theme);

type Scrolled = readonly [left: number, top: number];

/**
 * A row scrolled half under the sticky band is how a sticky band works, not a target-size defect:
 * the audit reads from the top.
 */
const returnedToItsTop = (page: Page): Promise<Scrolled> =>
  page.evaluate((): Scrolled => {
    const was = [window.scrollX, window.scrollY] as const;
    window.scrollTo(0, 0);
    return was;
  });

const scrolledBackTo = (page: Page, was: Scrolled): Promise<void> =>
  page.evaluate(([left, top]) => {
    window.scrollTo(left, top);
  }, was);

/** In the page's own theme, then in the other, so dark is held in every state a test leaves. */
const auditOf = async (page: Page): Promise<void> => {
  const was = await returnedToItsTop(page);
  const own = await themeOf(page);
  await auditIn(page, own ?? "light");
  const other = own === "dark" ? "light" : "dark";
  await themeSet(page, other);
  await auditIn(page, other);
  await themeSet(page, own);
  await transitionsHaveEnded(page);
  await scrolledBackTo(page, was);
};

export type BrowserFixtures = {
  readonly passesTheAccessibilityGate: () => Promise<void>;
  readonly holdsItsTitle: void;
};

/**
 * Playwright's `test`, with a client address for the page and another for `request`, and an
 * axe audit no passing test can skip.
 */
export const test = base.extend<BrowserFixtures>({
  holdsItsTitle: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern, and it has none
    async ({}, use, testInfo) => {
      holdTitle(testInfo.title);
      await use();
    },
    { auto: true },
  ],

  context: async ({ browser }, use, testInfo) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { [CLIENT_IP_HEADER]: anAddress(testInfo.workerIndex) },
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(await context.newPage());
  },

  /**
   * Its own address, not the page's: a flood here leaves the page to meet the per-email ceiling.
   */
  request: async ({ playwright, baseURL }, use, testInfo) => {
    const api = await playwright.request.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      extraHTTPHeaders: { [CLIENT_IP_HEADER]: anAddress(testInfo.workerIndex) },
    });
    await use(api);
    await api.dispose();
  },

  passesTheAccessibilityGate: [
    async ({ page, baseURL }, use, testInfo) => {
      let audited = false;
      await use(async () => {
        await auditOf(page);
        audited = true;
      });

      if (testInfo.errors.length > 0) return;
      const left = page.url();
      if (baseURL !== undefined && new URL(left).origin === new URL(baseURL).origin) {
        await auditOf(page);
        return;
      }
      expect(
        audited,
        `this test left the browser at ${left}, which this product did not serve, so the accessibility gate had no page of ours to audit — call \`passesTheAccessibilityGate()\` at the page the test is about`,
      ).toBe(true);
    },
    { auto: true },
  ],
});

export { expect };
