-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "index".chunk ADD COLUMN "audience_groups" text[];--> statement-breakpoint
ALTER TABLE "index".chunk ADD CONSTRAINT "chunk_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL));--> statement-breakpoint
ALTER TABLE "graph_node" ADD COLUMN "audience_groups" text[];--> statement-breakpoint
ALTER TABLE "graph_node" ADD CONSTRAINT "graph_node_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL));--> statement-breakpoint
ALTER TABLE "graph_edge" ADD COLUMN "audience_groups" text[];--> statement-breakpoint
ALTER TABLE "graph_edge" ADD CONSTRAINT "graph_edge_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL));--> statement-breakpoint
ALTER TABLE "source_binding" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_document" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "concept_class_override" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "composition" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "composition_include" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "source_binding" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "source_document" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "concept_evidence" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "concept_class_override" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "composition" FROM worker_rt;--> statement-breakpoint
REVOKE ALL ON "composition_include" FROM worker_rt;
