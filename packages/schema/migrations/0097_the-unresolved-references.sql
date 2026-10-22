-- Custom migration (hand-written SQL; ADR 0032).
-- The foreign key takes a lock on the workspace table; five seconds bounds the wait behind a writer
-- (ADR 0007).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "map_unresolved_reference" (
	"workspace_id" text NOT NULL REFERENCES "public"."workspace"("id") ON DELETE cascade,
	"gen" integer NOT NULL,
	"from_uid" text NOT NULL,
	"relation" text NOT NULL,
	"ordinal" integer NOT NULL,
	"target_path" text NOT NULL,
	CONSTRAINT "map_unresolved_reference_relation_check" CHECK (relation IN ('link', 'lineage')),
	CONSTRAINT "map_unresolved_reference_ordinal_check" CHECK (ordinal >= 0),
	CONSTRAINT "map_unresolved_reference_target_path_check" CHECK (target_path <> ''),
	CONSTRAINT "map_unresolved_reference_gen_check" CHECK (gen > 0)
);--> statement-breakpoint
ALTER TABLE "map_unresolved_reference" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "map_unresolved_reference_uidx" ON "map_unresolved_reference" USING btree ("workspace_id","gen","from_uid","relation","ordinal");--> statement-breakpoint
CREATE INDEX "map_unresolved_reference_target_idx" ON "map_unresolved_reference" USING btree ("workspace_id","gen","target_path");--> statement-breakpoint
CREATE POLICY "map_unresolved_reference_workspace_isolation" ON "map_unresolved_reference" AS PERMISSIVE FOR ALL TO public USING ("map_unresolved_reference"."workspace_id" = (select current_workspace_id())) WITH CHECK ("map_unresolved_reference"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
ALTER TABLE "map_unresolved_reference" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER map_unresolved_reference_generation_guard
BEFORE INSERT ON public.map_unresolved_reference
FOR EACH ROW EXECUTE FUNCTION public.map_row_generation_guard();--> statement-breakpoint
REVOKE ALL ON "map_unresolved_reference" FROM worker_rt;--> statement-breakpoint
GRANT SELECT, INSERT ON "map_unresolved_reference" TO worker_rt;--> statement-breakpoint
CREATE FUNCTION pg_temp.new_ulid() RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  crockford constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  noise bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  ulid text := '';
BEGIN
  FOR i IN 1..10 LOOP
    ulid := substr(crockford, (ms % 32)::int + 1, 1) || ulid;
    ms := ms / 32;
  END LOOP;
  FOR i IN 0..15 LOOP
    ulid := ulid || substr(crockford, get_byte(noise, i) % 32 + 1, 1);
  END LOOP;
  RETURN ulid;
END $$;--> statement-breakpoint
CREATE FUNCTION pg_temp.queue_the_upgrade_rebuilds() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    INSERT INTO public.job (workspace_id, id, kind, reason)
    SELECT scope, pg_temp.new_ulid(), 'full-rebuild', 'upgrade'
     WHERE EXISTS (SELECT 1 FROM public.map_generation)
       AND NOT EXISTS (
         SELECT 1 FROM public.job
          WHERE kind = 'full-rebuild' AND status = 'queued' AND attempts = 0
       );
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
SELECT pg_temp.queue_the_upgrade_rebuilds();--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
