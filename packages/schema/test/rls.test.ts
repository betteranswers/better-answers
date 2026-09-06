import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { declaredTableNames } from "../scripts/worker-view.ts";
import {
  boundarySchemas,
  EXEMPT_TABLE_NAMES,
  FAMILIES,
  IDENTITY_SET,
  RLS_EXEMPTIONS,
  ROLES,
  ulid,
} from "../src/index.ts";
import { testData } from "./factory.ts";
import { type MigratedPostgres, startMigratedPostgres, withRollback } from "./harness.ts";

/**
 * The isolation proofs ADR 0032 names: a missing scope (empty GUC) returns zero rows,
 * never another tenant's — once at the seam function, once through each tenant table —
 * and the one SECURITY DEFINER lifecycle function is the only runtime-DDL path.
 * Seeding runs through the factory as the container's superuser (which bypasses RLS by
 * design); every assertion runs as `app_rt`.
 *
 * A tenant table is every table `src/` declares minus `RLS_EXEMPTIONS`, the one list,
 * which carries a reason per entry: Better Auth's identity set (ADR 0009, 2026-09-01
 * amendment) and the pre-authentication counter, read by key before any workspace is
 * known. The exemption is checked in both directions (`[TEST7]`) so a table can neither
 * slip out of RLS unnamed nor stay named after it gains a policy.
 */

let db: MigratedPostgres;

beforeAll(async () => {
  db = await startMigratedPostgres();
}, 120_000);

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
    // The one list a reviewer reads is `RLS_EXEMPTIONS`; the arrays stay beside the
    // declarations they belong to. Held equal here, in both directions, so an entry
    // cannot be added to one and forgotten in the other.
    expect(Object.keys(RLS_EXEMPTIONS).toSorted()).toEqual([...EXEMPT_TABLE_NAMES].toSorted());
    for (const [table, reason] of Object.entries(RLS_EXEMPTIONS)) {
      expect({ table, reasoned: reason.trim().length > 0 }).toEqual({ table, reasoned: true });
    }
  });
});

describe("every tenant table", () => {
  it("carries RLS and FORCE ROW LEVEL SECURITY in the catalogue", async () => {
    // Every declared table outside the exemption list is a tenant table; a table
    // created without the hand-written FORCE line (which withRLS() cannot emit
    // through drizzle-kit) fails here rather than shipping RLS-without-FORCE silently.
    for (const qualified of tenantTableNames()) {
      expect({ table: qualified, ...(await rlsFlags(qualified)) }).toEqual({
        table: qualified,
        rls: true,
        forced: true,
      });
    }
  });

  it("carries exactly one policy — the workspace-isolation one", async () => {
    // withRLS()'s extraConfig could smuggle in a second, wider policy (policies are
    // OR-combined); one policy per tenant table is the invariant, asserted here.
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
    // ADR 0032: every tenant policy is written `(SELECT current_workspace_id())`.
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
    // Both directions: a declared table with no policy must be in the exemption list
    // (or it is a tenant table that lost its guarantee); a name in the list must be a
    // declared table with no policy (or the list is stale and hides a real check).
    const unpolicied: string[] = [];
    for (const qualified of declaredTableNames()) {
      const flags = await rlsFlags(qualified);
      if (flags?.rls === false) unpolicied.push(qualified);
    }
    expect(unpolicied.toSorted()).toEqual([...EXEMPT].toSorted());
  });

  it("carries no workspace column on Better Auth's tables", async () => {
    // The argument for the exemption is that these rows are isolated by key, not by
    // scope; a workspace_id column appearing on one would mean the argument no longer
    // holds and the table belongs under RLS.
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

  it("refuses the worker role on every identity-set table and the counters (migration 0005, [SEC3])", async () => {
    // The worker never touches identity rows — secrets, sessions, signing keys,
    // memberships — nor the counters; migration 0000's default privileges would have
    // granted it DML, which 0005 revokes. The refusal is asserted directly.
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

      // `workspace` is the identity set (not RLS'd): the worker reads it globally, which
      // is fine — it holds a tenant's name, not a secret. `workspace_config` is RLS'd, so
      // a read needs a scope.
      const workspaces = await client.query("SELECT id FROM workspace ORDER BY id");
      expect(workspaces.rows).toEqual([{ id: WS_A }, { id: WS_B }]);
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const config = await client.query("SELECT workspace_id FROM workspace_config");
      expect(config.rows).toEqual([{ workspace_id: WS_A }]);

      // Writes to either: refused (0005 revokes DML from worker_rt).
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
    // The CHECK's list is written from `ROLES` when the table is declared; this reads it
    // back out of the catalogue and holds the two equal, so a fourth role can be added to
    // neither alone — and the refusal below is a refusal of a word neither side admits.
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

      // Better Auth's own owner/admin/member defaults, refused at the row.
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

/**
 * The ledger's own proofs (ADR 0014 rule 4; ADR 0038): a tenant table like any other, so
 * its zero-rows proof is stated once here in its own words, and append-only by the
 * database — migration 0009 revokes UPDATE and DELETE from the app's role and everything
 * from the worker's, and each refusal is asserted beside the path it serves. The four
 * families and the act's shape are CHECKs the row itself refuses, as `member_role_check`
 * refuses a fourth role.
 */
/** A ledger row in A, then the app's role scoped to A — the footing the app_rt ledger tests share. */
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

      // The served path: an insert in scope lands, and the database derives the two
      // columns from the act.
      const inserted = await client.query<{ family: string; subject_kind: string }>(
        `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
         VALUES ($1, $2, 'people.group.created', 'process:better-answers-test', $3, '{}')
         RETURNING family, subject_kind`,
        [ulid(), WS_A, ulid()],
      );
      expect(inserted.rows).toEqual([{ family: "people", subject_kind: "group" }]);

      // The refused paths, each fenced by a savepoint because a denial aborts the transaction.
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

      // INSERT … ON CONFLICT DO UPDATE is an UPDATE wearing an INSERT's privilege; Postgres
      // asks for the UPDATE privilege on the conflict path, which 0009 revoked.
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

      // A row for the other tenant, from this tenant's scope: the policy's WITH CHECK.
      await client.query("SAVEPOINT other_tenant");
      await expect(
        client.query(
          `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
           VALUES ($1, $2, 'people.group.created', 'process:better-answers-test', $3, '{}')`,
          [ulid(), WS_B, ulid()],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");

      // The family and the subject kind are the database's reading of the act; a caller
      // cannot write a family the act does not say.
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
    // Straight SQL rather than the factory, which would refuse these at the boundary before
    // any INSERT existed: the claim here is the database's own.
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
    // The CHECK's list is written from `FAMILIES` when the table is declared; this reads it
    // back out of the catalogue and holds the two equal, so a fifth family can be added to
    // neither alone.
    const constraint = await db.pool.query<{ definition: string }>(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'audit_event_family_check'",
    );
    const inCheck = [...(constraint.rows[0]?.definition ?? "").matchAll(/'([a-z]+)'/g)].map(
      (match) => match[1],
    );
    expect(inCheck.toSorted()).toEqual([...FAMILIES].toSorted());
    // The boundary's half: every word the CHECK admits parses, and a fifth does not.
    const family = boundarySchemas.auditEvent.select.shape.family;
    expect(inCheck.map((word) => family.safeParse(word).success)).toEqual(inCheck.map(() => true));
    expect(family.safeParse("billing").success).toBe(false);
  });
});

/**
 * The two group tables' own proofs (ADR 0038): tenant tables like any other, so the
 * zero-rows proof is stated here in their words; and two cascades that are the database's
 * promise rather than the slice's — a membership that ends takes its group rows with it,
 * and a deleted group takes its memberships. Both run as the app's role under FORCE, so
 * what is proved is what a deployed estate does.
 *
 * The composite key to `group` is the security claim: a foreign-key check bypasses RLS by
 * Postgres's own rule, so a key on the group id alone would confirm that *somebody* holds
 * a given id. Keyed by the workspace and the id together, it can only ever confirm a group
 * of the workspace the referring row already names.
 */
/** A person in two of A's groups, a group of B's holding the same name, and the app's role scoped to A. */
const groupsAsApp = async (client: pg.PoolClient) => {
  const seed = await seedTwoWorkspaces(client);
  const person = await seed.user();
  await seed.member({ workspaceId: WS_A, userId: person.id });
  const hr = await seed.group({ workspaceId: WS_A, name: "HR team" });
  const sales = await seed.group({ workspaceId: WS_A, name: "Sales executives" });
  // The same name in the other tenant: the unique index is per workspace, and seeding
  // this row at all is the proof — it would have thrown otherwise.
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

      // A membership written wholly into the other tenant: the policy's WITH CHECK, on the
      // second table as on the first.
      await client.query("SAVEPOINT other_membership");
      await expect(
        client.query(
          "INSERT INTO group_member (workspace_id, group_id, user_id) VALUES ($1, $2, $3)",
          [WS_B, theirs.id, person.id],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_membership");

      // The row itself is this tenant's, so the policy admits it; what refuses it is the
      // key, which names the workspace beside the group id — the foreign-key check runs
      // outside RLS and still cannot find B's group under A's workspace.
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
      // The groups outlive the person: a leaver empties, never deletes.
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
    // The worker holds no people data: who is in which group is applied at read time by
    // the app, never by the worker, so a compromised worker can neither read a workspace's
    // membership nor write itself into one.
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
      // Six lines of arrange the test above also has, carried rather than folded: which
      // scope is set, and when, is the whole subject of each of these tests.
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
  it("creates the chunk partition and its HNSW index for app_rt, in one transaction", async () => {
    await withRollback(db.pool, async (client) => {
      // Six lines of arrange the test above also has, carried rather than folded: which
      // scope is set, and when, is the whole subject of each of these tests.
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
      expect(index.rows.map((row) => row.indexdef).join(" ")).toContain("hnsw");
    });

    // "In one transaction" made checkable: the enclosing transaction rolled back, so
    // the partition and its index went with it.
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

      // No scope at all.
      await expect(client.query("SELECT create_workspace_partition($1)", [WS_A])).rejects.toThrow(
        /not scoped/,
      );
    });
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      // Scoped to A, asking for B's objects.
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
    // The RLS-bypass Cubic caught: parent policies do not apply to a query aimed at
    // a child table, and migration 0000's default privileges would have granted the
    // runtime roles DML on it — the lifecycle function revokes them, so the only
    // road to chunk rows is the policied parent.
    await withRollback(db.pool, async (client) => {
      // Seven lines of arrange the chunk-scoping test above also has, carried rather than
      // folded: which scope is set, and when, is the whole subject of each of these tests.
      /* jscpd:ignore-start */
      const seed = await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query("SELECT create_workspace_partition($1)", [WS_A]);
      await seed.chunk({ workspaceId: WS_A, content: "hello" });
      /* jscpd:ignore-end */

      // The other tenant's scope, aiming straight at A's partition. Each denial
      // aborts the transaction, so a savepoint fences it from the next assertion.
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      await client.query("SAVEPOINT direct_query");
      await expect(client.query(`SELECT id FROM "index"."chunk_${WS_A}"`)).rejects.toThrow(
        /permission denied/,
      );
      await client.query("ROLLBACK TO SAVEPOINT direct_query");

      // Even the owning tenant goes through the parent, never the child.
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await expect(client.query(`SELECT id FROM "index"."chunk_${WS_A}"`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});
