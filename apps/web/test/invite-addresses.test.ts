// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  allInto,
  flagOf,
  flagsFrom,
  membersOf,
  MOST_AT_ONCE,
  typedInto,
  type Held,
} from "@/features/people/invite-addresses.ts";

const NONE: readonly Held[] = [];

const NO_FLAGS = new Map<string, never>();

const addressesOf = (held: readonly Held[]) => held.map((one) => one.address);

describe("the addresses the invite dialog holds", () => {
  it("moves whole typed addresses into the list, keeping the rest", () => {
    const moved = typedInto(NONE, "ana@example.com, ben@exa");

    expect(addressesOf(moved.held)).toEqual(["ana@example.com"]);
    expect(moved.field).toBe("ben@exa");
    expect(moved.capped).toBe(false);
  });

  it("leaves the field as typed until a separator comes", () => {
    expect(typedInto(NONE, "ana@exam")).toEqual({ held: NONE, field: "ana@exam", capped: false });
  });

  it.each([
    ["commas", "ana@example.com,ben@example.com"],
    ["semicolons", "ana@example.com; ben@example.com"],
    ["new lines", "ana@example.com\nben@example.com\r\n"],
  ])("splits what is pasted at %s", (_, pasted) => {
    expect(addressesOf(allInto(NONE, pasted).held)).toEqual(["ana@example.com", "ben@example.com"]);
  });

  it("folds two spellings of one address into the first (AE10)", () => {
    const moved = allInto(NONE, "Ana@Example.com, ana@example.com ,  ANA@example.com");

    expect(moved.held).toEqual([{ key: "ana@example.com", address: "Ana@Example.com" }]);
  });

  it("folds an address into one the list already holds", () => {
    const held = allInto(NONE, "ana@example.com").held;

    expect(allInto(held, "ANA@example.com").held).toBe(held);
  });

  it("holds 50 at most, leaving a 51st in the field", () => {
    const fifty = Array.from({ length: MOST_AT_ONCE }, (_, at) => `p${String(at)}@example.com`);
    const moved = allInto(NONE, [...fifty, "late@example.com"].join(", "));

    expect(moved.held).toHaveLength(MOST_AT_ONCE);
    expect(moved.field).toBe("late@example.com");
    expect(moved.capped).toBe(true);
  });

  it("keeps what is being typed after the cap's leftovers", () => {
    const full = allInto(
      NONE,
      Array.from({ length: MOST_AT_ONCE }, (_, at) => `p${String(at)}@example.com`).join(","),
    ).held;

    expect(typedInto(full, "late@example.com, ty").field).toBe("late@example.com, ty");
  });
});

describe("what flags an address the dialog holds", () => {
  const [ana, bad] = allInto(NONE, "ana@example.com, not-an-address").held;

  it("flags an address that is no address (AE5)", () => {
    expect(bad === undefined ? "missing" : flagOf(bad, new Set(), NO_FLAGS)).toBe("malformed");
  });

  it("flags a member's address, however it is cased", () => {
    const members = membersOf(["ANA@example.com"]);

    expect(ana === undefined ? "missing" : flagOf(ana, members, NO_FLAGS)).toBe("already-a-member");
  });

  it("flags what the api refused, and nothing else", () => {
    const refused = new Map([["ana@example.com", "already-a-member" as const]]);

    expect(ana === undefined ? "missing" : flagOf(ana, new Set(), refused)).toBe(
      "already-a-member",
    );
    expect(ana === undefined ? "missing" : flagOf(ana, new Set(), NO_FLAGS)).toBeUndefined();
  });

  it("maps the api's refused places back onto the addresses sent", () => {
    const sent = allInto(NONE, "a@example.com, b@example.com, c@example.com").held;

    expect(
      flagsFrom(sent, { "2": "already-a-member", "0": "malformed", "7": "malformed" }),
    ).toEqual(
      new Map([
        ["c@example.com", "already-a-member"],
        ["a@example.com", "malformed"],
      ]),
    );
  });

  it("maps no word but a row's own", () => {
    const sent = allInto(NONE, "a@example.com").held;

    expect(flagsFrom(sent, { "0": "changed-meanwhile" }).size).toBe(0);
  });
});
