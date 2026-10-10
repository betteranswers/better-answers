import { afterEach, describe, expect, it, vi } from "vitest";

import { WHILE_A_CEILING_HOLDS as HOLDS } from "@/shared/api/query-client.ts";

import { carrying } from "./stubbed-api.ts";

const NOON_MS = new Date("2026-10-10T12:00:00Z").getTime();

/** A read as the query cache holds it, failed at noon. */
const failedAtNoon = (error: Error | null) => ({ state: { error, errorUpdatedAt: NOON_MS } });

const PAST_ITS_CEILING = failedAtNoon(carrying({ retryAfterSeconds: 30 }));

/** Each way the page asks a held read again with no one pressing anything. */
const UNASKED = ["retryOnMount", "refetchOnWindowFocus", "refetchOnReconnect"] as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("a read that met a ceiling", () => {
  it.each(UNASKED)("is not asked again by %s while its wait runs", (road) => {
    vi.useFakeTimers({ now: NOON_MS + 29_999 });

    expect(HOLDS[road](PAST_ITS_CEILING)).toBe(false);
  });

  it.each(UNASKED)("is asked again by %s once its wait is over", (road) => {
    vi.useFakeTimers({ now: NOON_MS + 30_000 });

    expect(HOLDS[road](PAST_ITS_CEILING)).toBe(true);
  });

  it("is not retried at once", () => {
    expect(HOLDS.retry(0, carrying({ retryAfterSeconds: 30 }))).toBe(false);
  });
});

describe("a read that met no ceiling", () => {
  it.each(UNASKED)("is asked again by %s after a failure", (road) => {
    vi.useFakeTimers({ now: NOON_MS });

    expect(HOLDS[road](failedAtNoon(new TypeError("the network is down")))).toBe(true);
  });

  it.each(UNASKED)("is asked again by %s once it has answered", (road) => {
    expect(HOLDS[road](failedAtNoon(null))).toBe(true);
  });

  it("is retried after a failure with no word", () => {
    expect(HOLDS.retry(0, new TypeError("the network is down"))).toBe(true);
  });
});
