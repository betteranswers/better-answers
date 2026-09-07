import { describe, expect, it } from "vitest";

import { defaultClientAddresses } from "./client-addresses.ts";

/**
 * The address a client is given when a test does not name one. What it exists to make
 * impossible: two default clients in one `TestApp` holding the same address, which is
 * one rate-limit and one `ingress_counter` key, so one test's rows land under another
 * test's assertion that its own address was never counted (T-041).
 */
describe("the address a default client is given", () => {
  it("gives every client in one app an address of its own", () => {
    const next = defaultClientAddresses();

    const drawn = Array.from({ length: 200 }, next);

    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("draws from TEST-NET-2, the half the harness owns, and never from the half tests name", () => {
    const next = defaultClientAddresses();

    const drawn = Array.from({ length: 254 }, next);

    expect(drawn.slice(0, 3)).toEqual(["198.51.100.1", "198.51.100.2", "198.51.100.3"]);
    expect(drawn.at(-1)).toBe("198.51.100.254");
    expect(drawn.filter((address) => address.startsWith("203.0.113."))).toEqual([]);
  });

  it("gives a default client no address once the harness's half is spent, rather than starting it again behind the suite's back", () => {
    const next = defaultClientAddresses();
    for (let drawn = 0; drawn < 254; drawn += 1) next();

    // A wrap would hand `198.51.100.1` to a second client and put the collision back,
    // one range narrower; the throw names the range and what to do instead.
    expect(next).toThrow("198.51.100.0/24");
    // And it says what to do about it, not only that it happened.
    expect(next).toThrow("name its own address in 203.0.113.0/24");
  });
});
