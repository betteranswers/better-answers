import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { declaredTableNames } from "../scripts/worker-view.ts";
import {
  boundarySchemas,
  CONCEPT_FRONTMATTER_MAX,
  CONTRACT_DIGEST,
  EXEMPT_TABLE_NAMES,
  FAMILIES,
  IDENTITY_SET,
  JOB_KINDS,
  RLS_EXEMPTIONS,
  ROLES,
  SUGGESTION_BODY_MAX,
  SUGGESTION_KINDS,
  SUGGESTION_KINDS_FROM_A_RUN,
  SUGGESTION_KINDS_FROM_THE_APP,
  STAMP_THE_CONTRACT,
  ulid,
} from "../src/index.ts";
import { type TestData, testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { ADMITTED, privilegesHeld, refusalOf, refusesEach, sqlstateOf } from "./probes.ts";
import {
  A_BUNDLE_COMMIT,
  A_BUNDLE_COMMIT_WITH_A_PARENT,
  A_CITATION,
  A_COMPOSITION_INCLUDE,
  A_CONCEPT_CLASS_OVERRIDE,
  A_CONCEPT_IDENTITY,
  A_CONCEPT_INDEX_ROW,
  A_CONCEPT_VERIFICATION,
  A_CONCEPT_VERIFICATION_OF_ORIGIN,
  A_CONCEPT_WRITE_REQUEST,
  A_CONTRACT_STAMP,
  A_DECIDED_ACCESS_REQUEST,
  A_DECIDED_SUGGESTION,
  A_FINDING,
  A_FINDING_BORN_RESTORED,
  A_FINDING_BORN_REVIEWED,
  A_GRAPH_GENERATION,
  A_GRAPH_NODE,
  A_GRAPH_NODE_CLASSED,
  A_GRAPH_NODE_OF_KIND,
  A_GROUP,
  A_GROUP_MEMBERSHIP,
  A_LEDGER_ROW,
  A_LEDGER_ROW_WITH_ITS_FAMILY,
  A_MEMBER,
  A_MIGRATION_STAMP,
  A_SOURCE_BINDING,
  A_SOURCE_BINDING_CLASSED,
  A_SOURCE_DOCUMENT,
  A_SUBJECT_REQUEST,
  A_SUGGESTION,
  A_SUPPRESSION,
  A_SWEEP_PASS,
  A_SWEEP_PASS_COUNTING,
  AN_ACCESS_REQUEST,
  AN_EDGE,
  AN_EDGE_CARRYING_A_SENTENCE,
  AN_ERASURE_ROUTINE,
  AN_INVITATION,
  ONE_CALL_AGAINST_A_TOKEN,
  REFRESH_THE_READING,
  THE_DETAIL_EDITED,
  THE_FAMILY_AND_SUBJECT_IT_LANDS_IN,
  THE_GENERATION_ROW_HELD,
} from "./rls-probes.ts";
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

  it("lets the worker read the workspace table, never write it, and never reach the config at all (migration 0043)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.workspaceConfig({ workspaceId: WS_A });
      await client.query("SET LOCAL ROLE worker_rt");

      const workspaces = await client.query("SELECT id FROM workspace ORDER BY id");
      expect(workspaces.rows).toEqual([{ id: WS_A }, { id: WS_B }]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("SAVEPOINT w");
      await expect(
        client.query("UPDATE workspace SET name = 'x' WHERE id = $1", [WS_A]),
      ).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK TO SAVEPOINT w");
      await expect(client.query("SELECT workspace_id FROM workspace_config")).rejects.toThrow(
        /permission denied/,
      );
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
      await expect(client.query(A_MEMBER, [ulid(), WS_A, person.id, "owner"])).rejects.toThrow(
        /member_role_check/,
      );
      await client.query("ROLLBACK TO SAVEPOINT m");

      await client.query("SAVEPOINT i");
      await expect(client.query(AN_INVITATION, [ulid(), WS_A, "admin", person.id])).rejects.toThrow(
        /invitation_role_check/,
      );
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

  it("lets the api's role read and insert a row, and refuses it UPDATE and DELETE (migration 0009)", async () => {
    await withRollback(db.pool, async (client) => {
      const row = await ledgerRowAsApp(client);

      const inserted = await client.query<{ family: string; subject_kind: string }>(
        `${A_LEDGER_ROW} ${THE_FAMILY_AND_SUBJECT_IT_LANDS_IN}`,
        [ulid(), WS_A, "people.group.created", "process:better-answers-test", ulid()],
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

  it("refuses the api's role every other road to a changed row: an upsert, a cross-tenant insert, a derived column written", async () => {
    await withRollback(db.pool, async (client) => {
      const row = await ledgerRowAsApp(client);

      const GROUP_CREATED = "people.group.created";
      const TEST_ACTOR = "process:better-answers-test";

      await client.query("SAVEPOINT upsert");
      await expect(
        client.query(`${A_LEDGER_ROW} ${THE_DETAIL_EDITED}`, [
          row.id,
          WS_A,
          GROUP_CREATED,
          TEST_ACTOR,
          ulid(),
        ]),
      ).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK TO SAVEPOINT upsert");

      await client.query("SAVEPOINT other_tenant");
      await expect(
        client.query(A_LEDGER_ROW, [ulid(), WS_B, GROUP_CREATED, TEST_ACTOR, ulid()]),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");

      await expect(
        client.query(A_LEDGER_ROW_WITH_ITS_FAMILY, [
          ulid(),
          WS_A,
          GROUP_CREATED,
          "platform",
          TEST_ACTOR,
          ulid(),
        ]),
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
        client.query(A_LEDGER_ROW, [
          ulid(),
          WS_A,
          "sources.binding.published",
          "process:better-answers-worker",
          ulid(),
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("refuses an act outside the four families or the family.subject.verb shape at the row", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      for (const act of ["billing.invoice.sent", "people.member", "People.Member.Added"]) {
        await client.query("SAVEPOINT act");
        await expect(
          client.query(A_LEDGER_ROW, [ulid(), WS_A, act, "process:better-answers-test", ulid()]),
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
      await expect(client.query(A_GROUP, [ulid(), WS_B, "Theirs"])).rejects.toThrow(
        /row-level security/,
      );
      await client.query("ROLLBACK TO SAVEPOINT other_group");

      await client.query("SAVEPOINT other_membership");
      await expect(client.query(A_GROUP_MEMBERSHIP, [WS_B, theirs.id, person.id])).rejects.toThrow(
        /row-level security/,
      );
      await client.query("ROLLBACK TO SAVEPOINT other_membership");

      await expect(client.query(A_GROUP_MEMBERSHIP, [WS_A, theirs.id, person.id])).rejects.toThrow(
        /group_member_group_fk/,
      );
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
        [A_GROUP, [ulid(), WS_A, "Worker"]],
        [A_GROUP_MEMBERSHIP, [WS_A, ulid(), ulid()]],
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
      await expect(client.query(AN_ACCESS_REQUEST, [ulid(), WS_A, person.id])).rejects.toThrow(
        /permission denied/,
      );
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
      const decidedAt = new Date();

      const rows: readonly [string, readonly unknown[], string][] = [
        [
          A_DECIDED_ACCESS_REQUEST,
          [ulid(), WS_A, person.id, "expired", decidedAt, person.id, null],
          "access_request_status_check",
        ],

        [
          A_DECIDED_ACCESS_REQUEST,
          [ulid(), WS_A, person.id, "declined", decidedAt, null, null],
          "access_request_decision_check",
        ],
        [
          A_DECIDED_ACCESS_REQUEST,
          [ulid(), WS_A, person.id, "declined", decidedAt, person.id, "invitation-1"],
          "access_request_decision_check",
        ],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT decision");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
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

  const A_CONTENT_HASH = "a".repeat(64);
  const A_SECOND_COMMIT_SHA = "d".repeat(40);
  const A_PARENT_SHA = "e".repeat(40);
  const A_COMMIT_NOBODY_RECORDED = "f".repeat(40);

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
          "the row is derived from a commit the api made, and the worker makes no commits",
        ],
        [
          "UPDATE concept_index SET sensitivity = 'Public'",
          "the derived visibility is the api's; a worker that could write it would be a second opinion about who may read a concept",
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
      await expect(client.query(A_CONCEPT_IDENTITY, [WS_B, `${theirs.iri}-copy`])).rejects.toThrow(
        /row-level security/,
      );
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");

      await expect(
        client.query(A_CONCEPT_VERIFICATION, [ulid(), WS_A, theirs.iri, A_CONTENT_HASH]),
      ).rejects.toThrow(/concept_verification_identity_fk/);
    });
  });

  it("refuses every row the write path's sentences forbid, each at its own constraint", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const identity = await seed.conceptIdentity({ workspaceId: WS_A });
      const commit = await seed.bundleCommit({ workspaceId: WS_A });
      const indexed = (path: string, status: string, sensitivity: string, published: Date | null) =>
        [
          WS_A,
          identity.iri,
          path,
          A_CONTENT_HASH,
          commit.sha,
          status,
          sensitivity,
          published,
        ] as const;

      const rows: readonly [string, readonly unknown[], string][] = [
        [
          A_CONCEPT_INDEX_ROW,
          indexed("knowledge/one.md", "retired", "Internal", null),
          "concept_index_status_check",
        ],
        [
          A_CONCEPT_INDEX_ROW,
          indexed("knowledge/two.md", "draft", "Secret", null),
          "concept_index_sensitivity_check",
        ],

        [
          A_CONCEPT_INDEX_ROW,
          indexed("knowledge/three.md", "stable", "Internal", null),
          "concept_index_published_check",
        ],
        [
          A_CONCEPT_INDEX_ROW,
          indexed("knowledge/four.md", "draft", "Internal", new Date()),
          "concept_index_published_check",
        ],

        [
          A_CONCEPT_VERIFICATION_OF_ORIGIN,
          [ulid(), WS_A, identity.iri, "imported", A_CONTENT_HASH],
          "concept_verification_imported_check",
        ],
        [
          A_CONCEPT_VERIFICATION_OF_ORIGIN,
          [ulid(), WS_A, identity.iri, "platform", null],
          "concept_verification_imported_check",
        ],

        [
          A_BUNDLE_COMMIT,
          [WS_A, A_SECOND_COMMIT_SHA, commit.auditEventId],
          "bundle_commit_audit_event_uidx",
        ],
        [
          A_BUNDLE_COMMIT_WITH_A_PARENT,
          [WS_A, A_SECOND_COMMIT_SHA, A_PARENT_SHA, ulid()],
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
      await client.query(A_CONCEPT_INDEX_ROW, [
        WS_A,
        identity.iri,
        "knowledge/one.md",
        A_CONTENT_HASH,
        A_COMMIT_NOBODY_RECORDED,
        "stable",
        "Internal",
        new Date(),
      ]);

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
      await client.query(A_GRAPH_NODE_OF_KIND, [WS_A, next, live.uid, "Concept", "Policy"]);
      await client.query(AN_EDGE, [
        WS_A,
        next,
        `lineage:${live.uid}:0`,
        "DERIVED_FROM",
        live.uid,
        live.uid,
      ]);
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
        ["DELETE FROM graph_node", "sweeping a retired generation is the api's, not this"],
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

      const served: readonly (readonly [string, readonly unknown[]])[] = [
        [A_GRAPH_NODE, [WS_A, 1, "live", "Concept"]],
        [A_GRAPH_NODE, [WS_A, 2, "next", "Concept"]],
        [AN_EDGE, [WS_A, 2, "e-next", "LINKS_TO", "next", "live"]],
        [A_GRAPH_NODE, [WS_A, null, "entity", "source-entity:Person"]],
        ["UPDATE graph_generation SET live_gen = $2 WHERE workspace_id = $1", [WS_A, 2]],
        [`${A_GRAPH_GENERATION} ${THE_GENERATION_ROW_HELD}`, [WS_A, 1]],
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
          A_GRAPH_NODE,
          "a node into the retired generation, now that 2 is live",
          [WS_A, 1, "retired", "Concept"],
          /lands in the live generation or the next/,
        ],
        [
          A_GRAPH_NODE,
          "a node into a generation nobody is building",
          [WS_A, 4, "far", "Concept"],
          /lands in the live generation or the next/,
        ],
        [
          AN_EDGE,
          "and an edge the same",
          [WS_A, 4, "e-far", "LINKS_TO", "next", "live"],
          /lands in the live generation or the next/,
        ],
      ]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [
        "01J6CCCCCCCCCCCCCCCCCCCCCC",
      ]);
      await client.query("SAVEPOINT guard_probe");
      await expect(
        client.query(A_GRAPH_NODE, ["01J6CCCCCCCCCCCCCCCCCCCCCC", 1, "first", "Concept"]),
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
        client.query(A_GRAPH_NODE, [WS_B, null, "uid-b", "source-entity:Person"]),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");
      await expect(client.query(A_GRAPH_NODE, [WS_B, 1, "uid-b", "Concept"])).rejects.toThrow(
        /lands in the live generation or the next: live is <NULL>/,
      );
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
        [A_GRAPH_NODE, [WS_A, 1, "uid-1", "Widget"], "graph_node_label_check"],
        [A_GRAPH_NODE, [WS_A, 1, "uid-2", "source-entity:Person"], "graph_node_label_check"],
        [A_GRAPH_NODE, [WS_A, null, "uid-6", "Concept"], "graph_node_label_check"],
        [
          AN_EDGE,
          [WS_A, 1, "edge-2", "source-entity:mentions", "a", "b"],
          "graph_edge_label_check",
        ],

        [A_GRAPH_NODE, [WS_A, 0, "uid-7", "Concept"], "graph_node_gen_check"],
        [AN_EDGE, [WS_A, 0, "edge-3", "LINKS_TO", "a", "b"], "graph_edge_gen_check"],

        [
          A_GRAPH_NODE_CLASSED,
          [WS_A, 1, "uid-3", "Concept", "Secret"],
          "graph_node_sensitivity_check",
        ],

        [A_GRAPH_NODE, [WS_A, node.gen, node.uid, "Concept"], "graph_node_bundle_uidx"],
        [
          A_GRAPH_NODE,
          [WS_A, null, entity.uid, "source-entity:Person"],
          "graph_node_source_entity_uidx",
        ],

        [
          AN_EDGE_CARRYING_A_SENTENCE,
          [WS_A, 1, "edge-1", "SUPERSEDES", "a", "b", "smuggled"],
          "graph_edge_links_to_check",
        ],

        [A_GRAPH_GENERATION, [WS_A, 2], "graph_generation_pkey"],
        [A_GRAPH_GENERATION, [WS_A, 0], "graph_generation_live_gen_check"],
      ];
      for (const [statement, parameters, constraint] of rows) {
        await client.query("SAVEPOINT graph_row");
        await expect(client.query(statement, [...parameters])).rejects.toThrow(
          new RegExp(constraint),
        );
        await client.query("ROLLBACK TO SAVEPOINT graph_row");
      }

      await client.query(A_GRAPH_NODE, [WS_A, (node.gen ?? 0) + 1, node.uid, "Concept"]);
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

  it("refuses the api's role a deleted suggestion, so a decision can never become a silence", async () => {
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
      const PROPOSER = "process:better-answers-test";
      const decidedAt = new Date();
      const decided = (
        kind: string,
        status: string,
        decider: string | null,
        moment: Date | null,
        reason: string | null,
        target: string | null,
      ) => [WS_A, ulid(), ulid(), kind, PROPOSER, status, decider, moment, reason, target] as const;

      await refusesEach(client, [
        [
          A_DECIDED_SUGGESTION,
          "a withdrawn suggestion",
          decided("edit", "withdrawn", PROPOSER, decidedAt, null, null),
          /suggestion_status_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "a merge nobody raises",
          decided("merge", "waiting", null, null, null, null),
          /suggestion_kind_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "a decision with nobody behind it",
          decided("edit", "declined", null, decidedAt, "why", null),
          /suggestion_decision_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "a decision with no moment",
          decided("edit", "declined", PROPOSER, null, "why", null),
          /suggestion_decision_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "a decline with no reason",
          decided("edit", "declined", PROPOSER, decidedAt, null, null),
          /suggestion_decision_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "an acceptance carrying a reason",
          decided("edit", "accepted", PROPOSER, decidedAt, "why", identity.iri),
          /suggestion_decision_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "a waiting suggestion naming its target",
          decided("edit", "waiting", null, null, null, identity.iri),
          /suggestion_decision_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "an acceptance naming no target",
          decided("edit", "accepted", PROPOSER, decidedAt, null, null),
          /suggestion_decision_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "a waiting suggestion carrying a decider",
          decided("edit", "waiting", PROPOSER, decidedAt, null, null),
          /suggestion_decision_check/,
        ],
        [
          A_DECIDED_SUGGESTION,
          "a decider who is a name",
          decided("edit", "declined", "Ada Editor", decidedAt, "why", null),
          /suggestion_decider_check/,
        ],
        [
          A_SUGGESTION,
          "an edit from a bare email address",
          [WS_A, ulid(), ulid(), "edit", "ada@acme.invalid"],
          /suggestion_proposer_check/,
        ],
        [
          A_SUGGESTION,
          "a repair from a person",
          [WS_A, ulid(), ulid(), "repair", "human:01J6CCCCCCCCCCCCCCCCCCCCCC"],
          /suggestion_repair_proposer_check/,
        ],
        [
          A_SUGGESTION,
          "a repair from a versioned producer",
          [WS_A, ulid(), ulid(), "repair", "better-answers-citation-repair/1.0"],
          /suggestion_repair_proposer_check/,
        ],
      ]);

      const platform = await client.query(A_SUGGESTION, [
        WS_A,
        ulid(),
        ulid(),
        "repair",
        "process:better-answers-citation-repair",
      ]);
      expect(platform.rowCount).toBe(1);
    });
  });

  it("refuses a body larger than a concept could be, at the row", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const here = await seed.suggestion({ workspaceId: WS_A });

      await expect(
        client.query(A_CONCEPT_WRITE_REQUEST, [WS_A, here.id, "x".repeat(SUGGESTION_BODY_MAX + 1)]),
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

const INSUFFICIENT_PRIVILEGE = "42501";

// The one proposer form every kind's CHECK accepts, repair's platform-only one included, so
// the pair under test is all the probe varies.
const A_PLATFORM_PROPOSER = "process:better-answers-test";

// Under role NONE the function reads its caller off `session_user` instead: the migrator
// who applied the journal, whom its CASE names no branch for.
const THE_CALLERS = [
  { caller: "app_rt", mayRaise: SUGGESTION_KINDS_FROM_THE_APP, role: "app_rt" },
  { caller: "worker_rt", mayRaise: SUGGESTION_KINDS_FROM_A_RUN, role: "worker_rt" },
  { caller: "the migrator", mayRaise: [], role: "NONE" },
] as const satisfies readonly {
  readonly caller: string;
  readonly mayRaise: readonly string[];
  readonly role: string;
}[];

const submittingOneRequest = async (client: pg.PoolClient, kind: string): Promise<string> => {
  const suggestionId = ulid();
  await client.query("SAVEPOINT kind_probe");
  try {
    const submitted = await submitSet(client, {
      kind,
      proposer: A_PLATFORM_PROPOSER,
      requests: [submitRequest({ suggestion_id: suggestionId })],
    });
    const landed = submitted.rows.map((row) => row.submit_suggestion_set);
    return landed.length === 1 && landed[0] === suggestionId
      ? ADMITTED
      : `landed ${landed.join(", ")}`;
  } catch (error) {
    return sqlstateOf(error);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT kind_probe");
  }
};

describe("the kinds a caller may raise, asked of the function itself (migration 0018)", () => {
  it("lands a set of any kind its caller's tier names, refuses that caller every other kind, and refuses a caller of no tier all of them", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      // Owning the function, the migrator may execute it, so what refuses it below is the
      // CASE's silence rather than a missing grant.
      const owner = await client.query<{ holds: boolean }>(
        "SELECT has_function_privilege(session_user, 'submit_suggestion_set(text, text, text, jsonb)', 'EXECUTE') AS holds",
      );
      expect(owner.rows[0]?.holds).toBe(true);

      const answered: Record<string, string> = {};
      const theConstantsSay: Record<string, string> = {};
      for (const { caller, mayRaise, role } of THE_CALLERS) {
        await client.query(`SET LOCAL ROLE ${role}`);
        for (const kind of SUGGESTION_KINDS) {
          answered[`${caller} raising ${kind}`] = await submittingOneRequest(client, kind);
          theConstantsSay[`${caller} raising ${kind}`] = mayRaise.some((named) => named === kind)
            ? ADMITTED
            : INSUFFICIENT_PRIVILEGE;
        }
      }

      expect(answered).toEqual(theConstantsSay);
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
      await client.query(ONE_CALL_AGAINST_A_TOKEN, [WS_A]);

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
  it("holds the four verbs on the parent and no other privilege, and nothing at all on a partition (migrations 0037 and 0043)", async () => {
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
      await client.query(A_SOURCE_BINDING, [WS_A, id, "The handbook"]);

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

  it("refuses the worker four of the six, and serves it exactly what a run reconciles on the other two (migrations 0020, 0037, 0052)", async () => {
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
      await client.query(
        `UPDATE source_document
            SET content_hash = $2, normalised_key = 'normalised/handbook.md',
                redaction_version = '5:d1', outcome = 'converted', quarantine_error = NULL,
                last_seen = now(), sensitivity = 'Restricted'
          WHERE id = $1`,
        [seeded.document.id, `sha256:${"a".repeat(64)}`],
      );
      const reconciled = await client.query(
        "SELECT redaction_version, sensitivity FROM source_document WHERE id = $1",
        [seeded.document.id],
      );
      expect({
        binding: binding.rows,
        document: document.rows,
        quarantined: quarantined.rows,
        reconciled: reconciled.rows,
      }).toEqual({
        binding: [{ id: seeded.binding.id }],
        document: [{ id: seeded.document.id }],
        quarantined: [{ outcome: "quarantined", quarantine_error: "NeedsOcrError" }],
        reconciled: [{ redaction_version: "5:d1", sensitivity: "Restricted" }],
      });

      await refusesEach(client, [
        [
          "UPDATE source_document SET narrowed_to = NULL",
          "an Admin's narrowing is an act with a ledger row, and a run that could clear it could widen a document at nobody's word",
        ],
        [
          "UPDATE source_document SET title = 'Retitled by a run'",
          "what an upload catalogued is the upload's, and a run writes back only what it read",
        ],
        [
          "UPDATE source_binding SET name = 'renamed by a run'",
          "a binding is what an Admin made, and the tier that indexes it has no say in what it is",
        ],
        [
          A_SOURCE_BINDING_CLASSED,
          "a worker that could insert a binding could bind a source no Admin ever connected",
          [WS_A, ulid(), "A binding nobody made"],
        ],
        [
          "DELETE FROM source_binding",
          "and one that could remove a binding could take a published source away without a record",
        ],
        [
          A_SOURCE_DOCUMENT,
          "a worker that could insert a document row could catalogue a document nobody uploaded",
          [WS_A, ulid(), seeded.binding.id, "invented.md", "Invented", 1],
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
          A_SOURCE_DOCUMENT,
          [WS_A, ulid(), theirs.binding.id, "handbook.md", "The handbook", 1024],
          "source_document_binding_fk",
        ],
        [
          A_COMPOSITION_INCLUDE,
          [WS_A, ours.composed.id, theirs.identity.iri],
          "composition_include_identity_fk",
        ],
        [
          A_CONCEPT_CLASS_OVERRIDE,
          [WS_A, theirs.identity.iri, "Internal", "process:better-answers-test", ulid()],
          "concept_class_override_identity_fk",
        ],

        [A_CITATION, [WS_A, ours.identity.iri, ours.document.id], "concept_evidence_evidence_fk"],
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
        client.query(A_CONCEPT_CLASS_OVERRIDE, [WS_A, identity.iri, sensitivity, actor, ulid()]);

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

  it("lets the worker record a finding and refuses it every road to what an Admin wrote on one (migrations 0024, 0032, 0041, 0042, 0052)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const document = await seed.sourceDocument({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query(A_FINDING, [
        WS_A,
        ulid(),
        document.id,
        "bank-details",
        "always",
        "sort-code-with-account-number",
        12,
        20,
        0.85,
        "r1",
        "d1",
      ]);

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
          "SELECT reviewed_by FROM finding",
          "who reviewed a span is the review's business and the ledger's, never the run's",
        ],
        [
          "SELECT reviewed_at FROM finding",
          "the run needs only that a span was dismissed, never when",
        ],
        [
          "SELECT review_reason FROM finding",
          "a reason is a sentence an Admin typed and may name a person",
        ],
        [
          "SELECT id FROM finding",
          "a finding's id is the ledger's subject and nothing a run names",
        ],
        ["SELECT * FROM finding", "every column is more than the twelve the grants name"],

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
          "UPDATE finding SET review_state = 'dismissed'",
          "a worker that could dismiss a finding could lift a document's verdict at nobody's word",
        ],
        [
          "DELETE FROM finding",
          "a finding is the record of what was withheld, and nothing the worker holds takes one away",
        ],

        [
          A_FINDING_BORN_REVIEWED,
          "a finding is born unreviewed, and one inserted already reviewed is a special-category span a binding may widen over at nobody's word",
          [WS_A, ulid(), document.id],
        ],
        [
          A_FINDING_BORN_RESTORED,
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

  it("serves the worker which spans of a document an Admin dismissed, and only its own tenant's", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const document = await seed.sourceDocument({ workspaceId: WS_A });
      const dismissed = {
        category: "special-category",
        ruleId: "HEALTH_CUE",
        reviewState: "dismissed",
        reviewedAt: new Date("2026-09-24T10:00:00.000Z"),
        reviewedBy: `human:${WS_A}`,
        reviewReason: "our engineers diagnose faults, not people",
      } as const;
      await seed.finding({
        workspaceId: WS_A,
        documentId: document.id,
        charStart: 12,
        charEnd: 60,
        ...dismissed,
      });
      await seed.finding({
        workspaceId: WS_A,
        documentId: document.id,
        category: "special-category",
        ruleId: "HEALTH_CUE",
        charStart: 80,
        charEnd: 140,
      });

      const theirs = await seed.sourceDocument({ workspaceId: WS_B });
      await seed.finding({
        workspaceId: WS_B,
        documentId: theirs.id,
        charStart: 12,
        charEnd: 60,
        ...dismissed,
      });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const spans = await client.query(
        `SELECT workspace_id, document_id, rule_id, char_start, char_end FROM finding
          WHERE document_id = ANY($1) AND review_state = 'dismissed'`,
        [[document.id, theirs.id]],
      );

      expect(spans.rows).toEqual([
        {
          workspace_id: WS_A,
          document_id: document.id,
          rule_id: "HEALTH_CUE",
          char_start: 12,
          char_end: 60,
        },
      ]);
    });
  });

  it("holds a document's class no wider than the Admin narrowed it to", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const narrowed = await seed.sourceDocument({
        workspaceId: WS_A,
        sensitivity: "Internal",
        narrowedTo: "Internal",
      });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await client.query("UPDATE source_document SET sensitivity = 'Restricted' WHERE id = $1", [
        narrowed.id,
      ]);
      const refused: string[] = [];
      for (const statement of [
        "UPDATE source_document SET sensitivity = 'Public' WHERE id = $1",
        "UPDATE source_document SET sensitivity = NULL WHERE id = $1",
        "UPDATE source_document SET narrowed_to = 'Secret' WHERE id = $1",
      ]) {
        refused.push(await refusalOf(client, () => client.query(statement, [narrowed.id])));
      }
      expect(refused).toEqual([
        "source_document_narrowed_to_check",
        "source_document_narrowed_to_check",
        "source_document_narrowed_to_check",
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
      const theSameSpanAgain = (): readonly unknown[] => [
        WS_A,
        ulid(),
        document.id,
        "bank-details",
        "always",
        "sort-code-with-account-number",
        12,
        20,
        0.91,
        "r2",
        "d2",
      ];

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const targeted = await client.query(
        `${A_FINDING} ON CONFLICT (workspace_id, document_id, rule_id, char_start, char_end) DO NOTHING`,
        [...theSameSpanAgain()],
      );
      const untargeted = await client.query(`${A_FINDING} ON CONFLICT DO NOTHING`, [
        ...theSameSpanAgain(),
      ]);
      await refusesEach(client, [
        [
          A_FINDING,
          "the same span under the same rule is the same finding, and a bare insert of it is a run that would double the binding's rows",
          theSameSpanAgain(),
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
      const aNameRead = (tier: string, charStart: number, charEnd: number): readonly unknown[] => [
        WS_A,
        ulid(),
        document.id,
        "person-name",
        tier,
        "PERSON",
        charStart,
        charEnd,
        0.97,
        "r2",
        "d2",
      ];
      const refresh = (tier: string, charStart: number, charEnd: number) =>
        client.query(`${A_FINDING} ${REFRESH_THE_READING}`, [
          ...aNameRead(tier, charStart, charEnd),
        ]);
      const raised = await refresh("always", 12, 20);
      const lowered = await refresh("default-off", 40, 48);

      const unmoved = await refresh("always", 12, 20);
      await refusesEach(client, [
        [
          `${A_FINDING}
           ON CONFLICT (workspace_id, document_id, rule_id, char_start, char_end) DO UPDATE
             SET review_state = 'unreviewed', reviewed_by = NULL, reviewed_at = NULL`,
          "a refresh that named a review column would be the UPDATE migration 0024 revoked, arriving through an insert",
          aNameRead("always", 12, 20),
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
        client.query(A_FINDING, [
          WS_A,
          ulid(),
          theirs.id,
          "home-address",
          "default-on",
          "uk-address",
          0,
          9,
          0.6,
          "r1",
          "d1",
        ]),
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
          `UPDATE finding SET review_state = 'ignored', reviewed_at = now(),
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
          A_SUBJECT_REQUEST,
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
          AN_ERASURE_ROUTINE,
          "the routine runs under the platform principal in the api, so a worker that could insert one could claim an erasure that never ran",
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

      const insert = AN_ERASURE_ROUTINE;

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
          A_SUPPRESSION,
          "the routine writes suppressions under the platform principal, so a worker that could insert one could suppress a document nobody asked about",
          [
            WS_A,
            suppression.erasureRequestId,
            suppression.documentId,
            '{"emails": ["x@y.invalid"], "names": [], "other": []}',
          ],
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

      const insert = A_SUPPRESSION;
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
          A_MIGRATION_STAMP,
          "the api is the only migration owner, so a worker that could stamp one could tell itself the schema had moved",
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

describe("the contract stamp", () => {
  it("holds one row, which the migrator rewrites rather than adds to", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query(STAMP_THE_CONTRACT, [CONTRACT_DIGEST]);
      await client.query(STAMP_THE_CONTRACT, ["a-contract-an-older-image-carried"]);
      await client.query(STAMP_THE_CONTRACT, [CONTRACT_DIGEST]);

      const stamped = await client.query<{ digest: string }>("SELECT digest FROM contract_stamp");
      expect(stamped.rows).toEqual([{ digest: CONTRACT_DIGEST }]);
    });
  });

  it("lets the worker read what the api carries, and refuses it every road to writing one", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query(STAMP_THE_CONTRACT, [CONTRACT_DIGEST]);
      await client.query("SET LOCAL ROLE worker_rt");

      const read = await client.query<{ digest: string }>("SELECT digest FROM contract_stamp");
      expect(read.rows).toEqual([{ digest: CONTRACT_DIGEST }]);

      await refusesEach(client, [
        [
          A_CONTRACT_STAMP,
          "a worker that could stamp a contract could tell itself the api had caught up",
        ],
        [
          "UPDATE contract_stamp SET digest = 'x'",
          "and one that could move the stamp could make its own check pass",
        ],
        [
          "DELETE FROM contract_stamp",
          "a stamp a reader can remove is a refusal that stops firing",
        ],
      ]);
    });
  });
});

describe("the sweep pass", () => {
  it("lets the api record a pass and read it back, and never rewrite or remove one", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query("SET LOCAL ROLE app_rt");
      const id = ulid();

      await client.query(A_SWEEP_PASS, [id]);
      const read = await client.query("SELECT id, upload_sweep, found, removed FROM sweep_pass");
      expect(read.rows).toEqual([{ id, upload_sweep: "list", found: 2, removed: 0 }]);

      await refusesEach(client, [
        [
          "UPDATE sweep_pass SET removed = 0",
          "a pass the api could rewrite could say a last run removed nothing when it removed much",
        ],
        [
          "DELETE FROM sweep_pass",
          "and one it could remove could make a missed day look like no day at all",
        ],
      ]);
    });
  });

  it("refuses the worker every road to reading or recording a pass", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query(A_SWEEP_PASS, [ulid()]);
      expect(Object.values(await privilegesHeld(client, "worker_rt", "sweep_pass"))).not.toContain(
        true,
      );
      await client.query("SET LOCAL ROLE worker_rt");

      await refusesEach(client, [
        ["SELECT id FROM sweep_pass", "the worker sweeps nothing, so it has no pass to read"],
        [A_SWEEP_PASS, "and a worker that could record one could stand in for a pass", [ulid()]],
        ["UPDATE sweep_pass SET removed = 0", "or rewrite what a pass removed"],
        ["DELETE FROM sweep_pass", "or remove the last run an operator reads"],
      ]);
    });
  });

  it("refuses a row whose counts no pass could have made", async () => {
    await withRollback(db.pool, async (client) => {
      await client.query(A_SWEEP_PASS_COUNTING, [ulid(), "remove", 2, 1, 3, 3]);
      const standing = await client.query("SELECT refused, found, removed FROM sweep_pass");
      expect(standing.rows).toEqual([{ refused: 1, found: 3, removed: 3 }]);

      await refusesEach(client, [
        [
          A_SWEEP_PASS_COUNTING,
          "a list-only pass removes nothing",
          [ulid(), "list", 1, 0, 2, 1],
          /sweep_pass_counts_check/,
        ],
        [
          A_SWEEP_PASS_COUNTING,
          "a pass removes no more than it found",
          [ulid(), "remove", 1, 0, 1, 2],
          /sweep_pass_counts_check/,
        ],
        [
          A_SWEEP_PASS_COUNTING,
          "a pass passes over no more workspaces than it read",
          [ulid(), "remove", 1, 2, 0, 0],
          /sweep_pass_counts_check/,
        ],
        [
          A_SWEEP_PASS_COUNTING,
          "the upload sweep lists or removes, and nothing else",
          [ulid(), "delete", 1, 0, 0, 0],
          /sweep_pass_upload_sweep_check/,
        ],
      ]);
    });
  });
});
