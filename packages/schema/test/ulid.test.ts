import { afterEach, describe, expect, it, vi } from "vitest";

import { ULID_PATTERN, ulid } from "../src/index.ts";

/**
 * The platform's one minter, as every caller of it sees it. No database and no clock of
 * its own beyond the fake one: what is asserted here is the shape a reader of an id
 * sees, the order two ids minted at two instants sort in, and that two ids are never
 * the same — including the hard case, two ids minted inside one millisecond.
 *
 * Every fake instant below is in the far future, and they only move forward through the
 * file. The minter keeps the latest millisecond it has seen so that ids stay ordered
 * when a clock steps backwards; a test that froze the clock at an instant earlier than
 * a previous test's real-time mint would take that path and prove the fallback instead
 * of what it says it proves.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** Well past any wall clock this suite will run under, so the mint uses the frozen time. */
const FAR_FUTURE = Date.parse("2099-01-01T00:00:00.000Z");
const at = (offsetMs: number) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FAR_FUTURE + offsetMs));
};

describe("the minter, for anything that keeps an id", () => {
  it("mints an id a reader can recognise: 26 Crockford base32 characters", () => {
    const minted = ulid();

    expect(minted).toHaveLength(26);
    expect(new RegExp(ULID_PATTERN).test(minted)).toBe(true);
  });

  it("never mints the same id twice", () => {
    const minted = Array.from({ length: 10_000 }, () => ulid());

    expect(new Set(minted).size).toBe(minted.length);
  });

  it("still sorts in minting order when a thousand ids share one millisecond", () => {
    at(0);

    const minted = Array.from({ length: 1000 }, () => ulid());

    expect(minted.toSorted()).toEqual(minted);
    expect(new Set(minted).size).toBe(minted.length);
    for (const id of minted) expect(new RegExp(ULID_PATTERN).test(id)).toBe(true);
  });

  it("carries the same millisecond into every id minted in it, so the time half is readable", () => {
    at(1000);

    const [first, second] = [ulid(), ulid()];

    expect(second?.slice(0, 10)).toBe(first?.slice(0, 10));
  });

  it("mints ids that sort in the order they were minted, across two instants and across a year", () => {
    at(2000);
    const earlier = ulid();
    at(3000);
    const later = ulid();
    at(366 * 24 * 60 * 60 * 1000);
    const muchLater = ulid();

    expect([muchLater, earlier, later].toSorted()).toEqual([earlier, later, muchLater]);
    // The time halves differ, so it is the clock and not the monotonic counter ordering them.
    expect(new Set([earlier, later, muchLater].map((id) => id.slice(0, 10))).size).toBe(3);
  });
});
