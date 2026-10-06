-- Custom migration (hand-written SQL; ADR 0032).
-- A source binding becomes a connected source: its table, everything named after it, the column
-- each document names it by, the state its documents are received in, and the index reason its
-- first upload gives. The binding_id column on index.chunk and its view wait for the passage
-- sweep. A rename takes an ACCESS EXCLUSIVE lock; five seconds bounds the wait behind a reader,
-- and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "source_binding" RENAME TO "connected_source";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_workspace_id_id_pk" TO "connected_source_workspace_id_id_pk";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_workspace_id_workspace_id_fk" TO "connected_source_workspace_id_workspace_id_fk";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_audience_check" TO "connected_source_audience_check";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_connector_check" TO "connected_source_connector_check";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_destination_check" TO "connected_source_destination_check";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_retention_class_check" TO "connected_source_retention_class_check";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_rules_in_force_check" TO "connected_source_rules_in_force_check";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_sensitivity_check" TO "connected_source_sensitivity_check";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_audience_not_null" TO "connected_source_audience_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_connector_not_null" TO "connected_source_connector_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_created_at_not_null" TO "connected_source_created_at_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_destination_not_null" TO "connected_source_destination_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_id_not_null" TO "connected_source_id_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_name_not_null" TO "connected_source_name_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_retention_class_not_null" TO "connected_source_retention_class_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_rules_in_force_not_null" TO "connected_source_rules_in_force_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_sensitivity_not_null" TO "connected_source_sensitivity_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_state_not_null" TO "connected_source_state_not_null";--> statement-breakpoint
ALTER TABLE "connected_source" RENAME CONSTRAINT "source_binding_workspace_id_not_null" TO "connected_source_workspace_id_not_null";--> statement-breakpoint
ALTER POLICY "source_binding_workspace_isolation" ON "connected_source" RENAME TO "connected_source_workspace_isolation";--> statement-breakpoint
ALTER TABLE "source_document" RENAME COLUMN "binding_id" TO "connected_source_id";--> statement-breakpoint
ALTER TABLE "source_document" RENAME CONSTRAINT "source_document_binding_fk" TO "source_document_connected_source_fk";--> statement-breakpoint
ALTER TABLE "source_document" RENAME CONSTRAINT "source_document_binding_id_not_null" TO "source_document_connected_source_id_not_null";--> statement-breakpoint
ALTER INDEX "source_document_workspace_id_binding_id_idx" RENAME TO "source_document_workspace_id_connected_source_id_idx";--> statement-breakpoint
ALTER INDEX "source_document_workspace_id_binding_id_source_system_id_uidx" RENAME TO "source_document_connected_source_id_source_system_id_uidx";--> statement-breakpoint
-- Each CHECK goes first so its old value can be rewritten. Row-level security is forced on both
-- tables and a migration runs as the owner, so the updates take each row's workspace scope. Every
-- bound run moves, finished ones too: a repeated upload finds its first outcome by that reason.
ALTER TABLE "connected_source" DROP CONSTRAINT "source_binding_state_check";--> statement-breakpoint
ALTER TABLE "job" DROP CONSTRAINT "job_reason_check";--> statement-breakpoint
DO $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    UPDATE public.connected_source SET state = 'received' WHERE state = 'landed';
    UPDATE public.job SET reason = 'connected' WHERE kind = 'index' AND reason = 'bound';
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
ALTER TABLE "connected_source" ALTER COLUMN "state" SET DEFAULT 'received';--> statement-breakpoint
-- ADD CONSTRAINT validates every row standing, so no old value survives it.
ALTER TABLE "connected_source" ADD CONSTRAINT "connected_source_state_check" CHECK (state IN ('received', 'indexing', 'indexed', 'published'));--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_reason_check" CHECK ((reason IS NOT NULL) = (kind IN ('full-rebuild', 'index'))
         AND (reason IS NULL OR (kind, reason) IN (('full-rebuild', 'first-build'), ('full-rebuild', 'model-choice-change'), ('full-rebuild', 'reconciler'), ('full-rebuild', 'erasure'), ('full-rebuild', 'upgrade'), ('full-rebuild', 'drill'), ('index', 'connected'), ('index', 'restored'), ('index', 'dismissed'), ('index', 'rule-change'), ('index', 'wiped'))));--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;
