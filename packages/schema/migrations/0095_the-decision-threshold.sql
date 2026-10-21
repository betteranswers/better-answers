CREATE TABLE "decision_threshold" (
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"threshold" double precision NOT NULL,
	CONSTRAINT "decision_threshold_provider_model_pk" PRIMARY KEY("provider","model"),
	CONSTRAINT "decision_threshold_provider_check" CHECK (provider IN ('anthropic', 'mistral', 'cloudflare')),
	CONSTRAINT "decision_threshold_probability_check" CHECK (threshold > 0 AND threshold < 1)
);--> statement-breakpoint
-- Hand-written from here. A threshold is replaced, never removed, so a chosen decision model never loses its threshold.
REVOKE DELETE ON "decision_threshold" FROM app_rt;
