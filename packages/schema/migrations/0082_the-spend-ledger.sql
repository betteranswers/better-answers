CREATE TABLE "llm_call" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"called_at" timestamp with time zone NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"model_choice_id" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"seconds" double precision NOT NULL,
	"cost_usd" numeric NOT NULL,
	"outcome" text NOT NULL,
	"run_id" text,
	"answer_id" text,
	CONSTRAINT "llm_call_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "llm_call_outcome_check" CHECK (outcome IN ('succeeded', 'failed')),
	CONSTRAINT "llm_call_served_check" CHECK ((run_id IS NULL) <> (answer_id IS NULL)),
	CONSTRAINT "llm_call_spend_check" CHECK (tokens_in >= 0 AND tokens_out >= 0 AND seconds >= 0 AND cost_usd >= 0)
);--> statement-breakpoint
ALTER TABLE "llm_call" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "model_price" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"effective_from" date NOT NULL,
	"usd_per_million_in" numeric NOT NULL,
	"usd_per_million_out" numeric NOT NULL,
	CONSTRAINT "model_price_provider_model_effective_from_pk" PRIMARY KEY("provider","model","effective_from"),
	CONSTRAINT "model_price_provider_check" CHECK (provider IN ('anthropic', 'mistral')),
	CONSTRAINT "model_price_rates_check" CHECK (usd_per_million_in >= 0 AND usd_per_million_out >= 0)
);--> statement-breakpoint
CREATE TABLE "spend_reservation" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"model_choice_id" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"usd_per_million_in" numeric NOT NULL,
	"usd_per_million_out" numeric NOT NULL,
	"reserved_usd" numeric NOT NULL,
	"run_id" text,
	"answer_id" text,
	CONSTRAINT "spend_reservation_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "spend_reservation_served_check" CHECK ((run_id IS NULL) <> (answer_id IS NULL)),
	CONSTRAINT "spend_reservation_size_check" CHECK (tokens_in >= 0 AND tokens_out >= 0 AND usd_per_million_in >= 0
          AND usd_per_million_out >= 0 AND reserved_usd >= 0 AND expires_at > taken_at)
);--> statement-breakpoint
ALTER TABLE "spend_reservation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_call" ADD CONSTRAINT "llm_call_answer_fk" FOREIGN KEY ("workspace_id","answer_id") REFERENCES "public"."question_asked"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_reservation" ADD CONSTRAINT "spend_reservation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_reservation" ADD CONSTRAINT "spend_reservation_answer_fk" FOREIGN KEY ("workspace_id","answer_id") REFERENCES "public"."question_asked"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_call_workspace_id_called_at_idx" ON "llm_call" USING btree ("workspace_id","called_at");--> statement-breakpoint
CREATE INDEX "spend_reservation_expires_at_idx" ON "spend_reservation" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE POLICY "llm_call_workspace_isolation" ON "llm_call" AS PERMISSIVE FOR ALL TO public USING ("llm_call"."workspace_id" = (select current_workspace_id())) WITH CHECK ("llm_call"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "spend_reservation_workspace_isolation" ON "spend_reservation" AS PERMISSIVE FOR ALL TO public USING ("spend_reservation"."workspace_id" = (select current_workspace_id())) WITH CHECK ("spend_reservation"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
-- Hand-written from here, as each tenant table's substrate is: the policy binds the owner too.
ALTER TABLE "llm_call" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spend_reservation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- The worker is denied by default and is granted nothing here: no model call of its own is built.
-- A call's row is a ledger line, written once and never changed.
REVOKE UPDATE, DELETE ON "llm_call" FROM app_rt;--> statement-breakpoint
-- A reservation is taken and removed, never changed.
REVOKE UPDATE ON "spend_reservation" FROM app_rt;--> statement-breakpoint
-- A price is set from a day on and replaced by a later one, never removed.
REVOKE DELETE ON "model_price" FROM app_rt;