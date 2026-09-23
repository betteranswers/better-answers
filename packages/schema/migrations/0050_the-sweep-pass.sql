-- Custom migration (hand-written SQL; ADR 0032).
CREATE TABLE "sweep_pass" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"upload_sweep" text NOT NULL,
	"workspaces" integer NOT NULL,
	"refused" integer NOT NULL,
	"found" integer NOT NULL,
	"removed" integer NOT NULL,
	"generations" integer NOT NULL,
	CONSTRAINT "sweep_pass_upload_sweep_check" CHECK (upload_sweep IN ('list', 'remove')),
	CONSTRAINT "sweep_pass_counts_check" CHECK (refused BETWEEN 0 AND workspaces AND removed BETWEEN 0 AND found AND generations >= 0
          AND (upload_sweep = 'remove' OR removed = 0))
);--> statement-breakpoint
-- A pass is recorded once and never rewritten, so a last run read off it cannot have been moved.
REVOKE UPDATE, DELETE ON "sweep_pass" FROM app_rt;
