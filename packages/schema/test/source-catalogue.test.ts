import type pg from "pg";
import { describe, expect, it } from "vitest";

import {
  BINDING_STATES,
  CONNECTORS,
  DESTINATIONS,
  DOCUMENT_OUTCOMES,
  RETENTION_CLASSES,
  SENSITIVITIES,
  ulid,
} from "../src/index.ts";
import { testData } from "./factory.ts";
import { withRollback } from "./harness.ts";
import { ADMITTED, postgresForSuite, refusalOf } from "./probes.ts";

const db = postgresForSuite();

const WORKSPACE = "01J6CAAAAAAAAAAAAAAAAAAAAA";
const UPLOAD_BINDING = "01J6CBBBBBBBBBBBBBBBBBBBBB";
const SECOND_BINDING = "01J6CCCCCCCCCCCCCCCCCCCCCC";
const HANDBOOK = "01J6CDDDDDDDDDDDDDDDDDDDDD";

const CONTENT_SHA256 = "d".repeat(64);
const WHEN = new Date("2026-09-01T00:00:00Z");

const probe = (client: pg.PoolClient, sql: string, values: readonly unknown[]): Promise<string> =>
  refusalOf(client, () => client.query(sql, [...values]));

const admits = async (client: pg.PoolClient, sql: string, values: readonly unknown[]) => {
  const answer = await probe(client, sql, values);
  return answer === ADMITTED ? answer : `refused by ${answer}`;
};

const INSERT_BINDING = `INSERT INTO source_binding
    (workspace_id, id, name, connector, destination, retention_class, state)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

const bindingOf = (
  connector: string,
  destination: readonly string[],
  retentionClass: string,
  state: string,
): readonly unknown[] => [
  WORKSPACE,
  ulid(),
  "The handbook",
  connector,
  [...destination],
  retentionClass,
  state,
];

const INSERT_DOCUMENT = `INSERT INTO source_document
    (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
  VALUES ($1, $2, $3, $4, 'The handbook', 'text/markdown', 1024, 'documents/x/original')`;

const insertDocumentWith = (column: string, word: string) =>
  `INSERT INTO source_document
     (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size,
      original_key, ${column})
   VALUES ($1, $2, $3, $4, 'The handbook', 'text/markdown', 1024, 'documents/x/original', '${word}')`;

const insertDocumentOutcome = (outcome: string | null, quarantineError: string | null) =>
  `INSERT INTO source_document
     (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size,
      original_key, outcome, quarantine_error)
   VALUES ($1, $2, $3, $4, 'The handbook', 'text/markdown', 1024, 'documents/x/original',
           ${outcome === null ? "NULL" : `'${outcome}'`},
           ${quarantineError === null ? "NULL" : `'${quarantineError}'`})`;

const insertDocumentSized = (bytes: number) =>
  `INSERT INTO source_document
     (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
   VALUES ($1, $2, $3, $4, 'The handbook', 'text/markdown', ${String(bytes)}, 'documents/x/original')`;

const cite = (client: pg.PoolClient, documentId: string) =>
  client.query(
    "INSERT INTO evidence (workspace_id, source_document_id, locator, resource) VALUES ($1, $2, 'chars:0-42', 'The handbook')",
    [WORKSPACE, documentId],
  );

const withBindings = async (
  fn: (client: pg.PoolClient) => Promise<void>,
  bindings: readonly string[] = [UPLOAD_BINDING],
): Promise<void> => {
  await withRollback(db().pool, async (client) => {
    const seed = testData(client);
    await seed.workspace({ id: WORKSPACE, name: "The catalogue's workspace" });
    for (const id of bindings) {
      await seed.sourceBinding({ workspaceId: WORKSPACE, id });
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

describe("a binding nobody configured", () => {
  it("feeds the upload's two destinations, is kept by the platform, and has only landed", async () => {
    await withWorkspace(async (client) => {
      await client.query(
        "INSERT INTO source_binding (workspace_id, id, name, connector) VALUES ($1, $2, 'The handbook', 'upload')",
        [WORKSPACE, UPLOAD_BINDING],
      );

      const born = await client.query(
        "SELECT destination, retention_class, state FROM source_binding WHERE workspace_id = $1 AND id = $2",
        [WORKSPACE, UPLOAD_BINDING],
      );

      expect(born.rows).toEqual([
        { destination: ["chunk-index", "bundle"], retention_class: "keep", state: "landed" },
      ]);
    });
  });
});

describe("the four closed word sets a binding carries", () => {
  it("admits every word each set declares", async () => {
    await withWorkspace(async (client) => {
      const landed: string[] = [];
      for (const connector of CONNECTORS) {
        landed.push(
          await admits(
            client,
            INSERT_BINDING,
            bindingOf(connector, ["chunk-index"], "keep", "landed"),
          ),
        );
      }
      for (const destination of DESTINATIONS) {
        landed.push(
          await admits(
            client,
            INSERT_BINDING,
            bindingOf("upload", [destination], "keep", "landed"),
          ),
        );
      }
      for (const retentionClass of RETENTION_CLASSES) {
        landed.push(
          await admits(
            client,
            INSERT_BINDING,
            bindingOf("upload", ["chunk-index"], retentionClass, "landed"),
          ),
        );
      }
      for (const state of BINDING_STATES) {
        landed.push(
          await admits(client, INSERT_BINDING, bindingOf("upload", ["chunk-index"], "keep", state)),
        );
      }

      expect(landed).toEqual(Array.from({ length: 11 }, () => ADMITTED));
    });
  });

  it("refuses a word outside each set, an empty destination and a NULL among the destinations", async () => {
    await withWorkspace(async (client) => {
      const refusals = [
        await probe(
          client,
          INSERT_BINDING,
          bindingOf("sharepoint", ["chunk-index"], "keep", "landed"),
        ),
        await probe(client, INSERT_BINDING, bindingOf("upload", ["warehouse"], "keep", "landed")),

        await probe(client, INSERT_BINDING, bindingOf("upload", [], "keep", "landed")),

        await probe(client, INSERT_BINDING, [
          WORKSPACE,
          ulid(),
          "The handbook",
          "upload",
          ["bundle", null],
          "keep",
          "landed",
        ]),
        await probe(
          client,
          INSERT_BINDING,
          bindingOf("upload", ["chunk-index"], "forever", "landed"),
        ),
        await probe(
          client,
          INSERT_BINDING,
          bindingOf("upload", ["chunk-index"], "keep", "reviewing"),
        ),
      ];
      expect(refusals).toEqual([
        "source_binding_connector_check",
        "source_binding_destination_check",
        "source_binding_destination_check",
        "source_binding_destination_check",
        "source_binding_retention_class_check",
        "source_binding_state_check",
      ]);
    });
  });
});

describe("the catalogue a run reconciles", () => {
  it("keeps every column it was given, and leaves a document no run has seen with nothing to say", async () => {
    await withBindings(async (client) => {
      await client.query(INSERT_DOCUMENT, [WORKSPACE, HANDBOOK, UPLOAD_BINDING, "handbook.md"]);
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

  it("admits one item once per binding and refuses it twice, and admits it again under another binding", async () => {
    await withBindings(
      async (client) => {
        await client.query(INSERT_DOCUMENT, [WORKSPACE, HANDBOOK, UPLOAD_BINDING, "handbook.md"]);

        const twice = await probe(client, INSERT_DOCUMENT, [
          WORKSPACE,
          ulid(),
          UPLOAD_BINDING,
          "handbook.md",
        ]);

        const elsewhere = await admits(client, INSERT_DOCUMENT, [
          WORKSPACE,
          ulid(),
          SECOND_BINDING,
          "handbook.md",
        ]);
        expect({ twice, elsewhere }).toEqual({
          twice: "source_document_workspace_id_binding_id_source_system_id_uidx",
          elsewhere: ADMITTED,
        });
      },
      [UPLOAD_BINDING, SECOND_BINDING],
    );
  });

  it("admits every class and outcome it declares, and refuses a word outside either", async () => {
    await withBindings(async (client) => {
      const landed: string[] = [];
      for (const sensitivity of SENSITIVITIES) {
        landed.push(
          await admits(client, insertDocumentWith("sensitivity", sensitivity), [
            WORKSPACE,
            ulid(),
            UPLOAD_BINDING,
            ulid(),
          ]),
        );
      }
      for (const outcome of DOCUMENT_OUTCOMES) {
        landed.push(
          await admits(client, insertDocumentWith("outcome", outcome), [
            WORKSPACE,
            ulid(),
            UPLOAD_BINDING,
            ulid(),
          ]),
        );
      }
      const refusals = [
        await probe(client, insertDocumentWith("outcome", "skipped"), [
          WORKSPACE,
          ulid(),
          UPLOAD_BINDING,
          ulid(),
        ]),
        await probe(client, insertDocumentWith("sensitivity", "Secret"), [
          WORKSPACE,
          ulid(),
          UPLOAD_BINDING,
          ulid(),
        ]),

        await probe(client, insertDocumentSized(-1), [WORKSPACE, ulid(), UPLOAD_BINDING, ulid()]),
      ];
      const empty = await admits(client, insertDocumentSized(0), [
        WORKSPACE,
        ulid(),
        UPLOAD_BINDING,
        ulid(),
      ]);
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

  it("carries a quarantine error only on a document it also calls quarantined", async () => {
    await withBindings(async (client) => {
      const quarantined = await admits(
        client,
        insertDocumentOutcome("quarantined", "NeedsOcrError"),
        [WORKSPACE, ulid(), UPLOAD_BINDING, ulid()],
      );

      const refusals = [
        await probe(client, insertDocumentOutcome("converted", "NeedsOcrError"), [
          WORKSPACE,
          ulid(),
          UPLOAD_BINDING,
          ulid(),
        ]),
        await probe(client, insertDocumentOutcome(null, "NeedsOcrError"), [
          WORKSPACE,
          ulid(),
          UPLOAD_BINDING,
          ulid(),
        ]),
      ];

      const wordAlone = await admits(client, insertDocumentOutcome("quarantined", null), [
        WORKSPACE,
        ulid(),
        UPLOAD_BINDING,
        ulid(),
      ]);
      expect({ quarantined, refusals, wordAlone }).toEqual({
        quarantined: ADMITTED,
        refusals: [
          "source_document_quarantine_error_check",
          "source_document_quarantine_error_check",
        ],
        wordAlone: ADMITTED,
      });
    });
  });
});

describe("the key from evidence to the document it locates into", () => {
  it("refuses a cited document's deletion, and admits it once nothing cites it", async () => {
    await withBindings(async (client) => {
      await client.query(INSERT_DOCUMENT, [WORKSPACE, HANDBOOK, UPLOAD_BINDING, "handbook.md"]);
      await cite(client, HANDBOOK);

      const whileCited = await probe(
        client,
        "DELETE FROM source_document WHERE workspace_id = $1 AND id = $2",
        [WORKSPACE, HANDBOOK],
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

  it("refuses a binding's deletion while one of its documents is cited, because the cascade meets the key", async () => {
    await withBindings(async (client) => {
      await client.query(INSERT_DOCUMENT, [WORKSPACE, HANDBOOK, UPLOAD_BINDING, "handbook.md"]);
      await cite(client, HANDBOOK);

      expect(
        await probe(client, "DELETE FROM source_binding WHERE workspace_id = $1 AND id = $2", [
          WORKSPACE,
          UPLOAD_BINDING,
        ]),
      ).toBe("evidence_source_document_fk");
    });
  });

  it("refuses evidence naming a document nobody catalogued, and another tenant's document", async () => {
    await withWorkspace(async (client) => {
      const theirs = await testData(client).sourceDocument();
      const refusals = [
        await refusalOf(client, () => cite(client, ulid())),

        await refusalOf(client, () => cite(client, theirs.id)),
      ];
      expect(refusals).toEqual(["evidence_source_document_fk", "evidence_source_document_fk"]);
    });
  });
});

describe("the ledger's unique pair", () => {
  const withLedgerRow = async (fn: (client: pg.PoolClient, id: string) => Promise<void>) => {
    await withWorkspace(async (client) => {
      const event = await testData(client).auditEvent({ workspaceId: WORKSPACE });
      await fn(client, event.id);
    });
  };

  it("is a target a later row's composite key can point at", async () => {
    await withLedgerRow(async (client, id) => {
      await client.query(
        `CREATE TABLE keyed_to_the_ledger (
           workspace_id text NOT NULL,
           audit_event_id text NOT NULL,
           FOREIGN KEY (workspace_id, audit_event_id) REFERENCES audit_event (workspace_id, id)
         )`,
      );

      const insert =
        "INSERT INTO keyed_to_the_ledger (workspace_id, audit_event_id) VALUES ($1, $2)";
      expect({
        named: await admits(client, insert, [WORKSPACE, id]),
        unnamed: await probe(client, insert, [WORKSPACE, ulid()]),
      }).toEqual({
        named: ADMITTED,
        unnamed: "keyed_to_the_ledger_workspace_id_audit_event_id_fkey",
      });
    });
  });

  it("refuses a second ledger row on the same pair", async () => {
    await withLedgerRow(async (client, id) => {
      expect(
        await probe(
          client,
          `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
           VALUES ($1, $2, 'sources.binding.created', 'process:better-answers-test', $3, '{}'::jsonb)`,
          [id, WORKSPACE, ulid()],
        ),
      ).toBe("audit_event_pkey");
    });
  });
});
