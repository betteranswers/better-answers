-- Altering user and session waits behind any open transaction on them; five seconds bounds that wait, and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "second_factor_throttle" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"failures" integer NOT NULL,
	"wait_until" timestamp with time zone,
	"noticed_at" timestamp with time zone,
	CONSTRAINT "second_factor_throttle_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "second_factor_throttle_kind_check" CHECK (kind IN ('authenticator', 'recovery-code', 'restore-code'))
);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "setup_granted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "restore_required_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "second_factor_throttle" ADD CONSTRAINT "second_factor_throttle_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;