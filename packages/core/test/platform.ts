import { boundarySchemas, ulid } from "@better-answers/schema";
import { type MigratedPostgres, testData } from "@better-answers/schema/testing";
import type pg from "pg";

import type { PlatformPrincipal, UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres, type PostgresDoor } from "../src/store/postgres/index.ts";
import { provisionWorkspace } from "../src/workspaces/index.ts";

export const bootstrap: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

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

export type ProvisionedWorkspace = {
  readonly door: PostgresDoor;
  readonly workspaceId: string;
  readonly adminUserId: string;
};

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

export type PersonOverrides = Parameters<ReturnType<typeof testData>["user"]>[0];

export const seedPerson = async (pool: pg.Pool, overrides?: PersonOverrides): Promise<string> => {
  const client = await pool.connect();
  try {
    return (await testData(client).user(overrides)).id;
  } finally {
    client.release();
  }
};
