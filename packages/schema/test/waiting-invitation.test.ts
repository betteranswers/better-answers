import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { asTheMigrationOwnerOf, migrationStatements } from "./journal-statements.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

const WS = "01J6WWWWWWWWWWWWWWWWWWWWWW";
const ANOTHER_WS = "01J6XXXXXXXXXXXXXXXXXXXXXX";

const THE_MIGRATION = "the-waiting-invitation.sql";

const at = (minute: number): Date => new Date(Date.UTC(2026, 8, 20, 9, minute));

type Seeded = { readonly workspaceId: string; readonly inviterId: string };

const twoWorkspaces = async (client: pg.PoolClient): Promise<readonly [Seeded, Seeded]> => {
  const seed = testData(client);
  const inviter = await seed.user();
  await seed.workspace({ id: WS, name: "The inviting workspace" });
  await seed.workspace({ id: ANOTHER_WS, name: "Another inviting workspace" });
  return [
    { workspaceId: WS, inviterId: inviter.id },
    { workspaceId: ANOTHER_WS, inviterId: inviter.id },
  ];
};

const invited = async (
  client: pg.PoolClient,
  where: Seeded,
  email: string,
  fields: { readonly minute: number; readonly status?: string },
): Promise<string> =>
  (
    await testData(client).invitation({
      ...where,
      email,
      status: fields.status ?? "pending",
      createdAt: at(fields.minute),
    })
  ).id;

/** The shape a database held before the migration: no index over the waiting invitations. */
const withoutTheIndex = async (client: pg.PoolClient): Promise<void> => {
  await client.query('DROP INDEX "invitation_waiting_uidx"');
};

const migrated = (client: pg.PoolClient): Promise<void> =>
  asTheMigrationOwnerOf(client, ["SCHEMA public", "TABLE public.invitation"], async () => {
    for (const statement of migrationStatements(THE_MIGRATION)) {
      await client.query(statement);
    }
  });

const statusOf = async (client: pg.PoolClient, ids: readonly string[]) =>
  Object.fromEntries(
    (
      await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM invitation WHERE id = ANY($1)",
        [ids],
      )
    ).rows.map((row) => [row.id, row.status]),
  );

describe("the migration that holds one waiting invitation per address", () => {
  it("leaves the newest waiting invitation to each address per workspace", async () => {
    await withRollback(db.pool, async (client) => {
      const [here, there] = await twoWorkspaces(client);
      await withoutTheIndex(client);
      const oldest = await invited(client, here, "priya@client.invalid", { minute: 1 });
      const older = await invited(client, here, "Priya@Client.invalid", { minute: 2 });
      const newest = await invited(client, here, "PRIYA@client.invalid", { minute: 3 });
      const someoneElse = await invited(client, here, "sam@client.invalid", { minute: 1 });
      const elsewhere = await invited(client, there, "priya@client.invalid", { minute: 1 });
      const accepted = await invited(client, here, "priya@client.invalid", {
        minute: 4,
        status: "accepted",
      });

      await migrated(client);

      expect(
        await statusOf(client, [oldest, older, newest, someoneElse, elsewhere, accepted]),
      ).toEqual({
        [oldest]: "canceled",
        [older]: "canceled",
        [newest]: "pending",
        [someoneElse]: "pending",
        [elsewhere]: "pending",
        [accepted]: "accepted",
      });
    });
  });
});

describe("the index over waiting invitations", () => {
  it("refuses a second waiting invitation to one address, any case", async () => {
    await expect(
      withRollback(db.pool, async (client) => {
        const [here] = await twoWorkspaces(client);
        await invited(client, here, "priya@client.invalid", { minute: 1 });
        await invited(client, here, "Priya@Client.INVALID", { minute: 2 });
      }),
    ).rejects.toThrow(/invitation_waiting_uidx/);
  });

  it("admits one waiting per workspace, beside any number decided", async () => {
    const standing = await withRollback(db.pool, async (client) => {
      const [here, there] = await twoWorkspaces(client);
      const ids = [
        await invited(client, here, "priya@client.invalid", { minute: 1 }),
        await invited(client, there, "priya@client.invalid", { minute: 1 }),
        await invited(client, here, "priya@client.invalid", { minute: 2, status: "canceled" }),
        await invited(client, here, "priya@client.invalid", { minute: 3, status: "canceled" }),
        await invited(client, here, "priya@client.invalid", { minute: 4, status: "accepted" }),
      ];
      return Object.keys(await statusOf(client, ids)).length;
    });

    expect(standing).toBe(5);
  });
});
