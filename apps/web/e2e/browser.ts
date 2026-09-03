import { test as base, expect } from "@playwright/test";

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

let issued = 0;

export const test = base.extend({
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
});

export { expect };
