import { afterEach, describe, expect, it, vi } from "vitest";

import { WHILE_A_CEILING_HOLDS as RATE_LIMITED_OPTIONS } from "@/shared/api/query-client.ts";
import { carrying } from "@test/stubbed-api.ts";

const NOON_MS = new Date("2026-10-10T12:00:00Z").getTime();

const failedAtNoon = (error: Error | null) => ({ state: { error, errorUpdatedAt: NOON_MS } });

const RATE_LIMITED = failedAtNoon(carrying({ retryAfterSeconds: 30 }));

const { retry, ...refetchRules } = RATE_LIMITED_OPTIONS;

const REFETCH_RULES = Object.entries(refetchRules);

afterEach(() => {
  vi.useRealTimers();
});

describe("a rate-limited read", () => {
  it("suppresses every automatic refetch", () => {
    expect(Object.keys(refetchRules).toSorted()).toEqual([
      "refetchOnMount",
      "refetchOnReconnect",
      "refetchOnWindowFocus",
      "retryOnMount",
    ]);
  });

  it.each(REFETCH_RULES)("skips %s until the retry wait ends", (_, refetches) => {
    vi.useFakeTimers({ now: NOON_MS + 29_999 });

    expect(refetches(RATE_LIMITED)).toBe(false);
  });

  it.each(REFETCH_RULES)("allows %s after the retry wait ends", (_, refetches) => {
    vi.useFakeTimers({ now: NOON_MS + 30_000 });

    expect(refetches(RATE_LIMITED)).toBe(true);
  });

  it("is not retried immediately", () => {
    expect(retry(0, carrying({ retryAfterSeconds: 30 }))).toBe(false);
  });
});

describe("a read that is not rate-limited", () => {
  it.each(REFETCH_RULES)("allows %s after a failure", (_, refetches) => {
    vi.useFakeTimers({ now: NOON_MS });

    expect(refetches(failedAtNoon(new TypeError("the network is down")))).toBe(true);
  });

  it.each(REFETCH_RULES)("allows %s after a success", (_, refetches) => {
    expect(refetches(failedAtNoon(null))).toBe(true);
  });

  it("is retried after a network failure", () => {
    expect(retry(0, new TypeError("the network is down"))).toBe(true);
  });
});
