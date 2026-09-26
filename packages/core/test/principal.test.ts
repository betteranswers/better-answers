import { NIGHTLY_AUDIT_KIND, ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { configProbeWritten } from "@better-answers/schema/testing/probes";
import { describe, expect, expectTypeOf, it } from "vitest";

import { act, declareActs, declareIdentitySetActs, record, recordFor } from "../src/audit/index.ts";
import {
  actorIdOfPerson,
  attempt,
  err,
  ok,
  type Claims,
  type Principal,
  type Result,
  type UserPrincipal,
} from "../src/kernel/index.ts";
import { enqueueJobIn, enqueueJobInput } from "../src/runs/index.ts";
import {
  consumeCall,
  consumeIngress,
  folded,
  openPostgres,
  readWorkspaceConfig,
  tablesPresent,
  withMembership,
  withOperator,
  withPrincipal,
  withScope,
  type Answered,
  type PostgresDoor,
  type Tx,
} from "../src/store/postgres/index.ts";
import { bootstrap, principalOf } from "./platform.ts";
import { inputOf } from "./suite-input.ts";
import { postgresForSuite } from "./suite-postgres.ts";

const db = postgresForSuite();

type Seeded = {
  workspaceId: string;
  userId: string;
  otherWorkspaceId: string;

  groupIds: { here: readonly string[]; there: readonly string[] };
};

const seedMembership = async (
  overrides: {
    role?: "Admin" | "Editor" | "Viewer";

    revokedAt?: Date;

    revokedHereAt?: Date;

    memberOfBoth?: boolean;

    groupsEach?: number;
  } = {},
): Promise<Seeded> => {
  const client = await db().pool.connect();
  try {
    const seed = testData(client);
    const workspace = await seed.workspace();
    const other = await seed.workspace();
    const user = await seed.user({ credentialsRevokedAt: overrides.revokedAt ?? null });
    await seed.member({
      workspaceId: workspace.id,
      userId: user.id,
      role: overrides.role ?? "Viewer",
      credentialsRevokedAt: overrides.revokedHereAt ?? null,
    });
    if (overrides.memberOfBoth === true) {
      await seed.member({
        workspaceId: other.id,
        userId: user.id,
        role: overrides.role ?? "Viewer",
      });
    }
    const putInGroups = async (workspaceId: string): Promise<readonly string[]> => {
      const ids: string[] = [];
      for (let made = 0; made < (overrides.groupsEach ?? 0); made += 1) {
        const group = await seed.group({ workspaceId });
        await seed.groupMember({ workspaceId, groupId: group.id, userId: user.id });
        ids.push(group.id);
      }
      return ids.toSorted();
    };
    return {
      workspaceId: workspace.id,
      userId: user.id,
      otherWorkspaceId: other.id,
      groupIds: {
        here: await putInGroups(workspace.id),
        there: overrides.memberOfBoth === true ? await putInGroups(other.id) : [],
      },
    };
  } finally {
    client.release();
  }
};

const claimsFor = (seeded: Seeded, overrides: Partial<Claims> = {}): Claims => ({
  workspaceId: seeded.workspaceId,
  userId: seeded.userId,
  issuedAt: new Date(),
  ...overrides,
});

const PROBE_ACTS = declareActs("platform", {
  rolledBack: act("platform.probe.rolled_back", { confirmed: "flag" }),
});

const PROVOKED = "provoked" as const;

const IDENTITY_PROBE = declareIdentitySetActs("people", {
  written: act("people.probe.written", {}),
});

const answeringAfterThreeWrites =
  <Answer>(key: string, answer: Answer) =>
  async (principal: Principal, workspaceId: string, tx: Tx): Promise<Answer> => {
    await configProbeWritten(tx, workspaceId, key);
    await record(principal, tx, {
      id: ulid(),
      act: PROBE_ACTS.rolledBack,
      subjectId: workspaceId,
      detail: { confirmed: true },
    });
    const queued = await enqueueJobIn(
      principal,
      tx,
      inputOf(enqueueJobInput, { workspaceId, kind: NIGHTLY_AUDIT_KIND }),
    );
    if (!queued.ok) throw new Error(`the probe's job answered ${String(queued.error)}`);
    return answer;
  };

const leftBehindIn = async (workspaceId: string, key: string) => {
  const counted = await db().pool.query<{ rows: number; auditEvents: number; jobs: number }>(
    `SELECT (SELECT count(*)::int FROM workspace_config WHERE workspace_id = $1 AND key = $2) AS rows,
            (SELECT count(*)::int FROM audit_event WHERE workspace_id = $1 AND act = $3) AS "auditEvents",
            (SELECT count(*)::int FROM job WHERE workspace_id = $1) AS jobs`,
    [workspaceId, key, PROBE_ACTS.rolledBack.name],
  );
  return counted.rows[0];
};

const DOORS = ["the transport's", "the slice's", "the platform's"] as const;

const adminOf = async (door: PostgresDoor, claims: Claims): Promise<UserPrincipal> => {
  const admin = await withPrincipal(door, claims, async (principal) => principal);
  if (!admin.ok) throw new Error(`the Admin's principal answered ${admin.error}`);
  return admin.value;
};

const through = async <T>(
  door: (typeof DOORS)[number],
  work: (principal: Principal, workspaceId: string, tx: Tx) => Promise<T>,
): Promise<{ readonly seeded: Seeded; readonly answered: T }> => {
  const seeded = await seedMembership({ role: "Admin" });
  const open = openPostgres(db().runtimePool);
  if (door === "the platform's") {
    const answered = await withScope(bootstrap, open, seeded.workspaceId, (tx, platform) =>
      work(platform, seeded.workspaceId, tx),
    );
    return { seeded, answered };
  }
  const claims = claimsFor(seeded);
  const scoped = (principal: UserPrincipal, tx: Tx) => work(principal, principal.workspaceId, tx);
  const opened =
    door === "the transport's"
      ? await withPrincipal(open, claims, scoped)
      : await withMembership(await adminOf(open, claims), open, scoped);
  if (!opened.ok) throw new Error(`the Admin's door answered ${opened.error}`);
  return { seeded, answered: opened.value };
};

describe("a door whose work answers a refusal after a write", () => {
  it.each(DOORS)("rolls back three writes through %s door", async (door) => {
    const key = `probe-${ulid()}`;

    const { seeded, answered } = await through(door, answeringAfterThreeWrites(key, err(PROVOKED)));

    expect(await leftBehindIn(seeded.workspaceId, key)).toEqual({
      rows: 0,
      auditEvents: 0,
      jobs: 0,
    });
    expect(answered).toEqual({ ok: false, error: PROVOKED });
  });

  it.each(DOORS)("commits three writes through %s door on a value", async (door) => {
    const key = `probe-${ulid()}`;

    const { seeded, answered } = await through(door, answeringAfterThreeWrites(key, ok("landed")));

    expect(await leftBehindIn(seeded.workspaceId, key)).toEqual({
      rows: 1,
      auditEvents: 1,
      jobs: 1,
    });
    expect(answered).toEqual({ ok: true, value: "landed" });
  });
});

describe("a principal-scoped door's answer", () => {
  const TOLD_APART = ["the transport's", "the slice's"] as const;

  const refusedBothWays = (
    door: (typeof TOLD_APART)[number],
    seeded: Seeded,
    open: PostgresDoor,
  ) => {
    const work = async () => err("not-a-member" as const);
    const elsewhere = claimsFor(seeded, { workspaceId: seeded.otherWorkspaceId });
    return door === "the transport's"
      ? {
          byTheDoor: withPrincipal(open, elsewhere, work),
          byTheWork: withPrincipal(open, claimsFor(seeded), work),
        }
      : {
          byTheDoor: withMembership(
            principalOf(seeded.otherWorkspaceId, seeded.userId, "Viewer"),
            open,
            work,
          ),
          byTheWork: withMembership(
            principalOf(seeded.workspaceId, seeded.userId, "Viewer"),
            open,
            work,
          ),
        };
  };

  it.each(TOLD_APART)("keeps %s door's own refusal apart from its work's", async (door) => {
    const seeded = await seedMembership();

    const { byTheDoor, byTheWork } = refusedBothWays(door, seeded, openPostgres(db().runtimePool));

    expect(await byTheDoor).toEqual({ ok: false, error: "not-a-member" });
    expect(await byTheWork).toEqual({ ok: true, value: { ok: false, error: "not-a-member" } });
  });

  it("folds the door's refusal and the work's into one answer", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);

    const elsewhere = claimsFor(seeded, { workspaceId: seeded.otherWorkspaceId });

    const atTheDoor = folded(await withPrincipal(door, elsewhere, async () => ok("landed")));
    const refused = folded(await withPrincipal(door, claimsFor(seeded), async () => err(PROVOKED)));
    const valued = folded(await withPrincipal(door, claimsFor(seeded), async () => ok("landed")));
    const plain = folded(await withPrincipal(door, claimsFor(seeded), async () => "reached"));

    expect(atTheDoor).toEqual({ ok: false, error: "not-a-member" });
    expect(refused).toEqual({ ok: false, error: PROVOKED });
    expect(valued).toEqual({ ok: true, value: "landed" });
    expect(plain).toEqual({ ok: true, value: "reached" });
  });

  it("hands back a partly-Result answer untouched, with nothing to fold", async () => {
    type Partly = Result<number, typeof PROVOKED> | string;
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);

    const partly = await withPrincipal(
      door,
      claimsFor(seeded),
      async (): Promise<Partly> => "reached",
    );

    expect(partly).toEqual({ ok: true, value: "reached" });
    expectTypeOf<Answered<Partly>>().toBeNever();
    // @ts-expect-error — its Result members would reach the caller as values, a refusal among them.
    void (() => folded(partly));
  });
});

describe("the Principal resolver", () => {
  it("builds the Principal in the work's own transaction", async () => {
    const seeded = await seedMembership({ role: "Editor" });
    const door = openPostgres(db().runtimePool);
    const claims = claimsFor(seeded);

    const resolved = await withPrincipal(door, claims, async (principal, tx) => {
      const scope = await tx.query<{ ws: string }>("SELECT current_workspace_id() AS ws");
      return { principal, scope: scope.rows[0]?.ws };
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.principal).toEqual({
      kind: "user",
      workspaceId: seeded.workspaceId,
      userId: seeded.userId,
      role: "Editor",
      groups: [],

      credentialIssuedAtMs: claims.issuedAt.getTime(),
    });
    expect(resolved.value.scope).toBe(seeded.workspaceId);
  });

  it("refuses a non-member of the workspace the credential names", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);

    const resolved = await withPrincipal(
      door,
      claimsFor(seeded, { workspaceId: seeded.otherWorkspaceId }),
      async () => "reached",
    );

    expect(resolved).toEqual({ ok: false, error: "not-a-member" });
  });

  it("refuses a credential issued before the person's credentials were revoked", async () => {
    const revokedAt = new Date("2026-09-01T12:00:00Z");
    const seeded = await seedMembership({ revokedAt });
    const door = openPostgres(db().runtimePool);

    const before = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date("2026-09-01T11:59:59Z") }),
      async () => "reached",
    );
    expect(before).toEqual({ ok: false, error: "credentials-revoked" });

    const after = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date("2026-09-01T12:00:01Z") }),
      async () => "reached",
    );
    expect(after).toEqual({ ok: true, value: "reached" });
  });

  it("refuses a credential issued before this workspace's own revocation", async () => {
    const revokedHereAt = new Date("2026-09-03T12:00:00Z");
    const seeded = await seedMembership({ revokedHereAt });
    const door = openPostgres(db().runtimePool);

    const before = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date("2026-09-03T11:59:59Z") }),
      async () => "reached",
    );

    expect(before).toEqual({ ok: false, error: "credentials-revoked" });

    const after = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date("2026-09-03T12:00:01Z") }),
      async () => "reached",
    );
    expect(after).toEqual({ ok: true, value: "reached" });
  });

  it("lists the caller's groups here, or none when ungrouped", async () => {
    const grouped = await seedMembership({ role: "Editor", groupsEach: 2 });
    const alone = await seedMembership({ role: "Editor" });
    const door = openPostgres(db().runtimePool);

    const both = await withPrincipal(door, claimsFor(grouped), async ({ groups }) => groups);
    const none = await withPrincipal(door, claimsFor(alone), async ({ groups }) => groups);

    expect(both).toEqual({ ok: true, value: grouped.groupIds.here });
    expect(none).toEqual({ ok: true, value: [] });
  });

  it("lets a person revoked in one workspace work in another", async () => {
    const revokedHereAt = new Date("2026-09-03T12:00:00Z");
    const seeded = await seedMembership({
      role: "Editor",
      revokedHereAt,
      memberOfBoth: true,
      groupsEach: 1,
    });
    const door = openPostgres(db().runtimePool);
    const issuedAt = new Date("2026-09-03T11:00:00Z");

    const here = await withPrincipal(door, claimsFor(seeded, { issuedAt }), async () => "reached");
    expect(here).toEqual({ ok: false, error: "credentials-revoked" });

    const there = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt, workspaceId: seeded.otherWorkspaceId }),
      async (principal) => principal,
    );

    expect(there).toEqual({
      ok: true,
      value: {
        kind: "user",
        workspaceId: seeded.otherWorkspaceId,
        userId: seeded.userId,
        role: "Editor",
        groups: seeded.groupIds.there,
        credentialIssuedAtMs: issuedAt.getTime(),
      },
    });
    expect(seeded.groupIds.there).not.toEqual(seeded.groupIds.here);
  });

  it("refuses a role claim that disagrees with the member row", async () => {
    const seeded = await seedMembership({ role: "Viewer" });
    const door = openPostgres(db().runtimePool);

    const disagreeing = await withPrincipal(
      door,
      claimsFor(seeded, { role: "Admin" }),
      async () => "reached",
    );
    expect(disagreeing).toEqual({ ok: false, error: "role-disagrees" });

    const agreeing = await withPrincipal(
      door,
      claimsFor(seeded, { role: "Viewer" }),
      async () => "reached",
    );
    expect(agreeing).toEqual({ ok: true, value: "reached" });
  });

  it("refuses claims that are not a workspace and user id", async () => {
    const door = openPostgres(db().runtimePool);

    const resolved = await withPrincipal(
      door,
      { workspaceId: "not-a-ulid", userId: "", issuedAt: new Date() },
      async () => "reached",
    );

    expect(resolved).toEqual({ ok: false, error: "malformed-claims" });
  });

  it.each([
    ["the workspace id", { workspaceId: "not-a-ulid" }],
    ["the user id", { userId: "" }],
  ] as const)("refuses claims where %s alone is malformed", async (_which, malformed) => {
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);

    const resolved = await withPrincipal(door, claimsFor(seeded, malformed), async () => "reached");

    expect(resolved).toEqual({ ok: false, error: "malformed-claims" });
  });

  it("lets through a credential issued at the revocation's instant", async () => {
    const revokedAt = new Date("2026-09-05T09:00:00.000Z");
    const seeded = await seedMembership({ revokedAt, revokedHereAt: revokedAt });
    const door = openPostgres(db().runtimePool);

    const atTheInstant = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date(revokedAt) }),
      async () => "reached",
    );

    expect(atTheInstant).toEqual({ ok: true, value: "reached" });
  });

  it("rolls the work back when it throws", async () => {
    const seeded = await seedMembership({ role: "Admin" });
    const door = openPostgres(db().runtimePool);
    const key = `probe-${ulid()}`;

    await expect(
      withPrincipal(door, claimsFor(seeded), async (_principal, tx) => {
        await configProbeWritten(tx, seeded.workspaceId, key);
        throw new Error("the work failed after writing");
      }),
    ).rejects.toThrow("the work failed after writing");

    const written = await db().pool.query("SELECT 1 FROM workspace_config WHERE key = $1", [key]);
    expect(written.rowCount).toBe(0);
  });

  it("scopes every read inside the work to the Principal's workspace", async () => {
    const seeded = await seedMembership();
    const superuser = await db().pool.connect();
    try {
      const seed = testData(superuser);
      await seed.workspaceConfig({ workspaceId: seeded.workspaceId, key: "probe", value: "mine" });
      await seed.workspaceConfig({
        workspaceId: seeded.otherWorkspaceId,
        key: "probe",
        value: "theirs",
      });
    } finally {
      superuser.release();
    }
    const door = openPostgres(db().runtimePool);

    const resolved = await withPrincipal(door, claimsFor(seeded), (principal, tx) =>
      readWorkspaceConfig(principal, tx, "probe"),
    );

    expect(resolved).toEqual({ ok: true, value: "mine" });
  });
});

const withRoleOutsideTheThree = async (
  seeded: Seeded,
  work: () => Promise<void>,
): Promise<void> => {
  const pool = db().pool;
  const key = [seeded.workspaceId, seeded.userId];

  const before = await pool.query<{ role: string }>(
    "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2",
    key,
  );
  const role = before.rows[0]?.role;
  if (role === undefined) throw new Error("the membership to corrupt was not seeded");

  const held = await pool.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'member'::regclass AND conname = 'member_role_check'`,
  );
  const definition = held.rows[0]?.definition;
  if (definition === undefined) throw new Error("member_role_check is not on the table");

  await pool.query("ALTER TABLE member DROP CONSTRAINT member_role_check");
  try {
    await pool.query(
      "UPDATE member SET role = 'Owner' WHERE workspace_id = $1 AND user_id = $2",
      key,
    );
    await work();
  } finally {
    await pool.query("UPDATE member SET role = $3 WHERE workspace_id = $1 AND user_id = $2", [
      ...key,
      role,
    ]);
    await pool.query(`ALTER TABLE member ADD CONSTRAINT member_role_check ${definition}`);
  }
};

describe("a member row carrying a role the platform lacks", () => {
  it("refuses it rather than building a Principal at that role", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);

    await withRoleOutsideTheThree(seeded, async () => {
      const resolved = await withPrincipal(door, claimsFor(seeded), async () => "reached");

      expect(resolved).toEqual({ ok: false, error: "role-unknown" });
    });
  });
});

describe("a workspace's config", () => {
  it("answers nothing for an unset key without failing the transaction", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);

    const resolved = await withPrincipal(door, claimsFor(seeded), (principal, tx) =>
      readWorkspaceConfig(principal, tx, `unset-${ulid()}`),
    );

    expect(resolved).toEqual({ ok: true, value: undefined });
  });
});

describe("the catalogue read the estate's restore commands make", () => {
  it("names the tables present and omits the absent ones", async () => {
    const door = openPostgres(db().runtimePool);

    const present = await tablesPresent(door, ["member", "workspace", "table_nobody_migrated"]);

    expect(present.toSorted()).toEqual(["member", "workspace"]);
  });

  it("answers nothing when asked about nothing", async () => {
    const door = openPostgres(db().runtimePool);

    expect(await tablesPresent(door, [])).toEqual([]);
  });
});

describe("a transaction a caught failure aborted", () => {
  it("rejects a person's call at commit instead of reporting success", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);

    await expect(
      withPrincipal(door, claimsFor(seeded), async (_principal, tx) => {
        await attempt(() => tx.query("SELECT no_such_function()"));
        return "reached";
      }),
    ).rejects.toThrow(/did not commit/);
  });

  it("rejects the platform's call at commit instead of reporting success", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);

    await expect(
      withScope(bootstrap, door, seeded.workspaceId, async (tx) => {
        await attempt(() => tx.query("SELECT no_such_function()"));
        return "reached";
      }),
    ).rejects.toThrow(/did not commit/);
  });
});

describe("the counters", () => {
  it("counts a token's calls per window, refusing past the ceiling", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db().runtimePool);
    const rule = { windowMs: 60_000, max: 2 };
    const at = new Date("2026-09-01T10:00:30Z");

    const outcomes = await withPrincipal(door, claimsFor(seeded), async (principal, tx) => [
      await consumeCall(principal, tx, "jti-1", rule, at),
      await consumeCall(principal, tx, "jti-1", rule, at),
      await consumeCall(principal, tx, "jti-1", rule, at),

      await consumeCall(principal, tx, "jti-2", rule, at),

      await consumeCall(principal, tx, "jti-1", rule, new Date("2026-09-01T10:01:00Z")),
    ]);

    expect(outcomes.ok).toBe(true);
    if (!outcomes.ok) return;
    expect(outcomes.value.map((o) => o.allowed)).toEqual([true, true, false, true, true]);
    expect(outcomes.value[2]?.retryAfterSeconds).toBe(30);
  });

  it("counts pre-authentication events per key without any scope", async () => {
    const door = openPostgres(db().runtimePool);
    const rule = { windowMs: 10_000, max: 1 };
    const key = `203.0.113.${Math.floor(Math.random() * 200)}-${ulid()}`;

    const now = new Date();
    const first = await consumeIngress(door, "ip", key, rule, now);
    const second = await consumeIngress(door, "ip", key, rule, now);
    const otherScope = await consumeIngress(door, "email", key, rule, now);

    expect([first.allowed, second.allowed, otherScope.allowed]).toEqual([true, false, true]);
  });
});

describe("the operator resolver", () => {
  const aPerson = async (overrides: { operator?: boolean; revokedAt?: Date } = {}) => {
    const client = await db().pool.connect();
    try {
      return await testData(client).user({
        operator: overrides.operator ?? false,
        credentialsRevokedAt: overrides.revokedAt ?? null,
      });
    } finally {
      client.release();
    }
  };

  const resolving = (userId: string, issuedAt = new Date()) =>
    withOperator(openPostgres(db().runtimePool), { userId, issuedAt }, async (operator, tx) => {
      const scope = await tx.query<{ scope: string | null }>(
        "SELECT current_workspace_id() AS scope",
      );
      return { operator, scope: scope.rows[0]?.scope };
    });

  it("resolves a marked person to the operator, in no workspace", async () => {
    const person = await aPerson({ operator: true });
    const issuedAt = new Date("2026-09-25T09:00:00.000Z");

    expect(await resolving(person.id, issuedAt)).toEqual({
      ok: true,
      value: {
        operator: {
          kind: "operator",
          userId: person.id,
          credentialIssuedAtMs: Date.parse("2026-09-25T09:00:00.000Z"),
        },
        scope: null,
      },
    });
  });

  it("refuses a person without the mark", async () => {
    const person = await aPerson();

    expect(await resolving(person.id)).toEqual({ ok: false, error: "not-the-operator" });
  });

  it("refuses the operator's credentials issued before their revocation", async () => {
    const person = await aPerson({
      operator: true,
      revokedAt: new Date("2026-09-25T10:00:00.000Z"),
    });

    expect([
      await resolving(person.id, new Date("2026-09-25T09:59:59.999Z")),
      (await resolving(person.id, new Date("2026-09-25T10:00:00.000Z"))).ok,
    ]).toEqual([{ ok: false, error: "not-the-operator" }, true]);
  });

  it("rolls a refusal's writes back and commits a value's", async () => {
    const person = await aPerson({ operator: true });
    const writingThen = <Answer>(answer: Answer) =>
      withOperator(
        openPostgres(db().runtimePool),
        { userId: person.id, issuedAt: new Date() },
        async (_operator, tx) => {
          await recordFor(bootstrap, tx, {
            id: ulid(),
            actor: actorIdOfPerson(person.id),
            act: IDENTITY_PROBE.written,
            subjectId: person.id,
            detail: {},
          });
          return answer;
        },
      );

    const answers = [await writingThen(err(PROVOKED)), await writingThen(ok("landed"))];

    const written = await db().pool.query(
      "SELECT 1 FROM identity_audit_event WHERE subject_id = $1 AND act = $2",
      [person.id, IDENTITY_PROBE.written.name],
    );
    expect(written.rowCount).toBe(1);
    expect(answers).toEqual([
      { ok: true, value: { ok: false, error: PROVOKED } },
      { ok: true, value: { ok: true, value: "landed" } },
    ]);
  });

  it("refuses an id nobody holds, and a malformed one", async () => {
    expect([await resolving(ulid()), await resolving("not-a-person")]).toEqual([
      { ok: false, error: "not-the-operator" },
      { ok: false, error: "not-the-operator" },
    ]);
  });
});
