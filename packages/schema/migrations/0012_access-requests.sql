CREATE TABLE "access_request" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"invitation_id" text,
	CONSTRAINT "access_request_status_check" CHECK (status IN ('waiting', 'approved', 'declined')),
	CONSTRAINT "access_request_decision_check" CHECK ((status = 'waiting') = (decided_at IS NULL)
         AND (decided_at IS NULL) = (decided_by IS NULL)
         AND (invitation_id IS NULL OR status = 'approved'))
);
--> statement-breakpoint
ALTER TABLE "access_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_request_workspace_id_idx" ON "access_request" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_request_waiting_uidx" ON "access_request" USING btree ("workspace_id","requester_id") WHERE status = 'waiting';--> statement-breakpoint
CREATE POLICY "access_request_workspace_isolation" ON "access_request" AS PERMISSIVE FOR ALL TO public USING ("access_request"."workspace_id" = (select current_workspace_id())) WITH CHECK ("access_request"."workspace_id" = (select current_workspace_id()));