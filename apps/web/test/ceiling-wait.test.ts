import { afterEach, describe, expect, it, vi } from "vitest";

import { WHILE_A_CEILING_HOLDS as HOLDS } from "@/shared/api/query-client.ts";

import { carrying } from "./stubbed-api.ts";

const NOON_MS = new Date("2026-10-10T12:00:00Z").getTime();

/** A read as the query cache holds it, failed at noon. */
const failedAtNoon = (error: Error | null) => ({ state: { error, errorUpdatedAt: NOON_MS } });

const PAST_ITS_CEILING = failedAtNoon(carrying({ retryAfterSeconds: 30 }));

const { retry, ...unasked } = HOLDS;

/** Each way the page asks a held read again with no one pressing anything: every hold but the retry. */
const UNASKED = Object.entries(unasked);

afterEach(() => {
  vi.useRealTimers();
});

describe("a read that met a ceiling", () => {
  it("is held on every road but the reader's own ask", () => {
    expect(Object.keys(unasked).toSorted()).toEqual([
      "refetchOnMount",
      "refetchOnReconnect",
      "refetchOnWindowFocus",
      "retryOnMount",
    ]);
  });

  it.each(UNASKED)("is not asked again by %s while its wait runs", (_, asksAgain) => {
    vi.useFakeTimers({ now: NOON_MS + 29_999 });

    expect(asksAgain(PAST_ITS_CEILING)).toBe(false);
  });

  it.each(UNASKED)("is asked again by %s once its wait is over", (_, asksAgain) => {
    vi.useFakeTimers({ now: NOON_MS + 30_000 });

    expect(asksAgain(PAST_ITS_CEILING)).toBe(true);
  });

  it("is not retried at once", () => {
    expect(retry(0, carrying({ retryAfterSeconds: 30 }))).toBe(false);
  });
});

describe("a read that met no ceiling", () => {
  it.each(UNASKED)("is asked again by %s after a failure", (_, asksAgain) => {
    vi.useFakeTimers({ now: NOON_MS });

    expect(asksAgain(failedAtNoon(new TypeError("the network is down")))).toBe(true);
  });

  it.each(UNASKED)("is asked again by %s once it has answered", (_, asksAgain) => {
    expect(asksAgain(failedAtNoon(null))).toBe(true);
  });

  it("is retried after a failure with no word", () => {
    expect(retry(0, new TypeError("the network is down"))).toBe(true);
  });
});
