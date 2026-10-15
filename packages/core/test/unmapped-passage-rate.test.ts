import { describe, expect, it } from "vitest";

import { ANSWER_MEASURES, unmappedPassageRate } from "../src/answering/index.ts";
import type { PostgresDoor } from "../src/store/postgres/index.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { postgresForSuite, seedingWith } from "./suite-postgres.ts";

const db = postgresForSuite();

const A_PASSAGE = "documents/handbook.pdf#page=4";

type Flag = "incomplete" | "wrong";

/** A completed record with one flag of `reason` on it per entry in `flags`. */
const aRecordFlagged = (
  workspaceId: string,
  flags: readonly Flag[],
  unmappedPassages: readonly string[] = [],
) =>
  seedingWith(db().pool, async (seed) => {
    const record = await seed.questionAsked({
      workspaceId,
      completedAt: new Date(),
      verdict: "related",
      judgeState: "not-judged",
      unmappedPassages: [...unmappedPassages],
    });
    for (const reason of flags) {
      await seed.questionFeedback({ workspaceId, recordId: record.id, verdict: "flag", reason });
    }
    return record;
  });

const rateOf = (workspace: ProvisionedWorkspace, workspaceId: string = workspace.workspaceId) =>
  unmappedPassageRate(ANSWER_MEASURES, workspace.door, { workspaceId });

/** The workspace's door, keeping the text of every statement its connections run. */
const doorKeepingStatements = (workspace: ProvisionedWorkspace) => {
  const { pool } = workspace.door;
  const statements: string[] = [];
  const connect = async () => {
    const client = await pool.connect();
    const query = (text: string, values?: unknown[]) => {
      statements.push(text);
      return client.query(text, values);
    };
    return Object.assign(Object.create(client), { query });
  };
  const door: PostgresDoor = { pool: Object.assign(Object.create(pool), { connect }) };
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
      value: { flaggedIncomplete: 3, showedUnmappedPassages: 2 },
    });
  });

  it("counts a record flagged incomplete twice once", async () => {
    const workspace = await provisionedWorkspace(db(), "Flagged twice");
    await aRecordFlagged(workspace.workspaceId, ["incomplete", "incomplete"], [A_PASSAGE]);

    expect(await rateOf(workspace)).toEqual({
      ok: true,
      value: { flaggedIncomplete: 1, showedUnmappedPassages: 1 },
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
      value: { flaggedIncomplete: 1, showedUnmappedPassages: 1 },
    });
  });

  it("counts only the named workspace's records", async () => {
    const workspace = await provisionedWorkspace(db(), "Quiet");
    const elsewhere = await provisionedWorkspace(db(), "Busy");
    await aRecordFlagged(elsewhere.workspaceId, ["incomplete"], [A_PASSAGE]);

    expect(await rateOf(workspace)).toEqual({
      ok: true,
      value: { flaggedIncomplete: 0, showedUnmappedPassages: 0 },
    });
  });

  it("reads in a read-only transaction", async () => {
    const workspace = await provisionedWorkspace(db(), "Read only");
    const { door, statements } = doorKeepingStatements(workspace);

    expect(
      await unmappedPassageRate(ANSWER_MEASURES, door, { workspaceId: workspace.workspaceId }),
    ).toEqual({ ok: true, value: { flaggedIncomplete: 0, showedUnmappedPassages: 0 } });
    expect(statements[0]).toBe("BEGIN READ ONLY");
  });

  it("refuses malformed for a workspace id that is not one", async () => {
    const workspace = await provisionedWorkspace(db(), "Malformed");

    expect(await rateOf(workspace, "ws_synthetic")).toEqual({ ok: false, error: "malformed" });
  });
});
