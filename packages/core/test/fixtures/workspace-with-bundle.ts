import type pg from "pg";

import { initRepository, type GitDoor } from "@better-answers/core/store/git";
import { analyseMap } from "@better-answers/core/store/map";
import { testData, type MigratedPostgres } from "@better-answers/schema/testing";

import { nameOwner, type NameOwnerInput } from "../../src/concepts/index.ts";
import {
  systemClock,
  type Role,
  type UserPrincipal,
  type WorkspaceId,
} from "../../src/kernel/index.ts";
import {
  openPostgres,
  withMember,
  withPrincipal,
  type PostgresDoor,
} from "../../src/store/postgres/index.ts";
import { confirmedSessionFor } from "../support/identity-rows.ts";
import { provisionedWorkspace } from "../support/platform.ts";
import { postgresForSuite, seedingWith } from "../support/suite-postgres.ts";
import { bundlesForSuite } from "./bundle.ts";

export type Scenario = {
  readonly workspaceId: WorkspaceId;
  readonly postgres: PostgresDoor;
  readonly git: GitDoor;

  readonly editor: UserPrincipal;
  readonly viewer: UserPrincipal;
  readonly admin: UserPrincipal;

  readonly unowned: UserPrincipal;
};

export const EDITORS_COLLECTIONS = [
  "audits",
  "bare",
  "board",
  "company",
  "guidelines",
  "held",
  "lms",
  "payroll",
  "policies",
  "policy",
  "product",
  "roles",
  "search",
  "security",
  "website",
  "wide",
] as const;

export const nameOwnerAs = async (
  admin: UserPrincipal,
  postgres: PostgresDoor,
  input: NameOwnerInput,
): Promise<void> => {
  const named = await withMember(admin, postgres, (fresh, tx) => nameOwner(fresh, tx, input));
  if (!named.ok || !named.value.ok) throw new Error("the owner was not named");
};

export const doorsOf = (scenario: Scenario) => ({
  git: scenario.git,
  postgres: scenario.postgres,
  clock: systemClock(),
  analyse: () => analyseMap(scenario.postgres.pool),
});

export const suiteWithBundles = () => {
  const db = postgresForSuite();
  const bundles = bundlesForSuite();
  return { db, bundles, arrange: (): Promise<Scenario> => arrangeWorkspace(db(), bundles()) };
};

export const principalFor = async (
  db: MigratedPostgres,
  workspaceId: string,
  userId: string,
  confirmed = false,
): Promise<UserPrincipal> => {
  const sessionId = confirmed ? await confirmedSessionFor(db.pool, userId) : undefined;
  const resolved = await withPrincipal(
    openPostgres(db.runtimePool),
    {
      workspaceId,
      userId,
      issuedAt: new Date(),
      ...(sessionId === undefined ? {} : { sessionId }),
    },
    async (principal) => principal,
  );
  if (!resolved.ok) throw new Error(`the principal did not resolve: ${resolved.error}`);
  return resolved.value;
};

export const memberOf = (pool: pg.Pool, workspaceId: string, email: string) =>
  seedingWith(pool, async (seed) => {
    const person = await seed.user({ name: "Priya Anand", email });
    await seed.member({ workspaceId, userId: person.id, role: "Editor" });
    return person;
  });

export const arrangeWorkspace = async (db: MigratedPostgres, git: GitDoor): Promise<Scenario> => {
  const { door: postgres, workspaceId, adminUserId } = await provisionedWorkspace(db, "Acme");

  const client = await db.pool.connect();
  const people: Partial<Record<Role, string>> = {};
  let unownedId = "";
  try {
    const seed = testData(client);
    for (const role of ["Editor", "Viewer"] satisfies Role[]) {
      const person = await seed.user();
      await seed.member({ workspaceId, userId: person.id, role });
      people[role] = person.id;
    }
    const unowned = await seed.user();
    await seed.member({ workspaceId, userId: unowned.id, role: "Editor" });
    unownedId = unowned.id;
    for (const collection of EDITORS_COLLECTIONS) {
      await seed.conceptOwner({ workspaceId, collection, personId: personOf(people, "Editor") });
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
    unowned: await principalFor(db, workspaceId, unownedId),
  };
};

const personOf = (people: Partial<Record<Role, string>>, role: Role): string => {
  const person = people[role];
  if (person === undefined) throw new Error(`no ${role} was seeded into this workspace`);
  return person;
};
