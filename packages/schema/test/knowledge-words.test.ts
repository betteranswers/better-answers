import type pg from "pg";
import { describe, expect, it } from "vitest";

import { ulid } from "../src/index.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { asTheMigrationOwnerOf, migrationStatements } from "./journal-statements.ts";
import { ADMITTED, postgresForSuite, refusalOf, suggestionWritten } from "./probes.ts";

const db = postgresForSuite();

const THE_MIGRATION = "0072_the-knowledge-words.sql";

/**
 * Its value rewrites alone: the renames and the function ran with the database, and their old
 * names are gone.
 */
const itsValueRewrites = (): readonly string[] =>
  migrationStatements(THE_MIGRATION).filter(
    (statement) => !/RENAME|FUNCTION public\.submit_suggestion_set|SET LOCAL/u.test(statement),
  );

/** The CHECKs as 0071 left them, by the names 0072 drops; the column rename already ran. */
const THE_CHECKS_BEFORE = [
  'ALTER TABLE "suggestion" DROP CONSTRAINT "suggestion_kind_check"',
  `ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_kind_check" CHECK (kind IN ('edit', 'candidate', 'promotion', 'repair'))`,
  'ALTER TABLE "suggestion" DROP CONSTRAINT "suggestion_citation_fix_proposer_check"',
  `ALTER TABLE "suggestion" ADD CONSTRAINT "suggestion_repair_proposer_check" CHECK (kind <> 'repair' OR proposer LIKE 'process:better-answers-%')`,
  'ALTER TABLE "concept_verification" DROP CONSTRAINT "concept_verification_origin_check"',
  `ALTER TABLE "concept_verification" ADD CONSTRAINT "concept_verification_origin_check" CHECK (origin IN ('platform', 'imported', 'erasure-rewrite', 'repair'))`,
  'ALTER TABLE "source_document" DROP CONSTRAINT "source_document_outcome_check"',
  `ALTER TABLE "source_document" ADD CONSTRAINT "source_document_outcome_check" CHECK (outcome IS NULL OR outcome IN ('converted', 'quarantined'))`,
  'ALTER TABLE "source_document" DROP CONSTRAINT "source_document_unreadable_reason_check"',
  `ALTER TABLE "source_document" ADD CONSTRAINT "source_document_quarantine_error_check" CHECK (unreadable_reason IS NULL OR outcome IS NOT DISTINCT FROM 'quarantined')`,
  'ALTER TABLE "map_node" DROP CONSTRAINT "map_node_label_check"',
  `ALTER TABLE "map_node" ADD CONSTRAINT "map_node_label_check" CHECK ((gen IS NOT NULL AND label IN ('Concept', 'Section', 'Source', 'Actor', 'Composition', 'Evidence', 'CanonicalEntity')) OR (gen IS NULL AND label LIKE 'source-entity:%'))`,
] as const;

const OLD_PROPOSER = "process:better-answers-citation-repair";

const A_PERSON = "human:01J6CCCCCCCCCCCCCCCCCCCCCC";

const A_RUN = "better-answers-extraction/1.2";

type Seeded = {
  readonly decided: string;
  readonly waiting: string;
  readonly document: string;
  readonly node: string;
};

/** One of each old value in `workspaceId`; the decided suggestion is one the trigger guards. */
const oldValuesIn = async (client: pg.PoolClient, workspaceId: string): Promise<Seeded> => {
  const seed = testData(client);
  await seed.workspace({ id: workspaceId, name: workspaceId });
  const identity = await seed.conceptIdentity({ workspaceId });
  const decided = ulid();
  const waiting = ulid();
  const setId = ulid();
  await suggestionWritten(client, {
    workspaceId,
    id: decided,
    setId,
    kind: "candidate",
    proposer: A_RUN,
    decided: { targetIri: identity.iri, decider: A_PERSON },
  });
  await suggestionWritten(client, {
    workspaceId,
    id: waiting,
    setId,
    kind: "repair",
    proposer: OLD_PROPOSER,
  });
  const verification = await seed.conceptVerification({ workspaceId, iri: identity.iri });
  await client.query("UPDATE concept_verification SET origin = 'repair' WHERE id = $1", [
    verification.id,
  ]);
  const document = await seed.sourceDocument({ workspaceId });
  await client.query(
    `UPDATE source_document SET outcome = 'quarantined', unreadable_reason = 'NeedsOcrError',
            normalised_key = NULL, content_hash = NULL, redaction_version = NULL
      WHERE id = $1`,
    [document.id],
  );
  const node = await seed.mapNode({ workspaceId });
  await client.query("UPDATE map_node SET label = 'Composition' WHERE uid = $1", [node.uid]);
  return { decided, waiting, document: document.id, node: node.uid };
};

const replayingItsValueRewrites = (client: pg.PoolClient): Promise<void> =>
  asTheMigrationOwnerOf(
    client,
    [
      "TABLE public.suggestion",
      "TABLE public.concept_verification",
      "TABLE public.source_document",
      "TABLE public.map_node",
      "FUNCTION public.narrower_sensitivity(text, text)",
    ],
    async () => {
      for (const statement of itsValueRewrites()) await client.query(statement);
    },
  );

type Standing = {
  readonly kinds: readonly string[];
  readonly decidedStatus: string | undefined;
  readonly origins: readonly string[];
  readonly outcome: readonly (string | null)[];
  readonly label: string | undefined;
};

const standingIn = async (
  client: pg.PoolClient,
  workspaceId: string,
  seeded: Seeded,
): Promise<Standing> => {
  const kinds = await client.query<{ kind: string }>(
    "SELECT kind FROM suggestion WHERE workspace_id = $1 ORDER BY kind",
    [workspaceId],
  );
  const decided = await client.query<{ status: string }>(
    "SELECT status FROM suggestion WHERE id = $1",
    [seeded.decided],
  );
  const origins = await client.query<{ origin: string }>(
    "SELECT origin FROM concept_verification WHERE workspace_id = $1",
    [workspaceId],
  );
  const document = await client.query<{ outcome: string | null; reason: string | null }>(
    "SELECT outcome, unreadable_reason AS reason FROM source_document WHERE id = $1",
    [seeded.document],
  );
  const node = await client.query<{ label: string }>("SELECT label FROM map_node WHERE uid = $1", [
    seeded.node,
  ]);
  const row = document.rows[0];
  return {
    kinds: kinds.rows.map(({ kind }) => kind),
    decidedStatus: decided.rows[0]?.status,
    origins: origins.rows.map(({ origin }) => origin),
    outcome: row === undefined ? [] : [row.outcome, row.reason],
    label: node.rows[0]?.label,
  };
};

const AFTER: Standing = {
  kinds: ["citation-fix", "suggested-concept"],
  decidedStatus: "accepted",
  origins: ["citation-fix"],
  outcome: ["unreadable", "NeedsOcrError"],
  label: "WriteUp",
};

describe("migration 0072 over the knowledge words stored before it", () => {
  it("moves every workspace's stored old words to the new ones", async () => {
    await withRollback(db().pool, async (client) => {
      for (const statement of THE_CHECKS_BEFORE) await client.query(statement);
      const here = ulid();
      const there = ulid();
      const seededHere = await oldValuesIn(client, here);
      const seededThere = await oldValuesIn(client, there);

      await replayingItsValueRewrites(client);

      expect(await standingIn(client, here, seededHere)).toEqual(AFTER);
      expect(await standingIn(client, there, seededThere)).toEqual(AFTER);
    });
  });

  it("refuses each old value afterwards, and guards a decision again", async () => {
    await withRollback(db().pool, async (client) => {
      for (const statement of THE_CHECKS_BEFORE) await client.query(statement);
      const here = ulid();
      const seeded = await oldValuesIn(client, here);

      await replayingItsValueRewrites(client);

      const raised = (kind: string, proposer: string) => () =>
        suggestionWritten(client, { workspaceId: here, id: ulid(), setId: ulid(), kind, proposer });
      expect(await refusalOf(client, raised("candidate", A_RUN))).toBe("suggestion_kind_check");
      expect(await refusalOf(client, raised("citation-fix", A_PERSON))).toBe(
        "suggestion_citation_fix_proposer_check",
      );
      expect(
        await refusalOf(client, () =>
          client.query("UPDATE source_document SET outcome = 'quarantined' WHERE id = $1", [
            seeded.document,
          ]),
        ),
      ).toBe("source_document_outcome_check");
      expect(
        await refusalOf(client, () =>
          client.query("UPDATE suggestion SET kind = 'edit' WHERE id = $1", [seeded.waiting]),
        ),
      ).not.toBe(ADMITTED);
      const guards = await client.query<{ tgname: string; tgenabled: string }>(
        `SELECT tgname, tgenabled FROM pg_trigger
          WHERE tgname IN ('suggestion_decides_once_trigger', 'map_node_generation_guard')
          ORDER BY tgname`,
      );
      expect(guards.rows).toEqual([
        { tgname: "map_node_generation_guard", tgenabled: "O" },
        { tgname: "suggestion_decides_once_trigger", tgenabled: "O" },
      ]);
    });
  });
});

describe("migration 0072's renamed sensitivity ranking", () => {
  it("is the name the view and the CHECK now read", async () => {
    await withRollback(db().pool, async (client) => {
      const callers = await client.query<{ caller: string; renamed: boolean }>(
        `SELECT 'index.readable_passage' AS caller,
                pg_get_viewdef('index.readable_passage'::regclass) ~ 'narrower_sensitivity\\(' AS renamed
         UNION ALL
         SELECT conname, pg_get_constraintdef(oid) ~ 'narrower_sensitivity\\('
           FROM pg_constraint WHERE conname = 'source_document_narrowed_to_check'`,
      );

      expect(callers.rows).toEqual([
        { caller: "index.readable_passage", renamed: true },
        { caller: "source_document_narrowed_to_check", renamed: true },
      ]);
    });
  });
});
