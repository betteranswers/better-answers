-- Hand-written around drizzle-kit's statements: bounded wait for the locks the foreign key's check takes (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "access_request" DROP CONSTRAINT "access_request_invitation_id_invitation_id_fk";--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
