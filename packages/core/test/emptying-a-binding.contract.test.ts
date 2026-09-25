import { describe, expect, it } from "vitest";
import { z } from "zod";

import { REASONS_EMPTYING_THE_BINDING } from "@better-answers/schema";

import { contractFixture } from "./contract-fixture.ts";

const fixtureSchema = z.object({
  description: z.string(),
  reasons: z.array(z.string().min(1)).min(1),
});

const fixture = contractFixture("emptying-a-binding", fixtureSchema);

describe("the reasons the emptying-a-binding agreement says empty a binding", () => {
  it("are this tier's reasons: every named reason and no other", () => {
    expect([...REASONS_EMPTYING_THE_BINDING].toSorted()).toEqual(fixture.reasons.toSorted());
  });

  it("are each written once", () => {
    expect(new Set(fixture.reasons).size).toBe(fixture.reasons.length);
  });
});
