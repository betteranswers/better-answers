-- Custom migration (hand-written SQL; ADR 0032).
CREATE TABLE "identity_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"act" text NOT NULL,
	"family" text GENERATED ALWAYS AS (split_part(act, '.', 1)) STORED NOT NULL,
	"actor" text NOT NULL,
	"subject_kind" text GENERATED ALWAYS AS (split_part(act, '.', 2)) STORED NOT NULL,
	"subject_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb NOT NULL,
	"batch_id" text,
	CONSTRAINT "identity_audit_event_act_check" CHECK (act ~ '^(people|knowledge|sources|platform)\.[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "identity_audit_event_family_check" CHECK (family IN ('people', 'knowledge', 'sources', 'platform'))
);--> statement-breakpoint
CREATE INDEX "identity_audit_event_subject_idx" ON "identity_audit_event" USING btree ("subject_kind","subject_id");--> statement-breakpoint
-- A row is written in the act it records and never rewritten: erasure blanks the name, and the person id outlives it.
REVOKE UPDATE, DELETE ON "identity_audit_event" FROM app_rt;
