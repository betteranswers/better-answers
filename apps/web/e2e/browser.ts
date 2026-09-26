import { AxeBuilder } from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

import { holdTitle } from "@better-answers/schema/testing/test-title";

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

const auditOf = async (page: Page): Promise<void> => {
  const audit = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(audit.violations, `axe found violations on ${page.url()}`).toEqual([]);
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
        `this test left the browser at ${left}, which this product did not serve, so the accessibility gate had no screen of ours to audit — call \`passesTheAccessibilityGate()\` at the screen the test is about`,
      ).toBe(true);
    },
    { auto: true },
  ],
});

export { expect };
