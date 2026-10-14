-- Custom migration (hand-written SQL; ADR 0032).
-- The claim protocol (ADR 0031). A failure was terminal; now a job that
-- has an attempt left goes back to the queue for another run, its claim state returned,
-- and only a failure at the bound ends the job and records its outcome. The claim
-- protocol's other three functions are unchanged, and the poisoned arm of claim_job keeps
-- its meaning: a lease that lapsed at the bound is poisoned at claim time, not retried.

CREATE OR REPLACE FUNCTION public.fail_job(p_id text, p_worker_id text, p_outcome jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
  WITH failed AS (
    UPDATE public.job j
       SET status = CASE WHEN j.attempts < j.max_attempts
                         THEN 'queued' ELSE 'failed' END,
           claimed_by = CASE WHEN j.attempts < j.max_attempts
                             THEN NULL ELSE j.claimed_by END,
           claimed_at = CASE WHEN j.attempts < j.max_attempts
                             THEN NULL ELSE j.claimed_at END,
           lease_expires_at = CASE WHEN j.attempts < j.max_attempts
                                    THEN NULL ELSE j.lease_expires_at END,
           heartbeat_at = CASE WHEN j.attempts < j.max_attempts
                               THEN NULL ELSE j.heartbeat_at END,
           finished_at = CASE WHEN j.attempts < j.max_attempts
                              THEN NULL ELSE clock_timestamp() END,
           outcome = CASE WHEN j.attempts < j.max_attempts
                          THEN NULL ELSE p_outcome END
     WHERE j.id = p_id AND j.claimed_by = p_worker_id AND j.status = 'claimed'
       AND j.lease_expires_at > clock_timestamp()
    RETURNING j.id
  )
  SELECT EXISTS (SELECT 1 FROM failed);
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.fail_job(text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fail_job(text, text, jsonb) TO app_rt, worker_rt;
