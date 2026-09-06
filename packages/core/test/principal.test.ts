import { ulid } from "@better-answers/schema";
import {
  type MigratedPostgres,
  startMigratedPostgres,
  testData,
} from "@better-answers/schema/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attempt, type Claims } from "../src/kernel/index.ts";
import {
  consumeCall,
  consumeIngress,
  openPostgres,
  readWorkspaceConfig,
  withPrincipal,
  withScope,
} from "../src/store/postgres/index.ts";
import { bootstrap } from "./platform.ts";

/**
 * The Principal resolver through its interface (`[TEST1]`): claims in, a Principal
 * alive inside one scoped transaction, or a refusal. Every refusal path is its own
 * test (`[SEC3]`): the resolver is the guard every tenant read stands behind, so what
 * it refuses is the substance.
 *
 * Seeding runs as the superuser through the factory and is committed, because the
 * resolver opens its own transaction on the runtime pool (`app_rt`, RLS applied).
 */

let db: MigratedPostgres;

beforeAll(async () => {
  db = await startMigratedPostgres();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

type Seeded = { workspaceId: string; userId: string; otherWorkspaceId: string };

const seedMembership = async (
  overrides: {
    role?: "Admin" | "Editor" | "Viewer";
    /** The person-level instant: revoked everywhere. */
    revokedAt?: Date;
    /** The membership instant in the first workspace: revoked there and only there. */
    revokedHereAt?: Date;
    /** Give the person a membership in the second workspace too. */
    memberOfBoth?: boolean;
  } = {},
): Promise<Seeded> => {
  const client = await db.pool.connect();
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
    return { workspaceId: workspace.id, userId: user.id, otherWorkspaceId: other.id };
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

describe("the Principal resolver", () => {
  it("builds a Principal from the member row, with the role read in the same transaction as the work", async () => {
    const seeded = await seedMembership({ role: "Editor" });
    const door = openPostgres(db.runtimePool);

    const resolved = await withPrincipal(door, claimsFor(seeded), async (principal, tx) => {
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
    });
    expect(resolved.value.scope).toBe(seeded.workspaceId);
  });

  it("refuses a person who is not a member of the workspace the credential names", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db.runtimePool);

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
    const door = openPostgres(db.runtimePool);

    const before = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date("2026-09-01T11:59:59Z") }),
      async () => "reached",
    );
    expect(before).toEqual({ ok: false, error: "credentials-revoked" });

    // A credential minted after the revocation is the person's fresh sign-in.
    const after = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date("2026-09-01T12:00:01Z") }),
      async () => "reached",
    );
    expect(after).toEqual({ ok: true, value: "reached" });
  });

  it("refuses a credential issued before this workspace revoked the person's credentials here", async () => {
    const revokedHereAt = new Date("2026-09-03T12:00:00Z");
    const seeded = await seedMembership({ revokedHereAt });
    const door = openPostgres(db.runtimePool);

    const before = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date("2026-09-03T11:59:59Z") }),
      async () => "reached",
    );
    // The same word as the person-level scope: the People screen shows one outcome.
    expect(before).toEqual({ ok: false, error: "credentials-revoked" });

    const after = await withPrincipal(
      door,
      claimsFor(seeded, { issuedAt: new Date("2026-09-03T12:00:01Z") }),
      async () => "reached",
    );
    expect(after).toEqual({ ok: true, value: "reached" });
  });

  it("lets a person revoked in one workspace go on working in the other, role and groups intact", async () => {
    const revokedHereAt = new Date("2026-09-03T12:00:00Z");
    const seeded = await seedMembership({
      role: "Editor",
      revokedHereAt,
      memberOfBoth: true,
    });
    const door = openPostgres(db.runtimePool);
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
        groups: [],
      },
    });
  });

  it("refuses a credential whose role claim disagrees with the member row", async () => {
    const seeded = await seedMembership({ role: "Viewer" });
    const door = openPostgres(db.runtimePool);

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

  it("refuses claims that are not a workspace id and a user id", async () => {
    const door = openPostgres(db.runtimePool);

    const resolved = await withPrincipal(
      door,
      { workspaceId: "not-a-ulid", userId: "", issuedAt: new Date() },
      async () => "reached",
    );

    expect(resolved).toEqual({ ok: false, error: "malformed-claims" });
  });

  it("rolls the work back when it throws, and never leaves a Principal behind", async () => {
    const seeded = await seedMembership({ role: "Admin" });
    const door = openPostgres(db.runtimePool);
    const key = `probe-${ulid()}`;

    await expect(
      withPrincipal(door, claimsFor(seeded), async (_principal, tx) => {
        await tx.query(
          "INSERT INTO workspace_config (workspace_id, key, value) VALUES ($1, $2, '1')",
          [seeded.workspaceId, key],
        );
        throw new Error("the work failed after writing");
      }),
    ).rejects.toThrow("the work failed after writing");

    const written = await db.pool.query("SELECT 1 FROM workspace_config WHERE key = $1", [key]);
    expect(written.rowCount).toBe(0);
  });

  it("scopes every read inside the work to the Principal's workspace", async () => {
    const seeded = await seedMembership();
    const superuser = await db.pool.connect();
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
    const door = openPostgres(db.runtimePool);

    const resolved = await withPrincipal(door, claimsFor(seeded), (principal, tx) =>
      readWorkspaceConfig(principal, tx, "probe"),
    );

    expect(resolved).toEqual({ ok: true, value: "mine" });
  });
});

describe("a transaction a caught failure aborted", () => {
  // `[TEST8]`: the failure is provoked inside the work and the assertion is on the
  // transaction's outcome, because Postgres aborts the transaction whatever the work
  // does with the caught rejection — an opener that read only the work's value would
  // report success for a transaction that rolled back.
  it("rejects a person's call at commit instead of reporting success", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db.runtimePool);

    await expect(
      withPrincipal(door, claimsFor(seeded), async (_principal, tx) => {
        // The refused statement aborts the transaction; `attempt` catches the
        // rejection, so the work runs on and returns as though nothing failed.
        await attempt(() => tx.query("SELECT no_such_function()"));
        return "reached";
      }),
    ).rejects.toThrow(/did not commit/);
  });

  it("rejects the platform's call at commit instead of reporting success", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db.runtimePool);

    await expect(
      withScope(bootstrap, door, seeded.workspaceId, async (tx) => {
        await attempt(() => tx.query("SELECT no_such_function()"));
        return "reached";
      }),
    ).rejects.toThrow(/did not commit/);
  });
});

describe("the counters", () => {
  it("counts a token's calls per window and refuses the call past the ceiling", async () => {
    const seeded = await seedMembership();
    const door = openPostgres(db.runtimePool);
    const rule = { windowMs: 60_000, max: 2 };
    const at = new Date("2026-09-01T10:00:30Z");

    const outcomes = await withPrincipal(door, claimsFor(seeded), async (principal, tx) => [
      await consumeCall(principal, tx, "jti-1", rule, at),
      await consumeCall(principal, tx, "jti-1", rule, at),
      await consumeCall(principal, tx, "jti-1", rule, at),
      // Another token in the same window has its own count.
      await consumeCall(principal, tx, "jti-2", rule, at),
      // The next window starts fresh.
      await consumeCall(principal, tx, "jti-1", rule, new Date("2026-09-01T10:01:00Z")),
    ]);

    expect(outcomes.ok).toBe(true);
    if (!outcomes.ok) return;
    expect(outcomes.value.map((o) => o.allowed)).toEqual([true, true, false, true, true]);
    expect(outcomes.value[2]?.retryAfterSeconds).toBe(30);
  });

  it("counts pre-authentication events per key without any scope", async () => {
    const door = openPostgres(db.runtimePool);
    const rule = { windowMs: 10_000, max: 1 };
    const key = `203.0.113.${Math.floor(Math.random() * 200)}-${ulid()}`;

    const first = await consumeIngress(door, "ip", key, rule);
    const second = await consumeIngress(door, "ip", key, rule);
    const otherScope = await consumeIngress(door, "email", key, rule);

    expect([first.allowed, second.allowed, otherScope.allowed]).toEqual([true, false, true]);
  });
});
