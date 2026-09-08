-- Custom migration (hand-written SQL; ADR 0032).
-- The audience substrate (ADR 0039): the pair every readable unit carries — the audience
-- word and its group-id array — reaches the three tables whose DDL is hand-written in this
-- journal (the chunk table in `index`, the two graph tables), each taking the one CHECK
-- `AUDIENCE_CHECK` in src/concept-tables.ts states and the migration-ownership test reads
-- back; the six tables migration 0019 generated take the FORCE line withRLS() cannot emit;
-- and the worker's role loses the DML migration 0000's default privileges granted it on them.

-- The array beside the word, tied by the one CHECK. Every row written before this migration
-- says *everyone* over no array — the pair's first whole shape — so the constraint is added
-- with nothing to backfill; a chunk row carrying any other word would be refused here, and
-- none is written until B7's indexing runs, which write the pair as the binding holds it.
ALTER TABLE "index".chunk ADD COLUMN "audience_groups" text[];
--> statement-breakpoint
ALTER TABLE "index".chunk ADD CONSTRAINT "chunk_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL));
--> statement-breakpoint
ALTER TABLE "graph_node" ADD COLUMN "audience_groups" text[];
--> statement-breakpoint
ALTER TABLE "graph_node" ADD CONSTRAINT "graph_node_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL));
--> statement-breakpoint
ALTER TABLE "graph_edge" ADD COLUMN "audience_groups" text[];
--> statement-breakpoint
ALTER TABLE "graph_edge" ADD CONSTRAINT "graph_edge_audience_check" CHECK ((audience = 'everyone' AND audience_groups IS NULL) OR (audience = 'groups' AND audience_groups IS NOT NULL AND cardinality(audience_groups) > 0 AND array_position(audience_groups, NULL) IS NULL));
--> statement-breakpoint
-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "source_binding" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_document" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "concept_evidence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "concept_class_override" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "composition" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "composition_include" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The worker reads none of these yet and writes none of them ever: a class and an audience
-- are applied at read time by the app and derived in the app's own transactions, and the
-- binding's settings a run will index under reach the worker with B7's connectors — whose
-- SELECT on the binding lands in the same migration as the run that reads it rather than
-- standing here unused, exactly as migrations 0015 and 0016 reasoned. Proved by "refuses the
-- worker role on all six tables, reading and writing alike (migration 0020)" in
-- packages/schema/test/rls.test.ts, beside the served path the app's role keeps.
REVOKE ALL ON "source_binding" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "source_document" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "concept_evidence" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "concept_class_override" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "composition" FROM worker_rt;
--> statement-breakpoint
REVOKE ALL ON "composition_include" FROM worker_rt;
