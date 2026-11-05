import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REASONS_EMPTYING_THE_CONNECTED_SOURCE } from "@better-answers/schema";

import { contractFixture } from "../fixtures/contract-fixture.ts";

const fixtureSchema = z.object({
  description: z.string(),
  reasons: z.array(z.string().min(1)).min(1),
});

const fixture = contractFixture("emptying-a-connected-source", fixtureSchema);

describe("the reasons for emptying a connected source", () => {
  it("match the agreement's reasons exactly", () => {
    expect([...REASONS_EMPTYING_THE_CONNECTED_SOURCE].toSorted()).toEqual(
      fixture.reasons.toSorted(),
    );
  });

  it("appear once each in the agreement", () => {
    expect(new Set(fixture.reasons).size).toBe(fixture.reasons.length);
  });
});
