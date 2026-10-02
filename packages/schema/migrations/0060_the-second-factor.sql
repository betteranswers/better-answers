-- Altering user and session waits behind any open transaction on them; five seconds bounds that wait, and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "authenticator" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" bigint NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aaguid" text
);--> statement-breakpoint
CREATE TABLE "passkey_last_use" (
	"passkey_id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "recovery_code" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "workspace_last_active" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_last_active_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "second_factor_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "authenticator_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "passkey_offer_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "recovery_codes_acknowledged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "authenticator" ADD CONSTRAINT "authenticator_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_last_use" ADD CONSTRAINT "passkey_last_use_passkey_id_passkey_id_fk" FOREIGN KEY ("passkey_id") REFERENCES "public"."passkey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_last_active" ADD CONSTRAINT "workspace_last_active_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_last_active" ADD CONSTRAINT "workspace_last_active_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authenticator_user_id_uidx" ON "authenticator" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_uidx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_code_user_id_code_hash_uidx" ON "recovery_code" USING btree ("user_id","code_hash");--> statement-breakpoint
CREATE INDEX "workspace_last_active_user_id_idx" ON "workspace_last_active" USING btree ("user_id");--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;