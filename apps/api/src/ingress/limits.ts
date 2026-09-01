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

/** The client's address as the tunnel reports it, or the one bucket for a request off the tunnel. */
export const clientIpOf = (headers: Headers): string =>
  headers.get(CLIENT_IP_HEADER)?.trim() || UNKNOWN_CLIENT_IP;

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
