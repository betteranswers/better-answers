ALTER TABLE "llm_route" ADD COLUMN "retention_tail" text;--> statement-breakpoint
ALTER TABLE "source_binding" ADD COLUMN "rules_in_force" jsonb DEFAULT '{"default_on":true,"default_off":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "source_binding" ADD CONSTRAINT "source_binding_rules_in_force_check" CHECK (jsonb_typeof(rules_in_force) = 'object'
         AND jsonb_typeof(rules_in_force -> 'default_on') IS NOT DISTINCT FROM 'boolean'
         AND jsonb_typeof(rules_in_force -> 'default_off') IS NOT DISTINCT FROM 'boolean');
