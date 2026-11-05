// @vitest-environment node

import { assert, describe, expect, it } from "vitest";

import {
  addressesCounted,
  allInto,
  flagOf,
  flagsFrom,
  membersOf,
  MOST_AT_ONCE,
  typedInto,
  type Held,
} from "@/features/people/invitations/invite-addresses.ts";

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

  it("keeps the first spelling of an address typed several ways", () => {
    const moved = allInto(NONE, "Ana@Example.com, ana@example.com ,  ANA@example.com");

    expect(moved.held).toEqual([{ key: "ana@example.com", address: "Ana@Example.com" }]);
  });

  it("ignores an address the list already holds", () => {
    const held = allInto(NONE, "ana@example.com").held;

    expect(allInto(held, "ANA@example.com").held).toBe(held);
  });

  it("holds 50 at most and leaves the rest typed", () => {
    const fifty = Array.from({ length: MOST_AT_ONCE }, (_, at) => `p${String(at)}@example.com`);
    const moved = allInto(NONE, [...fifty, "late@example.com"].join(", "));

    expect(moved.held).toHaveLength(MOST_AT_ONCE);
    expect(moved.field).toBe("late@example.com");
    expect(moved.capped).toBe(true);
  });

  it("keeps the typed text after the addresses over the limit", () => {
    const full = allInto(
      NONE,
      Array.from({ length: MOST_AT_ONCE }, (_, at) => `p${String(at)}@example.com`).join(","),
    ).held;

    expect(typedInto(full, "late@example.com, ty").field).toBe("late@example.com, ty");
  });

  it("counts each distinct address in the field once", () => {
    expect(addressesCounted("Late@example.com, late@example.com; ty\n")).toBe(2);
    expect(addressesCounted(" , ")).toBe(0);
  });
});

describe("flagging an address in the invite dialog", () => {
  const [ana, bad] = allInto(NONE, "ana@example.com, not-an-address").held;
  assert(ana !== undefined, "the dialog holds ana's address");
  assert(bad !== undefined, "the dialog holds the invalid address");

  it("flags text that is not an email address", () => {
    expect(flagOf(bad, new Set(), NO_FLAGS)).toBe("malformed");
  });

  it("flags a member's address, however it is cased", () => {
    const members = membersOf(["ANA@example.com"]);

    expect(flagOf(ana, members, NO_FLAGS)).toBe("already-a-member");
  });

  it("flags only the addresses the api refused", () => {
    const refused = new Map([["ana@example.com", "already-a-member" as const]]);

    expect(flagOf(ana, new Set(), refused)).toBe("already-a-member");
    expect(flagOf(ana, new Set(), NO_FLAGS)).toBeUndefined();
  });

  it("matches the api's refused positions to the addresses sent", () => {
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

  it("ignores a refusal code that is not about an address", () => {
    const sent = allInto(NONE, "a@example.com").held;

    expect(flagsFrom(sent, { "0": "changed-meanwhile" }).size).toBe(0);
  });
});
