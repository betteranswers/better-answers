import { isIPv6 } from "node:net";

import type { MiddlewareHandler } from "hono";

import type { Clock } from "@better-answers/core/kernel";
import {
  consumeIngress,
  type CounterRule,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";

import { CLIENT_IP_HEADER, UNKNOWN_CLIENT_IP } from "../auth/constants.ts";

const prefix64Of = (ipv6: string): string => {
  const canonical = new URL(`http://[${ipv6}]`).hostname.replace(/^\[|\]$/g, "");
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

/** An IPv6 address keys as its /64, an IPv4-mapped one as that IPv4, anything else as given. */
export const clientKeyOf = (address: string): string => {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!isIPv6(bare)) return address;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped?.[1] !== undefined) return mapped[1];

  return prefix64Of(bare);
};

/** The key of the address the edge names; every request naming none shares `UNKNOWN_CLIENT_IP`. */
export const clientIpOf = (headers: Headers): string => {
  const address = headers.get(CLIENT_IP_HEADER)?.trim();
  return address === undefined || address === "" ? UNKNOWN_CLIENT_IP : clientKeyOf(address);
};

export const tooManyRequests = (retryAfterSeconds: number, description: string): Response =>
  Response.json(
    { error: "too_many_requests", error_description: description },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );

export const limitByIp = (
  door: PostgresDoor,
  rule: CounterRule,
  clock: Clock,
): MiddlewareHandler => {
  return async (context, next) => {
    const outcome = await consumeIngress(
      door,
      "ip",
      clientIpOf(context.req.raw.headers),
      rule,
      clock.now(),
    );
    if (!outcome.allowed) {
      return tooManyRequests(
        outcome.retryAfterSeconds,
        "Too many requests from this address; try again shortly.",
      );
    }
    await next();
  };
};
