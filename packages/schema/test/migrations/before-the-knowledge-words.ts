import type pg from "pg";

import { ulid } from "../../src/index.ts";
import { testData } from "../support/factory.ts";
import { suggestionWrittenOfAnyKind } from "../support/probes.ts";
import { migrationsFolderEndingAt } from "./journal-statements.ts";

const THE_LAST_BEFORE = "0071_the-short-name";

export const migrationsFolderBefore0072 = (): string => migrationsFolderEndingAt(THE_LAST_BEFORE);

const A_PERSON = "human:01J6CCCCCCCCCCCCCCCCCCCCCC";

const A_RUN = "better-answers-extraction/1.2";

const A_FIX_RUN = "process:better-answers-citation-repair";

export type SeededBefore0072 = {
  readonly decidedSuggestions: readonly string[];
};

export const oldWordsAndControlRowsStoredIn = async (
  client: pg.PoolClient,
  workspaceId: string,
): Promise<SeededBefore0072> => {
  const seed = testData(client);
  await seed.workspace({ id: workspaceId, name: workspaceId });
  const first = await seed.conceptIdentity({ workspaceId });
  const second = await seed.conceptIdentity({ workspaceId });
  const decided = { targetIri: first.iri, decider: A_PERSON };
  const raised = [
    { kind: "candidate", proposer: A_RUN },
    { kind: "candidate", proposer: A_RUN, decided },
    { kind: "repair", proposer: A_FIX_RUN },
    { kind: "repair", proposer: A_FIX_RUN, decided },
    { kind: "edit", proposer: A_PERSON },
  ];
  const decidedSuggestions: string[] = [];
  for (const suggestion of raised) {
    const id = ulid();
    await suggestionWrittenOfAnyKind(client, { workspaceId, id, setId: ulid(), ...suggestion });
    if ("decided" in suggestion) decidedSuggestions.push(id);
  }

  const fixed = await seed.conceptVerification({ workspaceId, iri: first.iri });
  await seed.conceptVerification({ workspaceId, iri: second.iri });
  await client.query("UPDATE concept_verification SET origin = 'repair' WHERE id = $1", [fixed.id]);

  const connectedSourceId = (await seed.connectedSource({ workspaceId })).id;
  await client.query(
    `INSERT INTO source_document
       (workspace_id, id, connected_source_id, source_system_id, title, media_type, byte_size,
        original_key, normalised_key, content_hash, redaction_version, outcome, quarantine_error)
     VALUES ($1, $2, $3, 'scan.pdf', 'A scan', 'application/pdf', 2048, $4, NULL, NULL, NULL,
             'quarantined', 'NeedsOcrError'),
            ($1, $5, $3, 'handbook.md', 'The handbook', 'text/markdown', 1024, $6, $7, $8,
             '1:presidio-test', 'converted', NULL)`,
    [
      workspaceId,
      ulid(),
      connectedSourceId,
      `documents/${ulid().toLowerCase()}/original`,
      ulid(),
      `documents/${ulid().toLowerCase()}/original`,
      `documents/${ulid().toLowerCase()}/normalised`,
      "c".repeat(64),
    ],
  );

  const relabelled = await seed.mapNode({ workspaceId });
  await seed.mapNode({ workspaceId });
  await client.query("UPDATE map_node SET label = 'Composition' WHERE uid = $1", [relabelled.uid]);

  const writeUp = ulid();
  await client.query(
    `INSERT INTO composition (workspace_id, id, published_at, sensitivity, audience)
     VALUES ($1, $2, now(), 'Internal', 'everyone')`,
    [workspaceId, writeUp],
  );
  await client.query(
    `INSERT INTO composition_include (workspace_id, composition_id, id, ordinal, iri)
     VALUES ($1, $2, $3, 0, $4), ($1, $2, $5, 1, $6)`,
    [
      workspaceId,
      writeUp,
      `i${ulid().toLowerCase()}`,
      first.iri,
      `i${ulid().toLowerCase()}`,
      second.iri,
    ],
  );
  await client.query(
    `INSERT INTO concept_class_override
       (workspace_id, iri, sensitivity, audience, actor, audit_event_id)
     VALUES ($1, $2, 'Restricted', 'everyone', $3, $4)`,
    [workspaceId, first.iri, A_PERSON, ulid()],
  );
  return { decidedSuggestions };
};
