-- Custom migration (hand-written SQL; ADR 0032).
REVOKE INSERT ON "finding" FROM worker_rt;--> statement-breakpoint
GRANT INSERT (workspace_id, id, document_id, category, tier, rule_id, char_start, char_end,
              score, rule_version, detector_pin) ON "finding" TO worker_rt;
