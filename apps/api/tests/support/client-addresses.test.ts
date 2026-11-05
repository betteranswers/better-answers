import { describe, expect, it } from "vitest";

import { defaultClientAddresses } from "./client-addresses.ts";

describe("default client addresses", () => {
  it("gives every client in one TestApp its own address", () => {
    const next = defaultClientAddresses();

    const drawn = Array.from({ length: 200 }, next);

    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("uses 198.51.100.0/24, leaving 203.0.113.0/24 for tests to name", () => {
    const next = defaultClientAddresses();

    const drawn = Array.from({ length: 254 }, next);

    expect(drawn.slice(0, 3)).toEqual(["198.51.100.1", "198.51.100.2", "198.51.100.3"]);
    expect(drawn.at(-1)).toBe("198.51.100.254");
    expect(drawn.filter((address) => address.startsWith("203.0.113."))).toEqual([]);
  });

  it("throws after 254 addresses instead of starting over", () => {
    const next = defaultClientAddresses();
    for (let drawn = 0; drawn < 254; drawn += 1) next();

    expect(next).toThrow("198.51.100.0/24");

    expect(next).toThrow("name its own address in 203.0.113.0/24");
  });
});
