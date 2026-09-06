CREATE TABLE "group" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_workspace_id_id_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "group_member" (
	"workspace_id" text NOT NULL,
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_workspace_id_group_id_user_id_pk" PRIMARY KEY("workspace_id","group_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "group_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "group" ADD CONSTRAINT "group_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_fk" FOREIGN KEY ("workspace_id","group_id") REFERENCES "public"."group"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."member"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_workspace_id_name_uidx" ON "group" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "group_member_workspace_id_user_id_idx" ON "group_member" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE POLICY "group_workspace_isolation" ON "group" AS PERMISSIVE FOR ALL TO public USING ("group"."workspace_id" = (select current_workspace_id())) WITH CHECK ("group"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "group_member_workspace_isolation" ON "group_member" AS PERMISSIVE FOR ALL TO public USING ("group_member"."workspace_id" = (select current_workspace_id())) WITH CHECK ("group_member"."workspace_id" = (select current_workspace_id()));