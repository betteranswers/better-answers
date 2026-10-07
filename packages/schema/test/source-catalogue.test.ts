import type pg from "pg";
import { describe, expect, it } from "vitest";

import {
  CONNECTED_SOURCE_STATES,
  CONNECTORS,
  DESTINATIONS,
  DOCUMENT_OUTCOMES,
  RETENTION_CLASSES,
  SENSITIVITIES,
  ulid,
} from "../src/index.ts";
import {
  type CataloguedItem,
  type CataloguePlace,
  citeDocument,
  seedConnectedSourceOfAConnectorAlone,
  seedCataloguedDocument,
} from "./catalogue-statements.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { asTheMigrationOwnerOf, migrationStatementSaying } from "./journal-statements.ts";
import {
  ADMITTED,
  attemptConnectedSourceOf,
  attemptCataloguedDocument,
  attemptDocumentClassed,
  attemptDocumentConcluded,
  attemptDocumentSized,
  attemptAuditEventRowReusingAnId,
  attemptUnreadablePair,
  attemptRowKeyedToTheAuditLog,
  type ConnectedSourceWords,
  postgresForSuite,
  refusalOf,
} from "./probes.ts";

const db = postgresForSuite();

const WORKSPACE = "01J6CAAAAAAAAAAAAAAAAAAAAA";
const UPLOAD_CONNECTED_SOURCE = "01J6CBBBBBBBBBBBBBBBBBBBBB";
const SECOND_CONNECTED_SOURCE = "01J6CCCCCCCCCCCCCCCCCCCCCC";
const HANDBOOK = "01J6CDDDDDDDDDDDDDDDDDDDDD";

const CONTENT_SHA256 = "d".repeat(64);
const WHEN = new Date("2026-09-01T00:00:00Z");

const admitting = (answer: string): string =>
  answer === ADMITTED ? answer : `refused by ${answer}`;

const wordsOf = (
  connector: string,
  destination: readonly (string | null)[],
  retentionClass: string,
  state: string,
): ConnectedSourceWords => ({ connector, destination, retentionClass, state });

const UNDER_THE_UPLOAD: CataloguePlace = {
  workspaceId: WORKSPACE,
  connectedSourceId: UPLOAD_CONNECTED_SOURCE,
};

const THE_HANDBOOK: CataloguedItem = {
  workspaceId: WORKSPACE,
  id: HANDBOOK,
  connectedSourceId: UPLOAD_CONNECTED_SOURCE,
  sourceSystemId: "handbook.md",
};

const withConnectedSources = async (
  fn: (client: pg.PoolClient) => Promise<void>,
  connectedSources: readonly string[] = [UPLOAD_CONNECTED_SOURCE],
): Promise<void> => {
  await withRollback(db().pool, async (client) => {
    const seed = testData(client);
    await seed.workspace({ id: WORKSPACE, name: "The catalogue's workspace" });
    for (const id of connectedSources) {
      await seed.connectedSource({ workspaceId: WORKSPACE, id });
    }
    await fn(client);
  });
};

const withWorkspace = async (fn: (client: pg.PoolClient) => Promise<void>): Promise<void> => {
  await withRollback(db().pool, async (client) => {
    await testData(client).workspace({ id: WORKSPACE, name: "The catalogue's workspace" });
    await fn(client);
  });
};

describe("a connected source nobody configured", () => {
  it("feeds both upload destinations, is kept, and is only received", async () => {
    await withWorkspace(async (client) => {
      await seedConnectedSourceOfAConnectorAlone(client, WORKSPACE, UPLOAD_CONNECTED_SOURCE);

      const born = await client.query(
        "SELECT destination, retention_class, state FROM connected_source WHERE workspace_id = $1 AND id = $2",
        [WORKSPACE, UPLOAD_CONNECTED_SOURCE],
      );

      expect(born.rows).toEqual([
        { destination: ["passage-index", "bundle"], retention_class: "keep", state: "received" },
      ]);
    });
  });
});

describe("the four closed word sets a connected source carries", () => {
  it("admits every word each set declares", async () => {
    await withWorkspace(async (client) => {
      const landed: string[] = [];
      for (const connector of CONNECTORS) {
        landed.push(
          admitting(
            await attemptConnectedSourceOf(
              client,
              WORKSPACE,
              wordsOf(connector, ["passage-index"], "keep", "received"),
            ),
          ),
        );
      }
      for (const destination of DESTINATIONS) {
        landed.push(
          admitting(
            await attemptConnectedSourceOf(
              client,
              WORKSPACE,
              wordsOf("upload", [destination], "keep", "received"),
            ),
          ),
        );
      }
      for (const retentionClass of RETENTION_CLASSES) {
        landed.push(
          admitting(
            await attemptConnectedSourceOf(
              client,
              WORKSPACE,
              wordsOf("upload", ["passage-index"], retentionClass, "received"),
            ),
          ),
        );
      }
      for (const state of CONNECTED_SOURCE_STATES) {
        landed.push(
          admitting(
            await attemptConnectedSourceOf(
              client,
              WORKSPACE,
              wordsOf("upload", ["passage-index"], "keep", state),
            ),
          ),
        );
      }

      expect(landed).toEqual(Array.from({ length: 11 }, () => ADMITTED));
    });
  });

  it("refuses stray words, empty destinations and a NULL destination", async () => {
    await withWorkspace(async (client) => {
      const refusals = [
        await attemptConnectedSourceOf(
          client,
          WORKSPACE,
          wordsOf("sharepoint", ["passage-index"], "keep", "received"),
        ),
        await attemptConnectedSourceOf(
          client,
          WORKSPACE,
          wordsOf("upload", ["warehouse"], "keep", "received"),
        ),

        await attemptConnectedSourceOf(
          client,
          WORKSPACE,
          wordsOf("upload", [], "keep", "received"),
        ),

        await attemptConnectedSourceOf(
          client,
          WORKSPACE,
          wordsOf("upload", ["bundle", null], "keep", "received"),
        ),
        await attemptConnectedSourceOf(
          client,
          WORKSPACE,
          wordsOf("upload", ["passage-index"], "forever", "received"),
        ),
        await attemptConnectedSourceOf(
          client,
          WORKSPACE,
          wordsOf("upload", ["passage-index"], "keep", "reviewing"),
        ),
      ];
      expect(refusals).toEqual([
        "connected_source_connector_check",
        "connected_source_destination_check",
        "connected_source_destination_check",
        "connected_source_destination_check",
        "connected_source_retention_class_check",
        "connected_source_state_check",
      ]);
    });
  });
});

describe("the catalogue a sync reconciles", () => {
  it("keeps every column given and leaves sync columns empty", async () => {
    await withConnectedSources(async (client) => {
      await seedCataloguedDocument(client, THE_HANDBOOK);
      const landed = await client.query(
        `SELECT source_system_id, title, media_type, byte_size, original_key,
                normalised_key, content_hash, redaction_version, last_modified, gone_at,
                outcome, sensitivity, first_seen = last_seen AS seen_once
           FROM source_document WHERE workspace_id = $1 AND id = $2`,
        [WORKSPACE, HANDBOOK],
      );
      expect(landed.rows).toEqual([
        {
          source_system_id: "handbook.md",
          title: "The handbook",
          media_type: "text/markdown",
          byte_size: 1024,
          original_key: "documents/x/original",

          normalised_key: null,
          content_hash: null,
          redaction_version: null,
          last_modified: null,
          gone_at: null,
          outcome: null,

          sensitivity: null,
          seen_once: true,
        },
      ]);

      await client.query(
        `UPDATE source_document
            SET normalised_key = $3, content_hash = $4, redaction_version = $5,
                last_modified = $6, last_seen = $6, outcome = 'converted', sensitivity = 'Restricted'
          WHERE workspace_id = $1 AND id = $2`,
        [WORKSPACE, HANDBOOK, "documents/x/normalised", CONTENT_SHA256, "1", WHEN],
      );
      const reconciled = await client.query(
        `SELECT normalised_key, content_hash, redaction_version, outcome, sensitivity
           FROM source_document WHERE workspace_id = $1 AND id = $2`,
        [WORKSPACE, HANDBOOK],
      );
      expect(reconciled.rows).toEqual([
        {
          normalised_key: "documents/x/normalised",
          content_hash: CONTENT_SHA256,
          redaction_version: "1",
          outcome: "converted",
          sensitivity: "Restricted",
        },
      ]);
    });
  });

  it("admits an item once per source, and under another source", async () => {
    await withConnectedSources(
      async (client) => {
        await seedCataloguedDocument(client, THE_HANDBOOK);

        const twice = await attemptCataloguedDocument(client, { ...THE_HANDBOOK, id: ulid() });

        const elsewhere = admitting(
          await attemptCataloguedDocument(client, {
            ...THE_HANDBOOK,
            id: ulid(),
            connectedSourceId: SECOND_CONNECTED_SOURCE,
          }),
        );
        expect({ twice, elsewhere }).toEqual({
          twice: "source_document_connected_source_id_source_system_id_uidx",
          elsewhere: ADMITTED,
        });
      },
      [UPLOAD_CONNECTED_SOURCE, SECOND_CONNECTED_SOURCE],
    );
  });

  it("admits every declared sensitivity and outcome, and refuses others", async () => {
    await withConnectedSources(async (client) => {
      const landed: string[] = [];
      for (const sensitivity of SENSITIVITIES) {
        landed.push(admitting(await attemptDocumentClassed(client, UNDER_THE_UPLOAD, sensitivity)));
      }
      for (const outcome of DOCUMENT_OUTCOMES) {
        landed.push(admitting(await attemptDocumentConcluded(client, UNDER_THE_UPLOAD, outcome)));
      }
      const refusals = [
        await attemptDocumentConcluded(client, UNDER_THE_UPLOAD, "skipped"),
        await attemptDocumentClassed(client, UNDER_THE_UPLOAD, "Secret"),

        await attemptDocumentSized(client, UNDER_THE_UPLOAD, -1),
      ];
      const empty = admitting(await attemptDocumentSized(client, UNDER_THE_UPLOAD, 0));
      expect({ landed, refusals, empty }).toEqual({
        landed: Array.from({ length: 5 }, () => ADMITTED),
        refusals: [
          "source_document_outcome_check",
          "source_document_sensitivity_check",
          "source_document_byte_size_check",
        ],
        empty: ADMITTED,
      });
    });
  });

  it("carries an unreadable reason only on an unreadable document", async () => {
    await withConnectedSources(async (client) => {
      const unreadable = admitting(
        await attemptUnreadablePair(client, UNDER_THE_UPLOAD, "unreadable", "NeedsOcrError"),
      );

      const refusals = [
        await attemptUnreadablePair(client, UNDER_THE_UPLOAD, "converted", "NeedsOcrError"),
        await attemptUnreadablePair(client, UNDER_THE_UPLOAD, null, "NeedsOcrError"),
      ];

      const wordAlone = admitting(
        await attemptUnreadablePair(client, UNDER_THE_UPLOAD, "unreadable", null),
      );
      expect({ unreadable, refusals, wordAlone }).toEqual({
        unreadable: ADMITTED,
        refusals: [
          "source_document_unreadable_reason_check",
          "source_document_unreadable_reason_check",
        ],
        wordAlone: ADMITTED,
      });
    });
  });
});

describe("the key from evidence to the document it locates into", () => {
  it("refuses a cited document's deletion until nothing cites it", async () => {
    await withConnectedSources(async (client) => {
      await seedCataloguedDocument(client, THE_HANDBOOK);
      await citeDocument(client, WORKSPACE, HANDBOOK);

      const whileCited = await refusalOf(client, () =>
        client.query("DELETE FROM source_document WHERE workspace_id = $1 AND id = $2", [
          WORKSPACE,
          HANDBOOK,
        ]),
      );

      await client.query(
        "DELETE FROM evidence WHERE workspace_id = $1 AND source_document_id = $2",
        [WORKSPACE, HANDBOOK],
      );
      await client.query("DELETE FROM source_document WHERE workspace_id = $1 AND id = $2", [
        WORKSPACE,
        HANDBOOK,
      ]);
      const left = await client.query(
        "SELECT id FROM source_document WHERE workspace_id = $1 AND id = $2",
        [WORKSPACE, HANDBOOK],
      );

      expect({ whileCited, left: left.rows }).toEqual({
        whileCited: "evidence_source_document_fk",
        left: [],
      });
    });
  });

  it("refuses a connected source's deletion while its document is cited", async () => {
    await withConnectedSources(async (client) => {
      await seedCataloguedDocument(client, THE_HANDBOOK);
      await citeDocument(client, WORKSPACE, HANDBOOK);

      expect(
        await refusalOf(client, () =>
          client.query("DELETE FROM connected_source WHERE workspace_id = $1 AND id = $2", [
            WORKSPACE,
            UPLOAD_CONNECTED_SOURCE,
          ]),
        ),
      ).toBe("evidence_source_document_fk");
    });
  });

  it("refuses evidence on an uncatalogued or another tenant's document", async () => {
    await withWorkspace(async (client) => {
      const theirs = await testData(client).sourceDocument();
      const refusals = [
        await refusalOf(client, () => citeDocument(client, WORKSPACE, ulid())),

        await refusalOf(client, () => citeDocument(client, WORKSPACE, theirs.id)),
      ];
      expect(refusals).toEqual(["evidence_source_document_fk", "evidence_source_document_fk"]);
    });
  });
});

describe("the audit log's unique pair", () => {
  const withAuditEventRow = async (fn: (client: pg.PoolClient, id: string) => Promise<void>) => {
    await withWorkspace(async (client) => {
      const event = await testData(client).auditEvent({ workspaceId: WORKSPACE });
      await fn(client, event.id);
    });
  };

  it("is a target for a later composite foreign key", async () => {
    await withAuditEventRow(async (client, id) => {
      await client.query(
        `CREATE TABLE keyed_to_the_audit_log (
           workspace_id text NOT NULL,
           audit_event_id text NOT NULL,
           FOREIGN KEY (workspace_id, audit_event_id) REFERENCES audit_event (workspace_id, id)
         )`,
      );

      expect({
        named: admitting(await attemptRowKeyedToTheAuditLog(client, WORKSPACE, id)),
        unnamed: await attemptRowKeyedToTheAuditLog(client, WORKSPACE, ulid()),
      }).toEqual({
        named: ADMITTED,
        unnamed: "keyed_to_the_audit_log_workspace_id_audit_event_id_fkey",
      });
    });
  });

  it("refuses a second audit event on the same pair", async () => {
    await withAuditEventRow(async (client, id) => {
      expect(await attemptAuditEventRowReusingAnId(client, WORKSPACE, id)).toBe("audit_event_pkey");
    });
  });
});

const THE_DISMISSAL_READ = "0052_the-dismissal-read.sql";

const OTHER_WORKSPACE = "01J6CEEEEEEEEEEEEEEEEEEEEE";

describe("the migration separating an Admin's narrowing from the seam's verdict", () => {
  it("backfills an Admin's last narrowing everywhere, never the seam's", async () => {
    await withWorkspace(async (client) => {
      const seed = testData(client);
      await seed.workspace({ id: OTHER_WORKSPACE, name: "The catalogue's other workspace" });
      const narrowedTwice = await seed.sourceDocument({
        workspaceId: WORKSPACE,
        sensitivity: "Restricted",
      });
      const seamNarrowed = await seed.sourceDocument({
        workspaceId: WORKSPACE,
        sensitivity: "Restricted",
      });
      const theirs = await seed.sourceDocument({
        workspaceId: OTHER_WORKSPACE,
        sensitivity: "Internal",
      });
      const narrowings: readonly [string, string, string, string][] = [
        [WORKSPACE, "01J6E0000000000000000000A0", narrowedTwice.id, "Internal"],
        [WORKSPACE, "01J6E0000000000000000000B0", narrowedTwice.id, "Restricted"],
        [OTHER_WORKSPACE, "01J6E0000000000000000000C0", theirs.id, "Internal"],
      ];
      for (const [workspaceId, id, documentId, sensitivity] of narrowings) {
        await seed.auditEvent({
          workspaceId,
          id,
          act: "sources.document.narrowed",
          subjectId: documentId,
          detail: { documentId, sensitivity },
        });
      }
      await seed.auditEvent({
        workspaceId: WORKSPACE,
        act: "sources.binding.narrowed",
        subjectId: seamNarrowed.id,
        detail: { sensitivity: "Restricted" },
      });
      // 0052 reads the column by the name it had before 0073.
      await client.query('ALTER TABLE "audit_event" RENAME COLUMN "action" TO "act"');

      await asTheMigrationOwnerOf(
        client,
        [
          "TABLE public.source_document",
          "TABLE public.audit_event",
          "FUNCTION public.narrower_sensitivity(text, text)",
        ],
        () => client.query(migrationStatementSaying(THE_DISMISSAL_READ, "DO $$")),
      );

      const backfilled = await client.query<{ id: string; narrowed_to: string | null }>(
        "SELECT id, narrowed_to FROM source_document WHERE id = ANY($1) ORDER BY id",
        [[narrowedTwice.id, seamNarrowed.id, theirs.id]],
      );
      expect(Object.fromEntries(backfilled.rows.map((row) => [row.id, row.narrowed_to]))).toEqual({
        [narrowedTwice.id]: "Restricted",
        [seamNarrowed.id]: null,
        [theirs.id]: "Internal",
      });
    });
  });
});
