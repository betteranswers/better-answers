import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { declaredTableNames } from "../scripts/worker-view.ts";
import {
  boundarySchemas,
  CONCEPT_FRONTMATTER_MAX,
  EXEMPT_TABLE_NAMES,
  FAMILIES,
  IDENTITY_SET,
  RLS_EXEMPTIONS,
  ROLES,
  SUGGESTION_BODY_MAX,
  ulid,
} from "../src/index.ts";
import { type TestData, testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

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

/** Rows visible per table under the role and scope the client holds — the zero-rows probe. */
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

/**
 * A statement that must be refused, the reason a reader wants beside it, its parameters,
 * and the refusal's own words — a privilege's unless the case says otherwise.
 */
type Refusal = readonly [
  statement: string,
  why: string,
  parameters?: readonly unknown[],
  message?: RegExp,
];

/**
 * Every statement in turn, each inside its own savepoint, each asserted with its reason
 * beside it — so a grant that stops refusing names the sentence it broke rather than
 * reporting that a query succeeded. Written once because three grants below are asked the
 * same question, and a copy per suite is three chances to forget the savepoint.
 */
const refusesEach = async (client: pg.PoolClient, refusals: readonly Refusal[]): Promise<void> => {
  for (const [statement, why, parameters = [], message = /permission denied/] of refusals) {
    await client.query("SAVEPOINT refusal_probe");
    const outcome = await client
      .query(statement, [...parameters])
      .then(() => "allowed")
      .catch((cause: unknown) => (cause as { message: string }).message);
    expect({ why, outcome }).toEqual({
      why,
      outcome: expect.stringMatching(message),
    });
    await client.query("ROLLBACK TO SAVEPOINT refusal_probe");
  }
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

/**
 * The access-request queue's own proofs (ADR 0038): a tenant table like any other, so its
 * zero-rows proof is stated here in its own words; the worker's role is refused on it
 * outright (migration 0013, `[SEC3]`); and the partial unique index refuses a second open
 * request from the same person while leaving a decided one alone.
 */
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

      // The second open ask, refused by the partial unique index rather than by code.
      await client.query("SAVEPOINT second");
      await expect(seed.accessRequest(waiting)).rejects.toThrow(/access_request_waiting_uidx/);
      await client.query("ROLLBACK TO SAVEPOINT second");

      // Both axes of the index's WHERE, each proved by a row it lets through: the same
      // person waiting in the other workspace, and a decided row for this person here —
      // which is what leaves a declined person free to ask again.
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
    // Straight SQL rather than the factory, which would refuse the status at the boundary
    // before any INSERT existed: the claim here is the database's own.
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const person = await seed.user();
      const rows: readonly [string, string][] = [
        // A fourth status, with a whole decision beside it so that only the status's own
        // CHECK can be what refuses the row.
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

/**
 * The concept write path's own proofs (ADR 0012, migration 0015, `[SEC3]`): five tenant
 * tables like any other, so the zero-rows proof is stated here in their words; the worker's
 * role is refused on all five outright; the composite keys refuse a row that names another
 * tenant's concept; and the CHECKs refuse a status, a class and an imported check that
 * carried a hash.
 */
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
      // One row of every table in each workspace: the claim is about all five, and asserting
      // it on the index row alone would leave the other four proved by their neighbour.
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
      // One each, never two: the other workspace's row is not in a scoped read at all.
      expect(await countedRows(client, CONCEPT_TABLES)).toEqual(
        CONCEPT_TABLES.map((table) => ({ table, rows: 1 })),
      );
    });
  });

  it("refuses the worker role on four of the five, reading and writing alike (migrations 0015, 0022)", async () => {
    // Migration 0015 revoked ALL on all five; migration 0022 gives the index row's *read*
    // back, and nothing else, because both of the worker's job kinds read it — the audit
    // compares its own parse against `content_hash`, the rebuild copies the derived
    // visibility columns onto the generation it writes. The other four stay out of reach,
    // and the index row stays unwritable, which is the half that matters: the records'
    // derived visibility is the app's, and a worker that could write it would be a second
    // opinion about who may read a concept.
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

      // The grant is a table privilege; the policy is still what says which rows. Unscoped
      // is zero rows, and a scope is this tenant's alone — the same guarantee the app's
      // role reads under, because the read predicate is not what a grant does.
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

      // The policy's WITH CHECK: a row whose workspace is not the scope never lands.
      await client.query("SAVEPOINT other_tenant");
      await expect(
        client.query(
          "INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, 'policy:theirs')",
          [WS_B, `${theirs.iri}-copy`],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT other_tenant");

      // The composite key: the foreign-key check runs as the owner and bypasses the policy,
      // so a key on the IRI alone would confirm that another tenant holds it. Keyed by the
      // pair, it refuses inside this workspace exactly as it would for an IRI nobody minted.
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
          // No published instant, so the published CHECK is satisfied and only the status's
          // own can be what refuses the row.
          `INSERT INTO concept_index ${columns} VALUES ${values}, 'retired', 'Internal', NULL)`,
          [WS_A, identity.iri, "knowledge/one.md"],
          "concept_index_status_check",
        ],
        [
          `INSERT INTO concept_index ${columns} VALUES ${values}, 'draft', 'Secret', NULL)`,
          [WS_A, identity.iri, "knowledge/two.md"],
          "concept_index_sensitivity_check",
        ],
        // A concept a reader may reach that carries no published instant, and a draft that
        // carries one: the predicate's first arm reads this column, so both directions are
        // the database's to refuse.
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
        // The other direction of the same sentence: a check the platform made, with nothing
        // recorded as confirmed.
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
        // A commit whose parent this workspace never recorded: the chain is the database's,
        // so `bundle_commit` cannot hold a history with a link missing from it.
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

      // Deferred: the row lands, and the constraint speaks when the act would end. `SET
      // CONSTRAINTS ALL IMMEDIATE` is how a test reaches that moment without committing.
      await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toThrow(
        /concept_index_bundle_commit_fk/,
      );
      await client.query("ROLLBACK TO SAVEPOINT dangling");
    });
  });
});

/**
 * The graph tables' own proofs (ADR 0032, migration 0016, `[SEC3]`): three tenant tables
 * like any other, so the zero-rows proof is stated here in their words; the worker's role
 * is refused on all three outright; the policy's WITH CHECK refuses a node written into
 * another tenant; and the CHECKs and unique indexes refuse a label outside the closed set,
 * a prefixed label inside a generation, a class outside the three, a doubled key in either
 * partition and a second live-generation row — while the side-by-side shape a full rebuild
 * needs (one uid in two generations) lands.
 */
describe("the graph tables under app_rt", () => {
  const GRAPH_TABLES = ["graph_generation", "graph_node", "graph_edge"] as const;

  it("returns zero rows on a missing scope and only the scoped tenant's rows otherwise, on all three", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      for (const workspaceId of [WS_A, WS_B]) {
        // One node, one edge and the generation row they stamp, in each workspace: the
        // claim is about all three tables, not the neighbour that happened to be seeded.
        const from = await seed.graphNode({ workspaceId });
        await seed.graphEdge({ workspaceId, fromUid: from.uid });
      }
      await client.query("SET LOCAL ROLE app_rt");

      expect(await countedRows(client, GRAPH_TABLES)).toEqual(
        GRAPH_TABLES.map((table) => ({ table, rows: 0 })),
      );

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      // One generation row, the seeded node and the target the edge factory minted —
      // never the other workspace's.
      expect(await countedRows(client, GRAPH_TABLES)).toEqual([
        { table: "graph_generation", rows: 1 },
        { table: "graph_node", rows: 2 },
        { table: "graph_edge", rows: 1 },
      ]);
    });
  });

  it("lets the worker build a generation beside the live one and flip it, and refuses it every edit to a node or an edge (migration 0022)", async () => {
    // Migration 0016 revoked ALL on all three and said the grants would land with the job
    // that uses them; migration 0022 is that job, and this is the shape it grants. The
    // worker may only ever *add* rows — to the generation it is building — and flip the
    // one row that says which generation is live. It can neither edit nor remove a row of
    // the live generation, which is what makes a rebuild invisible until the flip; and
    // sweeping a retired generation is the app's (T-058), so DELETE is nobody's here.
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
    // The grants say what a role may touch; these two triggers say which generation. A
    // rebuild writes `live + 1` and flips to it, an edit's delta writes into `live`, and
    // nothing else is a map write (ADR 0023, ADR 0032) — so a flip back to a swept
    // generation, or forward past one nobody built, and a row stamped into either, are
    // refused by the database rather than left to the code that chose `live + 1`.
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seed.graphNode({ workspaceId: WS_A });
      await seed.workspace({ id: "01J6CCCCCCCCCCCCCCCCCCCCCC", name: "C" });
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      // The served path: the live generation, the one being built, the source-entity
      // partition that carries none, and the flip to the next.
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
        // Re-asserting the live generation is not a flip; the delta's read does exactly this.
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

      // A workspace with no generation row has no live generation for a row to land in:
      // the delta and the rebuild both create the row first, and nothing else writes a map.
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

      // A source entity carries no generation, so the policy is the whole of what refuses
      // it; a bundle-and-record row is refused a step earlier, by the generation guard,
      // which under this scope can see no live generation of the other tenant's at all.
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
        // Each label family bound to its partition (ADR 0032): a label outside the closed
        // set; the prefixed form inside a generation, on either table; and a closed *node*
        // label carrying no generation — a node's rule holds both ways, an edge's closed
        // set is admitted at `gen` NULL because `IS_CONCEPT` and `SAME_AS` live there
        // (ADR 0026's amendment).
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
        // A generation before the first, on the rows as on the counter's own row below.
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
        // The two partitions' keys: a doubled `(workspace, gen, uid)` in the
        // bundle-and-record partition, and a doubled `(workspace, uid)` among the
        // source entities, which carry no generation to tell two rows apart by.
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
        // The link columns are LINKS_TO's alone: a named edge cannot smuggle prose.
        [
          "INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid, sentence) VALUES ($1, 1, 'edge-1', 'SUPERSEDES', 'a', 'b', 'smuggled')",
          [WS_A],
          "graph_edge_links_to_check",
        ],
        // One live generation per workspace, and never a generation before the first.
        [
          "INSERT INTO graph_generation (workspace_id, live_gen) VALUES ($1, 2)",
          [WS_A],
          "graph_generation_pkey",
        ],
        // The scoped workspace, so the row's own CHECK is what refuses it — Postgres
        // evaluates a CHECK before the key, so the doubled workspace never masks it.
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

      // The shape a full rebuild writes beside the live map (ADR 0023): the same uid in
      // the next generation lands, because the key carries the generation.
      await client.query(
        "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, $2, $3, 'Concept')",
        [WS_A, (node.gen ?? 0) + 1, node.uid],
      );
    });
  });
});

/**
 * The inbox's own proofs (ADR 0005, ADR 0012, migration 0018, `[SEC3]`): two tenant tables
 * like any other, so the zero-rows proof is stated here in their words; **the payload is out
 * of every runtime role's reach** and served by one definer function granted to the app
 * alone; the worker submits through a function and reads nothing back; and the decision
 * CHECK refuses every half-decided row the slice would otherwise have to remember not to
 * write.
 */
/** A waiting suggestion and its payload in each workspace, with the app's role scoped to A. */
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

/**
 * Say which suggestion this transaction is deciding, as the concepts slice's decision and
 * acceptance paths do (`markDeciding`). The row's trigger refuses a decision that arrives
 * without it, so a test asserting the *served* path has to speak the same sentence the
 * slice speaks; the test below asserts what happens when nobody does.
 */
const deciding = (client: pg.PoolClient, suggestionId: string) =>
  client.query("SELECT set_config('app.deciding_suggestion', $1, true)", [suggestionId]);

/**
 * One request of a submitted set, with whatever a test varies about it. The frontmatter is
 * the **producer's own JSON text**, because that is what `submit_suggestion_set` measures and
 * casts (migration 0018). Shared, because each test below varies one field of it and four
 * copies would be four places a change to the payload's shape has to land.
 */
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

/** Submit a set as whoever the transaction currently is — the one call all four sites make. */
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

      // The app's role: no road to the table at all — not a read, not a write.
      for (const statement of [
        "SELECT 1 FROM concept_write_request LIMIT 1",
        "DELETE FROM concept_write_request",
      ]) {
        await client.query("SAVEPOINT payload");
        await expect(client.query(statement)).rejects.toThrow(/permission denied/);
        await client.query("ROLLBACK TO SAVEPOINT payload");
      }

      // And the one road that is open: the acceptance path's function, which serves the
      // payload of a suggestion that is still waiting.
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
      // The function is the app's alone: a producer that could call it could read another
      // producer's candidates out of the inbox, which ADR 0012's amendment forbids.
      await expect(
        client.query("SELECT 1 FROM concept_write_request_for($1)", [here.id]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("withholds a payload once the suggestion is decided, and one of another tenant always", async () => {
    await withRollback(db.pool, async (client) => {
      const { here, there } = await inboxAsApp(client);

      // Another tenant's suggestion, asked for by id from this tenant's scope: the same
      // answer as an id nobody minted, which is what stops the function being a probe.
      const foreign = await client.query("SELECT 1 FROM concept_write_request_for($1)", [there.id]);
      expect(foreign.rowCount).toBe(0);

      await deciding(client, here.id);
      await client.query(
        `UPDATE suggestion SET status = 'declined', decider = 'process:better-answers-test',
                decided_at = now(), reason = 'not the company''s word on this'
          WHERE workspace_id = $1 AND id = $2`,
        [WS_A, here.id],
      );

      // A decided suggestion has been committed or refused; its payload has no reader left.
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
    // The privilege the app keeps is a general UPDATE — it is how a decision is written —
    // so what a decision *is* has to be the database's own sentence too: without this,
    // app code could mark a suggestion accepted with no commit, no ledger row and no
    // graph delta, which is the one thing the acceptance's transaction exists to prevent.
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

      // The served path first: a waiting suggestion is declined, once.
      expect((await decline(decided.id)).rowCount).toBe(1);

      // A second decision over the first, and the first undone back to waiting; then, on a
      // suggestion still waiting, an update that decides nothing and a decision that also
      // restates what was proposed. Thunks, because each one has to run behind its own
      // savepoint — a failed statement aborts everything after it (`[TEST8]`).
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
    // The decision trigger's other half. Refusing a *second* decision leaves the first one
    // open to any UPDATE the app can write — a suggestion marked accepted with no commit,
    // no ledger row and no graph delta, which is exactly what the acceptance's transaction
    // exists to make impossible. So the transaction has to name what it is deciding, and
    // the concepts slice's two decision paths are the only things that say it.
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

      // And a marker naming some *other* suggestion is no marker at all: the act names the
      // row it is deciding, not merely that it is deciding something.
      await deciding(client, ulid());
      await client.query("SAVEPOINT elsewhere");
      await expect(decline(here.id)).rejects.toThrow(/this transaction is not making it/);
      await client.query("ROLLBACK TO SAVEPOINT elsewhere");

      // The served path beside the refusals, in the words the slice speaks.
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
      // Both `p_kind` and `p_proposer` are the caller's words, so a compromised producer
      // could otherwise submit an *edit* under a `human:` proposer — a form the row's own
      // CHECK accepts — and put a change in a person's name into the queue an Admin
      // decides from. Which tier is calling is what the function reads instead.
      await client.query("SAVEPOINT kind");
      await expect(submit("edit", "human:01J6CCCCCCCCCCCCCCCCCCCCCC")).rejects.toThrow(
        /worker_rt may not raise a suggestion of kind edit/,
      );
      await client.query("ROLLBACK TO SAVEPOINT kind");

      // And the served path beside it: the platform's own citation repair, which is a
      // routine the worker runs.
      const repaired = await submit("repair", "process:better-answers-citation-repair");
      expect(repaired.rowCount).toBe(1);

      await client.query("SET LOCAL ROLE app_rt");
      // And what the app may not raise: the platform's own repair, and a run's candidate —
      // a candidate is what a run *found*, so an app that could raise one could put work
      // no run did into the queue an Admin decides from.
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

      // The served path: a run's candidates, submitted as one call, landing in the
      // workspace the transaction already names — the function takes no workspace at all.
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

      // A producer chooses how much it sends, so somebody other than the caller chooses
      // the ceiling; and a set of nothing is a call that meant to say something.
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

      // The guard `[SEC3]` asks a definer function to make before it writes anything: the
      // set lands in the scope the caller already holds, and an unscoped caller has none.
      await expect(
        client.query("SELECT * FROM submit_suggestion_set($1, 'edit', $2, '[]'::jsonb)", [
          ulid(),
          "process:better-answers-test",
        ]),
      ).rejects.toThrow(/scoped to no workspace/);
    });
  });

  it("refuses every half-decided suggestion the write path forbids, each at its own constraint", async () => {
    // Straight SQL rather than the factory, which would refuse these at the boundary before
    // any INSERT existed: the claim here is the database's own.
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const identity = await seed.conceptIdentity({ workspaceId: WS_A });
      const columns =
        "(workspace_id, id, set_id, kind, proposer, status, decider, decided_at, reason, target_iri)";
      const rows: readonly [string, string][] = [
        // A fifth status, and a kind nobody declared. The status row is a whole decision
        // otherwise, so that only the status's own CHECK can be what refuses it.
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'withdrawn', $4, now(), NULL, NULL)`,
          "suggestion_status_check",
        ],
        [
          `VALUES ($1, $2, $3, 'merge', $4, 'waiting', NULL, NULL, NULL, NULL)`,
          "suggestion_kind_check",
        ],
        // Decided by nobody, decided at no time, and each half of the pair alone.
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'declined', NULL, now(), 'why', NULL)`,
          "suggestion_decision_check",
        ],
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'declined', $4, NULL, 'why', NULL)`,
          "suggestion_decision_check",
        ],
        // A decline with no reason, and an acceptance carrying one.
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'declined', $4, now(), NULL, NULL)`,
          "suggestion_decision_check",
        ],
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'accepted', $4, now(), 'why', '${identity.iri}')`,
          "suggestion_decision_check",
        ],
        // A target on anything but an acceptance, and an acceptance with no target: the
        // target is what the acceptance resolved, so the two are one fact.
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'waiting', NULL, NULL, NULL, '${identity.iri}')`,
          "suggestion_decision_check",
        ],
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'accepted', $4, now(), NULL, NULL)`,
          "suggestion_decision_check",
        ],
        // A waiting suggestion that somebody has already decided.
        [
          `VALUES ($1, $2, $3, 'edit', $4, 'waiting', $4, now(), NULL, NULL)`,
          "suggestion_decision_check",
        ],
        // A decider of no known form — the row is written by a definer function both tiers
        // call, which is past every boundary the app parses through.
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

      // The proposer's own two rules, each read off the value the row carries: an actor of
      // no known form at all, and — the security one — a **repair nobody but the platform
      // may raise**. Accepting a repair re-points every standing check at the content it
      // wrote, so a member who could raise one could make somebody's check vouch for
      // content they never saw; not even an agent's output qualifies, because the repair is
      // the platform's own routine (ADR 0019).
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
      // And the served path the refusals sit beside: the platform's own repair lands.
      const platform = await client.query(
        `INSERT INTO suggestion (workspace_id, id, set_id, kind, proposer)
         VALUES ($1, $2, $3, 'repair', 'process:better-answers-citation-repair') RETURNING id`,
        [WS_A, ulid(), ulid()],
      );
      expect(platform.rowCount).toBe(1);
    });
  });

  it("refuses a body larger than a concept could be, at the row", async () => {
    // Straight SQL rather than the factory, which would refuse it at the boundary before
    // any INSERT existed: the claim here is the database's own, because the row is written
    // by a definer function both tiers call and no boundary stands in front of that.
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const here = await seed.suggestion({ workspaceId: WS_A });

      // A concept is a fact stated once, not a document; a producer writes this column, so
      // the size is somebody else's to bound. Its `frontmatter` neighbour is bounded in
      // `submit_suggestion_set` instead, and the test below says why.
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

      // **The rendering is not the caller's text, within any multiplier.** A `jsonb` column
      // read back with `::text` is Postgres's own printing of it — `{"a":1e-100}` is twelve
      // characters sent and a hundred and nine read back, and a number may carry a scale of
      // sixteen thousand — so a bound over the rendering would refuse payloads the boundary
      // had already passed. The frontmatter therefore arrives as the producer's own JSON text
      // and is measured as sent, here, which is the only road to the row.
      const wide = JSON.stringify({ a: 1e-100, title: "Expenses" });
      expect(wide.length).toBeLessThan(CONCEPT_FRONTMATTER_MAX);
      expect((await submit(wide)).rowCount).toBe(1);

      await client.query("SAVEPOINT frontmatter");
      await expect(
        submit(JSON.stringify({ title: "x".repeat(CONCEPT_FRONTMATTER_MAX) })),
      ).rejects.toThrow(/frontmatter is the producer's own JSON text/);
      await client.query("ROLLBACK TO SAVEPOINT frontmatter");

      // And an object where the text belongs: refused rather than quietly rendered, which
      // would be the measurement this function exists to avoid.
      await client.query("SAVEPOINT shape");
      await expect(submit({ title: "Expenses" })).rejects.toThrow(
        /frontmatter is the producer's own JSON text/,
      );
      await client.query("ROLLBACK TO SAVEPOINT shape");

      // A payload is the file an acceptance would commit, so its frontmatter is a mapping.
      // A list, a bare scalar and JSON's null are all valid JSON text that casts and stores
      // perfectly well — and then fails at the acceptance, which reads the file's keys,
      // where the refusal is somebody else's problem and the payload is already in the queue.
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

      // The composite key again: the foreign-key check runs as the owner and bypasses the
      // policy, so a key on the IRI alone would confirm that another tenant holds it.
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

/**
 * The audience pair on every readable unit (ADR 0039; migrations 0019 and 0020, `[SEC3]`):
 * the word and the array are one fact the row holds — *everyone* over no array, *groups*
 * over a non-empty one with no NULL element — refused in every half-shape on every table
 * that carries the pair, the hand-written chunk and graph DDL included, with the two whole
 * shapes landing beside the refusals. An empty intersection is therefore never a row: the
 * derivation forces the unit Restricted instead.
 */
describe("the audience pair on every readable unit", () => {
  /** Every table carrying the pair, seeded with one row of A's, and the CHECK that holds it. */
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

        // *groups* over nothing, over an empty array and over a NULL element; *everyone*
        // over an array; and a word outside the pair. Each aborts the transaction, so each
        // runs behind its own savepoint (`[TEST8]`).
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

        // The served paths: named groups, and back to everyone.
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

/**
 * The **rules in force** on a binding (ADR 0020; migration 0031): the two tiers a binding
 * switches, on the row rather than by convention, with the safe set as the column's default.
 *
 * Held by the database and not by the boundary alone, because the boundary is the app's and
 * this value is the *worker's* argument: `worker_rt` holds default DML on every ordinary
 * `public` table (migration `0000_substrate.sql`), so a shape stated at the boundary alone is
 * a shape one tier could write around. The refusals are written as UPDATEs for the same reason
 * the identifier set's are — the CHECK is what the row is held to whoever wrote it.
 */
describe("the rules in force on a source binding", () => {
  it("gives a binding nobody configured the safe set, and takes the one flip that changes it", async () => {
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      // A binding written without the factory and without the boundary, naming the workspace
      // and the id and nothing else: what lands in the column is then the database's own
      // DEFAULT and not a value some layer above put there.
      const id = ulid();
      await client.query("INSERT INTO source_binding (workspace_id, id) VALUES ($1, $2)", [
        WS_A,
        id,
      ]);

      // The safe set, written down here as a literal (`[TEST9]`): the default-on tier on, the
      // default-off tier off, and no key for *always*, because no binding switches it off.
      const born = await client.query<{ rules_in_force: Record<string, boolean> }>(
        "SELECT rules_in_force FROM source_binding WHERE id = $1",
        [id],
      );
      expect(born.rows).toEqual([{ rules_in_force: { default_on: true, default_off: false } }]);

      // The HR-shaped binding of the S0 spec: names withheld, which is one flip and not a new
      // column, a new table or a list of categories anywhere near a migration.
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
        // A tier missing. `->` on an absent key is SQL NULL and a CHECK worth NULL passes, so
        // this is the case a `=` comparison would have taken: a binding whose answer to *is a
        // name withheld?* is nothing at all.
        `'{"default_on": true}'::jsonb`,
        // A value that is neither a yes nor a no.
        `'{"default_on": true, "default_off": "no"}'::jsonb`,
        // The JSON `null`, which `jsonb NOT NULL` takes — it refuses SQL NULL, not the JSON
        // value — so this is the layer that refuses a binding withholding by no rule at all.
        `'null'::jsonb`,
        // A list and a bare string: valid JSON, and not a set of tiers.
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

/**
 * The derivation's six tables (ADR 0039; migrations 0019 and 0020, `[SEC3]`): tenant tables
 * like any other, so the zero-rows proof is stated here in their words; the worker's role is
 * refused on all six outright; every composite key refuses a row naming another tenant's
 * binding, concept or evidence; the override's own CHECKs refuse an actor of no known form
 * and a class outside the three; and the citation's key keeps cited evidence while a
 * citation names it.
 */
describe("the derivation's tables under app_rt", () => {
  const DERIVATION_TABLES = [
    "source_binding",
    "source_document",
    "concept_evidence",
    "concept_class_override",
    "composition",
    "composition_include",
  ] as const;

  /** One row of every table in one workspace: a binding, its document, a cited concept, its override, a composition including it. */
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

  it("refuses the worker role on all six tables, reading and writing alike (migration 0020)", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      await seedOneOfEach(seed, WS_A);
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      for (const table of DERIVATION_TABLES) {
        await client.query("SAVEPOINT derivation_probe");
        await expect(client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rejects.toThrow(
          /permission denied/,
        );
        await client.query("ROLLBACK TO SAVEPOINT derivation_probe");
        await expect(client.query(`DELETE FROM "${table}"`)).rejects.toThrow(/permission denied/);
        await client.query("ROLLBACK TO SAVEPOINT derivation_probe");
      }
    });
  });

  it("refuses a row naming another tenant's binding or concept, and a citation of evidence nobody recorded, each at its key", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const ours = await seedOneOfEach(seed, WS_A);
      const theirs = await seedOneOfEach(seed, WS_B);
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      // Every key names the workspace beside the id: a foreign-key check runs outside RLS
      // and still cannot find B's binding or concept under A's workspace — the same refusal
      // an id nobody minted gets, so a prober learns nothing.
      const rows: readonly [string, readonly unknown[], string][] = [
        [
          "INSERT INTO source_document (workspace_id, id, binding_id) VALUES ($1, $2, $3)",
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
        // A citation of evidence no row records: a concept cites what was recorded at its
        // commit, never a locator nobody kept.
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

      // The evidence pane names the overriding Admin off this column, so it holds the
      // ledger's actor form and never a display name.
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
      // And the served path beside them.
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

      // Cited evidence outlives its source (ADR 0013): the key refuses the delete rather
      // than cascading the citation away.
      await client.query("SAVEPOINT cited");
      await expect(
        client.query(
          "DELETE FROM evidence WHERE workspace_id = $1 AND source_document_id = $2 AND locator = $3",
          [WS_A, ours.cited.sourceDocumentId, ours.cited.locator],
        ),
      ).rejects.toThrow(/concept_evidence_evidence_fk/);
      await client.query("ROLLBACK TO SAVEPOINT cited");

      // A concept that has left the bundle cites nothing: the identity's cascade takes the
      // citation, the override and the include that named it.
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

/**
 * The **finding** (`CONTEXT.md`; ADR 0020, the S0 spec's tier boundary): what the seam found
 * in one source document, written by the worker and reviewed by the app. A tenant table like
 * any other, so the zero-rows proof is stated here in its words — and the grant is the whole
 * of the boundary between the two tiers (`[SEC3]`): the worker's role holds INSERT alone, so
 * a compromised worker can record what it withheld and can never read a workspace's findings
 * back, stamp a review, or take away the record of a span.
 *
 * The table never holds the value it found — offsets, a category and a score, and nothing a
 * personal detail could sit in. `boundary-schemas.test.ts` writes that column set down.
 */
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

  it("lets the worker record a finding and refuses it every road back to one (migration 0023)", async () => {
    // Migration 0000 hands both runtime roles the DML on every new `public` table by default
    // privilege, so the substrate revokes and grants INSERT back alone. The served path is
    // written without RETURNING on purpose: INSERT is the whole of what the worker holds, and
    // a statement that read its own row back would want the SELECT this grant withholds.
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const document = await seed.sourceDocument({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      await client.query(
        `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                              char_start, char_end, score, rule_version, detector_pin)
         VALUES ($1, $2, $3, 'sort-code', 'always', 'sort-code-with-account-number',
                 12, 20, 0.85, 'r1', 'd1')`,
        [WS_A, ulid(), document.id],
      );

      await refusesEach(client, [
        [
          "SELECT 1 FROM finding LIMIT 1",
          "the worker never reviews a finding, so it never reads one back",
        ],
        [
          "UPDATE finding SET review_state = 'narrowed'",
          "the review is an Admin's act, and a worker that could stamp one could mark a special-category span reviewed",
        ],
        [
          "DELETE FROM finding",
          "a finding is the record of what was withheld, and nothing the worker holds takes one away",
        ],
        // The two the grant's column list is for (migration 0032). Neither of these is an
        // UPDATE, and both reach the state the revoke of UPDATE was written to prevent: the
        // row CHECKs admit a review and a restore **on the insert itself**, so a worker that
        // may name those columns can land a reviewed or restored span without ever holding a
        // privilege 0024 named. What is refused is the column, not the value.
        [
          `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                char_start, char_end, score, rule_version, detector_pin,
                                review_state, reviewed_by, reviewed_at)
           VALUES ($1, $2, $3, 'sort-code', 'always', 'sort-code-with-account-number',
                   30, 38, 0.9, 'r1', 'd1', 'kept-in-text', 'process:better-answers-test', now())`,
          "a finding is born unreviewed, and one inserted already reviewed is a special-category span a binding may widen over at nobody's word",
          [WS_A, ulid(), document.id],
        ],
        [
          `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                char_start, char_end, score, rule_version, detector_pin,
                                restored_at, restored_by, restore_reason)
           VALUES ($1, $2, $3, 'sort-code', 'always', 'sort-code-with-account-number',
                   40, 48, 0.9, 'r1', 'd1', now(), 'process:better-answers-test', 'let it stand')`,
          "the restore is an Admin's act as well, and a span born restored is one the seam withheld and nobody put back",
          [WS_A, ulid(), document.id],
        ],
      ]);

      // The row the worker wrote, read back under the role that may read it — unreviewed,
      // which is what a finding is born as.
      await client.query("RESET ROLE");
      await client.query("SET LOCAL ROLE app_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const recorded = await client.query<{ document_id: string; review_state: string }>(
        "SELECT document_id, review_state FROM finding",
      );
      expect(recorded.rows).toEqual([{ document_id: document.id, review_state: "unreviewed" }]);
    });
  });

  it("refuses a finding naming another tenant's document, at its key", async () => {
    // The key names the workspace beside the document id, as every cross-table key in this
    // package does: a foreign-key check runs outside row-level security, so a key on the id
    // alone would confirm that some other tenant holds a given document.
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
        // A fourth tier and a fourth review state: both word sets are closed, and the
        // seam's three tiers are the glossary's.
        ["UPDATE finding SET tier = 'sometimes' WHERE id = $1", [always.id], "finding_tier_check"],
        // A fourth review state, with a whole review beside it so that only the state's own
        // CHECK can be what refuses the row.
        [
          `UPDATE finding SET review_state = 'dismissed', reviewed_at = now(),
                              reviewed_by = 'process:better-answers-test'
             WHERE id = $1`,
          [always.id],
          "finding_review_state_check",
        ],
        // Half a review: a state that moved with no Admin and no instant beside it would be
        // a reviewed span the screen cannot say who reviewed.
        [
          "UPDATE finding SET review_state = 'narrowed' WHERE id = $1",
          [always.id],
          "finding_review_check",
        ],
        // Half a restore, and a restore of a span no binding could switch off: the always
        // set is the only tier a restore applies to, which is the act's refusal made the
        // database's.
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

/**
 * The **subject request** (`CONTEXT.md`; ADR 0020, the S0 spec's record families): a person's
 * access or erasure request as an Admin recorded it, with the subject and the clock. A tenant
 * table like any other, so the zero-rows proof is stated here in its words.
 *
 * **The worker holds nothing here**, and that is the whole of its relation to this table
 * (`[SEC3]`). Migration 0000's default privileges would have handed it the four, as they did
 * on `finding`, so the substrate revokes and grants none back: the identifier set is
 * restricted personal data — the names and addresses a subject gave, in a workspace's own
 * words — and a tier whose only job is to run a detector over a document has no road to it.
 * A worker that could read this table would hold the platform's list of who has asked to be
 * erased; one that could write it could start a clock nobody set or answer a request nobody
 * answered.
 */
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

      // The row every one of those statements reached for, read back under the role that may
      // read it: still there, still unanswered. The refusals above are privileges rather than
      // policies, so this is what says the four were refused before the row and not after it.
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
        // A third kind: the pair is closed, as the glossary's *subject request* is.
        [
          "UPDATE subject_request SET kind = 'portability' WHERE id = $1",
          [request.id],
          "subject_request_kind_check",
        ],
        // A request naming nobody. The subject is a person id or the identifier set, and a
        // row with neither is a request no finder could run and no answer could reach.
        [
          `UPDATE subject_request
              SET person_id = NULL,
                  identifiers = '{"emails": [], "names": [], "other": []}'::jsonb
            WHERE id = $1`,
          [request.id],
          "subject_request_subject_check",
        ],
        // The set's three kinds, held by the database as well as the boundary: the finders
        // read one arm each, and an arm that is not a list is a finder with nothing to walk.
        // Two of the three missing is the case a `=` comparison would have taken, because
        // `->` on an absent key is SQL NULL and a CHECK worth NULL passes.
        [
          `UPDATE subject_request SET identifiers = '{"emails": []}'::jsonb WHERE id = $1`,
          [request.id],
          "subject_request_identifiers_check",
        ],
        // The one way off the shape the boundary does not refuse: `jsonb NOT NULL` takes the
        // JSON `null`, so this is the layer that refuses a set naming nobody at all.
        [
          `UPDATE subject_request SET identifiers = 'null'::jsonb WHERE id = $1`,
          [request.id],
          "subject_request_identifiers_check",
        ],
        // The clock, in the order the ICO's guidance sets it: the month runs from the start,
        // which is receipt or the later instant identity was confirmed, never before receipt.
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
        // An extension that does not extend. Article 12's two further months move the date
        // out; a date inside the month would be the platform shortening its own deadline.
        [
          "UPDATE subject_request SET extended_to = due_at WHERE id = $1",
          [request.id],
          "subject_request_clock_check",
        ],
        // Half an answer, either way: an instant with no words, and words with no instant.
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

/**
 * The **erasure request** (`CONTEXT.md`; ADR 0020, amended 2026-09-05): what the routine did
 * in every store for one subject request — the *erasure pseudonym* it minted, the instant it
 * took the lock, the per-store actions, the anchor with its four beyond-use dates, and the
 * report. The worker holds nothing here for the reason it holds nothing on the request: the
 * routine is the app tier's, under the platform principal, and this row is the record a
 * restore replays from.
 */
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

      // The row all four reached for, read back under the role that may read it: still there,
      // still unfinished, and still carrying the pseudonym the routine minted.
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
        // Half a completion, either way: a stamp with no report is a routine that finished
        // without saying what it did, and a report with no stamp is one that never finished.
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
        // The four dates run out from the anchor in order — 48 hours, 30 days, 8 weeks, six
        // months — because that is what the report promises about each backup tier. A weekly
        // date inside the daily one would be a promise the lifecycle rule cannot keep.
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
        // The actions are one flat object per store family; a `null` or a string would be a
        // record of what was done that no report could be written from.
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
    // One erasure per subject request: the replay re-runs the routine and finds the same
    // pseudonym on the same row, which is what makes it idempotent. A second row would be a
    // second pseudonym for one person, and a history rewritten twice to two opaque ids.
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

      // And the key names the workspace beside the request id, as every cross-table key in
      // this package does: a foreign-key check runs outside row-level security.
      await expect(client.query(insert, [WS_A, ulid(), theirs.id, ulid()])).rejects.toThrow(
        /erasure_request_subject_request_fk/,
      );
    });
  });
});

/**
 * The **suppression** (`CONTEXT.md`; ADR 0020): what keeps a person's data out of every
 * derived store the next time one document is reprocessed — one row per document per erasure
 * request, carrying the identifiers to keep out. Restricted personal data itself, which is
 * why the worker holds nothing here either: the reprocess that reads a suppression is the
 * app's act, and S1's worker is handed what to keep out rather than reading the table.
 */
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

  it("refuses the worker every road to a suppression", async () => {
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const suppression = await seed.suppression({ workspaceId: WS_A });

      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      await refusesEach(client, [
        [
          "SELECT 1 FROM suppression LIMIT 1",
          "a suppression is the identifiers of an erased person, so a worker that could read one would hold what the erasure was for",
        ],
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

      // The row all four reached for, read back under the role that may read it: still there,
      // still carrying the identifiers the routine wrote from the request's set.
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
        // A suppression keeps something out or it is not one: an empty set is a row the
        // reprocess would read and act on by doing nothing at all.
        [
          `UPDATE suppression SET identifiers = '${empty}'::jsonb WHERE document_id = $1`,
          [mine.documentId],
          "suppression_identifiers_check",
        ],
        // Both keys name the workspace beside the id, as every cross-table key in this
        // package does: a foreign-key check runs outside row-level security.
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

/**
 * The queue (ADR 0005's control plane of rows; ADR 0031's queue agreement). The claim
 * protocol's own behaviour — the order, the lapsed lease, the poison — is the fixture's, in
 * `contracts/queue/cases.json`, and both tiers' conformance suites read it. What is proved
 * here is what a *role* and a *scope* reach: the table's zero-rows guarantee, and the fact
 * that the four functions are SECURITY INVOKER, so a caller in the wrong scope claims
 * nothing rather than claiming somebody else's work.
 */
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
    // The functions take no workspace argument at all, so there is nothing to guard: the
    // policy is what decides which rows they can see, and an unscoped transaction sees
    // none. This is the whole reason none of the four is a definer function.
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const theirs = await seed.job({ workspaceId: WS_B });
      await client.query("SET LOCAL ROLE worker_rt");

      await client.query("SELECT set_config('app.workspace_id', '', true)");
      const unscoped = await client.query("SELECT id FROM claim_job($1, $2::interval)", [
        "worker-1",
        "60 seconds",
      ]);
      expect(unscoped.rows).toEqual([]);

      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const elsewhere = await client.query("SELECT id FROM claim_job($1, $2::interval)", [
        "worker-1",
        "60 seconds",
      ]);
      expect(elsewhere.rows).toEqual([]);

      // And the other tenant's job is untouched — still queued, still unclaimed. Read from
      // its own scope, because that is the only scope it exists in.
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_B]);
      const untouched = await client.query<{ status: string; claimed_by: string | null }>(
        "SELECT status, claimed_by FROM job WHERE id = $1",
        [theirs.id],
      );
      expect(untouched.rows).toEqual([{ status: "queued", claimed_by: null }]);
    });
  });

  it("refuses both runtime roles a DELETE on the queue, while the claim protocol still moves a row (migration 0022)", async () => {
    // A job's row is the record of a run and nothing removes one: the queue retires a job
    // by moving its status through the four functions, never by taking the row away, so the
    // default DELETE migration 0000 would have handed both roles is revoked.
    await withRollback(db.pool, async (client) => {
      const seed = await seedTwoWorkspaces(client);
      const job = await seed.job({ workspaceId: WS_A });
      for (const role of ["app_rt", "worker_rt"]) {
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
        await refusesEach(client, [["DELETE FROM job", `${role} removing the record of a run`]]);
        await client.query("RESET ROLE");
      }

      // The served path: the row still moves, through the function, under the worker's role.
      await client.query("SET LOCAL ROLE worker_rt");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
      const claimed = await client.query<{ id: string }>(
        "SELECT id FROM claim_job($1, $2::interval)",
        ["worker-1", "60 seconds"],
      );
      expect(claimed.rows).toEqual([{ id: job.id }]);
    });
  });

  it("refuses every caller but the two runtime roles the migration grants (migration 0022)", async () => {
    // EXECUTE is revoked from PUBLIC on all four, so a role nobody granted — a person's
    // ad-hoc session, a role a later migration adds — reaches none of them.
    await withRollback(db.pool, async (client) => {
      await seedTwoWorkspaces(client);
      await client.query("CREATE ROLE queue_probe NOLOGIN");
      await client.query("GRANT USAGE ON SCHEMA public TO queue_probe");
      await client.query("SET LOCAL ROLE queue_probe");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);

      const refused: readonly [string, readonly unknown[]][] = [
        ["SELECT id FROM claim_job($1, $2::interval)", ["worker-1", "60 seconds"]],
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

/**
 * The migration stamp (`[WRK1]`): the worker refuses to claim a job when the schema view it
 * carries and the database it would claim from disagree about which migration ran last. The
 * grant that makes the check possible lands in the same migration as the check (migration
 * 0022, closing PR #5's finding), and it is one SELECT and nothing else.
 */
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
