-- Custom migration (hand-written SQL; ADR 0032).
DROP FUNCTION public.claim_job(text, interval);--> statement-breakpoint
CREATE FUNCTION public.claim_job(p_worker_id text, p_lease interval, p_kinds text[])
RETURNS SETOF public.job
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
  WITH spent AS (
    SELECT j.workspace_id, j.id FROM public.job j
     WHERE (j.status = 'queued' OR (j.status = 'claimed' AND j.lease_expires_at < now()))
       AND j.kind = ANY(p_kinds)
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
       AND j.kind = ANY(p_kinds)
       AND j.attempts < j.max_attempts
       AND NOT EXISTS (
         SELECT 1 FROM public.job s
          WHERE s.workspace_id = j.workspace_id
            AND s.kind = j.kind
            AND s.subject_id IS NOT NULL
            AND s.subject_id = j.subject_id
            AND s.id <> j.id
            AND s.status = 'claimed'
            AND s.lease_expires_at > now()
       )
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
REVOKE EXECUTE ON FUNCTION public.claim_job(text, interval, text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_job(text, interval, text[]) TO app_rt, worker_rt;
