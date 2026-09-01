import { describe, expect, it } from "vitest";

import { clientKeyOf } from "../src/ingress/limits.ts";

/**
 * The per-IP counter's key: an IPv6 client holds a whole `/64`, so every address in it
 * — however it is written — is one key; an IPv4 address is its own.
 */
describe("the client key an address becomes", () => {
  it("keys every address in one IPv6 /64 the same, whatever the spelling", () => {
    const keys = new Set(
      [
        "2001:db8:85a3::8a2e:370:7334",
        "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
        "2001:DB8:85A3::1",
        "[2001:db8:85a3::ffff:ffff:ffff:ffff]",
        "2001:db8:85a3::1%eth0",
      ].map(clientKeyOf),
    );

    expect([...keys]).toEqual(["2001:0db8:85a3:0000::/64"]);
  });

  it("keeps two IPv6 /64s apart, and an IPv4 address as itself", () => {
    expect(clientKeyOf("2001:db8:85a3::1")).not.toBe(clientKeyOf("2001:db8:85a4::1"));
    expect(clientKeyOf("203.0.113.9")).toBe("203.0.113.9");
    expect(clientKeyOf("::ffff:203.0.113.9")).toBe("0000:0000:0000:0000::/64");
  });
});
