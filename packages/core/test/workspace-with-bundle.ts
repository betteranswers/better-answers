import { testData, type MigratedPostgres } from "@better-answers/schema/testing";

import { initRepository, type GitDoor } from "@better-answers/core/store/git";

import type { Role, UserPrincipal } from "../src/kernel/index.ts";
import { openPostgres, withPrincipal, type PostgresDoor } from "../src/store/postgres/index.ts";
import { provisionWorkspace } from "../src/workspaces/index.ts";
import { ulid } from "../src/kernel/index.ts";
import { bootstrap, seedPerson } from "./platform.ts";

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
  const people: Record<string, string> = {};
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
    editor: await principalFor(db, workspaceId, people["Editor"] ?? ""),
    viewer: await principalFor(db, workspaceId, people["Viewer"] ?? ""),
    admin: await principalFor(db, workspaceId, adminUserId),
  };
};

// Reading as somebody is `suite-postgres.ts`'s `readingAs`, shared with every other suite
// that does it: which door a read goes through is one fact, not one per arrange block.
