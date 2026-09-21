import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { declaredTableNames } from "../scripts/worker-view.ts";
import {
  boundarySchemas,
  CONCEPT_FRONTMATTER_MAX,
  EXEMPT_TABLE_NAMES,
  FAMILIES,
  IDENTITY_SET,
  JOB_KINDS,
  RLS_EXEMPTIONS,
  ROLES,
  SUGGESTION_BODY_MAX,
  ulid,
} from "../src/index.ts";
import { type TestData, testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { refusesEach } from "./probes.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
});

afterAll(async () => {
  await db.stop();
});

const WS_A = "01J6AAAAAAAAAAAAAAAAAAAAAA";
const WS_B = "01J6BBBBBBBBBBBBBBBBBBBBBB";

const EXEMPT = new Set<string>(Object.keys(RLS_EXEMPTIONS));
const tenantTableNames = (): string[] =>
  [...declaredTableNames()].filter((name) => !EXEMPT.has(name));

const seedTwoWorkspaces = async (client: pg.PoolClient) => {
  const seed = testData(client);
  await seed.workspace({ id: WS_A, name: "A" });
  await seed.workspace({ id: WS_B, name: "B" });
  return seed;
};

const countedRows = async (
  client: pg.PoolClient,
  tables: readonly string[],
): Promise<readonly { table: string; rows: number }[]> => {
  const rows: { table: string; rows: number }[] = [];
  for (const table of tables) {
    const found = await client.query(`SELECT 1 FROM "${table}"`);
    rows.push({ table, rows: found.rowCount ?? 0 });
  }
  return rows;
};

const rlsFlags = async (qualified: string) => {
  const [schema, table] = qualified.split(".");
  const flags = await db.pool.query(
    "SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2",
    [schema, table],
  );
  return flags.rows[0];
};

describe("the seam function", () => {
  it("returns NULL when no scope was set, and NULL on an empty one", async () => {
    await withRollback(db.pool, async (client) => {
      const unset = await client.query("SELECT current_workspace_id() AS ws");
      expect(unset.rows[0]?.ws).toBeNull();

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const empty = await client.query("SELECT current_workspace_id() AS ws");
      expect(empty.rows[0]?.ws).toBeNull();
    });
  });

  it("returns the workspace the transaction set", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const set = await client.query("SELECT current_workspace_id() AS ws");
      expect(set.rows[0]?.ws).toBe(WS_A);
    });
  });
});

describe("the exemption list", () => {
  it("names the same tables the two source arrays do, and carries a reason for each", () => {
    expect(Object.keys(RLS_EXEMPTIONS).toSorted()).toEqual([...EXEMPT_TABLE_NAMES].toSorted());
    for (const [table, reason] of Object.entries(RLS_EXEMPTIONS)) {
      expect({ table, reasoned: reason.trim().length > 0 }).toEqual({ table, reasoned: true });
    }
  });
});

describe("every tenant table", () => {
  it("carries RLS and FORCE ROW LEVEL SECURITY in the catalogue", async () => {
    for (const qualified of tenantTableNames()) {
      expect({ table: qualified, ...(await rlsFlags(qualified)) }).toEqual({
        table: qualified,
        rls: true,
        forced: true,
      });
    }
  });

  it("carries exactly one policy — the workspace-isolation one", async () => {
    for (const qualified of tenantTableNames()) {
      const [schema, table] = qualified.split(".");
      const policies = await db.pool.query(
        "SELECT policyname FROM pg_policies WHERE schemaname = $1 AND tablename = $2",
        [schema, table],
      );
      expect({ table: qualified, policies: policies.rows }).toEqual({
        table: qualified,
        policies: [{ policyname: `${table}_workspace_isolation` }],
      });
    }
  });

  it("calls the one seam function in its policy, never a literal or a second function", async () => {
    for (const qualified of tenantTableNames()) {
      const [schema, table] = qualified.split(".");
      const policy = await db.pool.query(
        "SELECT qual, with_check FROM pg_policies WHERE schemaname = $1 AND tablename = $2",
        [schema, table],
      );
      expect({ table: qualified, qual: policy.rows[0]?.qual }).toEqual({
        table: qualified,
        qual: expect.stringContaining("current_workspace_id()"),
      });
      expect(policy.rows[0]?.with_check).toContain("current_workspace_id()");
    }
  });
});

describe("the identity set", () => {
  it("names every declared table that carries no policy, and nothing else", async () => {
    const unpolicied: string[] = [];
    for (const qualified of declaredTableNames()) {
      const flags = await rlsFlags(qualified);
      if (flags?.rls === false) unpolicied.push(qualified);
    }
    expect(unpolicied.toSorted()).toEqual([...EXEMPT].toSorted());
  });

  it("carries no workspace column on Better Auth's tables", async () => {
    for (const qualified of IDENTITY_SET) {
      if (qualified === "public.workspace") continue;
      const [schema, table] = qualified.split(".");
      const column = await db.pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'workspace_id'",
        [schema, table],
      );
      expect({ table: qualified, hasWorkspaceColumn: column.rowCount === 1 }).toEqual({
        table: qualified,
        hasWorkspaceColumn: qualified === "public.member" || qualified === "public.invitation",
      });
    }
  });

  it("is readable by app_rt with no scope set — the picker reads it before any workspace exists", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");

      const unscoped = await client.query("SELECT id FROM workspace ORDER BY id");
      expect(unscoped.rows).toEqual([{ id: WS_A }, { id: WS_B }]);
    });
  });

  it("keeps the two counters UNLOGGED — the limiter cannot become the load it sheds", async () => {
    const persistence = await db.pool.query(
      "SELECT relname, relpersistence FROM pg_class WHERE relname IN ('ingress_counter', 'mcp_call_counter') ORDER BY relname",
    );
    expect(persistence.rows).toEqual([
      { relname: "ingress_counter", relpersistence: "u" },
      { relname: "mcp_call_counter", relpersistence: "u" },
    ]);
  });

  it("refuses the worker role on every identity-set table and the counters (migration 0005)", async () => {
    const refused = [
      ...IDENTITY_SET.filter((name) => name !== "public.workspace"),
      "public.ingress_counter",
      "public.mcp_call_counter",
    ];
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.user({ email: "probe@example.invalid" });
      await client.query("SET LOCAL ROLE worker_rt");
      for (const qualified of refused) {
        const [, table] = qualified.split(".");
        await client.query("SAVEPOINT probe");
        await expect(client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rejects.toThrow(
          /permission denied/,
        );
        await client.query("ROLLBACK TO SAVEPOINT probe");
      }
    });
  });

  it("lets the worker read the workspace table and config, and never write them", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.workspaceConfig({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE worker_rt");

      const workspaces = await client.query("SELECT id FROM workspace ORDER BY id");
      expect(workspaces.rows).toEqual([{ id: WS_A }, { id: WS_B }]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const config = await client.query("SELECT workspace_id FROM workspace_config");
      expect(config.rows).toEqual([{ workspace_id: WS_A }]);

      await client.query("SAVEPOINT w");
      await expect(
        client.query("UPDATE workspace SET name = 'x' WHERE id = $1", [WS_A]),
      ).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK TO SAVEPOINT w");
      await expect(
        client.query("UPDATE workspace_config SET value = 'x' WHERE workspace_id = $1", [WS_A]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe("the role CHECK on the identity set", () => {
  it("holds member_role_check to the same three words the boundary narrows to, both ways", async () => {
    const constraint = await db.pool.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'member_role_check'",
    );
    const inCheck = [...(constraint.rows[0]?.definition ?? "").matchAll(/'([A-Za-z]+)'/g)].map(
      (match) => match[1],
    );
    expect(inCheck.toSorted()).toEqual([...ROLES].toSorted());
    const role = boundarySchemas.member.select.shape.role;
    expect(inCheck.map((word) => role.safeParse(word).success)).toEqual(inCheck.map(() => true));
    expect(role.safeParse("Owner").success).toBe(false);
  });

  it("refuses a member or invitation role outside Admin, Editor and Viewer", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const person = await seed.user();

      await client.query("SAVEPOINT m");
      await expect(
        client.query(
          "INSERT INTO member (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, 'owner', now())",
          [ulid(), WS_A, person.id],
        ),
      ).rejects.toThrow(/member_role_check/);
      await client.query("ROLLBACK TO SAVEPOINT m");

      await client.query("SAVEPOINT i");
      await expect(
        client.query(
          "INSERT INTO invitation (id, workspace_id, email, role, expires_at, inviter_id) VALUES ($1, $2, 'x@example.invalid', 'admin', now(), $3)",
          [ulid(), WS_A, person.id],
        ),
      ).rejects.toThrow(/invitation_role_check/);
      await client.query("ROLLBACK TO SAVEPOINT i");
    });
  });
});

const ledgerRowAsApp = async (client: pg.PoolClient) => {
  const seed = await seedTwoWorkspaces(client);
  const row = await seed.auditEvent({ workspaceId: WS_A });
  await client.query("SET LOCAL ROLE app_rt");
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
  return row;
};

describe("the ledger under app_rt", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's rows otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const inA = await seed.auditEvent({ workspaceId: WS_A });
      await seed.auditEvent({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE app_rt");

      const unscoped = await client.query("SELECT id FROM audit_event");
      expect(unscoped.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const scoped = await client.query("SELECT id, workspace_id FROM audit_event");
      expect(scoped.rows).toEqual([{ id: inA.id, workspace_id: WS_A }]);
    });
  });

  it("lets the app's role read and insert a row, and refuses it UPDATE and DELETE (migration 0009)", async () => {
    await withRollback(db.pool, async (client) => {
      const row = await ledgerRowAsApp(client);

      const inserted = await client.query<{ family: string; subject_kind: string }>(
        `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
         VALUES ($1, $2, 'people.group.created', 'process:better-answers-test', $3, '{}')
         RETURNING family, subject_kind`,
        [ulid(), WS_A, ulid()],
      );
      expect(inserted.rows).toEqual([{ family: "people", subject_kind: "group" }]);

      await client.query("SAVEPOINT u");
      await expect(
        client.query("UPDATE audit_event SET detail = '{}' WHERE id = $1", [row.id]),
      ).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK TO SAVEPOINT u");
      await client.query("SAVEPOINT d");
      await expect(client.query("DELETE FROM audit_event WHERE id = $1", [row.id])).rejects.toThrow(
        /permission denied/,
      );
      await client.query("ROLLBACK TO SAVEPOINT d");
      await expect(client.query("TRUNCATE audit_event")).rejects.toThrow(/permission denied/);
    });
  });

  it("refuses the app's role every other road to a changed row: an upsert, a cross-tenant insert, a derived column written", async () => {
    await withRollback(db.pool, async (client) => {
      const row = await ledgerRowAsApp(client);

      await client.query("SAVEPOINT upsert");
      await expect(
        client.query(
          `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
           VALUES ($1, $2, 'people.group.created', 'process:better-answers-test', $3, '{}')
           ON CONFLICT (id) DO UPDATE SET detail = '{"edited": true}'`,
          [row.id, WS_A, ulid()],
        ),
      ).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK TO SAVEPOINT upsert");

      await client.query("SAVEPOINT other_tenant");
      await expect(
        client.query(
          `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
           VALUES ($1, $2, 'people.group.created', 'process:better-answers-test', $3, '{}')`,
          [ulid(), WS_B, ulid()],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");

      await expect(
        client.query(
          `INSERT INTO audit_event (id, workspace_id, act, family, actor, subject_id, detail)
           VALUES ($1, $2, 'people.group.created', 'platform', 'process:better-answers-test', $3, '{}')`,
          [ulid(), WS_A, ulid()],
        ),
      ).rejects.toThrow(/generated|non-DEFAULT/);
    });
  });

  it("refuses the worker role on the ledger, reading and writing alike (migration 0009)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.auditEvent({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("SAVEPOINT r");
      await expect(client.query("SELECT 1 FROM audit_event LIMIT 1")).rejects.toThrow(
        /permission denied/,
      );
      await client.query("ROLLBACK TO SAVEPOINT r");
      await expect(
        client.query(
          `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
           VALUES ($1, $2, 'sources.binding.published', 'process:better-answers-worker', $3, '{}')`,
          [ulid(), WS_A, ulid()],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("refuses an act outside the four families or the family.subject.verb shape at the row", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      for (const act of ["billing.invoice.sent", "people.member", "People.Member.Added"]) {
        await client.query("SAVEPOINT act");
        await expect(
          client.query(
            `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
             VALUES ($1, $2, $3, 'process:better-answers-test', $4, '{}')`,
            [ulid(), WS_A, act, ulid()],
          ),
        ).rejects.toThrow(/audit_event_act_check|audit_event_family_check/);
        await client.query("ROLLBACK TO SAVEPOINT act");
      }
    });
  });

  it("holds the family CHECK to the same four words the boundary narrows to, both ways", async () => {
    const constraint = await db.pool.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'audit_event_family_check'",
    );
    const inCheck = [...(constraint.rows[0]?.definition ?? "").matchAll(/'([a-z]+)'/g)].map(
      (match) => match[1],
    );
    expect(inCheck.toSorted()).toEqual([...FAMILIES].toSorted());

    const family = boundarySchemas.auditEvent.select.shape.family;
    expect(inCheck.map((word) => family.safeParse(word).success)).toEqual(inCheck.map(() => true));
    expect(family.safeParse("billing").success).toBe(false);
  });
});

const groupsAsApp = async (client: pg.PoolClient) => {
  const seed = await seedTwoWorkspaces(client);
  const person = await seed.user();
  await seed.member({ workspaceId: WS_A, userId: person.id });
  const hr = await seed.group({ workspaceId: WS_A, name: "HR team" });
  const sales = await seed.group({ workspaceId: WS_A, name: "Sales executives" });

  const theirs = await seed.group({ workspaceId: WS_B, name: "HR team" });
  for (const group of [hr, sales]) {
    await seed.groupMember({ workspaceId: WS_A, groupId: group.id, userId: person.id });
  }
  await client.query("SET LOCAL ROLE app_rt");
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
  return { person, hr, sales, theirs };
};

const groupIdsHeldBy = async (client: pg.PoolClient, userId: string): Promise<string[]> => {
  const held = await client.query<{ group_id: string }>(
    "SELECT group_id FROM group_member WHERE user_id = $1 ORDER BY group_id",
    [userId],
  );
  return held.rows.map((row) => row.group_id);
};

describe("the group tables under app_rt", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's groups otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const { hr, sales, theirs } = await groupsAsApp(client);

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      expect((await client.query('SELECT id FROM "group"')).rows).toEqual([]);
      expect((await client.query("SELECT group_id FROM group_member")).rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const ours = await client.query('SELECT id FROM "group" ORDER BY name');
      expect(ours.rows).toEqual([{ id: hr.id }, { id: sales.id }]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      const theirSide = await client.query('SELECT id FROM "group"');
      expect(theirSide.rows).toEqual([{ id: theirs.id }]);
    });
  });

  it("refuses a group written into another tenant, and a membership naming another tenant's group", async () => {
    await withRollback(db.pool, async (client) => {
      const { theirs, person } = await groupsAsApp(client);

      await client.query("SAVEPOINT other_group");
      await expect(
        client.query(
          `INSERT INTO "group" (id, workspace_id, name, origin) VALUES ($1, $2, 'Theirs', 'admin-curated')`,
          [ulid(), WS_B],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_group");

      await client.query("SAVEPOINT other_membership");
      await expect(
        client.query(
          "INSERT INTO group_member (workspace_id, group_id, user_id) VALUES ($1, $2, $3)",
          [WS_B, theirs.id, person.id],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_membership");

      await expect(
        client.query(
          "INSERT INTO group_member (workspace_id, group_id, user_id) VALUES ($1, $2, $3)",
          [WS_A, theirs.id, person.id],
        ),
      ).rejects.toThrow(/group_member_group_fk/);
    });
  });

  it("takes a person out of every group in the workspace when their membership ends", async () => {
    await withRollback(db.pool, async (client) => {
      const { person, hr, sales } = await groupsAsApp(client);
      expect(await groupIdsHeldBy(client, person.id)).toEqual([hr.id, sales.id].toSorted());

      await client.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
        WS_A,
        person.id,
      ]);

      expect(await groupIdsHeldBy(client, person.id)).toEqual([]);

      const groups = await client.query('SELECT count(*)::int AS held FROM "group"');
      expect(groups.rows).toEqual([{ held: 2 }]);
    });
  });

  it("deletes a group's memberships with the group, and leaves every other group's alone", async () => {
    await withRollback(db.pool, async (client) => {
      const { person, hr, sales } = await groupsAsApp(client);

      await client.query('DELETE FROM "group" WHERE workspace_id = $1 AND id = $2', [WS_A, hr.id]);

      expect(await groupIdsHeldBy(client, person.id)).toEqual([sales.id]);
    });
  });

  it("refuses the worker role on both group tables, reading and writing alike (migration 0011)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.group({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const refused: readonly [string, readonly string[]][] = [
        [`SELECT 1 FROM "group" LIMIT 1`, []],
        ["SELECT 1 FROM group_member LIMIT 1", []],
        [
          `INSERT INTO "group" (id, workspace_id, name, origin) VALUES ($1, $2, 'Worker', 'admin-curated')`,
          [ulid(), WS_A],
        ],
        [
          "INSERT INTO group_member (workspace_id, group_id, user_id) VALUES ($1, $2, $3)",
          [WS_A, ulid(), ulid()],
        ],
      ];
      for (const [statement, values] of refused) {
        await client.query("SAVEPOINT worker_probe");
        await expect(client.query(statement, [...values])).rejects.toThrow(/permission denied/);
        await client.query("ROLLBACK TO SAVEPOINT worker_probe");
      }
    });
  });
});

describe("access requests under app_rt", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's rows otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const inA = await seed.accessRequest({ workspaceId: WS_A });
      await seed.accessRequest({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE app_rt");

      const unscoped = await client.query("SELECT id FROM access_request");
      expect(unscoped.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const scoped = await client.query("SELECT id, workspace_id FROM access_request");
      expect(scoped.rows).toEqual([{ id: inA.id, workspace_id: WS_A }]);
    });
  });

  it("refuses the worker role on the access-request queue, reading and writing alike (migration 0013)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const person = await seed.user();
      await seed.accessRequest({ workspaceId: WS_A, requesterId: person.id });
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("SAVEPOINT r");
      await expect(client.query("SELECT 1 FROM access_request LIMIT 1")).rejects.toThrow(
        /permission denied/,
      );
      await client.query("ROLLBACK TO SAVEPOINT r");
      await expect(
        client.query(
          "INSERT INTO access_request (id, workspace_id, requester_id, reason) VALUES ($1, $2, $3, 'let me in')",
          [ulid(), WS_A, person.id],
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("holds one open request per workspace and person, and counts only the waiting ones", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const person = await seed.user();
      const waiting = { workspaceId: WS_A, requesterId: person.id };
      await seed.accessRequest(waiting);

      await client.query("SAVEPOINT second");
      await expect(seed.accessRequest(waiting)).rejects.toThrow(/access_request_waiting_uidx/);
      await client.query("ROLLBACK TO SAVEPOINT second");

      await seed.accessRequest({ workspaceId: WS_B, requesterId: person.id });
      const decided = await seed.accessRequest({
        ...waiting,
        status: "declined",
        decidedBy: person.id,
        decidedAt: new Date(),
      });
      expect(decided.status).toBe("declined");
    });
  });

  it("refuses a fourth status and a decision that only half happened, at the row", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const person = await seed.user();
      const rows: readonly [string, string][] = [
        [
          "INSERT INTO access_request (id, workspace_id, requester_id, reason, status, decided_at, decided_by) VALUES ($1, $2, $3, 'why', 'expired', now(), $3)",
          "access_request_status_check",
        ],
        [
          "INSERT INTO access_request (id, workspace_id, requester_id, reason, status, decided_at) VALUES ($1, $2, $3, 'why', 'declined', now())",
          "access_request_decision_check",
        ],
        [
          "INSERT INTO access_request (id, workspace_id, requester_id, reason, status, decided_at, decided_by, invitation_id) VALUES ($1, $2, $3, 'why', 'declined', now(), $3, 'invitation-1')",
          "access_request_decision_check",
        ],
      ];
      for (const [statement, constraint] of rows) {
        await client.query("SAVEPOINT decision");
        await expect(client.query(statement, [ulid(), WS_A, person.id])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT decision");
      }
    });
  });
});

describe("the concept write path under app_rt", () => {
  const CONCEPT_TABLES = [
    "concept_identity",
    "concept_index",
    "bundle_commit",
    "evidence",
    "concept_verification",
  ] as const;

  it("returns zero rows on a missing scope and only the scoped tenant's rows otherwise, on every one of the five", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);

      for (const workspaceId of [WS_A, WS_B]) {
        const identity = await seed.conceptIdentity({ workspaceId });
        const commit = await seed.bundleCommit({ workspaceId });
        await seed.conceptIndex({ workspaceId, iri: identity.iri, commitSha: commit.sha });
        await seed.evidence({ workspaceId });
        await seed.conceptVerification({ workspaceId, iri: identity.iri });
      }
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, CONCEPT_TABLES)).toEqual(
        CONCEPT_TABLES.map((table) => ({ table, rows: 0 })),
      );

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      expect(await countedRows(client, CONCEPT_TABLES)).toEqual(
        CONCEPT_TABLES.map((table) => ({ table, rows: 1 })),
      );
    });
  });

  it("refuses the worker role on four of the five, reading and writing alike (migrations 0015, 0022)", async () => {
    const OUT_OF_REACH = CONCEPT_TABLES.filter((table) => table !== "concept_index");
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.conceptIndex({ workspaceId: WS_A });
      await seed.bundleCommit({ workspaceId: WS_A });
      await seed.evidence({ workspaceId: WS_A });
      await seed.conceptVerification({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      for (const table of OUT_OF_REACH) {
        await client.query("SAVEPOINT concept");
        await expect(client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rejects.toThrow(
          /permission denied/,
        );
        await client.query("ROLLBACK TO SAVEPOINT concept");
        await expect(client.query(`DELETE FROM "${table}"`)).rejects.toThrow(/permission denied/);
        await client.query("ROLLBACK TO SAVEPOINT concept");
      }
    });
  });

  it("lets the worker read the concept index in its scope and never write it (migration 0022)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) await seed.conceptIndex({ workspaceId });
      await client.query("SET LOCAL ROLE worker_rt");

      expect(await countedRows(client, ["concept_index"])).toEqual([
        { table: "concept_index", rows: 0 },
      ]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      expect(await countedRows(client, ["concept_index"])).toEqual([
        { table: "concept_index", rows: 1 },
      ]);

      await refusesEach(client, [
        [
          "UPDATE concept_index SET title = 'renamed'",
          "the row is derived from a commit the app made, and the worker makes no commits",
        ],
        [
          "UPDATE concept_index SET sensitivity = 'Public'",
          "the derived visibility is the app's; a worker that could write it would be a second opinion about who may read a concept",
        ],
        [
          "DELETE FROM concept_index",
          "a concept leaves the bundle by an act, never by a reader of it",
        ],
      ]);
    });
  });

  it("refuses a concept written into another tenant, and a check naming another tenant's concept", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const theirs = await seed.conceptIdentity({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("SAVEPOINT other_tenant");
      await expect(
        client.query(
          "INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, 'policy:theirs')",
          [WS_B, `${theirs.iri}-copy`],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");

      await expect(
        client.query(
          `INSERT INTO concept_verification (id, workspace_id, iri, actor, content_hash)
           VALUES ($1, $2, $3, 'process:better-answers-test', $4)`,
          [ulid(), WS_A, theirs.iri, "a".repeat(64)],
        ),
      ).rejects.toThrow(/concept_verification_identity_fk/);
    });
  });

  it("refuses every row the write path's sentences forbid, each at its own constraint", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const identity = await seed.conceptIdentity({ workspaceId: WS_A });
      const commit = await seed.bundleCommit({ workspaceId: WS_A });
      const columns =
        "(workspace_id, iri, path, kind, title, frontmatter, body, content_hash, commit_sha, audience, status, sensitivity, published_at)";
      const values = `($1, $2, $3, 'Policy', 'Expenses', '{}'::jsonb, 'body', '${"a".repeat(64)}', '${commit.sha}', 'everyone'`;
      const rows: readonly [string, readonly unknown[], string][] = [
        [
          `INSERT INTO concept_index ${columns} VALUES ${values}, 'retired', 'Internal', NULL)`,
          [WS_A, identity.iri, "knowledge/one.md"],
          "concept_index_status_check",
        ],
        [
          `INSERT INTO concept_index ${columns} VALUES ${values}, 'draft', 'Secret', NULL)`,
          [WS_A, identity.iri, "knowledge/two.md"],
          "concept_index_sensitivity_check",
        ],

        [
          `INSERT INTO concept_index ${columns} VALUES ${values}, 'stable', 'Internal', NULL)`,
          [WS_A, identity.iri, "knowledge/three.md"],
          "concept_index_published_check",
        ],
        [
          `INSERT INTO concept_index ${columns} VALUES ${values}, 'draft', 'Internal', now())`,
          [WS_A, identity.iri, "knowledge/four.md"],
          "concept_index_published_check",
        ],
        [
          "INSERT INTO concept_verification (id, workspace_id, iri, actor, origin, content_hash) VALUES ($1, $2, $3, 'process:better-answers-test', 'imported', $4)",
          [ulid(), WS_A, identity.iri, "a".repeat(64)],
          "concept_verification_imported_check",
        ],

        [
          "INSERT INTO concept_verification (id, workspace_id, iri, actor, origin, content_hash) VALUES ($1, $2, $3, 'process:better-answers-test', 'platform', NULL)",
          [ulid(), WS_A, identity.iri],
          "concept_verification_imported_check",
        ],
        [
          "INSERT INTO bundle_commit (workspace_id, sha, audit_event_id, actor) VALUES ($1, $2, $3, 'process:better-answers-reconciler')",
          [WS_A, "d".repeat(40), commit.auditEventId],
          "bundle_commit_audit_event_uidx",
        ],

        [
          "INSERT INTO bundle_commit (workspace_id, sha, parent_sha, audit_event_id, actor) VALUES ($1, $2, $3, $4, 'process:better-answers-reconciler')",
          [WS_A, "d".repeat(40), "e".repeat(40), ulid()],
          "bundle_commit_parent_fk",
        ],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT concept_row");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT concept_row");
      }
    });
  });

  it("refuses an index row naming a commit the workspace never recorded, when the act ends", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const identity = await seed.conceptIdentity({ workspaceId: WS_A });
      await client.query("SAVEPOINT dangling");
      await client.query(
        `INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter, body,
                                    content_hash, commit_sha, audience, status, sensitivity,
                                    published_at)
         VALUES ($1, $2, 'knowledge/one.md', 'Policy', 'Expenses', '{}'::jsonb, 'body', $3, $4,
                 'everyone', 'stable', 'Internal', now())`,
        [WS_A, identity.iri, "a".repeat(64), "f".repeat(40)],
      );

      await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toThrow(
        /concept_index_bundle_commit_fk/,
      );
      await client.query("ROLLBACK TO SAVEPOINT dangling");
    });
  });
});

describe("the graph tables under app_rt", () => {
  const GRAPH_TABLES = ["graph_generation", "graph_node", "graph_edge"] as const;

  it("returns zero rows on a missing scope and only the scoped tenant's rows otherwise, on all three", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) {
        const from = await seed.graphNode({ workspaceId });
        await seed.graphEdge({ workspaceId, fromUid: from.uid });
      }
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, GRAPH_TABLES)).toEqual(
        GRAPH_TABLES.map((table) => ({ table, rows: 0 })),
      );

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      expect(await countedRows(client, GRAPH_TABLES)).toEqual([
        { table: "graph_generation", rows: 1 },
        { table: "graph_node", rows: 2 },
        { table: "graph_edge", rows: 1 },
      ]);
    });
  });

  it("lets the worker build a generation beside the live one and flip it, and refuses it every edit to a node or an edge (migration 0022)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const live = await seed.graphNode({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const generation = await client.query<{ live_gen: number }>(
        "SELECT live_gen FROM graph_generation WHERE workspace_id = $1",
        [WS_A],
      );
      const next = (generation.rows[0]?.live_gen ?? 0) + 1;
      await client.query(
        "INSERT INTO graph_node (workspace_id, gen, uid, label, kind) VALUES ($1, $2, $3, 'Concept', 'Policy')",
        [WS_A, next, live.uid],
      );
      await client.query(
        "INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid) VALUES ($1, $2, $3, 'DERIVED_FROM', $4, $4)",
        [WS_A, next, `lineage:${live.uid}:0`, live.uid],
      );
      await client.query("UPDATE graph_generation SET live_gen = $2 WHERE workspace_id = $1", [
        WS_A,
        next,
      ]);
      const flipped = await client.query<{ live_gen: number }>(
        "SELECT live_gen FROM graph_generation WHERE workspace_id = $1",
        [WS_A],
      );
      expect(flipped.rows).toEqual([{ live_gen: next }]);

      await refusesEach(client, [
        [
          "UPDATE graph_node SET kind = 'Product'",
          "a rebuild that could edit a node could edit the live generation's",
        ],
        ["DELETE FROM graph_node", "sweeping a retired generation is the app's, not this"],
        [
          "UPDATE graph_edge SET section = 'elsewhere'",
          "the same for an edge, whose section and sentence are a concept's own content",
        ],
        ["DELETE FROM graph_edge", "and the same for the sweep"],
        [
          "DELETE FROM graph_generation",
          "the row that says which generation is live is flipped, never removed",
        ],
      ]);
    });
  });

  it("refuses a flip to any generation but the next, and a row in any generation but the live one or the next (migration 0022)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.graphNode({ workspaceId: WS_A });
      await seed.workspace({ id: "01J6CCCCCCCCCCCCCCCCCCCCCC", name: "C" });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const served: readonly [string, readonly unknown[]][] = [
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 1, 'live', 'Concept')",
          [WS_A],
        ],
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 2, 'next', 'Concept')",
          [WS_A],
        ],
        [
          "INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid) VALUES ($1, 2, 'e-next', 'LINKS_TO', 'next', 'live')",
          [WS_A],
        ],
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, NULL, 'entity', 'source-entity:Person')",
          [WS_A],
        ],
        ["UPDATE graph_generation SET live_gen = 2 WHERE workspace_id = $1", [WS_A]],

        [
          "INSERT INTO graph_generation (workspace_id, live_gen) VALUES ($1, 1) ON CONFLICT (workspace_id) DO UPDATE SET live_gen = graph_generation.live_gen",
          [WS_A],
        ],
      ];
      for (const [statement, parameters] of served) {
        await client.query(statement, [...parameters]);
      }

      await refusesEach(client, [
        [
          "UPDATE graph_generation SET live_gen = 4 WHERE workspace_id = $1",
          "a flip past the generation being built exposes a map nobody wrote",
          [WS_A],
          /flips only to the next/,
        ],
        [
          "UPDATE graph_generation SET live_gen = 1 WHERE workspace_id = $1",
          "a flip back is a swept generation served as the map",
          [WS_A],
          /flips only to the next/,
        ],
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 1, 'retired', 'Concept')",
          "a node into the retired generation, now that 2 is live",
          [WS_A],
          /lands in the live generation or the next/,
        ],
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 4, 'far', 'Concept')",
          "a node into a generation nobody is building",
          [WS_A],
          /lands in the live generation or the next/,
        ],
        [
          "INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid) VALUES ($1, 4, 'e-far', 'LINKS_TO', 'next', 'live')",
          "and an edge the same",
          [WS_A],
          /lands in the live generation or the next/,
        ],
      ]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [
        "01J6CCCCCCCCCCCCCCCCCCCCCC",
      ]);
      await client.query("SAVEPOINT guard_probe");
      await expect(
        client.query(
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 1, 'first', 'Concept')",
          ["01J6CCCCCCCCCCCCCCCCCCCCCC"],
        ),
      ).rejects.toThrow(/lands in the live generation or the next/);
      await client.query("ROLLBACK TO SAVEPOINT guard_probe");
    });
  });

  it("refuses a node written into another tenant, from this tenant's scope", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.graphGeneration({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("SAVEPOINT other_tenant");
      await expect(
        client.query(
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, NULL, 'uid-b', 'source-entity:Person')",
          [WS_B],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");
      await expect(
        client.query(
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 1, 'uid-b', 'Concept')",
          [WS_B],
        ),
      ).rejects.toThrow(/lands in the live generation or the next: live is <NULL>/);
    });
  });

  it("refuses every row the graph's sentences forbid, each at its own constraint", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const node = await seed.graphNode({ workspaceId: WS_A });
      const entity = await seed.graphNode({
        workspaceId: WS_A,
        gen: null,
        label: "source-entity:Person",
        kind: null,
      });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const rows: readonly [string, readonly unknown[], string][] = [
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 1, 'uid-1', 'Widget')",
          [WS_A],
          "graph_node_label_check",
        ],
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 1, 'uid-2', 'source-entity:Person')",
          [WS_A],
          "graph_node_label_check",
        ],
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, NULL, 'uid-6', 'Concept')",
          [WS_A],
          "graph_node_label_check",
        ],
        [
          "INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid) VALUES ($1, 1, 'edge-2', 'source-entity:mentions', 'a', 'b')",
          [WS_A],
          "graph_edge_label_check",
        ],

        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, 0, 'uid-7', 'Concept')",
          [WS_A],
          "graph_node_gen_check",
        ],
        [
          "INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid) VALUES ($1, 0, 'edge-3', 'LINKS_TO', 'a', 'b')",
          [WS_A],
          "graph_edge_gen_check",
        ],
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label, sensitivity) VALUES ($1, 1, 'uid-3', 'Concept', 'Secret')",
          [WS_A],
          "graph_node_sensitivity_check",
        ],

        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, $2, $3, 'Concept')",
          [WS_A, node.gen, node.uid],
          "graph_node_bundle_uidx",
        ],
        [
          "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, NULL, $2, 'source-entity:Person')",
          [WS_A, entity.uid],
          "graph_node_source_entity_uidx",
        ],

        [
          "INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid, sentence) VALUES ($1, 1, 'edge-1', 'SUPERSEDES', 'a', 'b', 'smuggled')",
          [WS_A],
          "graph_edge_links_to_check",
        ],

        [
          "INSERT INTO graph_generation (workspace_id, live_gen) VALUES ($1, 2)",
          [WS_A],
          "graph_generation_pkey",
        ],

        [
          "INSERT INTO graph_generation (workspace_id, live_gen) VALUES ($1, 0)",
          [WS_A],
          "graph_generation_live_gen_check",
        ],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT graph_row");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT graph_row");
      }

      await client.query(
        "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, $2, $3, 'Concept')",
        [WS_A, (node.gen ?? 0) + 1, node.uid],
      );
    });
  });
});

const inboxAsApp = async (client: pg.PoolClient) => {
  const seed = await seedTwoWorkspaces(client);
  const here = await seed.suggestion({ workspaceId: WS_A });
  await seed.conceptWriteRequest({ workspaceId: WS_A, suggestionId: here.id });
  const there = await seed.suggestion({ workspaceId: WS_B });
  await seed.conceptWriteRequest({ workspaceId: WS_B, suggestionId: there.id });
  await client.query("SET LOCAL ROLE app_rt");
  await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
  return { seed, here, there };
};

const deciding = (client: pg.PoolClient, suggestionId: string) =>
  client.query("SELECT set_config('app.deciding_suggestion', $1, true)", [suggestionId]);

const submitRequest = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  suggestion_id: ulid(),
  merge_key: `policy:${ulid().toLowerCase()}`,
  path: `knowledge/${ulid().toLowerCase()}.md`,
  concept_kind: "Policy",
  title: "Expenses",
  frontmatter: '{"title":"Expenses"}',
  body: "Expenses are claimed within thirty days.",
  base_content_hash: null,
  ...overrides,
});

const submitSet = (
  client: pg.PoolClient,
  set: { readonly kind: string; readonly proposer: string; readonly requests: readonly unknown[] },
) =>
  client.query<{ submit_suggestion_set: string }>(
    "SELECT * FROM submit_suggestion_set($1, $2, $3, $4::jsonb)",
    [ulid(), set.kind, set.proposer, JSON.stringify(set.requests)],
  );

describe("the inbox under app_rt", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's suggestions otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const { here } = await inboxAsApp(client);

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      expect((await client.query("SELECT id FROM suggestion")).rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const scoped = await client.query("SELECT id, workspace_id FROM suggestion");
      expect(scoped.rows).toEqual([{ id: here.id, workspace_id: WS_A }]);
    });
  });

  it("refuses both runtime roles the payload table itself, and serves it only through the definer function (migration 0018)", async () => {
    await withRollback(db.pool, async (client) => {
      const { here } = await inboxAsApp(client);

      for (const statement of [
        "SELECT 1 FROM concept_write_request LIMIT 1",
        "DELETE FROM concept_write_request",
      ]) {
        await client.query("SAVEPOINT payload");
        await expect(client.query(statement)).rejects.toThrow(/permission denied/);
        await client.query("ROLLBACK TO SAVEPOINT payload");
      }

      const served = await client.query<{ merge_key: string }>(
        "SELECT merge_key FROM concept_write_request_for($1)",
        [here.id],
      );
      expect(served.rowCount).toBe(1);

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SAVEPOINT worker");
      await expect(client.query("SELECT 1 FROM concept_write_request LIMIT 1")).rejects.toThrow(
        /permission denied/,
      );
      await client.query("ROLLBACK TO SAVEPOINT worker");

      await expect(
        client.query("SELECT 1 FROM concept_write_request_for($1)", [here.id]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("withholds a payload once the suggestion is decided, and one of another tenant always", async () => {
    await withRollback(db.pool, async (client) => {
      const { here, there } = await inboxAsApp(client);

      const foreign = await client.query("SELECT 1 FROM concept_write_request_for($1)", [there.id]);
      expect(foreign.rowCount).toBe(0);

      await deciding(client, here.id);
      await client.query(
        `UPDATE suggestion SET status = 'declined', decider = 'process:better-answers-test',
                decided_at = now(), reason = 'not the company''s word on this'
          WHERE workspace_id = $1 AND id = $2`,
        [WS_A, here.id],
      );

      const decided = await client.query("SELECT 1 FROM concept_write_request_for($1)", [here.id]);
      expect(decided.rowCount).toBe(0);
    });
  });

  it("refuses the app's role a deleted suggestion, so a decision can never become a silence", async () => {
    await withRollback(db.pool, async (client) => {
      const { here } = await inboxAsApp(client);

      await expect(
        client.query("DELETE FROM suggestion WHERE workspace_id = $1 AND id = $2", [WS_A, here.id]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("decides a waiting suggestion once, and refuses every road back out of a decision (migration 0018)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const decided = await seed.suggestion({ workspaceId: WS_A });
      const waiting = await seed.suggestion({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const decline = async (id: string, extra = "") => {
        await deciding(client, id);
        return client.query(
          `UPDATE suggestion
              SET status = 'declined', decider = 'process:better-answers-test',
                  decided_at = now(), reason = 'not the company''s word on this'${extra}
            WHERE workspace_id = $1 AND id = $2`,
          [WS_A, id],
        );
      };

      expect((await decline(decided.id)).rowCount).toBe(1);

      const refusals: readonly [() => Promise<unknown>, RegExp][] = [
        [() => decline(decided.id), /decided as declined already/],
        [
          () =>
            client.query(
              `UPDATE suggestion SET status = 'waiting', decider = NULL, decided_at = NULL,
                      reason = NULL WHERE workspace_id = $1 AND id = $2`,
              [WS_A, decided.id],
            ),
          /decided as declined already/,
        ],
        [
          () =>
            client.query("UPDATE suggestion SET set_id = $3 WHERE workspace_id = $1 AND id = $2", [
              WS_A,
              waiting.id,
              ulid(),
            ]),
          /an update to a waiting suggestion decides it/,
        ],
        [
          () => decline(waiting.id, ", proposer = 'human:01J6CCCCCCCCCCCCCCCCCCCCCC'"),
          /never restates what was proposed/,
        ],
      ];
      for (const [statement, message] of refusals) {
        await client.query("SAVEPOINT decision");
        await expect(statement()).rejects.toThrow(message);
        await client.query("ROLLBACK TO SAVEPOINT decision");
      }
    });
  });

  it("refuses a first decision from a transaction that never said it was making one (migration 0018)", async () => {
    await withRollback(db.pool, async (client) => {
      const { here } = await inboxAsApp(client);
      const decline = (id: string) =>
        client.query(
          `UPDATE suggestion SET status = 'declined', decider = 'process:better-answers-test',
                  decided_at = now(), reason = 'not the company''s word on this'
            WHERE workspace_id = $1 AND id = $2`,
          [WS_A, id],
        );

      await client.query("SAVEPOINT bare");
      await expect(decline(here.id)).rejects.toThrow(/this transaction is not making it/);
      await client.query("ROLLBACK TO SAVEPOINT bare");

      await deciding(client, ulid());
      await client.query("SAVEPOINT elsewhere");
      await expect(decline(here.id)).rejects.toThrow(/this transaction is not making it/);
      await client.query("ROLLBACK TO SAVEPOINT elsewhere");

      await deciding(client, here.id);
      expect((await decline(here.id)).rowCount).toBe(1);
    });
  });

  it("lets each tier raise only the kinds that are its own, whatever a caller names (migration 0018)", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      const submit = (kind: string, proposer: string) =>
        submitSet(client, { kind, proposer, requests: [submitRequest()] });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("SAVEPOINT kind");
      await expect(submit("edit", "human:01J6CCCCCCCCCCCCCCCCCCCCCC")).rejects.toThrow(
        /worker_rt may not raise a suggestion of kind edit/,
      );
      await client.query("ROLLBACK TO SAVEPOINT kind");

      const repaired = await submit("repair", "process:better-answers-citation-repair");
      expect(repaired.rowCount).toBe(1);

      await client.query("SET LOCAL ROLE app_rt");

      await client.query("SAVEPOINT app");
      await expect(submit("repair", "process:better-answers-citation-repair")).rejects.toThrow(
        /app_rt may not raise a suggestion of kind repair/,
      );
      await client.query("ROLLBACK TO SAVEPOINT app");
      await expect(submit("candidate", "better-answers-extraction/1.2")).rejects.toThrow(
        /app_rt may not raise a suggestion of kind candidate/,
      );
    });
  });

  it("refuses the worker role the queue, and lets it submit a set through the function alone (migration 0018)", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("SAVEPOINT queue");
      await expect(client.query("SELECT 1 FROM suggestion LIMIT 1")).rejects.toThrow(
        /permission denied/,
      );
      await client.query("ROLLBACK TO SAVEPOINT queue");

      const submitted = await submitSet(client, {
        kind: "candidate",
        proposer: "better-answers-extract/1.0",
        requests: [submitRequest({ merge_key: "policy:expenses", path: "knowledge/expenses.md" })],
      });
      expect(submitted.rowCount).toBe(1);
    });
  });

  it("refuses a set larger than one an Admin could decide, and one carrying nothing", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      for (const requests of [[], Array.from({ length: 501 }, () => submitRequest())]) {
        await client.query("SAVEPOINT sized");
        await expect(
          submitSet(client, {
            kind: "edit",
            proposer: "process:better-answers-test",
            requests,
          }),
        ).rejects.toThrow(/between one and 500 requests/);
        await client.query("ROLLBACK TO SAVEPOINT sized");
      }
    });
  });

  it("refuses a submission from a transaction that names no workspace", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");

      await expect(
        client.query("SELECT * FROM submit_suggestion_set($1, 'edit', $2, '[]'::jsonb)", [
          ulid(),
          "process:better-answers-test",
        ]),
      ).rejects.toThrow(/scoped to no workspace/);
    });
  });

  it("refuses every half-decided suggestion the write path forbids, each at its own constraint", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const identity = await seed.conceptIdentity({ workspaceId: WS_A });
      const columns =
        "(workspace_id, id, set_id, kind, proposer, status, decider, decided_at, reason, target_iri)";
      const rows: readonly [string, string][] = [
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'withdrawn', $4, now(), NULL, NULL)`,
          "suggestion_status_check",
        ],
        [
          `VALUES ($1, $2, $3, 'merge', $4, 'waiting', NULL, NULL, NULL, NULL)`,
          "suggestion_kind_check",
        ],

        [
          `VALUES ($1, $2, $3, 'edit', $4, 'declined', NULL, now(), 'why', NULL)`,
          "suggestion_decision_check",
        ],
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'declined', $4, NULL, 'why', NULL)`,
          "suggestion_decision_check",
        ],

        [
          `VALUES ($1, $2, $3, 'edit', $4, 'declined', $4, now(), NULL, NULL)`,
          "suggestion_decision_check",
        ],
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'accepted', $4, now(), 'why', '${identity.iri}')`,
          "suggestion_decision_check",
        ],

        [
          `VALUES ($1, $2, $3, 'edit', $4, 'waiting', NULL, NULL, NULL, '${identity.iri}')`,
          "suggestion_decision_check",
        ],
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'accepted', $4, now(), NULL, NULL)`,
          "suggestion_decision_check",
        ],

        [
          `VALUES ($1, $2, $3, 'edit', $4, 'waiting', $4, now(), NULL, NULL)`,
          "suggestion_decision_check",
        ],

        [
          `VALUES ($1, $2, $3, 'edit', $4, 'declined', 'Ada Editor', now(), 'why', NULL)`,
          "suggestion_decider_check",
        ],
      ];
      for (const [values, constraint] of rows) {
        await client.query("SAVEPOINT decision");
        await expect(
          client.query(`INSERT INTO suggestion ${columns} ${values}`, [
            WS_A,
            ulid(),
            ulid(),
            "process:better-answers-test",
          ]),
        ).rejects.toThrow(new RegExp(constraint));
        await client.query("ROLLBACK TO SAVEPOINT decision");
      }

      const proposers: readonly [string, string, string][] = [
        ["edit", "ada@acme.invalid", "suggestion_proposer_check"],
        ["repair", "human:01J6CCCCCCCCCCCCCCCCCCCCCC", "suggestion_repair_proposer_check"],
        ["repair", "better-answers-citation-repair/1.0", "suggestion_repair_proposer_check"],
      ];
      for (const [kind, proposer, constraint] of proposers) {
        await client.query("SAVEPOINT proposer");
        await expect(
          client.query(
            `INSERT INTO suggestion (workspace_id, id, set_id, kind, proposer)
             VALUES ($1, $2, $3, $4, $5)`,
            [WS_A, ulid(), ulid(), kind, proposer],
          ),
        ).rejects.toThrow(new RegExp(constraint));
        await client.query("ROLLBACK TO SAVEPOINT proposer");
      }

      const platform = await client.query(
        `INSERT INTO suggestion (workspace_id, id, set_id, kind, proposer)
         VALUES ($1, $2, $3, 'repair', 'process:better-answers-citation-repair') RETURNING id`,
        [WS_A, ulid(), ulid()],
      );
      expect(platform.rowCount).toBe(1);
    });
  });

  it("refuses a body larger than a concept could be, at the row", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const here = await seed.suggestion({ workspaceId: WS_A });

      await expect(
        client.query(
          `INSERT INTO concept_write_request
             (workspace_id, suggestion_id, merge_key, path, concept_kind, title, frontmatter, body)
           VALUES ($1, $2, 'policy:big', 'knowledge/big.md', 'Policy', 'Big', '{}'::jsonb, $3)`,
          [WS_A, here.id, "x".repeat(SUGGESTION_BODY_MAX + 1)],
        ),
      ).rejects.toThrow(/concept_write_request_body_length_check/);
    });
  });

  it("bounds a frontmatter by the characters its caller wrote, at the one road to the row (migration 0018)", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const submit = (frontmatter: unknown) =>
        submitSet(client, {
          kind: "candidate",
          proposer: "better-answers-extraction/1.2",
          requests: [submitRequest({ frontmatter })],
        });

      const wide = JSON.stringify({ a: 1e-100, title: "Expenses" });
      expect(wide.length).toBeLessThan(CONCEPT_FRONTMATTER_MAX);
      expect((await submit(wide)).rowCount).toBe(1);

      await client.query("SAVEPOINT frontmatter");
      await expect(
        submit(JSON.stringify({ title: "x".repeat(CONCEPT_FRONTMATTER_MAX) })),
      ).rejects.toThrow(/frontmatter is the producer's own JSON text/);
      await client.query("ROLLBACK TO SAVEPOINT frontmatter");

      await client.query("SAVEPOINT shape");
      await expect(submit({ title: "Expenses" })).rejects.toThrow(
        /frontmatter is the producer's own JSON text/,
      );
      await client.query("ROLLBACK TO SAVEPOINT shape");

      for (const notAnObject of ["[1,2]", '"str"', "null", "7"]) {
        await client.query("SAVEPOINT shape");
        await expect(submit(notAnObject)).rejects.toThrow(/a JSON object of at most/);
        await client.query("ROLLBACK TO SAVEPOINT shape");
      }
    });
  });

  it("refuses a target naming another tenant's concept, whatever the row says", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const theirs = await seed.conceptIdentity({ workspaceId: WS_B });
      const here = await seed.suggestion({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await deciding(client, here.id);

      await expect(
        client.query(
          `UPDATE suggestion SET status = 'accepted', decider = 'process:better-answers-test',
                  decided_at = now(), target_iri = $3
            WHERE workspace_id = $1 AND id = $2`,
          [WS_A, here.id, theirs.iri],
        ),
      ).rejects.toThrow(/suggestion_target_fk/);
    });
  });
});

describe("a tenant table under app_rt", () => {
  it("returns zero rows on a missing scope, never another tenant's", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.workspaceConfig({ workspaceId: WS_A });
      await seed.workspaceConfig({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE app_rt");

      const unscoped = await client.query("SELECT workspace_id FROM workspace_config");
      expect(unscoped.rows).toEqual([]);
    });
  });

  it("returns exactly the scoped tenant's rows", async () => {
    await withRollback(db.pool, async (client) => {
      /* jscpd:ignore-start */
      const seed = await seedTwoWorkspaces(client);
      await seed.workspaceConfig({ workspaceId: WS_A });
      await seed.workspaceConfig({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      /* jscpd:ignore-end */

      const scoped = await client.query("SELECT workspace_id FROM workspace_config");
      expect(scoped.rows).toEqual([{ workspace_id: WS_A }]);
    });
  });

  it("returns zero llm_route rows on a missing or empty scope", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.llmRoute({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE app_rt");

      const unscoped = await client.query("SELECT id FROM llm_route");
      expect(unscoped.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const emptyScope = await client.query("SELECT id FROM llm_route");
      expect(emptyScope.rows).toEqual([]);
    });
  });

  it("refuses a write into another tenant's scope", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await expect(seed.llmRoute({ workspaceId: WS_B })).rejects.toThrow(/row-level security/);
    });
  });

  it("scopes the per-token counter to its tenant, so one workspace's tokens never read another's counts", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query(
        "INSERT INTO mcp_call_counter (workspace_id, token_id, window_start, count) VALUES ($1, 'jti-1', now(), 1)",
        [WS_A],
      );

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      const otherTenant = await client.query("SELECT token_id FROM mcp_call_counter");
      expect(otherTenant.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const missingScope = await client.query("SELECT token_id FROM mcp_call_counter");
      expect(missingScope.rows).toEqual([]);
    });
  });
});

describe("the workspace-lifecycle function", () => {
  it("creates the chunk partition and its full-text index for app_rt, in one transaction", async () => {
    await withRollback(db.pool, async (client) => {
      /* jscpd:ignore-start */
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("SELECT create_workspace_partition($1)", [WS_A]);
      /* jscpd:ignore-end */

      const partition = await client.query(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'index' AND c.relname = $1",
        [`chunk_${WS_A}`],
      );
      expect(partition.rowCount).toBe(1);

      const index = await client.query(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'index' AND tablename = $1",
        [`chunk_${WS_A}`],
      );
      const definitions = index.rows.map((row) => String(row.indexdef)).join(" ");
      expect({
        fullText: definitions.includes("USING gin (search)"),
        vector: definitions.includes("hnsw"),
      }).toEqual({ fullText: true, vector: false });
    });

    const afterRollback = await db.pool.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'index' AND c.relname = $1",
      [`chunk_${WS_A}`],
    );
    expect(afterRollback.rowCount).toBe(0);
  });

  it("is refused to any role but app_rt", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query("SET LOCAL ROLE worker_rt");
      await expect(client.query("SELECT create_workspace_partition($1)", [WS_A])).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("refuses a workspace the transaction is not scoped to, and an unknown one", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");

      await expect(client.query("SELECT create_workspace_partition($1)", [WS_A])).rejects.toThrow(
        /not scoped/,
      );
    });
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await expect(client.query("SELECT create_workspace_partition($1)", [WS_B])).rejects.toThrow(
        /not scoped/,
      );
    });
    await withRollback(db.pool, async (client) => {
      const unknown = "01J6CCCCCCCCCCCCCCCCCCCCCC";
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [unknown]);

      await expect(
        client.query("SELECT create_workspace_partition($1)", [unknown]),
      ).rejects.toThrow(/no such workspace/);
    });
  });

  it("scopes chunk rows to their tenant through the parent, and denies the child table outright", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("SELECT create_workspace_partition($1)", [WS_A]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      await client.query("SELECT create_workspace_partition($1)", [WS_B]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await seed.chunk({ workspaceId: WS_A, content: "hello" });

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      const otherTenant = await client.query('SELECT id FROM "index".chunk');
      expect(otherTenant.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const missingScope = await client.query('SELECT id FROM "index".chunk');
      expect(missingScope.rows).toEqual([]);
    });
  });

  it("denies a direct query against a partition, whatever the scope", async () => {
    await withRollback(db.pool, async (client) => {
      /* jscpd:ignore-start */
      const seed = await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("SELECT create_workspace_partition($1)", [WS_A]);
      await seed.chunk({ workspaceId: WS_A, content: "hello" });
      /* jscpd:ignore-end */

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      await client.query("SAVEPOINT direct_query");
      await expect(client.query(`SELECT id FROM "index"."chunk_${WS_A}"`)).rejects.toThrow(
        /permission denied/,
      );
      await client.query("ROLLBACK TO SAVEPOINT direct_query");

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await expect(client.query(`SELECT id FROM "index"."chunk_${WS_A}"`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});

describe("the chunk index under worker_rt", () => {
  const TABLE_PRIVILEGES = [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
    "MAINTAIN",
  ] as const;

  const privilegesHeld = async (
    client: pg.PoolClient,
    role: string,
    table: string,
  ): Promise<Record<string, boolean>> => {
    const held = await client.query<{ privilege: string; held: boolean }>(
      "SELECT privilege, has_table_privilege($1, $2, privilege) AS held FROM unnest($3::text[]) AS privilege",
      [role, table, [...TABLE_PRIVILEGES]],
    );
    return Object.fromEntries(held.rows.map((row) => [row.privilege, row.held]));
  };

  it("holds the four verbs on the parent and no other privilege, and nothing at all on a partition (migrations 0000 and 0037)", async () => {
    await withRollback(db.pool, async (client) => {
      /* jscpd:ignore-start */
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("SELECT create_workspace_partition($1)", [WS_A]);
      /* jscpd:ignore-end */

      await client.query("RESET ROLE");

      expect(await privilegesHeld(client, "worker_rt", '"index".chunk')).toEqual({
        SELECT: true,
        INSERT: true,
        UPDATE: true,
        DELETE: true,
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
        MAINTAIN: false,
      });

      expect(await privilegesHeld(client, "worker_rt", `"index"."chunk_${WS_A}"`)).toEqual({
        SELECT: false,
        INSERT: false,
        UPDATE: false,
        DELETE: false,
        TRUNCATE: false,
        REFERENCES: false,
        TRIGGER: false,
        MAINTAIN: false,
      });
    });
  });

  it("reads this tenant's chunk rows through the parent, and none on another scope or no scope", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const mine = await seed.chunk({ workspaceId: WS_A, content: "ours" });
      await client.query("SET LOCAL ROLE worker_rt");

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const scoped = await client.query('SELECT id FROM "index".chunk');

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      const otherTenant = await client.query('SELECT id FROM "index".chunk');

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const missingScope = await client.query('SELECT id FROM "index".chunk');

      expect({
        scoped: scoped.rows,
        otherTenant: otherTenant.rows,
        missingScope: missingScope.rows,
      }).toEqual({ scoped: [{ id: mine.id }], otherTenant: [], missingScope: [] });
    });
  });
});

describe("the audience pair on every readable unit", () => {
  const AUDIENCE_TABLES: readonly [string, string, (seed: TestData) => Promise<unknown>][] = [
    [
      "concept_index",
      "concept_index_audience_check",
      (seed) => seed.conceptIndex({ workspaceId: WS_A }),
    ],
    ["graph_node", "graph_node_audience_check", (seed) => seed.graphNode({ workspaceId: WS_A })],
    ["graph_edge", "graph_edge_audience_check", (seed) => seed.graphEdge({ workspaceId: WS_A })],
    ['"index".chunk', "chunk_audience_check", (seed) => seed.chunk({ workspaceId: WS_A })],
    [
      "source_binding",
      "source_binding_audience_check",
      (seed) => seed.sourceBinding({ workspaceId: WS_A }),
    ],
    [
      "composition",
      "composition_audience_check",
      (seed) => seed.composition({ workspaceId: WS_A }),
    ],
    [
      "concept_class_override",
      "concept_class_override_audience_check",
      (seed) => seed.conceptClassOverride({ workspaceId: WS_A }),
    ],
  ];

  it.each(AUDIENCE_TABLES)(
    "holds the word to the array on %s, refusing every half-shape and landing both whole ones",
    async (table, constraint, seedOne) => {
      await withRollback(db.pool, async (client) => {
        const seed = await seedTwoWorkspaces(client);
        await seedOne(seed);
        await client.query("SET LOCAL ROLE app_rt");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

        const halfShapes = [
          "audience = 'groups', audience_groups = NULL",
          "audience = 'groups', audience_groups = '{}'",
          "audience = 'groups', audience_groups = ARRAY[NULL]::text[]",
          "audience = 'everyone', audience_groups = ARRAY['01J6JJJJJJJJJJJJJJJJJJJJJJ']",
          "audience = 'members', audience_groups = NULL",
        ];
        for (const half of halfShapes) {
          await client.query("SAVEPOINT half_shape");
          await expect(
            client.query(`UPDATE ${table} SET ${half} WHERE workspace_id = $1`, [WS_A]),
          ).rejects.toThrow(new RegExp(constraint));
          await client.query("ROLLBACK TO SAVEPOINT half_shape");
        }

        const narrowed = await client.query(
          `UPDATE ${table} SET audience = 'groups', audience_groups = ARRAY['01J6JJJJJJJJJJJJJJJJJJJJJJ'] WHERE workspace_id = $1`,
          [WS_A],
        );
        expect(narrowed.rowCount).toBeGreaterThan(0);
        const widened = await client.query(
          `UPDATE ${table} SET audience = 'everyone', audience_groups = NULL WHERE workspace_id = $1`,
          [WS_A],
        );
        expect(widened.rowCount).toBe(narrowed.rowCount);
      });
    },
  );
});

describe("the rules in force on a source binding", () => {
  it("gives a binding nobody configured the safe set, and takes the one flip that changes it", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const id = ulid();
      await client.query(
        "INSERT INTO source_binding (workspace_id, id, name, connector) VALUES ($1, $2, 'The handbook', 'upload')",
        [WS_A, id],
      );

      const born = await client.query<{ rules_in_force: Record<string, boolean> }>(
        "SELECT rules_in_force FROM source_binding WHERE id = $1",
        [id],
      );
      expect(born.rows).toEqual([{ rules_in_force: { default_on: true, default_off: false } }]);

      const flipped = await client.query(
        `UPDATE source_binding SET rules_in_force = '{"default_on": true, "default_off": true}'::jsonb
          WHERE id = $1`,
        [id],
      );
      expect(flipped.rowCount).toBe(1);
    });
  });

  it("refuses a set of rules the seam could not read as tiers", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const binding = await seed.sourceBinding({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const offShape = [
        `'{"default_on": true}'::jsonb`,

        `'{"default_on": true, "default_off": "no"}'::jsonb`,

        `'null'::jsonb`,

        `'[]'::jsonb`,
        `'"default_on"'::jsonb`,
      ];
      for (const value of offShape) {
        await client.query("SAVEPOINT rules_in_force_row");
        await expect(
          client.query(`UPDATE source_binding SET rules_in_force = ${value} WHERE id = $1`, [
            binding.id,
          ]),
        ).rejects.toThrow(/source_binding_rules_in_force_check/);
        await client.query("ROLLBACK TO SAVEPOINT rules_in_force_row");
      }
    });
  });
});

describe("the derivation's tables under app_rt", () => {
  const DERIVATION_TABLES = [
    "source_binding",
    "source_document",
    "concept_evidence",
    "concept_class_override",
    "composition",
    "composition_include",
  ] as const;

  const seedOneOfEach = async (seed: TestData, workspaceId: string) => {
    const binding = await seed.sourceBinding({ workspaceId });
    const document = await seed.sourceDocument({ workspaceId, bindingId: binding.id });
    const identity = await seed.conceptIdentity({ workspaceId });
    const cited = await seed.conceptEvidence({
      workspaceId,
      iri: identity.iri,
      sourceDocumentId: document.id,
    });
    await seed.conceptClassOverride({ workspaceId, iri: identity.iri });
    const composed = await seed.composition({ workspaceId });
    await seed.compositionInclude({ workspaceId, compositionId: composed.id, iri: identity.iri });
    return { binding, document, identity, cited, composed };
  };

  it("returns zero rows on a missing scope and only the scoped tenant's rows otherwise, on all six", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) await seedOneOfEach(seed, workspaceId);
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, DERIVATION_TABLES)).toEqual(
        DERIVATION_TABLES.map((table) => ({ table, rows: 0 })),
      );

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      expect(await countedRows(client, DERIVATION_TABLES)).toEqual(
        DERIVATION_TABLES.map((table) => ({ table, rows: 1 })),
      );
    });
  });

  const REFUSED_TO_THE_WORKER = [
    "concept_evidence",
    "concept_class_override",
    "composition",
    "composition_include",
  ] as const;

  it("refuses the worker four of the six, and serves it exactly what a run reconciles on the other two (migrations 0020, 0037)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const seeded = await seedOneOfEach(seed, WS_A);
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      for (const table of REFUSED_TO_THE_WORKER) {
        await refusesEach(client, [
          [`SELECT 1 FROM "${table}" LIMIT 1`, `the worker reading ${table}`],
          [`DELETE FROM "${table}"`, `the worker taking a row off ${table}`],
        ]);
      }

      const binding = await client.query("SELECT id FROM source_binding");
      const document = await client.query("SELECT id FROM source_document");
      await client.query(
        "UPDATE source_document SET last_seen = now(), outcome = 'converted' WHERE id = $1",
        [seeded.document.id],
      );

      await client.query(
        `UPDATE source_document
            SET outcome = 'quarantined', quarantine_error = 'NeedsOcrError'
          WHERE id = $1`,
        [seeded.document.id],
      );
      const quarantined = await client.query(
        "SELECT outcome, quarantine_error FROM source_document WHERE id = $1",
        [seeded.document.id],
      );
      expect({
        binding: binding.rows,
        document: document.rows,
        quarantined: quarantined.rows,
      }).toEqual({
        binding: [{ id: seeded.binding.id }],
        document: [{ id: seeded.document.id }],
        quarantined: [{ outcome: "quarantined", quarantine_error: "NeedsOcrError" }],
      });

      await refusesEach(client, [
        [
          "UPDATE source_binding SET name = 'renamed by a run'",
          "a binding is what an Admin made, and the tier that indexes it has no say in what it is",
        ],
        [
          `INSERT INTO source_binding (workspace_id, id, name, connector, sensitivity, audience)
             VALUES ($1, $2, 'A binding nobody made', 'upload', 'Restricted', 'everyone')`,
          "a worker that could insert a binding could bind a source no Admin ever connected",
          [WS_A, ulid()],
        ],
        [
          "DELETE FROM source_binding",
          "and one that could remove a binding could take a published source away without a record",
        ],
        [
          `INSERT INTO source_document
             (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
           VALUES ($1, $2, $3, 'invented.md', 'Invented', 'text/markdown', 1, 'documents/x/original')`,
          "a worker that could insert a document row could catalogue a document nobody uploaded",
          [WS_A, ulid(), seeded.binding.id],
        ],
        [
          "DELETE FROM source_document",
          "the withdrawal of a document is an act with a ledger row, so the run marks one gone and never removes it",
        ],
      ]);
    });
  });

  it("refuses a row naming another tenant's binding or concept, and a citation of evidence nobody recorded, each at its key", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const ours = await seedOneOfEach(seed, WS_A);
      const theirs = await seedOneOfEach(seed, WS_B);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const rows: readonly [string, readonly unknown[], string][] = [
        [
          `INSERT INTO source_document
             (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
           VALUES ($1, $2, $3, 'handbook.md', 'The handbook', 'text/markdown', 1024, 'documents/x/original')`,
          [WS_A, ulid(), theirs.binding.id],
          "source_document_binding_fk",
        ],
        [
          "INSERT INTO composition_include (workspace_id, composition_id, id, ordinal, iri) VALUES ($1, $2, 'i9', 9, $3)",
          [WS_A, ours.composed.id, theirs.identity.iri],
          "composition_include_identity_fk",
        ],
        [
          `INSERT INTO concept_class_override (workspace_id, iri, sensitivity, audience, actor, audit_event_id)
           VALUES ($1, $2, 'Internal', 'everyone', 'process:better-answers-test', $3)`,
          [WS_A, theirs.identity.iri, ulid()],
          "concept_class_override_identity_fk",
        ],

        [
          "INSERT INTO concept_evidence (workspace_id, iri, source_document_id, locator) VALUES ($1, $2, $3, 'p.99')",
          [WS_A, ours.identity.iri, ours.document.id],
          "concept_evidence_evidence_fk",
        ],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT derivation_row");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT derivation_row");
      }
    });
  });

  it("refuses an override by an actor of no known form, or to a class outside the three", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const identity = await seed.conceptIdentity({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const override = (actor: string, sensitivity: string) =>
        client.query(
          `INSERT INTO concept_class_override (workspace_id, iri, sensitivity, audience, actor, audit_event_id)
           VALUES ($1, $2, $3, 'everyone', $4, $5)`,
          [WS_A, identity.iri, sensitivity, actor, ulid()],
        );

      await client.query("SAVEPOINT actor");
      await expect(override("Ada Admin", "Internal")).rejects.toThrow(
        /concept_class_override_actor_check/,
      );
      await client.query("ROLLBACK TO SAVEPOINT actor");
      await client.query("SAVEPOINT class");
      await expect(override("human:01J6CCCCCCCCCCCCCCCCCCCCCC", "Secret")).rejects.toThrow(
        /concept_class_override_sensitivity_check/,
      );
      await client.query("ROLLBACK TO SAVEPOINT class");

      const landed = await override("human:01J6CCCCCCCCCCCCCCCCCCCCCC", "Internal");
      expect(landed.rowCount).toBe(1);
    });
  });

  it("keeps cited evidence while a citation names it, and takes the citation with its concept", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const ours = await seedOneOfEach(seed, WS_A);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("SAVEPOINT cited");
      await expect(
        client.query(
          "DELETE FROM evidence WHERE workspace_id = $1 AND source_document_id = $2 AND locator = $3",
          [WS_A, ours.cited.sourceDocumentId, ours.cited.locator],
        ),
      ).rejects.toThrow(/concept_evidence_evidence_fk/);
      await client.query("ROLLBACK TO SAVEPOINT cited");

      await client.query("DELETE FROM concept_identity WHERE workspace_id = $1 AND iri = $2", [
        WS_A,
        ours.identity.iri,
      ]);
      expect(
        await countedRows(client, [
          "concept_evidence",
          "concept_class_override",
          "composition_include",
        ]),
      ).toEqual([
        { table: "concept_evidence", rows: 0 },
        { table: "concept_class_override", rows: 0 },
        { table: "composition_include", rows: 0 },
      ]);
    });
  });
});

const RECORD_A_NAME = `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                           char_start, char_end, score, rule_version, detector_pin)
                       VALUES ($1, $2, $3, 'person-name', $4, 'PERSON', $5, $6, 0.97, 'r2', 'd2')`;

const REFRESH_THE_READING = `ON CONFLICT (workspace_id, document_id, rule_id, char_start, char_end)
  DO UPDATE SET category = EXCLUDED.category,
                tier = CASE WHEN finding.restored_at IS NULL THEN EXCLUDED.tier ELSE finding.tier END,
                score = EXCLUDED.score,
                rule_version = EXCLUDED.rule_version,
                detector_pin = EXCLUDED.detector_pin
  WHERE (finding.category, finding.score, finding.rule_version, finding.detector_pin)
        IS DISTINCT FROM
        (EXCLUDED.category, EXCLUDED.score, EXCLUDED.rule_version, EXCLUDED.detector_pin)
     OR (finding.restored_at IS NULL AND finding.tier IS DISTINCT FROM EXCLUDED.tier)`;

describe("the finding under both runtime roles", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's findings otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) await seed.finding({ workspaceId });
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, ["finding"])).toEqual([{ table: "finding", rows: 0 }]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      expect(await countedRows(client, ["finding"])).toEqual([{ table: "finding", rows: 1 }]);
    });
  });

  it("lets the worker record a finding and refuses it every road to what an Admin wrote on one (migrations 0024, 0032, 0041, 0042)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const document = await seed.sourceDocument({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query(
        `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                              char_start, char_end, score, rule_version, detector_pin)
         VALUES ($1, $2, $3, 'bank-details', 'always', 'sort-code-with-account-number',
                 12, 20, 0.85, 'r1', 'd1')`,
        [WS_A, ulid(), document.id],
      );

      await refusesEach(client, [
        [
          "SELECT restore_reason FROM finding",
          "a reason is a sentence an Admin typed and may name a person, and the run needs only that the span was restored",
        ],
        [
          "SELECT restored_by FROM finding",
          "who restored a span is the review's business and the ledger's, never the run's",
        ],
        [
          "SELECT review_state, reviewed_by, reviewed_at, review_reason FROM finding",
          "the worker never reviews a finding, so it never reads a review back",
        ],
        [
          "SELECT id FROM finding",
          "a finding's id is the ledger's subject and nothing a run names",
        ],
        ["SELECT * FROM finding", "every column is more than the eleven the two grants name"],

        [
          "UPDATE finding SET restored_at = NULL, restored_by = NULL, restore_reason = NULL",
          "a worker that could clear a restore could withhold again a span an Admin let back, at nobody's word",
        ],
        [
          "UPDATE finding SET char_start = 0, char_end = 1",
          "the offsets are what a finding is, and a row moved to another span is another finding wearing this one's review",
        ],
        [
          "UPDATE finding SET document_id = document_id, rule_id = rule_id",
          "the document and the rule are what a finding is as well",
        ],
        ["UPDATE finding SET id = id", "the id is the ledger's subject, minted once"],
        [
          "UPDATE finding SET workspace_id = workspace_id",
          "the tenant a row belongs to is the first part of what a finding is",
        ],
        [
          "UPDATE finding SET review_reason = NULL",
          "a reason is an Admin's sentence, and a worker that could write one could put words in their mouth",
        ],
        [
          "UPDATE finding SET review_state = 'narrowed'",
          "the review is an Admin's act, and a worker that could stamp one could mark a special-category span reviewed",
        ],
        [
          "DELETE FROM finding",
          "a finding is the record of what was withheld, and nothing the worker holds takes one away",
        ],

        [
          `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                char_start, char_end, score, rule_version, detector_pin,
                                review_state, reviewed_by, reviewed_at)
           VALUES ($1, $2, $3, 'bank-details', 'always', 'sort-code-with-account-number',
                   30, 38, 0.9, 'r1', 'd1', 'kept-in-text', 'process:better-answers-test', now())`,
          "a finding is born unreviewed, and one inserted already reviewed is a special-category span a binding may widen over at nobody's word",
          [WS_A, ulid(), document.id],
        ],
        [
          `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                char_start, char_end, score, rule_version, detector_pin,
                                restored_at, restored_by, restore_reason)
           VALUES ($1, $2, $3, 'bank-details', 'always', 'sort-code-with-account-number',
                   40, 48, 0.9, 'r1', 'd1', now(), 'process:better-answers-test', 'let it stand')`,
          "the restore is an Admin's act as well, and a span born restored is one the seam withheld and nobody put back",
          [WS_A, ulid(), document.id],
        ],
      ]);

      await client.query("RESET ROLE");
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const recorded = await client.query<{ document_id: string; review_state: string }>(
        "SELECT document_id, review_state FROM finding",
      );
      expect(recorded.rows).toEqual([{ document_id: document.id, review_state: "unreviewed" }]);
    });
  });

  it("serves the worker which spans of a document were restored, and only its own tenant's", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const document = await seed.sourceDocument({ workspaceId: WS_A });
      const restored = {
        restoredAt: new Date("2026-09-20T10:00:00.000Z"),
        restoredBy: `human:${WS_A}`,
        restoreReason: "the company's own sort code",
      };
      await seed.finding({
        workspaceId: WS_A,
        documentId: document.id,
        charStart: 12,
        charEnd: 20,
        ...restored,
      });
      await seed.finding({
        workspaceId: WS_A,
        documentId: document.id,
        charStart: 40,
        charEnd: 48,
      });

      const theirs = await seed.sourceDocument({ workspaceId: WS_B });
      await seed.finding({
        workspaceId: WS_B,
        documentId: theirs.id,
        charStart: 12,
        charEnd: 20,
        ...restored,
      });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const spans = await client.query(
        `SELECT workspace_id, document_id, rule_id, char_start, char_end FROM finding
          WHERE document_id = ANY($1) AND restored_at IS NOT NULL`,
        [[document.id, theirs.id]],
      );

      expect(spans.rows).toEqual([
        {
          workspace_id: WS_A,
          document_id: document.id,
          rule_id: "sort-code-with-account-number",
          char_start: 12,
          char_end: 20,
        },
      ]);
    });
  });

  it("holds one row per span, so a second run's insert lands nothing and leaves an Admin's mark where it stood", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const document = await seed.sourceDocument({ workspaceId: WS_A });
      const marked = await seed.finding({
        workspaceId: WS_A,
        documentId: document.id,
        charStart: 12,
        charEnd: 20,
        restoredAt: new Date("2026-09-20T10:00:00.000Z"),
        restoredBy: `human:${WS_A}`,
        restoreReason: "the company's own sort code",
      });
      const again = `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                          char_start, char_end, score, rule_version, detector_pin)
                     VALUES ($1, $2, $3, 'bank-details', 'always', 'sort-code-with-account-number',
                             12, 20, 0.91, 'r2', 'd2')`;

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const targeted = await client.query(
        `${again} ON CONFLICT (workspace_id, document_id, rule_id, char_start, char_end) DO NOTHING`,
        [WS_A, ulid(), document.id],
      );
      const untargeted = await client.query(`${again} ON CONFLICT DO NOTHING`, [
        WS_A,
        ulid(),
        document.id,
      ]);
      await refusesEach(client, [
        [
          again,
          "the same span under the same rule is the same finding, and a bare insert of it is a run that would double the binding's rows",
          [WS_A, ulid(), document.id],
          /finding_span_key/,
        ],
      ]);

      expect([targeted.rowCount, untargeted.rowCount]).toEqual([0, 0]);
      await client.query("RESET ROLE");
      const held = await client.query<{ id: string; restore_reason: string; rule_version: string }>(
        "SELECT id, restore_reason, rule_version FROM finding WHERE document_id = $1",
        [document.id],
      );

      expect(held.rows).toEqual([
        { id: marked.id, restore_reason: "the company's own sort code", rule_version: "1" },
      ]);
    });
  });

  it("lets a run refresh its own reading of a span it finds again, and nothing an Admin wrote on it", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const document = await seed.sourceDocument({ workspaceId: WS_A });
      const reviewed = {
        reviewedBy: `human:${WS_A}`,
        reviewedAt: new Date("2026-09-20T10:00:00.000Z"),
      };
      const narrowed = await seed.finding({
        workspaceId: WS_A,
        documentId: document.id,
        category: "person-name",
        tier: "default-off",
        ruleId: "PERSON",
        charStart: 12,
        charEnd: 20,
        score: 0.5,
        reviewState: "narrowed",
        ...reviewed,
      });
      const restored = await seed.finding({
        workspaceId: WS_A,
        documentId: document.id,
        category: "person-name",
        tier: "always",
        ruleId: "PERSON",
        charStart: 40,
        charEnd: 48,
        score: 0.5,
        reviewState: "kept-in-text",
        ...reviewed,
        reviewReason: "the company's own director",
        restoredAt: new Date("2026-09-20T10:00:00.000Z"),
        restoredBy: `human:${WS_A}`,
        restoreReason: "the company's own director",
      });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const refresh = (tier: string, charStart: number, charEnd: number) =>
        client.query(`${RECORD_A_NAME} ${REFRESH_THE_READING}`, [
          WS_A,
          ulid(),
          document.id,
          tier,
          charStart,
          charEnd,
        ]);
      const raised = await refresh("always", 12, 20);
      const lowered = await refresh("default-off", 40, 48);

      const unmoved = await refresh("always", 12, 20);
      await refusesEach(client, [
        [
          `${RECORD_A_NAME}
           ON CONFLICT (workspace_id, document_id, rule_id, char_start, char_end) DO UPDATE
             SET review_state = 'unreviewed', reviewed_by = NULL, reviewed_at = NULL`,
          "a refresh that named a review column would be the UPDATE migration 0024 revoked, arriving through an insert",
          [WS_A, ulid(), document.id, "always", 12, 20],
        ],
      ]);

      expect([raised.rowCount, lowered.rowCount, unmoved.rowCount]).toEqual([1, 1, 0]);
      await client.query("RESET ROLE");
      const held = await client.query(
        `SELECT id, tier, score, rule_version, detector_pin, review_state, restore_reason
           FROM finding WHERE document_id = $1 ORDER BY char_start`,
        [document.id],
      );
      expect(held.rows).toEqual([
        {
          id: narrowed.id,
          tier: "always",
          score: 0.97,
          rule_version: "r2",
          detector_pin: "d2",
          review_state: "narrowed",
          restore_reason: null,
        },
        {
          id: restored.id,
          tier: "always",
          score: 0.97,
          rule_version: "r2",
          detector_pin: "d2",
          review_state: "kept-in-text",
          restore_reason: "the company's own director",
        },
      ]);
    });
  });

  it("refuses a finding naming another tenant's document, at its key", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const theirs = await seed.sourceDocument({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await expect(
        client.query(
          `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                char_start, char_end, score, rule_version, detector_pin)
           VALUES ($1, $2, $3, 'home-address', 'default-on', 'uk-address', 0, 9, 0.6, 'r1', 'd1')`,
          [WS_A, ulid(), theirs.id],
        ),
      ).rejects.toThrow(/finding_document_fk/);
    });
  });

  it("refuses a review, a restore and a tier the finding's own sentences do not admit", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const always = await seed.finding({ workspaceId: WS_A });
      const defaultOn = await seed.finding({
        workspaceId: WS_A,
        documentId: always.documentId,
        tier: "default-on",
        category: "home-address",
      });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const rows: readonly [string, readonly unknown[], string][] = [
        ["UPDATE finding SET tier = 'sometimes' WHERE id = $1", [always.id], "finding_tier_check"],

        [
          `UPDATE finding SET review_state = 'dismissed', reviewed_at = now(),
                              reviewed_by = 'process:better-answers-test'
             WHERE id = $1`,
          [always.id],
          "finding_review_state_check",
        ],

        [
          "UPDATE finding SET review_state = 'narrowed' WHERE id = $1",
          [always.id],
          "finding_review_check",
        ],

        [
          "UPDATE finding SET restored_at = now() WHERE id = $1",
          [always.id],
          "finding_restore_check",
        ],
        [
          `UPDATE finding SET restored_at = now(), restored_by = 'human:${WS_B}',
                              restore_reason = 'the client asked for the officer block back'
             WHERE id = $1`,
          [defaultOn.id],
          "finding_restore_check",
        ],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT finding_row");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT finding_row");
      }
    });
  });
});

describe("the subject request under both runtime roles", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's requests otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) await seed.subjectRequest({ workspaceId });
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, ["subject_request"])).toEqual([
        { table: "subject_request", rows: 0 },
      ]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      expect(await countedRows(client, ["subject_request"])).toEqual([
        { table: "subject_request", rows: 1 },
      ]);
    });
  });

  it("refuses the worker every road to a subject request", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.subjectRequest({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await refusesEach(client, [
        [
          "SELECT 1 FROM subject_request LIMIT 1",
          "the identifier set is restricted personal data, and a worker that could read it would hold the platform's list of who has asked to be erased",
        ],
        [
          `INSERT INTO subject_request (workspace_id, id, kind, identifiers, received_at,
                                        clock_started_at, due_at)
           VALUES ($1, $2, 'erasure', '{"emails": [], "names": [], "other": []}'::jsonb,
                   now(), now(), now() + interval '1 month')`,
          "recording a request is an Admin's act, so a worker that could insert one could start a clock nobody set",
          [WS_A, ulid()],
        ],
        [
          "UPDATE subject_request SET answered_at = now(), answer = 'nothing found'",
          "and one that could stamp an answer could close a request nobody answered",
        ],
        [
          "DELETE FROM subject_request",
          "a request a tier can remove is a clock that stops without a record",
        ],
      ]);

      await client.query("RESET ROLE");
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const standing = await client.query<{ answered_at: Date | null }>(
        "SELECT answered_at FROM subject_request",
      );
      expect(standing.rows).toEqual([{ answered_at: null }]);
    });
  });

  it("refuses a subject, a clock and an identifier set the request's own sentences do not admit", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const request = await seed.subjectRequest({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const rows: readonly [string, readonly unknown[], string][] = [
        [
          "UPDATE subject_request SET kind = 'portability' WHERE id = $1",
          [request.id],
          "subject_request_kind_check",
        ],

        [
          `UPDATE subject_request
              SET person_id = NULL,
                  identifiers = '{"emails": [], "names": [], "other": []}'::jsonb
            WHERE id = $1`,
          [request.id],
          "subject_request_subject_check",
        ],

        [
          `UPDATE subject_request SET identifiers = '{"emails": []}'::jsonb WHERE id = $1`,
          [request.id],
          "subject_request_identifiers_check",
        ],

        [
          `UPDATE subject_request SET identifiers = 'null'::jsonb WHERE id = $1`,
          [request.id],
          "subject_request_identifiers_check",
        ],

        [
          "UPDATE subject_request SET clock_started_at = received_at - interval '1 day' WHERE id = $1",
          [request.id],
          "subject_request_clock_check",
        ],
        [
          "UPDATE subject_request SET due_at = clock_started_at WHERE id = $1",
          [request.id],
          "subject_request_clock_check",
        ],

        [
          "UPDATE subject_request SET extended_to = due_at WHERE id = $1",
          [request.id],
          "subject_request_clock_check",
        ],

        [
          "UPDATE subject_request SET answered_at = now() WHERE id = $1",
          [request.id],
          "subject_request_answer_check",
        ],
        [
          "UPDATE subject_request SET answer = 'nothing found' WHERE id = $1",
          [request.id],
          "subject_request_answer_check",
        ],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT subject_request_row");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT subject_request_row");
      }
    });
  });
});

describe("the erasure request under both runtime roles", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's routines otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) await seed.erasureRequest({ workspaceId });
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, ["erasure_request"])).toEqual([
        { table: "erasure_request", rows: 0 },
      ]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      expect(await countedRows(client, ["erasure_request"])).toEqual([
        { table: "erasure_request", rows: 1 },
      ]);
    });
  });

  it("refuses the worker every road to an erasure request", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const request = await seed.erasureRequest({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await refusesEach(client, [
        [
          "SELECT 1 FROM erasure_request LIMIT 1",
          "the pseudonym is what a rewritten history was rewritten to, and a worker that could read it could join the history back to the request that caused it",
        ],
        [
          `INSERT INTO erasure_request (workspace_id, id, subject_request_id, pseudonym,
                                        locked_at, anchored_at, beyond_use_hourly_at,
                                        beyond_use_daily_at, beyond_use_weekly_at,
                                        beyond_use_monthly_at)
           VALUES ($1, $2, $3, $4, now(), now(), now() + interval '2 days',
                   now() + interval '30 days', now() + interval '8 weeks',
                   now() + interval '6 months')`,
          "the routine runs under the platform principal in the app tier, so a worker that could insert one could claim an erasure that never ran",
          [WS_A, ulid(), request.subjectRequestId, ulid()],
        ],
        [
          "UPDATE erasure_request SET completed_at = now(), report = 'done'",
          "and one that could complete a request could close a routine that had touched no store",
        ],
        [
          "DELETE FROM erasure_request",
          "this row is what a restore replays from, so a tier that could remove one could make an erasure un-replayable",
        ],
      ]);

      await client.query("RESET ROLE");
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const standing = await client.query<{ pseudonym: string; completed_at: Date | null }>(
        "SELECT pseudonym, completed_at FROM erasure_request",
      );
      expect(standing.rows).toEqual([{ pseudonym: request.pseudonym, completed_at: null }]);
    });
  });

  it("refuses a completion, a pseudonym and a set of dates the routine's own sentences do not admit", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const request = await seed.erasureRequest({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const rows: readonly [string, readonly unknown[], string][] = [
        [
          "UPDATE erasure_request SET completed_at = now() WHERE id = $1",
          [request.id],
          "erasure_request_completion_check",
        ],
        [
          "UPDATE erasure_request SET report = 'done' WHERE id = $1",
          [request.id],
          "erasure_request_completion_check",
        ],

        [
          "UPDATE erasure_request SET beyond_use_weekly_at = beyond_use_daily_at WHERE id = $1",
          [request.id],
          "erasure_request_beyond_use_check",
        ],
        [
          "UPDATE erasure_request SET beyond_use_hourly_at = anchored_at WHERE id = $1",
          [request.id],
          "erasure_request_beyond_use_check",
        ],

        [
          `UPDATE erasure_request SET actions = 'null'::jsonb WHERE id = $1`,
          [request.id],
          "erasure_request_actions_check",
        ],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT erasure_request_row");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT erasure_request_row");
      }
    });
  });

  it("refuses a second routine over one subject request, and one naming another tenant's", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const mine = await seed.erasureRequest({ workspaceId: WS_A });
      const theirs = await seed.subjectRequest({ workspaceId: WS_B, kind: "erasure" });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const insert = `INSERT INTO erasure_request (workspace_id, id, subject_request_id, pseudonym,
                                                   locked_at, anchored_at, beyond_use_hourly_at,
                                                   beyond_use_daily_at, beyond_use_weekly_at,
                                                   beyond_use_monthly_at)
                      VALUES ($1, $2, $3, $4, now(), now(), now() + interval '2 days',
                              now() + interval '30 days', now() + interval '8 weeks',
                              now() + interval '6 months')`;

      await client.query("SAVEPOINT second_routine");
      await expect(
        client.query(insert, [WS_A, ulid(), mine.subjectRequestId, ulid()]),
      ).rejects.toThrow(/erasure_request_subject_request_uidx/);
      await client.query("ROLLBACK TO SAVEPOINT second_routine");

      await expect(client.query(insert, [WS_A, ulid(), theirs.id, ulid()])).rejects.toThrow(
        /erasure_request_subject_request_fk/,
      );
    });
  });
});

describe("the suppression under both runtime roles", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's suppressions otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) await seed.suppression({ workspaceId });
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, ["suppression"])).toEqual([
        { table: "suppression", rows: 0 },
      ]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      expect(await countedRows(client, ["suppression"])).toEqual([
        { table: "suppression", rows: 1 },
      ]);
    });
  });

  it("serves the worker the set a run must keep out, and refuses it every road that writes one", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const suppression = await seed.suppression({ workspaceId: WS_A });
      await seed.suppression({ workspaceId: WS_B });

      await client.query("SET LOCAL ROLE worker_rt");

      expect(await countedRows(client, ["suppression"])).toEqual([
        { table: "suppression", rows: 0 },
      ]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const gathered = await client.query<{ document_id: string; identifiers: unknown }>(
        "SELECT document_id, identifiers FROM suppression",
      );
      expect(gathered.rows).toEqual([
        { document_id: suppression.documentId, identifiers: suppression.identifiers },
      ]);

      await refusesEach(client, [
        [
          `INSERT INTO suppression (workspace_id, erasure_request_id, document_id, identifiers)
           VALUES ($1, $2, $3, '{"emails": ["x@y.invalid"], "names": [], "other": []}'::jsonb)`,
          "the routine writes suppressions under the platform principal, so a worker that could insert one could suppress a document nobody asked about",
          [WS_A, suppression.erasureRequestId, suppression.documentId],
        ],
        [
          `UPDATE suppression SET identifiers = '{"emails": [], "names": [], "other": []}'::jsonb`,
          "and one that could edit the set could empty it, which is an erasure quietly undone at the next reprocess",
        ],
        [
          "DELETE FROM suppression",
          "a suppression a tier can remove is a person's data back in the derived stores the next time the document is converted",
        ],
      ]);

      await client.query("RESET ROLE");
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const standing = await client.query<{ identifiers: unknown }>(
        "SELECT identifiers FROM suppression",
      );
      expect(standing.rows).toEqual([{ identifiers: suppression.identifiers }]);
    });
  });

  it("refuses a suppression that keeps nothing out, and one naming another tenant's rows", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const mine = await seed.suppression({ workspaceId: WS_A });
      const theirDocument = await seed.sourceDocument({ workspaceId: WS_B });
      const theirRoutine = await seed.erasureRequest({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const insert = `INSERT INTO suppression (workspace_id, erasure_request_id, document_id, identifiers)
                      VALUES ($1, $2, $3, $4::jsonb)`;
      const set = '{"emails": ["priya@client.invalid"], "names": [], "other": []}';
      const empty = '{"emails": [], "names": [], "other": []}';

      const rows: readonly [string, readonly unknown[], string][] = [
        [
          `UPDATE suppression SET identifiers = '${empty}'::jsonb WHERE document_id = $1`,
          [mine.documentId],
          "suppression_identifiers_check",
        ],

        [insert, [WS_A, mine.erasureRequestId, theirDocument.id, set], "suppression_document_fk"],
        [insert, [WS_A, theirRoutine.id, mine.documentId, set], "suppression_erasure_request_fk"],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT suppression_row");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT suppression_row");
      }
    });
  });
});

describe("the queue under both runtime roles", () => {
  it("returns zero rows on a missing scope and only the scoped tenant's jobs otherwise", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) await seed.job({ workspaceId });
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, ["job"])).toEqual([{ table: "job", rows: 0 }]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      expect(await countedRows(client, ["job"])).toEqual([{ table: "job", rows: 1 }]);
    });
  });

  it("claims nothing for a caller whose transaction names no workspace, and never another tenant's job", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const theirs = await seed.job({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE worker_rt");

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const unscoped = await client.query("SELECT id FROM claim_job($1, $2::interval, $3)", [
        "worker-1",
        "60 seconds",
        JOB_KINDS,
      ]);
      expect(unscoped.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const elsewhere = await client.query("SELECT id FROM claim_job($1, $2::interval, $3)", [
        "worker-1",
        "60 seconds",
        JOB_KINDS,
      ]);
      expect(elsewhere.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      const untouched = await client.query<{ status: string; claimed_by: string | null }>(
        "SELECT status, claimed_by FROM job WHERE id = $1",
        [theirs.id],
      );
      expect(untouched.rows).toEqual([{ status: "queued", claimed_by: null }]);
    });
  });

  it("refuses both runtime roles a DELETE on the queue, while the claim protocol still moves a row (migration 0022)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const job = await seed.job({ workspaceId: WS_A });
      for (const role of ["app_rt", "worker_rt"]) {
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
        await refusesEach(client, [["DELETE FROM job", `${role} removing the record of a run`]]);
        await client.query("RESET ROLE");
      }

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const claimed = await client.query<{ id: string }>(
        "SELECT id FROM claim_job($1, $2::interval, $3)",
        ["worker-1", "60 seconds", JOB_KINDS],
      );
      expect(claimed.rows).toEqual([{ id: job.id }]);
    });
  });

  it("refuses every caller but the two runtime roles the migration grants (migration 0022)", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("CREATE ROLE queue_probe NOLOGIN");
      await client.query("GRANT USAGE ON SCHEMA public TO queue_probe");
      await client.query("SET LOCAL ROLE queue_probe");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const refused: readonly [string, readonly unknown[]][] = [
        ["SELECT id FROM claim_job($1, $2::interval, $3)", ["worker-1", "60 seconds", JOB_KINDS]],
        ["SELECT heartbeat_job($1, $2, $3::interval)", ["01J6J1AAAAAAAAAAAAAAAAAAAA", "w", "60 s"]],
        ["SELECT finish_job($1, $2, NULL)", ["01J6J1AAAAAAAAAAAAAAAAAAAA", "w"]],
        ["SELECT fail_job($1, $2, NULL)", ["01J6J1AAAAAAAAAAAAAAAAAAAA", "w"]],
      ];
      for (const [statement, parameters] of refused) {
        await client.query("SAVEPOINT queue_probe");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(/permission denied/);
        await client.query("ROLLBACK TO SAVEPOINT queue_probe");
      }
    });
  });
});

describe("the migration stamp under worker_rt", () => {
  it("lets the worker read the stamp, and refuses it every other road to the migrator's own table", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query("SET LOCAL ROLE worker_rt");

      const stamped = await client.query<{ created_at: string }>(
        "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
      );
      expect(stamped.rowCount).toBe(1);

      await refusesEach(client, [
        [
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', 1)",
          "the app is the only migration owner, so a worker that could stamp one could tell itself the schema had moved",
        ],
        [
          "UPDATE drizzle.__drizzle_migrations SET created_at = 1",
          "and one that could move the stamp could make its own check pass",
        ],
        [
          "DELETE FROM drizzle.__drizzle_migrations",
          "a journal a reader can empty is a check that stops asking",
        ],
      ]);
    });
  });
});
