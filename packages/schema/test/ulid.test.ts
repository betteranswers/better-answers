import { afterEach, describe, expect, it, vi } from "vitest";

import { ULID_PATTERN, ulid } from "../src/index.ts";

/**
 * The platform's one minter, as every caller of it sees it. No database and no clock of
 * its own beyond the fake one: what is asserted here is the shape a reader of an id
 * sees, the order two ids minted at two instants sort in, and that two ids are never
 * the same — including the hard case, two ids minted inside one millisecond.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("the minter, for anything that keeps an id", () => {
  it("mints an id a reader can recognise: 26 Crockford base32 characters", () => {
    const minted = ulid();

    expect(minted).toHaveLength(26);
    expect(new RegExp(ULID_PATTERN).test(minted)).toBe(true);
  });

  it("mints ids that sort in the order they were minted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T10:00:00.000Z"));
    const earlier = ulid();
    vi.setSystemTime(new Date("2026-09-05T10:00:01.000Z"));
    const later = ulid();
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    const muchLater = ulid();

    expect([muchLater, earlier, later].toSorted()).toEqual([earlier, later, muchLater]);
  });

  it("never mints the same id twice", () => {
    const minted = Array.from({ length: 10_000 }, () => ulid());

    expect(new Set(minted).size).toBe(minted.length);
  });

  it("still sorts in minting order when a thousand ids share one millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T10:00:00.000Z"));

    const minted = Array.from({ length: 1000 }, () => ulid());

    expect(minted.toSorted()).toEqual(minted);
    expect(new Set(minted).size).toBe(minted.length);
    for (const id of minted) expect(new RegExp(ULID_PATTERN).test(id)).toBe(true);
  });

  it("carries the same millisecond into every id minted in it, so the time half is readable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T10:00:00.000Z"));

    const [first, second] = [ulid(), ulid()];

    expect(second?.slice(0, 10)).toBe(first?.slice(0, 10));
  });
});
