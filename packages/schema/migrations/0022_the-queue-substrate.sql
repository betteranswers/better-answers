-- Custom migration (hand-written SQL; ADR 0032).

ALTER TABLE "job" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE DELETE ON "job" FROM app_rt, worker_rt;--> statement-breakpoint

CREATE FUNCTION public.claim_job(p_worker_id text, p_lease interval)
RETURNS SETOF public.job
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
  WITH spent AS (
    SELECT j.workspace_id, j.id FROM public.job j
     WHERE (j.status = 'queued' OR (j.status = 'claimed' AND j.lease_expires_at < now()))
       AND j.attempts >= j.max_attempts
     ORDER BY j.enqueued_at, j.id
     FOR UPDATE SKIP LOCKED
  ), poisoned AS (
    UPDATE public.job j SET status = 'poisoned', finished_at = clock_timestamp()
      FROM spent s
     WHERE j.workspace_id = s.workspace_id AND j.id = s.id
    RETURNING j.id
  ), candidate AS (
    SELECT j.workspace_id, j.id FROM public.job j
     WHERE (j.status = 'queued' OR (j.status = 'claimed' AND j.lease_expires_at < now()))
       AND j.attempts < j.max_attempts
     ORDER BY j.enqueued_at, j.id
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.job j
     SET status = 'claimed',
         claimed_by = p_worker_id,
         claimed_at = clock_timestamp(),
         lease_expires_at = clock_timestamp() + p_lease,
         heartbeat_at = clock_timestamp(),
         attempts = j.attempts + 1
    FROM candidate c
   WHERE j.workspace_id = c.workspace_id AND j.id = c.id
  RETURNING j.*;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.claim_job(text, interval) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_job(text, interval) TO app_rt, worker_rt;--> statement-breakpoint
CREATE FUNCTION public.heartbeat_job(p_id text, p_worker_id text, p_lease interval)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
  WITH refreshed AS (
    UPDATE public.job j
       SET lease_expires_at = clock_timestamp() + p_lease, heartbeat_at = clock_timestamp()
     WHERE j.id = p_id AND j.claimed_by = p_worker_id AND j.status = 'claimed'
       AND j.lease_expires_at > clock_timestamp()
    RETURNING j.id
  )
  SELECT EXISTS (SELECT 1 FROM refreshed);
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.heartbeat_job(text, text, interval) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.heartbeat_job(text, text, interval) TO app_rt, worker_rt;--> statement-breakpoint
CREATE FUNCTION public.finish_job(p_id text, p_worker_id text, p_outcome jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
  WITH finished AS (
    UPDATE public.job j
       SET status = 'done', finished_at = clock_timestamp(), outcome = p_outcome
     WHERE j.id = p_id AND j.claimed_by = p_worker_id AND j.status = 'claimed'
       AND j.lease_expires_at > clock_timestamp()
    RETURNING j.id
  )
  SELECT EXISTS (SELECT 1 FROM finished);
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.finish_job(text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_job(text, text, jsonb) TO app_rt, worker_rt;--> statement-breakpoint
CREATE FUNCTION public.fail_job(p_id text, p_worker_id text, p_outcome jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
  WITH failed AS (
    UPDATE public.job j
       SET status = 'failed', finished_at = clock_timestamp(), outcome = p_outcome
     WHERE j.id = p_id AND j.claimed_by = p_worker_id AND j.status = 'claimed'
       AND j.lease_expires_at > clock_timestamp()
    RETURNING j.id
  )
  SELECT EXISTS (SELECT 1 FROM failed);
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.fail_job(text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fail_job(text, text, jsonb) TO app_rt, worker_rt;--> statement-breakpoint
GRANT USAGE ON SCHEMA "drizzle" TO worker_rt;--> statement-breakpoint
GRANT SELECT ON "drizzle"."__drizzle_migrations" TO worker_rt;--> statement-breakpoint
GRANT SELECT ON "concept_index" TO worker_rt;--> statement-breakpoint
GRANT SELECT, INSERT ON "graph_node" TO worker_rt;--> statement-breakpoint
GRANT SELECT, INSERT ON "graph_edge" TO worker_rt;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "graph_generation" TO worker_rt;--> statement-breakpoint
CREATE FUNCTION public.graph_generation_flip_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.live_gen <> OLD.live_gen AND NEW.live_gen <> OLD.live_gen + 1 THEN
    RAISE EXCEPTION 'a generation flips only to the next one: live is %, % refused',
      OLD.live_gen, NEW.live_gen
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER graph_generation_flip_guard
BEFORE UPDATE OF live_gen ON public.graph_generation
FOR EACH ROW EXECUTE FUNCTION public.graph_generation_flip_guard();--> statement-breakpoint
CREATE FUNCTION public.graph_row_generation_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  live integer;
BEGIN
  -- A generation before the first is the row's own CHECK's to refuse, by its own name.
  IF NEW.gen IS NULL OR NEW.gen < 1 THEN
    RETURN NEW;
  END IF;
  SELECT g.live_gen INTO live FROM public.graph_generation g WHERE g.workspace_id = NEW.workspace_id;
  IF live IS NULL OR NEW.gen NOT IN (live, live + 1) THEN
    RAISE EXCEPTION 'a map row lands in the live generation or the next: live is %, % refused',
      live, NEW.gen
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER graph_node_generation_guard
BEFORE INSERT ON public.graph_node
FOR EACH ROW EXECUTE FUNCTION public.graph_row_generation_guard();--> statement-breakpoint
CREATE TRIGGER graph_edge_generation_guard
BEFORE INSERT ON public.graph_edge
FOR EACH ROW EXECUTE FUNCTION public.graph_row_generation_guard();
