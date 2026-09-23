-- Custom migration (hand-written SQL; ADR 0032).

CREATE TABLE "graph_generation" (
	"workspace_id" text PRIMARY KEY REFERENCES "public"."workspace"("id") ON DELETE cascade,
	"live_gen" integer NOT NULL,
	CONSTRAINT "graph_generation_live_gen_check" CHECK (live_gen > 0)
);--> statement-breakpoint
ALTER TABLE "graph_generation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "graph_node" (
	"workspace_id" text NOT NULL REFERENCES "public"."workspace"("id") ON DELETE cascade,
	"gen" integer,
	"uid" text NOT NULL,
	"label" text NOT NULL,
	"kind" text,
	"published_at" timestamp with time zone,
	"sensitivity" text DEFAULT 'Restricted' NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	CONSTRAINT "graph_node_label_check" CHECK ((gen IS NOT NULL AND label IN ('Concept', 'Section', 'Source', 'Actor', 'Composition', 'Evidence', 'CanonicalEntity')) OR (gen IS NULL AND label LIKE 'source-entity:%')),
	CONSTRAINT "graph_node_gen_check" CHECK (gen IS NULL OR gen > 0),
	CONSTRAINT "graph_node_sensitivity_check" CHECK (sensitivity IN ('Restricted', 'Internal', 'Public'))
);--> statement-breakpoint
ALTER TABLE "graph_node" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_node_bundle_uidx" ON "graph_node" USING btree ("workspace_id","gen","uid") WHERE gen IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_node_source_entity_uidx" ON "graph_node" USING btree ("workspace_id","uid") WHERE gen IS NULL;--> statement-breakpoint
CREATE INDEX "graph_node_kind_idx" ON "graph_node" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE TABLE "graph_edge" (
	"workspace_id" text NOT NULL REFERENCES "public"."workspace"("id") ON DELETE cascade,
	"gen" integer,
	"uid" text NOT NULL,
	"label" text NOT NULL,
	"from_uid" text NOT NULL,
	"to_uid" text NOT NULL,
	"from_kind" text,
	"to_kind" text,
	"section" text,
	"sentence" text,
	"published_at" timestamp with time zone,
	"sensitivity" text DEFAULT 'Restricted' NOT NULL,
	"audience" text DEFAULT 'everyone' NOT NULL,
	CONSTRAINT "graph_edge_label_check" CHECK (label IN ('LINKS_TO', 'SUPERSEDES', 'CITES', 'IS_CONCEPT', 'DERIVED_FROM', 'SAME_AS') OR (gen IS NULL AND label LIKE 'source-entity:%')),
	CONSTRAINT "graph_edge_gen_check" CHECK (gen IS NULL OR gen > 0),
	CONSTRAINT "graph_edge_sensitivity_check" CHECK (sensitivity IN ('Restricted', 'Internal', 'Public')),
	CONSTRAINT "graph_edge_links_to_check" CHECK (label = 'LINKS_TO' OR (from_kind IS NULL AND to_kind IS NULL AND section IS NULL AND sentence IS NULL))
);--> statement-breakpoint
ALTER TABLE "graph_edge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_edge_bundle_uidx" ON "graph_edge" USING btree ("workspace_id","gen","uid") WHERE gen IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_edge_source_entity_uidx" ON "graph_edge" USING btree ("workspace_id","uid") WHERE gen IS NULL;--> statement-breakpoint
CREATE INDEX "graph_edge_from_idx" ON "graph_edge" USING btree ("workspace_id","from_uid");--> statement-breakpoint
CREATE INDEX "graph_edge_to_idx" ON "graph_edge" USING btree ("workspace_id","to_uid");--> statement-breakpoint
CREATE POLICY "graph_generation_workspace_isolation" ON "graph_generation" AS PERMISSIVE FOR ALL TO public USING ("graph_generation"."workspace_id" = (select current_workspace_id())) WITH CHECK ("graph_generation"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "graph_node_workspace_isolation" ON "graph_node" AS PERMISSIVE FOR ALL TO public USING ("graph_node"."workspace_id" = (select current_workspace_id())) WITH CHECK ("graph_node"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "graph_edge_workspace_isolation" ON "graph_edge" AS PERMISSIVE FOR ALL TO public USING ("graph_edge"."workspace_id" = (select current_workspace_id())) WITH CHECK ("graph_edge"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
ALTER TABLE "graph_generation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "graph_node" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "graph_edge" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "graph_generation" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "graph_node" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "graph_edge" FROM worker_rt;
