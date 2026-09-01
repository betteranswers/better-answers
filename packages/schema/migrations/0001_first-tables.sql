CREATE TYPE "public"."llm_purpose" AS ENUM('extraction', 'enrichment', 'answering', 'judging', 'embedding');--> statement-breakpoint
CREATE TABLE "llm_route" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer
);
--> statement-breakpoint
ALTER TABLE "llm_route" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_route" ADD CONSTRAINT "llm_route_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_route_workspace_purpose_unique" ON "llm_route" USING btree ("workspace_id","purpose");--> statement-breakpoint
CREATE POLICY "llm_route_workspace_isolation" ON "llm_route" AS PERMISSIVE FOR ALL TO public USING ("llm_route"."workspace_id" = (select current_workspace_id())) WITH CHECK ("llm_route"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "workspace_workspace_isolation" ON "workspace" AS PERMISSIVE FOR ALL TO public USING ("workspace"."id" = (select current_workspace_id())) WITH CHECK ("workspace"."id" = (select current_workspace_id()));