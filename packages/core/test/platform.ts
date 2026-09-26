import type pg from "pg";

import { boundarySchemas, ulid } from "@better-answers/schema";
import { type MigratedPostgres, testData } from "@better-answers/schema/testing";

import type {
  OperatorPrincipal,
  PlatformPrincipal,
  UserPrincipal,
  WorkspaceId,
} from "../src/kernel/index.ts";
import {
  openPostgres,
  type PostgresDoor,
  type Tx,
  withOperator,
} from "../src/store/postgres/index.ts";
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
  readonly workspaceId: WorkspaceId;
  readonly name: string;
  readonly slug: string;
  readonly adminUserId: string;
};

export const provisionedWorkspace = async (
  db: MigratedPostgres,
  name: string,
  admin?: PersonOverrides,
): Promise<ProvisionedWorkspace> => {
  const adminUserId = await seedPerson(db.pool, admin);
  const door = openPostgres(db.runtimePool);
  const mintedId = ulid();
  const slug = `${name.toLowerCase()}-${mintedId.toLowerCase()}`;
  const made = await provisionWorkspace(bootstrap, door, { id: mintedId, name, slug, adminUserId });
  if (!made.ok) throw new Error(`the workspace was not provisioned: ${made.error}`);
  return { door, workspaceId: made.value.workspaceId, name, slug, adminUserId };
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

/** Answers the new operator's id, the actor on every row they write, beside the resolver's answer. */
export const asANewOperator = async <T>(
  db: MigratedPostgres,
  signedInAt: Date,
  work: (operator: OperatorPrincipal, tx: Tx) => Promise<T>,
) => {
  const operatorId = await seedPerson(db.pool, { operator: true });
  const answered = await withOperator(
    openPostgres(db.runtimePool),
    { userId: operatorId, issuedAt: signedInAt },
    work,
  );
  return { operatorId, answered };
};

/**
 * Answers `work` as a new operator signed in just now.
 * @throws when the resolver refuses them.
 */
export const asTheOperator = async <T>(
  db: MigratedPostgres,
  work: (operator: OperatorPrincipal, tx: Tx) => Promise<T>,
): Promise<T> => {
  const { answered } = await asANewOperator(db, new Date(), work);
  if (!answered.ok) throw new Error(`the operator was refused: ${answered.error}`);
  return answered.value;
};
