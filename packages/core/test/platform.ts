import { boundarySchemas, ulid } from "@better-answers/schema";
import { type MigratedPostgres, testData } from "@better-answers/schema/testing";
import type pg from "pg";

import type { PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres, type PostgresDoor } from "../src/store/postgres/index.ts";
import { provisionWorkspace } from "../src/workspaces/index.ts";

/**
 * The platform principal T-005's bootstrap provisions under, and the one person a
 * provisioning needs first — shared by every core suite that provisions a workspace,
 * so the actor the ledger names for it is one fact across the suites and not a copy
 * in each.
 */
export const bootstrap: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

/**
 * A Principal a credential would carry, for the cases the resolver cannot build one for:
 * a workspace the transaction is not scoped to, or a workspace or person whose row is
 * gone. Every suite that reaches for one names it here, so the shape is one fact.
 *
 * The ids come through the boundary, so the brands are earned rather than asserted — an
 * id of another shape throws here, in the arrangement, rather than reaching the act.
 */
export const principalOf = (
  workspaceId: string,
  userId: string,
  role: UserPrincipal["role"],
): UserPrincipal => ({
  kind: "user",
  workspaceId: boundarySchemas.workspace.select.shape.id.parse(workspaceId),
  userId: boundarySchemas.user.select.shape.id.parse(userId),
  role,
  groups: [],
  credentialIssuedAtMs: Date.now(),
});

/** A workspace that exists, the door it was made through, and the Admin it was made for. */
export type ProvisionedWorkspace = {
  readonly door: PostgresDoor;
  readonly workspaceId: string;
  readonly adminUserId: string;
};

/**
 * A provisioned workspace and its first Admin — the arrange block a suite opens with when
 * what it is about starts after provisioning rather than at it. It throws rather than
 * asserting, the way `workspace-with-bundle.ts` does: a failure here is the arrangement
 * falling over, not the thing under test disagreeing, and the two read differently in a
 * report.
 */
export const provisionedWorkspace = async (
  db: MigratedPostgres,
  name: string,
  admin?: PersonOverrides,
): Promise<ProvisionedWorkspace> => {
  const adminUserId = await seedPerson(db.pool, admin);
  const door = openPostgres(db.runtimePool);
  const workspaceId = ulid();
  const made = await provisionWorkspace(bootstrap, door, {
    id: workspaceId,
    name,
    slug: `${name.toLowerCase()}-${workspaceId.toLowerCase()}`,
    adminUserId,
  });
  if (!made.ok) throw new Error(`the workspace was not provisioned: ${made.error}`);
  return { door, workspaceId, adminUserId };
};

/**
 * What a suite may name about the person it seeds — the factory's own overrides, read off
 * it rather than restated, so a column the factory gains is one this type gains too.
 */
export type PersonOverrides = Parameters<ReturnType<typeof testData>["user"]>[0];

/**
 * A person on the identity set, seeded as the superuser through the factory; their id.
 * A suite names the fields it is going to assert on and leaves the rest to the factory.
 */
export const seedPerson = async (pool: pg.Pool, overrides?: PersonOverrides): Promise<string> => {
  const client = await pool.connect();
  try {
    return (await testData(client).user(overrides)).id;
  } finally {
    client.release();
  }
};
