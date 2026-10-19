import { BlockList, isIPv4, isIPv6 } from "node:net";

import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";

import type { Clock } from "@better-answers/core/kernel";
import {
  consumeIngress,
  type CounterOutcome,
  type CounterRule,
  type PostgresDoor,
} from "@better-answers/core/store/postgres";

import { ANTHROPIC_EGRESS_RANGE, CLIENT_IP_HEADER, UNKNOWN_CLIENT_IP } from "../auth/constants.ts";

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

export const clientKeyOf = (address: string): string => {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!isIPv6(bare)) return address;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare);
  if (mapped?.[1] !== undefined) return mapped[1];

  return prefix64Of(bare);
};

export const clientIpOf = (headers: Headers): string => {
  const address = headers.get(CLIENT_IP_HEADER)?.trim();
  return address === undefined || address === "" ? UNKNOWN_CLIENT_IP : clientKeyOf(address);
};

export const tooManyRequests = (retryAfterSeconds: number, description: string): Response =>
  Response.json(
    { error: "too_many_requests", error_description: description },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );

export type AddressScope =
  | "consent"
  | "email-code-send"
  | "email-code-sign-in"
  | "identity"
  | "mcp"
  | "oauth"
  | "passkey-sign-in"
  | "sign-in-link-read"
  | "sign-in-link-sign-in"
  | "trpc";

export const addressKeyOf = (scope: AddressScope, headers: Headers): string =>
  `${scope}:${clientIpOf(headers)}`;

const anthropicRange = new BlockList();
anthropicRange.addSubnet(ANTHROPIC_EGRESS_RANGE.network, ANTHROPIC_EGRESS_RANGE.prefix);

export const inAnthropicRange = (clientKey: string): boolean =>
  isIPv4(clientKey) && anthropicRange.check(clientKey);

export type AddressCounter = {
  readonly door: PostgresDoor;
  readonly clock: Clock;
  readonly logger: Logger;
};

export const countByAddress = async (
  counter: AddressCounter,
  rule: CounterRule,
  scope: AddressScope,
  headers: Headers,
): Promise<CounterOutcome> => {
  const outcome = await consumeIngress(
    counter.door,
    "ip",
    addressKeyOf(scope, headers),
    rule,
    counter.clock.now(),
  );
  if (outcome.count === rule.max + 1) {
    counter.logger.child({ module: "ingress" }).info(
      {
        event: "ingress.address_ceiling_met",
        group: scope,
        anthropicRange: inAnthropicRange(clientIpOf(headers)),
      },
      "an address met its route group's ceiling",
    );
  }
  return outcome;
};

export const limitByIp = (
  counter: AddressCounter,
  rule: CounterRule,
  scope: AddressScope,
): MiddlewareHandler => {
  return async (context, next) => {
    const outcome = await countByAddress(counter, rule, scope, context.req.raw.headers);
    if (!outcome.allowed) {
      return tooManyRequests(
        outcome.retryAfterSeconds,
        "Too many requests from this address; try again shortly.",
      );
    }
    await next();
  };
};

export const countingPostsAlone =
  (limit: MiddlewareHandler): MiddlewareHandler =>
  (context, next) =>
    context.req.method === "POST" ? limit(context, next) : next();
