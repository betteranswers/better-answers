-- Custom migration (hand-written SQL; ADR 0032).
GRANT SELECT (workspace_id, document_id, rule_id, char_start, char_end, restored_at)
  ON "finding" TO worker_rt;
