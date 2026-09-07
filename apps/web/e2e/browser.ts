import { AxeBuilder } from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

/**
 * The browser suite's fixture module: what every spec's `test` carries whether it asks for it
 * or not.
 *
 * Two things live here and they are the same kind of thing — a fact about the run no spec
 * should have to remember (`[CHECK1]`). One gives each browser an address of its own. The
 * other audits the screen the spec leaves behind.
 */

let issued = 0;

/**
 * The tags this repository holds a screen to (`[A11Y1]`).
 *
 * The list is the fact worth having in one place — a screen audited against four of the five
 * would pass while being held to less than its neighbour — and `@axe-core/playwright` 4.13.0
 * is the version they were read from, on 03/09/2026 (`[DEPS1]`).
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Axe over the page as it stands, with no violation tolerated. Automated rules are evidence
 * and not proof: each screen's own keyboard traversal and aria snapshot are the rest of the
 * claim, which is why this is the gate and never the whole of it.
 *
 * The address is in the message because the gate now runs from a fixture, where a reader of
 * the failure has no line of the spec to tell them which screen was under axe.
 */
const auditOf = async (page: Page): Promise<void> => {
  const audit = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(audit.violations, `axe found violations on ${page.url()}`).toEqual([]);
};

/** What a spec may ask for by name, on top of Playwright's own fixtures. */
export type BrowserFixtures = {
  /**
   * Audit this screen now, before the test moves off it. Needed only where the test does not
   * end on the screen it is about — the gate runs on its own everywhere else.
   */
  readonly passesTheAccessibilityGate: () => Promise<void>;
};

export const test = base.extend<BrowserFixtures>({
  /**
   * A browser with an address of its own.
   *
   * Every counter in front of sign-in is per client address — the platform's per-IP ceiling
   * and Better Auth's own limiter both are — and the address is read from the tunnel's
   * `CF-Connecting-IP` header and nowhere else (T-004 grilling Q8). A suite whose browsers
   * all arrive from the loopback with no such header shares one bucket between every test,
   * so the sixth sign-in in the whole run is refused and everything after it fails for a
   * reason that has nothing to do with what it was testing.
   *
   * So each test is given an address, as each person in the world has one. The range is
   * RFC 2544's benchmarking block, which is reserved and routes nowhere; the worker's index
   * keeps two runners apart, and the count keeps two tests on one runner apart.
   */
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

  /**
   * The accessibility gate, run rather than remembered (T-081).
   *
   * It was a helper each spec called, and on 05/09/2026 two specs in six called it while the
   * skill described the suite as auditing every screen — an absence nobody had decided on.
   * So it is automatic: the screen the test leaves the browser on is audited when the test
   * body has finished, and a spec cannot drop the gate by saying nothing.
   *
   * A test that ends somewhere this product did not serve — the consent flow ends at the
   * client's own redirect, and a browser that never opened a screen is still on `about:blank`
   * — leaves the fixture no screen of ours to read. Rather than audit whatever is there or
   * quietly audit nothing, it asks the test what it audited: the exposed call is how such a
   * spec gates the screen it is actually about, and a spec that made neither is refused.
   *
   * A test that has already failed is not audited. Axe would report the wreckage of whatever
   * went wrong, and a second failure on top of the real one buries it.
   */
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
