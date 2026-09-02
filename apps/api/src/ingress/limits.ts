import { isIPv6 } from "node:net";

import type { MiddlewareHandler } from "hono";

import {
  consumeIngress,
  type CounterRule,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";

import { CLIENT_IP_HEADER, UNKNOWN_CLIENT_IP } from "../auth/constants.ts";

/**
 * The pre-authentication per-IP limit (T-004; research 80 F8): one counter row per
 * `(ip, window)` in front of `/oauth2/*`, the discovery documents, the three pages and
 * the MCP endpoint's 401s. Keys on `CF-Connecting-IP` alone; `X-Forwarded-For` is
 * never read (grilling Q8) — the test "ignores a spoofed X-Forwarded-For" holds it.
 */

/**
 * The counter's key for an address. An IPv6 client holds a whole `/64` (RFC 6177), so
 * the key is the prefix, canonicalised first — the same address written two ways is
 * one key. IPv4 is keyed per address.
 */
export const clientKeyOf = (address: string): string => {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!isIPv6(bare)) return address;
  // An IPv4-mapped literal (`::ffff:203.0.113.9`) is that IPv4 client, keyed as itself,
  // not as the one /64 every mapped client would otherwise share.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped?.[1] !== undefined) return mapped[1];
  // The URL parser canonicalises an IPv6 literal (lowercase, `::` compressed once, an
  // embedded IPv4 written as hex groups).
  const canonical = new URL(`http://[${bare}]`).hostname.replace(/^\[|\]$/g, "");
  const [head = "", tail = ""] = canonical.split("::");
  const groups = head === "" ? [] : head.split(":");
  const tailGroups = tail === "" ? [] : tail.split(":");
  const expanded = [
    ...groups,
    ...Array.from({ length: 8 - groups.length - tailGroups.length }, () => "0"),
    ...tailGroups,
  ].map((group) => group.padStart(4, "0"));
  return `${expanded.slice(0, 4).join(":")}::/64`;
};

/** The client's address as the tunnel reports it, or the one bucket for a request off the tunnel. */
export const clientIpOf = (headers: Headers): string => {
  const address = headers.get(CLIENT_IP_HEADER)?.trim();
  return address === undefined || address === "" ? UNKNOWN_CLIENT_IP : clientKeyOf(address);
};

export const tooManyRequests = (retryAfterSeconds: number, description: string): Response =>
  Response.json(
    { error: "too_many_requests", error_description: description },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );

export const limitByIp = (door: PostgresDoor, rule: CounterRule): MiddlewareHandler => {
  return async (context, next) => {
    const outcome = await consumeIngress(door, "ip", clientIpOf(context.req.raw.headers), rule);
    if (!outcome.allowed) {
      return tooManyRequests(
        outcome.retryAfterSeconds,
        "Too many requests from this address; try again shortly.",
      );
    }
    await next();
  };
};
