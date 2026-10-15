-- Hand-written around drizzle-kit's statements: bounded wait for the locks the checks' scans take (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "model_key" DROP CONSTRAINT "model_key_provider_check";--> statement-breakpoint
ALTER TABLE "model_price" DROP CONSTRAINT "model_price_provider_check";--> statement-breakpoint
ALTER TABLE "model_key" ADD CONSTRAINT "model_key_provider_check" CHECK (provider IN ('anthropic', 'mistral', 'cloudflare'));--> statement-breakpoint
ALTER TABLE "model_price" ADD CONSTRAINT "model_price_provider_check" CHECK (provider IN ('anthropic', 'mistral', 'cloudflare'));--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
