import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  bulkChangeRole,
  bulkChangeRoleInput,
  removeMember,
  removeMemberInput,
} from "../src/members/index.ts";
import { openPostgres, withHeldPrincipal, withPrincipalRead } from "../src/store/postgres/index.ts";
import { heldAs, membersSuite } from "./members-suite.ts";
import { provisionedWorkspace, type ProvisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import {
  countWaitingOnLocks,
  holdingRows,
  postgresForSuite,
  seedingWith,
  until,
  whileActionsWaitAt,
  whileWritesAreRefused,
} from "./suite-postgres.ts";

const db = postgresForSuite();

const door = () => openPostgres(db().runtimePool);

const { joining } = membersSuite(db);

const HOUR_MS = 3_600_000;

const TEN_MINUTES_MS = 10 * 60_000;

/**
 * Resolves the member's claims and answers their role, as every door on a request does.
 * `meanwhile` runs as the request's own work, inside its transaction.
 */
const resolvedIn = async (
  workspaceId: string,
  userId: string,
  meanwhile: () => Promise<unknown> = () => Promise.resolve(),
) => {
  const opened = await withPrincipalRead(
    door(),
    { workspaceId, userId, issuedAt: new Date() },
    async (principal) => {
      await meanwhile();
      return principal.role;
    },
  );
  return opened;
};

/** As the MCP surface's own door resolves a mutating call. */
const mcpCallIn = (workspaceId: string, userId: string) =>
  withHeldPrincipal(door(), { workspaceId, userId, issuedAt: new Date() }, async (principal) => ({
    role: principal.role,
  }));

type Stamped = { readonly at: Date };

const stampedIn = async (workspaceId: string, userId: string): Promise<Date | undefined> =>
  (
    await db().pool.query<Stamped>(
      "SELECT at FROM workspace_last_active WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, userId],
    )
  ).rows[0]?.at;

/** A row `agoMs` old: within the hour no request writes it again, past the hour the next one does. */
const stampedAgo = (workspaceId: string, userId: string, agoMs: number) =>
  seedingWith(db().pool, async (seed) =>
    seed.workspaceLastActive({
      workspaceId,
      userId,
      at: new Date(Date.now() - agoMs),
    }),
  );

/** Holds the member's own last-active row, from a connection of its own, while `work` runs. */
const holdingTheStamp = <T>(workspaceId: string, userId: string, work: () => Promise<T>) =>
  holdingRows(
    db().pool,
    "SELECT 1 FROM workspace_last_active WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE",
    [workspaceId, userId],
    work,
  );

/** The workspace's Admin removes the member, as the transport holds the Admin. */
const removing = (workspace: ProvisionedWorkspace, personId: string) =>
  heldAs(workspace, workspace.adminUserId, (principal, tx) =>
    removeMember(principal, tx, { ...inputOf(removeMemberInput, { personId }), at: new Date() }),
  );

/** Whether any transaction has locked or written the row since it was seeded: its xmax stays 0 until one does. */
const rowEverLocked = async (workspaceId: string, userId: string): Promise<boolean> =>
  (
    await db().pool.query<{ locked: boolean }>(
      `SELECT xmax::text <> '0' AS locked FROM workspace_last_active
        WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId],
    )
  ).rows[0]?.locked ?? true;

describe("stamping a member's last activity", () => {
  it("writes the row on the member's first request", async () => {
    const workspace = await provisionedWorkspace(db(), "FirstStamp");
    const viewer = await joining(workspace, "Viewer");

    const read = await resolvedIn(workspace.workspaceId, viewer);

    expect(read.ok ? read.value : read.error).toBe("Viewer");
    const at = await stampedIn(workspace.workspaceId, viewer);
    expect(at, "the request was answered, so a row should be stamped").toBeDefined();
    expect(at && Date.now() - at.getTime()).toBeLessThan(60_000);
  });

  it("stamps once within the hour, and again after it", async () => {
    const workspace = await provisionedWorkspace(db(), "HourlyStamp");
    const viewer = await joining(workspace, "Viewer");
    const seeded = (await stampedAgo(workspace.workspaceId, viewer, TEN_MINUTES_MS)).at;

    for (let request = 0; request < 3; request += 1) {
      await resolvedIn(workspace.workspaceId, viewer);
    }

    expect(await stampedIn(workspace.workspaceId, viewer)).toEqual(seeded);

    await db().pool.query(
      "UPDATE workspace_last_active SET at = now() - interval '2 hours' WHERE workspace_id = $1 AND user_id = $2",
      [workspace.workspaceId, viewer],
    );
    const backdated = await stampedIn(workspace.workspaceId, viewer);
    await resolvedIn(workspace.workspaceId, viewer);

    const stampedAgain = await stampedIn(workspace.workspaceId, viewer);
    expect(
      stampedAgain && backdated && stampedAgain.getTime() - backdated.getTime(),
      "a request an hour on from the last stamp writes it again",
    ).toBeGreaterThan(HOUR_MS);
  });

  it("stamps the workspace an MCP call names, and no other", async () => {
    const first = await provisionedWorkspace(db(), "StampedHere");
    const second = await provisionedWorkspace(db(), "StampedThere");
    const viewer = await joining(first, "Viewer");
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: second.workspaceId, userId: viewer, role: "Viewer" }),
    );

    const called = await mcpCallIn(first.workspaceId, viewer);

    expect(called.ok ? called.value.role : called.error).toBe("Viewer");
    expect(
      await stampedIn(second.workspaceId, viewer),
      "another workspace is untouched",
    ).toBeUndefined();
    const firstStamped = await stampedIn(first.workspaceId, viewer);
    expect(firstStamped).toBeDefined();

    await mcpCallIn(second.workspaceId, viewer);

    expect(await stampedIn(second.workspaceId, viewer)).toBeDefined();
    expect(await stampedIn(first.workspaceId, viewer), "the first stamp stands").toEqual(
      firstStamped,
    );
  });

  it("leaves the request answered when the stamp fails", async () => {
    const workspace = await provisionedWorkspace(db(), "FailedStamp");
    const viewer = await joining(workspace, "Viewer");

    const answered = await whileWritesAreRefused(db().pool, "workspace_last_active", () =>
      resolvedIn(workspace.workspaceId, viewer),
    );

    expect(answered.ok ? answered.value : answered.error).toBe("Viewer");
    expect(await stampedIn(workspace.workspaceId, viewer)).toBeUndefined();
  });

  it("never lets a bulk act wait on a held stamp", async () => {
    const workspace = await provisionedWorkspace(db(), "BulkPastAStamp");
    const viewer = await joining(workspace, "Viewer");
    const editor = await joining(workspace, "Editor");
    const stale = (await stampedAgo(workspace.workspaceId, workspace.adminUserId, 2 * HOUR_MS)).at;

    const acted = await holdingTheStamp(workspace.workspaceId, workspace.adminUserId, () =>
      heldAs(workspace, workspace.adminUserId, (principal, tx) =>
        bulkChangeRole(principal, tx, {
          ...inputOf(bulkChangeRoleInput, { personIds: [viewer, editor], role: "Viewer" }),
          at: new Date(),
        }),
      ),
    );

    expect(acted.ok ? acted.value.changed : acted.error).toEqual([editor]);
    expect(
      await stampedIn(workspace.workspaceId, workspace.adminUserId),
      "the stamp was dropped, not waited on",
    ).toEqual(stale);
  });

  it("never lets a stamp wait on a bulk act", async () => {
    const workspace = await provisionedWorkspace(db(), "StampPastABulk");
    const viewer = await joining(workspace, "Viewer");
    const editor = await joining(workspace, "Editor");

    const acted = whileActionsWaitAt(db().pool, "member", "UPDATE", async (release) => {
      const bulk = heldAs(workspace, workspace.adminUserId, (principal, tx) =>
        bulkChangeRole(principal, tx, {
          ...inputOf(bulkChangeRoleInput, { personIds: [viewer, editor], role: "Editor" }),
          at: new Date(),
        }),
      );
      await until(async () => (await countWaitingOnLocks(db().pool)) > 0);

      const read = await resolvedIn(workspace.workspaceId, workspace.adminUserId);
      expect(read.ok ? read.value : read.error).toBe("Admin");
      expect(
        await stampedIn(workspace.workspaceId, workspace.adminUserId),
        "the stamp landed while the bulk act held its rows",
      ).toBeDefined();

      await release();
      return bulk;
    });

    const answered = await acted;
    expect(answered.ok ? answered.value : answered.error).toMatchObject({
      changed: [viewer],
      skipped: 1,
    });
  });

  it("a removal deletes the row here alone", async () => {
    const ours = await provisionedWorkspace(db(), "RowRemoved");
    const theirs = await provisionedWorkspace(db(), "RowKept");
    const viewer = await joining(ours, "Viewer");
    await seedingWith(db().pool, (seed) =>
      seed.member({ workspaceId: theirs.workspaceId, userId: viewer, role: "Viewer" }),
    );
    await resolvedIn(ours.workspaceId, viewer);
    await resolvedIn(theirs.workspaceId, viewer);

    const removed = await removing(ours, viewer);

    expect(removed.ok).toBe(true);
    expect(await stampedIn(ours.workspaceId, viewer)).toBeUndefined();
    expect(await stampedIn(theirs.workspaceId, viewer)).toBeDefined();
  });

  it("locks no row stamped within the hour", async () => {
    const workspace = await provisionedWorkspace(db(), "FreshStampUnlocked");
    const viewer = await joining(workspace, "Viewer");
    await stampedAgo(workspace.workspaceId, viewer, TEN_MINUTES_MS);

    for (let request = 0; request < 3; request += 1) {
      await resolvedIn(workspace.workspaceId, viewer);
    }

    expect(
      await rowEverLocked(workspace.workspaceId, viewer),
      "a request within the hour reads the row and opens no write",
    ).toBe(false);
  });

  it("leaves the request answered when the pool has ended", async () => {
    const workspace = await provisionedWorkspace(db(), "PoolEnded");
    const viewer = await joining(workspace, "Viewer");
    const pool = new pg.Pool({
      connectionString: db().connectionUri,
      max: 2,
      options: "-c role=app_rt",
    });
    let ending: Promise<void> = Promise.resolve();

    const answered = await withPrincipalRead(
      openPostgres(pool),
      { workspaceId: workspace.workspaceId, userId: viewer, issuedAt: new Date() },
      async (principal) => {
        // A shutdown mid-request: the request's own connection serves until it is released.
        ending = pool.end();
        return principal.role;
      },
    );
    await ending;

    expect(answered.ok ? answered.value : answered.error).toBe("Viewer");
    expect(
      await stampedIn(workspace.workspaceId, viewer),
      "no connection was left for the stamp, and it was let go",
    ).toBeUndefined();
  });

  it("writes no row for a member removed mid-request", async () => {
    const workspace = await provisionedWorkspace(db(), "RemovedMidRequest");
    const viewer = await joining(workspace, "Viewer");

    const read = await resolvedIn(workspace.workspaceId, viewer, async () => {
      const removed = await removing(workspace, viewer);
      expect(removed.ok).toBe(true);
    });

    expect(read.ok ? read.value : read.error).toBe("Viewer");
    expect(
      await stampedIn(workspace.workspaceId, viewer),
      "the person had left before the stamp",
    ).toBeUndefined();
  });
});
