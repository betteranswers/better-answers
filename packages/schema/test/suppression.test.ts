import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import type { SUBJECT_IDENTIFIER_KINDS } from "../src/index.ts";
import { testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import {
  asTheMigrationOwnerOf,
  migrationStatements,
  migrationStatementSaying,
} from "./journal-statements.ts";
import { A_SUPPRESSION_OF_A_DOCUMENT } from "./rls-probes.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
  return async () => {
    await db.stop();
  };
});

const WS = "01J6SSSSSSSSSSSSSSSSSSSSSS";
const ANOTHER_WS = "01J6STTTTTTTTTTTTTTTTTTTTT";

const THE_MIGRATION_THAT_MADE_IT = "0029_the-suppression.sql";

const THE_RESHAPING_MIGRATION = "the-workspace-suppression.sql";

type Identifiers = Readonly<Record<(typeof SUBJECT_IDENTIFIER_KINDS)[number], readonly string[]>>;

const HER_SET: Identifiers = {
  emails: ["priya@client.invalid"],
  names: ["Priya Anand"],
  other: [],
};
const HIS_SET: Identifiers = { emails: [], names: ["Dan Okoro"], other: ["ACME-4471"] };
const THEIR_SET: Identifiers = { emails: ["sam@other.invalid"], names: [], other: [] };
const NO_SET: Identifiers = { emails: [], names: [], other: [] };

/**
 * Replayed from the journal where it can be, so the rows seeded under it are ones a real
 * database held.
 */
const theShapeItHadPerDocument = async (client: pg.PoolClient): Promise<void> => {
  await client.query(
    'ALTER TABLE "suppression" DROP CONSTRAINT "suppression_workspace_id_erasure_request_id_pk"',
  );
  await client.query('ALTER TABLE "suppression" ADD COLUMN "document_id" text NOT NULL');
  await client.query(
    `ALTER TABLE "suppression" ADD CONSTRAINT "suppression_workspace_id_erasure_request_id_document_id_pk"
       PRIMARY KEY ("workspace_id", "erasure_request_id", "document_id")`,
  );
  await client.query(
    migrationStatementSaying(THE_MIGRATION_THAT_MADE_IT, '"suppression_document_fk"'),
  );
  await client.query(
    migrationStatementSaying(
      THE_MIGRATION_THAT_MADE_IT,
      "suppression_workspace_id_document_id_idx",
    ),
  );
};

const withTwoWorkspacesSuppressedPerDocument = async (
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> => {
  await withRollback(db.pool, async (client) => {
    await testData(client).workspace({ id: WS, name: "The erasing workspace" });
    await testData(client).workspace({ id: ANOTHER_WS, name: "Another erasing workspace" });
    await theShapeItHadPerDocument(client);
    await fn(client);
  });
};

const erasureOf = async (
  client: pg.PoolClient,
  workspaceId: string,
  identifiers: Identifiers,
  standing: "completed" | "open",
): Promise<string> => {
  const seed = testData(client);
  const request = await seed.subjectRequest({ workspaceId, kind: "erasure", identifiers });
  const completion =
    standing === "completed" ? { completedAt: new Date(), report: "Erasure report." } : {};
  return (await seed.erasureRequest({ workspaceId, subjectRequestId: request.id, ...completion }))
    .id;
};

const suppressedPerDocument = async (
  client: pg.PoolClient,
  workspaceId: string,
  erasureRequestId: string,
  identifiers: Identifiers,
  documents: number,
): Promise<void> => {
  for (let at = 0; at < documents; at += 1) {
    const document = await testData(client).sourceDocument({ workspaceId });
    await client.query(A_SUPPRESSION_OF_A_DOCUMENT, [
      workspaceId,
      erasureRequestId,
      document.id,
      JSON.stringify(identifiers),
    ]);
  }
};

const reshaped = (client: pg.PoolClient): Promise<void> =>
  asTheMigrationOwnerOf(
    client,
    [
      // The new key's index is created in the schema, which the owner `migrate` runs as holds.
      "SCHEMA public",
      "TABLE public.suppression",
      "TABLE public.erasure_request",
      "TABLE public.subject_request",
      "TABLE public.source_document",
    ],
    async () => {
      for (const statement of migrationStatements(THE_RESHAPING_MIGRATION)) {
        await client.query(statement);
      }
    },
  );

const suppressionsStanding = async (client: pg.PoolClient) =>
  (
    await client.query<{ workspace_id: string; erasure_request_id: string; identifiers: unknown }>(
      `SELECT workspace_id, erasure_request_id, identifiers FROM suppression
        ORDER BY workspace_id, erasure_request_id`,
    )
  ).rows;

describe("the suppression reshaped to one row per erasure request", () => {
  it("collapses a request's per-document rows into one, in every workspace", async () => {
    await withTwoWorkspacesSuppressedPerDocument(async (client) => {
      const hers = await erasureOf(client, WS, HER_SET, "completed");
      const theirs = await erasureOf(client, ANOTHER_WS, THEIR_SET, "completed");
      await suppressedPerDocument(client, WS, hers, HER_SET, 3);
      await suppressedPerDocument(client, ANOTHER_WS, theirs, THEIR_SET, 2);

      await reshaped(client);

      expect(await suppressionsStanding(client)).toEqual([
        { workspace_id: WS, erasure_request_id: hers, identifiers: HER_SET },
        { workspace_id: ANOTHER_WS, erasure_request_id: theirs, identifiers: THEIR_SET },
      ]);
    });
  });

  it("backfills completed erasures naming someone, skipping open and id-only ones", async () => {
    await withTwoWorkspacesSuppressedPerDocument(async (client) => {
      const his = await erasureOf(client, WS, HIS_SET, "completed");
      await erasureOf(client, WS, HER_SET, "open");
      await erasureOf(client, WS, NO_SET, "completed");
      const theirs = await erasureOf(client, ANOTHER_WS, THEIR_SET, "completed");

      await reshaped(client);

      expect(await suppressionsStanding(client)).toEqual([
        { workspace_id: WS, erasure_request_id: his, identifiers: HIS_SET },
        { workspace_id: ANOTHER_WS, erasure_request_id: theirs, identifiers: THEIR_SET },
      ]);
    });
  });
});
