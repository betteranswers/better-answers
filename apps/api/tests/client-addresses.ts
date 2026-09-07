/**
 * The address a `TestApp` client is given when the test does not name one.
 *
 * Two documentation ranges are in play, and which is whose is the rule this file keeps:
 * **TEST-NET-2 (`198.51.100.0/24`) belongs to the harness** — every address handed out
 * here — and **TEST-NET-3 (`203.0.113.0/24`) belongs to the tests**, which is where a
 * test that names an address by hand names it. The ranges are disjoint so that the two
 * cannot meet: the rate limiter and `ingress_counter` key their rows on the client
 * address, so a default client drawing the very address a test asserts was never counted
 * writes that test's row, and the file fails about one run in thirty (T-041).
 *
 * A counter rather than `Math.random` is the other half: within one `TestApp` no address
 * is handed out twice, so a shared key is impossible rather than unlikely.
 *
 * (`apps/web/e2e/browser.ts` allocates a browser client's address from RFC 2544's
 * `198.18.0.0/15`, disjoint from both, because its clients share a database with nothing
 * here but are counted by the same rules.)
 */

const BLOCK = "198.51.100";
/** `.0` is the network address and `.255` the broadcast; the hosts are `.1` to `.254`. */
const LAST_HOST = 254;

export const defaultClientAddresses = (): (() => string) => {
  let issued = 0;
  return () => {
    issued += 1;
    if (issued > LAST_HOST) {
      // Widening into the third octet would leave TEST-NET-2, which is a /24, and take
      // addresses that belong to somebody real; wrapping would restore the collision one
      // range narrower and say nothing. A suite this large wants an address per test.
      throw new Error(
        `a TestApp asked for ${issued} default client addresses and ${BLOCK}.0/24 holds ${LAST_HOST}; split the suite, or have the test that wants more clients than that name its own address in 203.0.113.0/24`,
      );
    }
    return `${BLOCK}.${issued}`;
  };
};
