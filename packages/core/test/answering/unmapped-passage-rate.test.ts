import { describe, expect, it } from "vitest";

import type { RecordMapState } from "@better-answers/schema";

import { ANSWER_MEASURES, unmappedPassageRate } from "../../src/answering/index.ts";
import type { PostgresDoor } from "../../src/store/postgres/index.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "../support/platform.ts";
import { overriding, postgresForSuite, seedingWith } from "../support/suite-postgres.ts";

const db = postgresForSuite();

const A_PASSAGE = "documents/handbook.pdf#page=4";

type Flag = "incomplete" | "wrong";

const LIVE: RecordMapState = { state: "live" };

const UNAVAILABLE: RecordMapState = {
  state: "unavailable_since",
  since: "2026-10-21T09:00:00.000Z",
};

const aRecordFlagged = (
  workspaceId: string,
  flags: readonly Flag[],
  unmappedPassages: readonly string[] = [],
  mapState: RecordMapState | null = LIVE,
) =>
  seedingWith(db().pool, async (seed) => {
    const record = await seed.questionAsked({
      workspaceId,
      completedAt: new Date(),
      verdict: "related",
      judgeState: "not-judged",
      unmappedPassages: [...unmappedPassages],
      mapState,
    });
    for (const reason of flags) {
      await seed.questionFeedback({ workspaceId, recordId: record.id, verdict: "flag", reason });
    }
    return record;
  });

const ONE = { flaggedIncomplete: 1, showedUnmappedPassages: 1 };

const NONE = { flaggedIncomplete: 0, showedUnmappedPassages: 0 };

const NONE_LEFT_OUT = { mapUnavailable: NONE, mapUnknown: NONE };

const rateOf = (workspace: ProvisionedWorkspace, workspaceId: string = workspace.workspaceId) =>
  unmappedPassageRate(ANSWER_MEASURES, workspace.door, { workspaceId });

const doorKeepingStatements = (workspace: ProvisionedWorkspace) => {
  const { pool } = workspace.door;
  const statements: string[] = [];
  const connect = async () => {
    const client = await pool.connect();
    const query = (text: string, values?: unknown[]) => {
      statements.push(text);
      return client.query(text, values);
    };
    return overriding(client, { query });
  };
  const door: PostgresDoor = { pool: overriding(pool, { connect }) };
  return { door, statements };
};

describe("the unmapped-passage rate", () => {
  it("reports two of three incomplete records showing unmapped passages", async () => {
    const workspace = await provisionedWorkspace(db(), "Measured");
    const { workspaceId } = workspace;
    await aRecordFlagged(workspaceId, ["incomplete"], [A_PASSAGE]);
    await aRecordFlagged(workspaceId, ["incomplete"], [A_PASSAGE, `${A_PASSAGE}0`]);
    await aRecordFlagged(workspaceId, ["incomplete"]);
    await aRecordFlagged(workspaceId, ["wrong"], [A_PASSAGE]);
    await aRecordFlagged(workspaceId, [], [A_PASSAGE]);
    await seedingWith(db().pool, (seed) =>
      seed.questionFeedback({ workspaceId, verdict: "helpful", reason: null }),
    );

    expect(await rateOf(workspace)).toEqual({
      ok: true,
      value: { ...NONE_LEFT_OUT, withTheMap: { flaggedIncomplete: 3, showedUnmappedPassages: 2 } },
    });
  });

  it("counts a map-unavailable or unknown answer apart from mapped ones", async () => {
    const workspace = await provisionedWorkspace(db(), "Map-less");
    const { workspaceId } = workspace;
    await aRecordFlagged(workspaceId, ["incomplete"], [A_PASSAGE], LIVE);
    await aRecordFlagged(workspaceId, ["incomplete"], [A_PASSAGE], UNAVAILABLE);
    await aRecordFlagged(workspaceId, ["incomplete"], [A_PASSAGE], null);

    expect(await rateOf(workspace)).toEqual({
      ok: true,
      value: { withTheMap: ONE, mapUnavailable: ONE, mapUnknown: ONE },
    });
  });

  it("counts a record flagged incomplete twice once", async () => {
    const workspace = await provisionedWorkspace(db(), "Flagged twice");
    await aRecordFlagged(workspace.workspaceId, ["incomplete", "incomplete"], [A_PASSAGE]);

    expect(await rateOf(workspace)).toEqual({
      ok: true,
      value: { ...NONE_LEFT_OUT, withTheMap: { flaggedIncomplete: 1, showedUnmappedPassages: 1 } },
    });
  });

  it("counts a record whose incomplete flag an Admin closed", async () => {
    const workspace = await provisionedWorkspace(db(), "Closed flag");
    const { workspaceId } = workspace;
    const record = await aRecordFlagged(workspaceId, [], [A_PASSAGE]);
    await seedingWith(db().pool, (seed) =>
      seed.questionFeedback({
        workspaceId,
        recordId: record.id,
        verdict: "flag",
        reason: "incomplete",
        closedAs: "no-fault-in-the-knowledge",
        closedAt: new Date(),
      }),
    );

    expect(await rateOf(workspace)).toEqual({
      ok: true,
      value: { ...NONE_LEFT_OUT, withTheMap: { flaggedIncomplete: 1, showedUnmappedPassages: 1 } },
    });
  });

  it("counts only the named workspace's records", async () => {
    const workspace = await provisionedWorkspace(db(), "Quiet");
    const elsewhere = await provisionedWorkspace(db(), "Busy");
    await aRecordFlagged(elsewhere.workspaceId, ["incomplete"], [A_PASSAGE]);

    expect(await rateOf(workspace)).toEqual({
      ok: true,
      value: { ...NONE_LEFT_OUT, withTheMap: { flaggedIncomplete: 0, showedUnmappedPassages: 0 } },
    });
  });

  it("reads in a read-only transaction", async () => {
    const workspace = await provisionedWorkspace(db(), "Read only");
    const { door, statements } = doorKeepingStatements(workspace);

    expect(
      await unmappedPassageRate(ANSWER_MEASURES, door, { workspaceId: workspace.workspaceId }),
    ).toEqual({
      ok: true,
      value: { ...NONE_LEFT_OUT, withTheMap: { flaggedIncomplete: 0, showedUnmappedPassages: 0 } },
    });
    expect(statements[0]).toBe("BEGIN READ ONLY");
  });

  it("refuses malformed for a workspace id that is not one", async () => {
    const workspace = await provisionedWorkspace(db(), "Malformed");

    expect(await rateOf(workspace, "ws_synthetic")).toEqual({ ok: false, error: "malformed" });
  });
});
