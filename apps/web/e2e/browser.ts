import { AxeBuilder } from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

import { holdTitle } from "@better-answers/schema/testing/test-title";

import { contrastBetween, controlEdges, drawnMarks } from "./locators.ts";

let addressesIssued = 0;

const CLIENT_IP_HEADER = "cf-connecting-ip";

const clientAddress = (workerIndex: number): string => {
  addressesIssued += 1;
  return `198.18.${workerIndex % 250}.${addressesIssued % 250}`;
};

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const waitForTransitions = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const finiteAnimations = (): Animation[] =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        );
    for (let running = finiteAnimations(); running.length > 0; running = finiteAnimations()) {
      await Promise.allSettled(running.map(async (animation) => animation.finished));
    }
  });
};

const MAX_MARKED_ELEMENTS = 3;

const HIDE_TEXTURES_CSS =
  "[data-grid-pattern], [data-dot-pattern] { background-image: none !important; } [data-marks]::before { content: none !important; }";

const UNDECIDED_BACKGROUND_KEYS = new Set(["bgImage", "bgGradient", "pseudoContent"]);

const isUndecidedOverBackground = (check: { readonly data: unknown }): boolean => {
  const { data } = check;
  return (
    typeof data === "object" &&
    data !== null &&
    "messageKey" in data &&
    UNDECIDED_BACKGROUND_KEYS.has(String(data.messageKey))
  );
};

const MIN_CONTROL_CONTRAST = 3;

const lowContrastControls = async (page: Page): Promise<readonly string[]> =>
  (await controlEdges(page)).flatMap(({ control, edges, fill, behind }) => {
    const ratio = Math.max(...[fill, ...edges].map((painted) => contrastBetween(painted, behind)));
    return ratio < MIN_CONTROL_CONTRAST ? [`${control} at ${ratio.toFixed(2)}:1`] : [];
  });

const auditInTheme = async (page: Page, theme: string): Promise<void> => {
  await waitForTransitions(page);
  const where = `${page.url()} in ${theme}`;
  const marked = await drawnMarks(page);
  expect(
    marked.length,
    `${where} has decorative marks on ${String(marked.length)} elements, over the limit: ${marked.join(" ")}`,
  ).toBeLessThanOrEqual(MAX_MARKED_ELEMENTS);

  const texturesHidden = await page.addStyleTag({ content: HIDE_TEXTURES_CSS });
  const audit = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await texturesHidden.evaluate((style) => {
    style.parentNode?.removeChild(style);
  });

  expect(audit.violations, `axe found violations on ${where}`).toEqual([]);
  const undecided = audit.incomplete
    .filter((result) => result.id === "color-contrast")
    .flatMap((result) => result.nodes)
    .filter((node) => node.any.some(isUndecidedOverBackground))
    .map((node) => node.target.join(" "));
  expect(
    undecided,
    `axe could not check the text contrast over a background texture on ${where}`,
  ).toEqual([]);
  expect(
    await lowContrastControls(page),
    `controls on ${where} have an edge contrast below 3:1`,
  ).toEqual([]);
};

const themeOf = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => document.documentElement.dataset["theme"]);

const setTheme = (page: Page, theme: string | undefined): Promise<void> =>
  page.evaluate((next) => {
    if (next === undefined) delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = next;
  }, theme);

type Scrolled = readonly [left: number, top: number];

const scrollToTop = (page: Page): Promise<Scrolled> =>
  page.evaluate((): Scrolled => {
    const was = [window.scrollX, window.scrollY] as const;
    window.scrollTo(0, 0);
    return was;
  });

const scrollBackTo = (page: Page, was: Scrolled): Promise<void> =>
  page.evaluate(([left, top]) => {
    window.scrollTo(left, top);
  }, was);

const auditBothThemes = async (page: Page): Promise<void> => {
  const was = await scrollToTop(page);
  const ownTheme = await themeOf(page);
  await auditInTheme(page, ownTheme ?? "light");
  const other = ownTheme === "dark" ? "light" : "dark";
  await setTheme(page, other);
  await auditInTheme(page, other);
  await setTheme(page, ownTheme);
  await waitForTransitions(page);
  await scrollBackTo(page, was);
};

export type BrowserFixtures = {
  readonly passesTheAccessibilityGate: () => Promise<void>;
  readonly holdsItsTitle: void;
};

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
      extraHTTPHeaders: { [CLIENT_IP_HEADER]: clientAddress(testInfo.workerIndex) },
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(await context.newPage());
  },

  request: async ({ playwright, baseURL }, use, testInfo) => {
    const api = await playwright.request.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      extraHTTPHeaders: { [CLIENT_IP_HEADER]: clientAddress(testInfo.workerIndex) },
    });
    await use(api);
    await api.dispose();
  },

  passesTheAccessibilityGate: [
    async ({ page, baseURL }, use, testInfo) => {
      let audited = false;
      await use(async () => {
        await auditBothThemes(page);
        audited = true;
      });

      if (testInfo.errors.length > 0) return;
      const left = page.url();
      if (baseURL !== undefined && new URL(left).origin === new URL(baseURL).origin) {
        await auditBothThemes(page);
        return;
      }
      expect(
        audited,
        `The test ended at ${left}, a page this app does not serve, so the accessibility gate had no page to check. Call \`passesTheAccessibilityGate()\` on the page that the test checks.`,
      ).toBe(true);
    },
    { auto: true },
  ],
});

export { expect };
