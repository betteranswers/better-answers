-- Custom migration (hand-written SQL; ADR 0032).
-- Before BA-249 both tiers read a connected source's label as a path, so a map can hold a lineage
-- row, or a DERIVED_FROM or SUPERSEDES edge, that a rebuild by the fixed reader leaves out.
-- OR REPLACE: a database migrating from before 0097 runs both in one session, and pg_temp keeps
-- 0097's function.
CREATE OR REPLACE FUNCTION pg_temp.new_ulid() RETURNS text LANGUAGE plpgsql AS $$
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
CREATE FUNCTION pg_temp.queue_the_lineage_rebuilds() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  scope text;
BEGIN
  FOR scope IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('app.workspace_id', scope, true);
    INSERT INTO public.job (workspace_id, id, kind, reason)
    SELECT scope, pg_temp.new_ulid(), 'full-rebuild', 'upgrade'
     WHERE (
         EXISTS (
           SELECT 1 FROM public.map_unresolved_reference
            WHERE workspace_id = scope AND relation = 'lineage'
         )
         OR EXISTS (
           SELECT 1 FROM public.map_edge
            WHERE workspace_id = scope AND label IN ('DERIVED_FROM', 'SUPERSEDES')
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.job
          WHERE workspace_id = scope
            AND kind = 'full-rebuild' AND status = 'queued' AND attempts = 0
       );
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;--> statement-breakpoint
SELECT pg_temp.queue_the_lineage_rebuilds();
