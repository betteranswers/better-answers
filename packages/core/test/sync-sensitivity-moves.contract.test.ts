import { describe, expect, it } from "vitest";
import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { SENSITIVITY_MOVED_KEY, whatTheSyncMoved, type SyncMoved } from "../src/runs/index.ts";
import { contractFixture } from "./contract-fixture.ts";

const reads = z.union([
  z.object({ whole_source: z.literal(true) }).strict(),
  z.object({ documents: z.array(z.string().min(1)) }).strict(),
]);

const fixtureSchema = z.object({
  description: z.string(),
  key: z.string().min(1),
  moves: z.array(z.object({ why: z.string().min(1) })).min(1),
  readings: z
    .array(
      z.object({
        why: z.string().min(1),
        outcome: boundarySchemas.job.select.shape.outcome,
        reads,
      }),
    )
    .min(1),
});

const fixture = contractFixture("sync-sensitivity-moves", fixtureSchema);

const movedAsTheFixtureSays = (read: z.output<typeof reads>): SyncMoved =>
  "whole_source" in read
    ? { kind: "whole-source" }
    : { kind: "documents", documentIds: read.documents };

describe("what the sync-sensitivity-moves agreement says a sync's outcome moved", () => {
  it("is read under this tier's key", () => {
    expect(SENSITIVITY_MOVED_KEY).toBe(fixture.key);
  });

  it("reads each finished first attempt's outcome as the fixture says", () => {
    const read = fixture.readings.map(({ why, outcome }) => ({
      why,
      moved: whatTheSyncMoved({ status: "done", attempts: 1, outcome }),
    }));

    expect(read).toEqual(
      fixture.readings.map(({ why, reads: said }) => ({
        why,
        moved: movedAsTheFixtureSays(said),
      })),
    );
  });
});
