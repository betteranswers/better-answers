import { describe, expect, it } from "vitest";
import type { z } from "zod";

import type { Result, Role, UserPrincipal } from "../src/kernel/index.ts";
import {
  changeRole,
  changeRoleInput,
  createGroup,
  exportAuditLog,
  exportAuditLogInput,
  type AuditExport,
} from "../src/members/index.ts";
import type { PostgresDoor, Tx } from "../src/store/postgres/index.ts";
import { provisionedWorkspace, seedPerson, type ProvisionedWorkspace } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { answered, postgresForSuite, readingAs, seedingWith } from "./suite-postgres.ts";

const db = postgresForSuite();

const ISO_INSTANT = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`;

const memberAt = async (
  workspace: ProvisionedWorkspace,
  role: Role,
  person: { readonly name: string; readonly email?: string },
): Promise<string> => {
  const userId = await seedPerson(db().pool, person);
  await seedingWith(db().pool, (seed) =>
    seed.member({ workspaceId: workspace.workspaceId, userId, role }),
  );
  return userId;
};

const principalOf = async (
  workspace: ProvisionedWorkspace,
  userId: string,
): Promise<UserPrincipal> =>
  answered(
    await readingAs(
      db().runtimePool,
      { workspaceId: workspace.workspaceId, userId },
      async (p) => p,
    ),
  );

const exportAs = async (
  workspace: ProvisionedWorkspace,
  userId: string,
  asked: z.input<typeof exportAuditLogInput> = {},
) =>
  exportAuditLog(
    await principalOf(workspace, userId),
    workspace.door,
    inputOf(exportAuditLogInput, asked),
  );

const exported = (made: Result<AuditExport, unknown>): AuditExport => {
  if (!made.ok) throw new Error(`the export was refused: ${String(made.error)}`);
  return made.value;
};

const linesOf = (file: AuditExport): readonly string[] => file.csv.split("\r\n").slice(0, -1);

const exportEvents = async (workspace: ProvisionedWorkspace) =>
  (
    await db().pool.query<{ actor: string; subject_id: string; detail: Record<string, unknown> }>(
      `SELECT actor, subject_id, detail FROM audit_event
        WHERE workspace_id = $1 AND act = 'platform.audit_log.exported'`,
      [workspace.workspaceId],
    )
  ).rows;

const groupMade = async (workspace: ProvisionedWorkspace, userId: string, name: string) =>
  answered(
    await readingAs(
      db().runtimePool,
      { workspaceId: workspace.workspaceId, userId },
      (principal, tx: Tx) => createGroup(principal, tx, { name }),
    ),
  );

/** A group named as given, past the trimming the factory and an Admin's own act both do. */
const groupSeeded = (workspace: ProvisionedWorkspace, name: string) =>
  seedingWith(db().pool, async (seed) => {
    const group = await seed.group({ workspaceId: workspace.workspaceId, name: "Unnamed" });
    await db().pool.query('UPDATE "group" SET name = $1 WHERE id = $2', [name, group.id]);
    await seed.auditEvent({
      workspaceId: workspace.workspaceId,
      act: "people.group.created",
      actor: `human:${workspace.adminUserId}`,
      subjectId: group.id,
      detail: {},
    });
  });

describe("the audit log's export", () => {
  it("writes the events as CSV, newest first, one per line", async () => {
    const workspace = await provisionedWorkspace(db(), "Exported", { name: "Hannah Wright" });
    await groupMade(workspace, workspace.adminUserId, "Bid writers");

    const file = exported(await exportAs(workspace, workspace.adminUserId));

    expect(linesOf(file)).toEqual([
      `"Time","Family","Act","Actor","Subject","Detail"`,
      expect.stringMatching(
        new RegExp(
          String.raw`^"${ISO_INSTANT}","people","people\.group\.created","Hannah Wright","Bid writers",""$`,
        ),
      ),
      expect.stringMatching(
        new RegExp(
          String.raw`^"${ISO_INSTANT}","platform","platform\.workspace\.provisioned","the platform",` +
            `"workspace ${workspace.workspaceId}","role: Admin; adminUserId: ${workspace.adminUserId}"$`,
        ),
      ),
    ]);
    expect(file).toMatchObject({ count: 2, capped: false });
  });

  it("writes the family and search's events alone", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportedNarrow");
    await groupMade(workspace, workspace.adminUserId, "Bid writers");
    await groupMade(workspace, workspace.adminUserId, "Site team");

    const file = exported(
      await exportAs(workspace, workspace.adminUserId, { family: "people", search: "site" }),
    );

    expect(linesOf(file).slice(1)).toEqual([expect.stringContaining('"Site team"')]);
    expect(file.count).toBe(1);
  });

  it("records the Admin, family and person matched, AE11", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportRecorded");
    const address = `priya.${workspace.workspaceId.toLowerCase()}@example.com`;
    const priya = await memberAt(workspace, "Viewer", { name: "Priya Shah", email: address });

    exported(
      await exportAs(workspace, workspace.adminUserId, { family: "people", search: address }),
    );

    const events = await exportEvents(workspace);
    expect(events).toEqual([
      {
        actor: `human:${workspace.adminUserId}`,
        subject_id: workspace.workspaceId,
        detail: {
          matched: [{ kind: "person", id: priya }],
          family: "people",
          eventCount: 0,
          capped: false,
          searchTooBroad: false,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("@");
  });

  it("records the groups a search matched, and no family unasked", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportGroups");
    const group = await groupMade(workspace, workspace.adminUserId, "Bid writers");

    exported(await exportAs(workspace, workspace.adminUserId, { search: "bid" }));

    expect((await exportEvents(workspace))[0]?.detail).toEqual({
      matched: [{ kind: "group", id: group.groupId }],
      eventCount: 1,
      capped: false,
      searchTooBroad: false,
    });
  });

  it("flags and records a search naming over 100 groups", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportTooBroad");
    await seedingWith(db().pool, async (seed) => {
      for (let crew = 1; crew <= 101; crew += 1) {
        await seed.group({ workspaceId: workspace.workspaceId, name: `Crew ${crew}` });
      }
    });

    const file = exported(await exportAs(workspace, workspace.adminUserId, { search: "Crew" }));

    expect(file).toMatchObject({ searchTooBroad: true, capped: false });
    expect(linesOf(file).at(-1)).toBe(
      `"The search named more than 100 people or groups. Only the first 100 were read; narrow it for the rest."`,
    );
    const [recorded] = await exportEvents(workspace);
    expect(recorded?.detail).toMatchObject({ searchTooBroad: true });
    expect(recorded?.detail["matched"]).toHaveLength(100);
  });

  it("matches no one known only to another workspace", async () => {
    const ours = await provisionedWorkspace(db(), "OurExport");
    const address = `una.${ours.workspaceId.toLowerCase()}@example.com`;
    await provisionedWorkspace(db(), "TheirExport", { name: "Una Elsewhere", email: address });

    for (const search of ["Una Elsewhere", address]) {
      exported(await exportAs(ours, ours.adminUserId, { search }));
    }

    expect((await exportEvents(ours)).map((event) => event.detail["matched"])).toEqual([[], []]);
  });

  it("writes a list in the detail as JSON", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportListed");
    const group = await groupMade(workspace, workspace.adminUserId, "Bid writers");
    exported(await exportAs(workspace, workspace.adminUserId, { search: "bid" }));

    const file = exported(await exportAs(workspace, workspace.adminUserId, { family: "platform" }));

    expect(linesOf(file)[1]).toContain(
      `matched: [{""id"":""${group.groupId}"",""kind"":""group""}]`,
    );
  });

  it("names an invitation by the address it was sent to", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportInvited");
    await seedingWith(db().pool, async (seed) => {
      const invitation = await seed.invitation({
        workspaceId: workspace.workspaceId,
        inviterId: workspace.adminUserId,
        email: "jo.bloggs@example.invalid",
      });
      await seed.auditEvent({
        workspaceId: workspace.workspaceId,
        act: "people.invitation.created",
        actor: `human:${workspace.adminUserId}`,
        subjectId: invitation.id,
        detail: { role: "Editor" },
      });
    });

    const file = exported(await exportAs(workspace, workspace.adminUserId, { family: "people" }));

    expect(linesOf(file)[1]).toContain(`,"jo.bloggs@example.invalid","role: Editor"`);
  });

  it("writes a display name starting with = after an apostrophe", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportFormula", { name: "=Priya" });
    await groupMade(workspace, workspace.adminUserId, "Bid writers");

    const file = exported(await exportAs(workspace, workspace.adminUserId, { family: "people" }));

    expect(linesOf(file)[1]).toContain(`,"'=Priya","Bid writers",`);
  });

  it.each([
    ["=1+1", `"'=1+1"`],
    ["+SUM(A1)", `"'+SUM(A1)"`],
    ["-2+3", `"'-2+3"`],
    ["@SUM(A1)", `"'@SUM(A1)"`],
    ["\tcmd", `"'\tcmd"`],
    ["\rcmd", `"'\rcmd"`],
    ["  =1+1", `"'  =1+1"`],
    [",=1+1", `",=1+1"`],
    [`","=HYPERLINK("x")`, `""",""=HYPERLINK(""x"")"`],
    ["Site = team", `"Site = team"`],
  ])("writes the group %j inert", async (name, cell) => {
    const workspace = await provisionedWorkspace(db(), "ExportInert");
    await groupSeeded(workspace, name);

    const file = exported(await exportAs(workspace, workspace.adminUserId, { family: "people" }));

    expect(file.csv).toContain(`,${cell},"`);
  });

  it("stops at 10,000 rows, saying so on a line", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportCapped");
    await seedingWith(db().pool, async (seed) => {
      for (let index = 0; index < 10_001; index += 1) {
        await seed.auditEvent({
          workspaceId: workspace.workspaceId,
          act: "people.group.created",
          actor: `human:${workspace.adminUserId}`,
          detail: {},
        });
      }
    });

    const file = exported(await exportAs(workspace, workspace.adminUserId, { family: "people" }));

    const lines = linesOf(file);
    expect(lines).toHaveLength(10_002);
    expect(lines.at(-1)).toBe(
      `"The export stopped at 10,000 events. Narrow the search or the family for the rest."`,
    );
    expect(file).toMatchObject({ count: 10_000, capped: true });
    expect((await exportEvents(workspace))[0]?.detail).toMatchObject({
      eventCount: 10_000,
      capped: true,
    });
  });

  it.each(["Editor", "Viewer"] as const)(
    "refuses a member at %s, recording nothing",
    async (role) => {
      const workspace = await provisionedWorkspace(db(), `ExportRefused${role}`);
      const member = await memberAt(workspace, role, { name: "Una Member" });

      expect(await exportAs(workspace, member)).toEqual({ ok: false, error: "role-forbids" });
      expect(await exportEvents(workspace)).toEqual([]);
    },
  );

  it("refuses an Admin demoted since, recording nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportDemoted");
    const principal = await principalOf(workspace, workspace.adminUserId);
    await memberAt(workspace, "Admin", { name: "Bea Admin" });
    await db().pool.query(
      "UPDATE member SET role = 'Editor' WHERE workspace_id = $1 AND user_id = $2",
      [workspace.workspaceId, workspace.adminUserId],
    );

    const made = await exportAuditLog(principal, workspace.door, inputOf(exportAuditLogInput, {}));

    expect(made).toEqual({ ok: false, error: "role-disagrees" });
    expect(await exportEvents(workspace)).toEqual([]);
  });
});

/** Holds the group table, so an export stops partway, after its membership is read. */
const groupTableHeld = async () => {
  const holder = await db().pool.connect();
  await holder.query("BEGIN");
  await holder.query('LOCK TABLE "group" IN ACCESS EXCLUSIVE MODE');
  return {
    released: async () => {
      await holder.query("COMMIT");
      holder.release();
    },
  };
};

const waitingOnTheGroupTable = async (): Promise<void> => {
  for (let tries = 0; tries < 100; tries += 1) {
    const waiting = await db().pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
        WHERE c.relname = 'group' AND NOT l.granted`,
    );
    if ((waiting.rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("the export never reached the group table");
};

/** The workspace's door, running `before` ahead of each connection it opens, counted from 1. */
const doorWith = (
  workspace: ProvisionedWorkspace,
  before: (opened: number) => Promise<void>,
): PostgresDoor => {
  const { pool } = workspace.door;
  let opened = 0;
  const connect = async () => {
    opened += 1;
    await before(opened);
    return pool.connect();
  };
  return { pool: Object.assign(Object.create(pool), { connect }) };
};

const exportThrough = async (workspace: ProvisionedWorkspace, door: PostgresDoor) =>
  exportAuditLog(
    await principalOf(workspace, workspace.adminUserId),
    door,
    inputOf(exportAuditLogInput, {}),
  );

describe("an export under way", () => {
  it.each([1, 2])("answers the store failing on connection %i", async (failing) => {
    const workspace = await provisionedWorkspace(db(), `ExportFailed${failing}`);
    const door = doorWith(workspace, async (opened) => {
      if (opened === failing) throw new Error("the store is gone");
    });

    expect(await exportThrough(workspace, door)).toEqual({ ok: false, error: expect.any(Error) });
    expect(await exportEvents(workspace)).toEqual([]);
  });

  it("refuses an Admin demoted while it reads, recording nothing", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportDemotedMidway");
    await memberAt(workspace, "Admin", { name: "Bea Admin" });
    const door = doorWith(workspace, async (opened) => {
      if (opened !== 2) return;
      await db().pool.query(
        "UPDATE member SET role = 'Editor' WHERE workspace_id = $1 AND user_id = $2",
        [workspace.workspaceId, workspace.adminUserId],
      );
    });

    expect(await exportThrough(workspace, door)).toEqual({ ok: false, error: "role-disagrees" });
    expect(await exportEvents(workspace)).toEqual([]);
  });

  it("lets another Admin change a role meanwhile", async () => {
    const workspace = await provisionedWorkspace(db(), "ExportConcurrent");
    const bea = await memberAt(workspace, "Admin", { name: "Bea Admin" });
    const cal = await memberAt(workspace, "Admin", { name: "Cal Admin" });
    const held = await groupTableHeld();

    const exporting = exportAs(workspace, workspace.adminUserId, { search: "Cal" });
    await waitingOnTheGroupTable();
    const changed = await readingAs(
      db().runtimePool,
      { workspaceId: workspace.workspaceId, userId: bea },
      async (principal, tx) => {
        await tx.query("SET LOCAL lock_timeout = '2s'");
        return changeRole(
          principal,
          tx,
          inputOf(changeRoleInput, { personId: cal, role: "Editor" }),
        );
      },
    );
    await held.released();

    expect(changed).toMatchObject({ ok: true, value: { personId: cal, role: "Editor" } });
    expect((await exporting).ok).toBe(true);
  });
});
