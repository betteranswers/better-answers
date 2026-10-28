import { describe, expect, it } from "vitest";

import { objectStoreForSuite } from "@better-answers/core/testing/objects";
import type { RecordMapState } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { TestApp } from "../support/harness/harness.ts";
import { opsRunner } from "../support/ops-run.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { ops } = opsRunner(objects);

describe("pnpm ops — the restore scripts' commands", () => {
  const served = servedApp();

  describe("unmapped-passage-rate — the records flagged incomplete, as JSON", () => {
    const flaggedIncomplete = async (
      app: TestApp,
      workspaceId: string,
      unmappedPassages: readonly string[],
      mapState: RecordMapState | null = { state: "live" },
    ): Promise<void> => {
      const client = await app.database.superuser.connect();
      try {
        const seed = testData(client);
        const record = await seed.questionAsked({
          workspaceId,
          completedAt: new Date(),
          verdict: "related",
          judgeState: "not-judged",
          unmappedPassages: [...unmappedPassages],
          mapState,
        });
        await seed.questionFeedback({
          workspaceId,
          recordId: record.id,
          verdict: "flag",
          reason: "incomplete",
        });
      } finally {
        client.release();
      }
    };

    it("reports two of three mapped records showing unmapped passages", async () => {
      const { workspaceId } = await served().provision();
      await flaggedIncomplete(served(), workspaceId, ["documents/handbook.pdf#page=4"]);
      await flaggedIncomplete(served(), workspaceId, ["documents/handbook.pdf#page=9"]);
      await flaggedIncomplete(served(), workspaceId, []);
      await flaggedIncomplete(served(), workspaceId, ["documents/handbook.pdf#page=2"], null);

      const run = await ops(served(), ["unmapped-passage-rate", "--workspace", workspaceId]);

      expect({ exitCode: run.exitCode, lines: run.lines }).toEqual({
        exitCode: 0,
        lines: [
          JSON.stringify({
            with_the_map: { flagged_incomplete: 3, showed_unmapped_passages: 2 },
            map_unavailable: { flagged_incomplete: 0, showed_unmapped_passages: 0 },
            map_unknown: { flagged_incomplete: 1, showed_unmapped_passages: 1 },
          }),
        ],
      });
    });

    it("answers usage to a non-id workspace before reading anything", async () => {
      const run = await ops(served(), ["unmapped-passage-rate", "--workspace", "ws_synthetic"]);

      expect(run.exitCode).toBe(2);
    });
  });
});
