import { describe, expect, it } from "vitest";

import { CLIENT_IP_HEADER, UNKNOWN_CLIENT_IP } from "../../src/auth/constants.ts";
import {
  addressKeyOf,
  clientIpOf,
  clientKeyOf,
  inAnthropicRange,
} from "../../src/ingress/limits.ts";

describe("clientKeyOf", () => {
  it("gives every spelling of one IPv6 /64 the same key", () => {
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

  it("separates two IPv6 /64s and keeps an IPv4 address unchanged", () => {
    expect(clientKeyOf("2001:db8:85a3::1")).not.toBe(clientKeyOf("2001:db8:85a4::1"));
    expect(clientKeyOf("203.0.113.9")).toBe("203.0.113.9");

    expect(clientKeyOf("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("returns the input unchanged when brackets do not wrap it", () => {
    expect(clientKeyOf("[2001:db8::1]:443")).toBe("[2001:db8::1]:443");
    expect(clientKeyOf("2001:db8::[1]")).toBe("2001:db8::[1]");
  });
});

describe("clientIpOf", () => {
  it("returns the unknown address for a blank or missing header", () => {
    for (const blank of ["", "   "]) {
      expect(clientIpOf(new Headers({ [CLIENT_IP_HEADER]: blank }))).toBe(UNKNOWN_CLIENT_IP);
    }
    expect(clientIpOf(new Headers())).toBe(UNKNOWN_CLIENT_IP);
  });
});

describe("addressKeyOf", () => {
  it("prefixes the client key with the route group", () => {
    const from = (address: string): Headers => new Headers({ [CLIENT_IP_HEADER]: address });

    expect(addressKeyOf("oauth", from("203.0.113.9"))).toBe("oauth:203.0.113.9");
    expect(addressKeyOf("mcp", from("2001:db8:85a3::1"))).toBe("mcp:2001:0db8:85a3:0000::/64");
    expect(addressKeyOf("trpc", new Headers())).toBe("trpc:unknown");
  });
});

describe("inAnthropicRange", () => {
  it("includes both ends of the range but neither neighbour", () => {
    expect(["160.79.104.0", "160.79.111.255"].map(inAnthropicRange)).toEqual([true, true]);
    expect(["160.79.103.255", "160.79.112.0"].map(inAnthropicRange)).toEqual([false, false]);
  });

  it("matches an IPv4-mapped IPv6 address by its IPv4 address", () => {
    const from = (address: string): Headers => new Headers({ [CLIENT_IP_HEADER]: address });

    expect(inAnthropicRange(clientIpOf(from("::ffff:160.79.104.1")))).toBe(true);
    expect(inAnthropicRange(clientIpOf(from("::ffff:203.0.113.9")))).toBe(false);
  });

  it("returns false for every key that is not IPv4", () => {
    const keys = [UNKNOWN_CLIENT_IP, clientKeyOf("2001:db8:85a3::1"), "", "160.79.104.1:443"];

    expect(keys.map(inAnthropicRange)).toEqual([false, false, false, false]);
  });
});
