import { migrationStatementSaying } from "./journal-statements.ts";

/** The words the sweeps retired from the index's names; none may stand after migration 0069. */
export const WORDS_RETIRED_FROM_THE_INDEX = ["chunk", "binding", "route"] as const;

/** A workspace's partition as the function before migration 0069 named it. */
export const thePartitionBeforeThePassage = (workspaceId: string): string => `chunk_${workspaceId}`;

/** The names migration 0069 found, put back so it can run again over a partition made before it. */
export const NAMES_BEFORE_THE_PASSAGE: readonly string[] = [
  'ALTER TABLE "index".passage RENAME TO chunk',
  'ALTER TABLE "index".chunk RENAME COLUMN connected_source_id TO binding_id',
  'ALTER TABLE "index".chunk RENAME COLUMN embedding_model_choice_id TO embedding_route_id',
  'ALTER POLICY "passage_workspace_isolation" ON "index".chunk RENAME TO "chunk_workspace_isolation"',
  'ALTER INDEX "index".passage_pkey RENAME TO chunk_pkey',
  `ALTER INDEX "index".passage_workspace_connected_source_document_ordinal_idx
     RENAME TO chunk_workspace_id_binding_id_source_document_id_ordinal_idx`,
  `ALTER INDEX "index".passage_workspace_id_source_document_id_locator_uidx
     RENAME TO chunk_workspace_id_source_document_id_locator_uidx`,
  `DO $$
   DECLARE con record;
   BEGIN
     FOR con IN SELECT conname FROM pg_constraint
                 WHERE conrelid = '"index".chunk'::regclass AND conname LIKE 'passage\\_%'
                   AND contype <> 'p'
     LOOP
       EXECUTE format('ALTER TABLE "index".chunk RENAME CONSTRAINT %I TO %I', con.conname,
         replace(replace(con.conname, 'passage_', 'chunk_'), 'connected_source_id', 'binding_id'));
     END LOOP;
   END $$`,
  'ALTER VIEW "index".readable_passage RENAME TO readable_chunk',
  'ALTER VIEW "index".readable_chunk RENAME COLUMN connected_source_id TO binding_id',
  'ALTER VIEW "index".readable_chunk RENAME COLUMN embedding_model_choice_id TO embedding_route_id',
  migrationStatementSaying("0054_the-attached-partition.sql", "create_workspace_partition"),
];
