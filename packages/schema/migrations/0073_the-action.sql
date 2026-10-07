-- Custom migration (hand-written SQL; ADR 0032).
-- A rename takes an ACCESS EXCLUSIVE lock; five seconds bounds the wait behind a reader, and a
-- failed release is re-run by hand.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- The generated family and subject_kind and the CHECK hold the column by number, so each reads the
-- new name with no rebuild. Stored act names stay as written, and no row is rewritten.
ALTER TABLE "audit_event" RENAME COLUMN "act" TO "action";--> statement-breakpoint
ALTER TABLE "audit_event" RENAME CONSTRAINT "audit_event_act_check" TO "audit_event_action_check";--> statement-breakpoint
ALTER TABLE "audit_event" RENAME CONSTRAINT "audit_event_act_not_null" TO "audit_event_action_not_null";--> statement-breakpoint
ALTER TABLE "identity_audit_event" RENAME COLUMN "act" TO "action";--> statement-breakpoint
ALTER TABLE "identity_audit_event" RENAME CONSTRAINT "identity_audit_event_act_check" TO "identity_audit_event_action_check";--> statement-breakpoint
ALTER TABLE "identity_audit_event" RENAME CONSTRAINT "identity_audit_event_act_not_null" TO "identity_audit_event_action_not_null";--> statement-breakpoint
-- Every pending migration runs in one transaction, so the bound ends with this one.
SET LOCAL lock_timeout = DEFAULT;
