-- A newer invitation to an address replaces an older one, so only the newest waiting one stands;
-- two left waiting would stop the index being built.
UPDATE "invitation" AS "older" SET "status" = 'canceled'
  FROM "invitation" AS "newer"
 WHERE "older"."status" = 'pending'
   AND "newer"."status" = 'pending'
   AND "newer"."workspace_id" = "older"."workspace_id"
   AND lower("newer"."email") = lower("older"."email")
   AND ("newer"."created_at", "newer"."id") > ("older"."created_at", "older"."id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_waiting_uidx" ON "invitation" USING btree ("workspace_id",lower("email")) WHERE status = 'pending';
