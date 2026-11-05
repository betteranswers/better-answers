import { describe, expect, it } from "vitest";
import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { SENSITIVITY_MOVED_KEY, whatTheSyncMoved, type SyncMoved } from "../../src/runs/index.ts";
import { contractFixture } from "../fixtures/contract-fixture.ts";

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

const expectedMoved = (read: z.output<typeof reads>): SyncMoved =>
  "whole_source" in read
    ? { kind: "whole-source" }
    : { kind: "documents", documentIds: read.documents };

describe("whatTheSyncMoved against the sync-sensitivity-moves agreement", () => {
  it("reads the outcome key the agreement names", () => {
    expect(SENSITIVITY_MOVED_KEY).toBe(fixture.key);
  });

  it("reads each first-attempt outcome as the fixture expects", () => {
    const read = fixture.readings.map(({ why, outcome }) => ({
      why,
      moved: whatTheSyncMoved({ status: "done", attempts: 1, outcome }),
    }));

    expect(read).toEqual(
      fixture.readings.map(({ why, reads: said }) => ({
        why,
        moved: expectedMoved(said),
      })),
    );
  });
});
