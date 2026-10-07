-- Custom migration (hand-written SQL; ADR 0032).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "concept_verification" RENAME COLUMN "checked_at" TO "verified_at";--> statement-breakpoint
ALTER TABLE "concept_verification" RENAME CONSTRAINT "concept_verification_checked_at_not_null" TO "concept_verification_verified_at_not_null";--> statement-breakpoint
ALTER INDEX "concept_verification_workspace_id_iri_checked_at_idx" RENAME TO "concept_verification_workspace_id_iri_verified_at_idx";--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
