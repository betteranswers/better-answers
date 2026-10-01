-- A blocked build would queue every audit write behind it; five seconds bounds that wait, and a failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" USING btree ("workspace_id","actor","at","id");--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;
