import { AxeBuilder } from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

let issued = 0;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const auditOf = async (page: Page): Promise<void> => {
  const audit = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(audit.violations, `axe found violations on ${page.url()}`).toEqual([]);
};

export type BrowserFixtures = {
  readonly passesTheAccessibilityGate: () => Promise<void>;
};

export const test = base.extend<BrowserFixtures>({
  context: async ({ browser }, use, testInfo) => {
    issued += 1;
    const context = await browser.newContext({
      extraHTTPHeaders: {
        "cf-connecting-ip": `198.18.${testInfo.workerIndex % 250}.${issued % 250}`,
      },
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(await context.newPage());
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
