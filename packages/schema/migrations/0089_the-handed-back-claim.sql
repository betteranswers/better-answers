-- Custom migration (hand-written SQL; ADR 0032).
-- The claim protocol (ADR 0031). A claimant that is stopping hands its job back: the lease
-- ends at once and the bound rises by one, so the stop spends none of the job's budget. The
-- attempt count still rises, because the api reads a sync on any attempt but its first as
-- having moved its whole connected source. The row keeps the shape a lapsed lease leaves,
-- status claimed with its lease gone, because a queued row would break the run key whenever a
-- newer job for the same subject is waiting. The claim protocol's other functions are unchanged.

CREATE FUNCTION public.hand_back_job(p_id text, p_worker_id text)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
  WITH handed_back AS (
    UPDATE public.job j
       SET lease_expires_at = clock_timestamp(),
           max_attempts = j.max_attempts + 1
     WHERE j.id = p_id AND j.claimed_by = p_worker_id AND j.status = 'claimed'
       AND j.lease_expires_at > clock_timestamp()
    RETURNING j.id
  )
  SELECT EXISTS (SELECT 1 FROM handed_back);
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.hand_back_job(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hand_back_job(text, text) TO app_rt, worker_rt;
