import { testData, type MigratedPostgres } from "@better-answers/schema/testing";
import type pg from "pg";

import { initRepository, type GitDoor } from "@better-answers/core/store/git";

import { systemClock, ulid, type Role, type UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres, withPrincipal, type PostgresDoor } from "../src/store/postgres/index.ts";
import { provisionWorkspace } from "../src/workspaces/index.ts";
import { bundlesForSuite } from "./bundle.ts";
import { bootstrap, seedPerson } from "./platform.ts";
import { postgresForSuite, seedingWith } from "./suite-postgres.ts";

/**
 * A provisioned workspace with its bundle and three people in it — the arrange block every
 * suite over the concept write path opens with, written once here.
 *
 * Provisioning, the two extra memberships and the repository are one call because a governed
 * write needs all four before it can happen at all; a suite that said so in four lines would
 * say it in four lines a dozen times, and two suites would say it twice. It lives beside
 * `suite-postgres.ts` and `bundle.ts` for the same reason they do.
 */

export type Scenario = {
  readonly workspaceId: string;
  readonly postgres: PostgresDoor;
  readonly git: GitDoor;
  /** The Editor every write here is made by, unless a test names another role. */
  readonly editor: UserPrincipal;
  readonly viewer: UserPrincipal;
  readonly admin: UserPrincipal;
};

/**
 * Both doors, as every act in the concepts slice takes them — a write, a decision and a
 * replay each hold the bundle's lock and open the rows' transaction. One helper for the
 * suites that hand a scenario to an act, so the pair is one fact and not a copy per suite.
 */
export const doorsOf = (scenario: Scenario) => ({
  git: scenario.git,
  postgres: scenario.postgres,
  clock: systemClock(),
});

/**
 * A suite's whole footing on one line: the migrated Postgres, the bundle root, and the
 * arrange block over both. The two `forSuite` helpers register the lifecycle each; this
 * pairs them, because every suite over the write path opens with the same three lines and
 * the copy gate said so the third time they were written.
 */
export const suiteWithBundles = () => {
  const db = postgresForSuite();
  const bundles = bundlesForSuite();
  return { db, bundles, arrange: (): Promise<Scenario> => arrangeWorkspace(db(), bundles()) };
};

/**
 * The Principal a transport resolves and hands to an act: it outlives the resolving
 * transaction on purpose — a governed write opens its own, which is the whole point of
 * `withMembership` re-reading the membership inside it.
 */
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

/**
 * One more person in this workspace, named and addressed by the caller: the subject an
 * erasure suite seeds before it asks what the platform holds about them.
 *
 * It takes the address rather than minting one, because `user.email` is unique and the
 * address is the thing a test's expected values are written from — a helper that made one up
 * would be handing the assertion a value it could only read back from the arrange
 * (`[TEST9]`). The name is fixed here: two suites assert on it as a literal, and a name a
 * helper varied would make those literals unwritable.
 */
export const memberOf = (pool: pg.Pool, workspaceId: string, email: string) =>
  seedingWith(pool, async (seed) => {
    const person = await seed.user({ name: "Priya Anand", email });
    await seed.member({ workspaceId, userId: person.id, role: "Editor" });
    return person;
  });

export const arrangeWorkspace = async (db: MigratedPostgres, git: GitDoor): Promise<Scenario> => {
  const adminUserId = await seedPerson(db.pool);
  const postgres = openPostgres(db.runtimePool);
  const workspaceId = ulid();
  const provisioned = await provisionWorkspace(bootstrap, postgres, {
    id: workspaceId,
    name: "Acme",
    slug: `acme-${workspaceId.toLowerCase()}`,
    adminUserId,
  });
  if (!provisioned.ok) throw new Error(`the workspace was not provisioned: ${provisioned.error}`);

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

/**
 * The person seeded for one role. A fallback here would hand `principalFor` an id nobody
 * holds and the suite would fail somewhere else entirely — the arrange block is the thing
 * that broke, so it is the thing that says so.
 */
const personOf = (people: Partial<Record<Role, string>>, role: Role): string => {
  const person = people[role];
  if (person === undefined) throw new Error(`no ${role} was seeded into this workspace`);
  return person;
};

// Reading as somebody is `suite-postgres.ts`'s `readingAs`, shared with every other suite
// that does it: which door a read goes through is one fact, not one per arrange block.
