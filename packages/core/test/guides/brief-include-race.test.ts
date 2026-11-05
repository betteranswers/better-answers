import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { head } from "@better-answers/core/store/git";

import { includeAvailable } from "../../src/guides/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { bundleHistory } from "../fixtures/bundle.ts";
import { EMPLOYERS_LIABILITY, type Concept } from "../fixtures/northgate-concepts.ts";
import { typedBy } from "../fixtures/northgate.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "../fixtures/workspace-with-bundle.ts";
import {
  briefCiting,
  includeIdsOf,
  latestVersionOf,
  saveBriefAs,
  seededGuide,
  writeUpOf,
} from "./northgate-guide.ts";

const { db, arrange } = suiteWithBundles();

const SAVE_TIME_TO_LAND_MS = 500;

const ANOTHER_POLICY = {
  key: "anotherPolicy",
  slug: "business-continuity-plan",
  title: "Business continuity plan",
  kind: "insurance policy",
  tags: ["continuity"],
  body: "Northgate keeps a business continuity plan and tests it each year.",
} as const satisfies Concept;

const recordedCommits = async (workspaceId: string): Promise<ReadonlySet<string>> => {
  const found = await db().pool.query<{ sha: string }>(
    "SELECT sha FROM bundle_commit WHERE workspace_id = $1",
    [workspaceId],
  );
  return new Set(found.rows.map((row) => row.sha));
};

const insertIsWaiting = async (): Promise<void> => {
  const waiting = await db().pool.query(
    `SELECT 1 FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND query LIKE '%write_up_include%'`,
  );
  if (waiting.rowCount !== 1) throw new Error("the include is not yet waiting on its insert");
};

type Race = {
  readonly including: ReturnType<typeof includeAvailable>;
  readonly saving: ReturnType<typeof saveBriefAs>;
};

const raced = async (scenario: Scenario, as: UserPrincipal, writeUpId: string): Promise<Race> => {
  const base = await latestVersionOf(db(), writeUpId);
  const markdown = briefCiting(await includeIdsOf(db(), writeUpId));
  const holder = await db().pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE write_up_include IN EXCLUSIVE MODE");
    const including = includeAvailable(as, doorsOf(scenario), { writeUpId });
    await vi.waitFor(insertIsWaiting, { timeout: 10_000, interval: 20 });
    const saving = saveBriefAs(scenario, as, { writeUpId, markdown, base });
    await Promise.race([saving, sleep(SAVE_TIME_TO_LAND_MS)]);
    return { including, saving };
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
};

describe("a Brief save racing an include on the same section", () => {
  it("keeps the bundle writable when a save races an include", async () => {
    const scenario = await arrange();
    const guide = await seededGuide(db(), scenario);
    const { ng } = guide;
    await typedBy(ng.editor, scenario, EMPLOYERS_LIABILITY);
    const writeUpId = await writeUpOf(db(), guide, "Insurance and financial standing");
    const base = await latestVersionOf(db(), writeUpId);

    const { including, saving } = await raced(scenario, ng.editor, writeUpId);

    expect(await including).toMatchObject({ ok: true, value: { included: 1 } });
    expect(await saving).toEqual({ ok: false, error: "stale-precondition" });
    expect(await latestVersionOf(db(), writeUpId)).toBe(base + 1);
    const history = await bundleHistory(scenario.git, scenario.workspaceId);
    const recorded = await recordedCommits(scenario.workspaceId);
    expect(history.filter((sha) => !recorded.has(sha))).toEqual([]);

    const another = await typedBy(ng.editor, scenario, ANOTHER_POLICY);
    expect(await head(ng.admin, scenario.git)).toBe(another.sha);
  });
});
