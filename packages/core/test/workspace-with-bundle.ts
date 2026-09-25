import { testData, type MigratedPostgres } from "@better-answers/schema/testing";
import type pg from "pg";

import { initRepository, type GitDoor } from "@better-answers/core/store/git";

import {
  systemClock,
  type Role,
  type UserPrincipal,
  type WorkspaceId,
} from "../src/kernel/index.ts";
import { openPostgres, withPrincipal, type PostgresDoor } from "../src/store/postgres/index.ts";
import { bundlesForSuite } from "./bundle.ts";
import { provisionedWorkspace } from "./platform.ts";
import { postgresForSuite, seedingWith } from "./suite-postgres.ts";

export type Scenario = {
  readonly workspaceId: WorkspaceId;
  readonly postgres: PostgresDoor;
  readonly git: GitDoor;

  readonly editor: UserPrincipal;
  readonly viewer: UserPrincipal;
  readonly admin: UserPrincipal;
};

export const doorsOf = (scenario: Scenario) => ({
  git: scenario.git,
  postgres: scenario.postgres,
  clock: systemClock(),
});

/** Registers the suite's database and bundle hooks; each `arrange` makes a fresh workspace. */
export const suiteWithBundles = () => {
  const db = postgresForSuite();
  const bundles = bundlesForSuite();
  return { db, bundles, arrange: (): Promise<Scenario> => arrangeWorkspace(db(), bundles()) };
};

export const principalFor = async (
  db: MigratedPostgres,
  workspaceId: string,
  userId: string,
): Promise<UserPrincipal> => {
  const resolved = await withPrincipal(
    openPostgres(db.runtimePool),
    { workspaceId, userId, issuedAt: new Date() },
    async (principal) => principal,
  );
  if (!resolved.ok) throw new Error(`the principal did not resolve: ${resolved.error}`);
  return resolved.value;
};

/** Seeds Priya Anand as an Editor of the workspace, under the email given. */
export const memberOf = (pool: pg.Pool, workspaceId: string, email: string) =>
  seedingWith(pool, async (seed) => {
    const person = await seed.user({ name: "Priya Anand", email });
    await seed.member({ workspaceId, userId: person.id, role: "Editor" });
    return person;
  });

/** Provisions Acme with an Admin, an Editor and a Viewer, and an empty bundle repository. */
export const arrangeWorkspace = async (db: MigratedPostgres, git: GitDoor): Promise<Scenario> => {
  const { door: postgres, workspaceId, adminUserId } = await provisionedWorkspace(db, "Acme");

  const client = await db.pool.connect();
  const people: Partial<Record<Role, string>> = {};
  try {
    const seed = testData(client);
    for (const role of ["Editor", "Viewer"] satisfies Role[]) {
      const person = await seed.user();
      await seed.member({ workspaceId, userId: person.id, role });
      people[role] = person.id;
    }
  } finally {
    client.release();
  }

  await initRepository(git, workspaceId);
  return {
    workspaceId,
    postgres,
    git,
    editor: await principalFor(db, workspaceId, personOf(people, "Editor")),
    viewer: await principalFor(db, workspaceId, personOf(people, "Viewer")),
    admin: await principalFor(db, workspaceId, adminUserId),
  };
};

const personOf = (people: Partial<Record<Role, string>>, role: Role): string => {
  const person = people[role];
  if (person === undefined) throw new Error(`no ${role} was seeded into this workspace`);
  return person;
};
