import { describe, expect, expectTypeOf, it } from "vitest";

import { boundarySchemas } from "@better-answers/schema";

import type { OperatorPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import {
  KERNEL_REFUSALS,
  requireFreshConfirmation,
  type FreshnessRefusal,
} from "../src/kernel/index.ts";

const CONFIRMED_AT = new Date("2026-10-14T12:00:00.000Z");

const aMinute = (minutes: number): Date => new Date(CONFIRMED_AT.getTime() + minutes * 60_000);

const confirmedAt = (secondFactorConfirmedAtMs: number | null) => ({
  credentialIssuedAtMs: CONFIRMED_AT.getTime(),
  secondFactorConfirmedAtMs,
});

describe("the one freshness rule", () => {
  it("admits a confirmation 59 minutes old, refusing one 61", () => {
    const held = confirmedAt(CONFIRMED_AT.getTime());

    expect(requireFreshConfirmation(held, aMinute(59))).toEqual({ ok: true, value: held });
    expect(requireFreshConfirmation(held, aMinute(61))).toEqual({
      ok: false,
      error: "confirmation-too-old",
    });
  });

  it("admits a confirmation exactly an hour old", () => {
    const held = confirmedAt(CONFIRMED_AT.getTime());

    expect(requireFreshConfirmation(held, aMinute(60))).toEqual({ ok: true, value: held });
  });

  it("refuses a stamp in the future", () => {
    expect(requireFreshConfirmation(confirmedAt(aMinute(5).getTime()), CONFIRMED_AT)).toEqual({
      ok: false,
      error: "confirmation-too-old",
    });
  });

  it("refuses a caller carrying no confirmation, such as a bearer", () => {
    expect(requireFreshConfirmation(confirmedAt(null), CONFIRMED_AT)).toEqual({
      ok: false,
      error: "confirmation-too-old",
    });
  });

  it("answers the same word for a member and the operator", () => {
    const twoHoursAgo = CONFIRMED_AT.getTime() - 2 * 60 * 60_000;
    const member: UserPrincipal = {
      kind: "user",
      workspaceId: boundarySchemas.workspace.select.shape.id.parse("01JQ0000000000000000000WSP"),
      userId: boundarySchemas.user.select.shape.id.parse("01JQ0000000000000000000PER"),
      role: "Admin",
      groups: [],
      ...confirmedAt(twoHoursAgo),
    };

    const operator: OperatorPrincipal = {
      kind: "operator",
      userId: boundarySchemas.user.select.shape.id.parse("01JQ0000000000000000000ZED"),
      ...confirmedAt(twoHoursAgo),
    };

    expect(requireFreshConfirmation(member, CONFIRMED_AT)).toEqual({
      ok: false,
      error: "confirmation-too-old",
    });
    expect(requireFreshConfirmation(operator, CONFIRMED_AT)).toEqual({
      ok: false,
      error: "confirmation-too-old",
    });
  });

  it("refuses in a word whose remedy is confirming again", () => {
    expect(KERNEL_REFUSALS["confirmation-too-old"]).toBe("precondition");
    expectTypeOf<FreshnessRefusal>().toEqualTypeOf<"confirmation-too-old">();
  });
});
