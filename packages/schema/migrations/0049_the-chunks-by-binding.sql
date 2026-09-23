-- Custom migration (hand-written SQL; ADR 0032).
-- On the parent rather than in create_workspace_partition: a partition made later is born with it.
CREATE INDEX "chunk_workspace_id_binding_id_source_document_id_ordinal_idx" ON "index".chunk ("workspace_id", "binding_id", "source_document_id", "ordinal");
