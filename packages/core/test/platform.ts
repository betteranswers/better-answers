import { ulid } from "@better-answers/schema";
import { type MigratedPostgres, testData } from "@better-answers/schema/testing";
import type pg from "pg";

import type { PlatformPrincipal } from "../src/kernel/index.ts";
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
): Promise<ProvisionedWorkspace> => {
  const adminUserId = await seedPerson(db.pool);
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

/** A person on the identity set, seeded as the superuser through the factory; their id. */
export const seedPerson = async (pool: pg.Pool): Promise<string> => {
  const client = await pool.connect();
  try {
    return (await testData(client).user()).id;
  } finally {
    client.release();
  }
};
