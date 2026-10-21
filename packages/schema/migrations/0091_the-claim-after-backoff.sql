-- Custom migration (hand-written SQL; ADR 0032).
-- The claim protocol (ADR 0031). A failure with an attempt left queues the job behind a
-- backoff: 60 seconds after its first attempt, doubled for each attempt since, capped at an
-- hour, set from the database's clock so both tiers agree. The claim skips a job until its
-- backoff has ended, and clears the backoff when it takes the job. A failed job keeps its
-- attempts, so it holds no place in the run key (0090) and requeues beside a fresh job for its
-- subject instead of colliding with it. A subject can then hold two queued jobs, so the claim
-- takes only the older of them: two claimants never run one subject at once, and a fresh job
-- waits behind a retry still in its backoff. The claim protocol's other functions are unchanged.

CREATE OR REPLACE FUNCTION public.fail_job(p_id text, p_worker_id text, p_outcome jsonb)
RETURNS boolean
LANGUAGE sql
SET search_path = pg_catalog, pg_temp
AS $$
  WITH requeued AS (
    UPDATE public.job j
       SET status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL,
           heartbeat_at = NULL,
           backoff_ends_at = now() + make_interval(
             secs => least(60 * power(2, j.attempts - 1), 3600))
     WHERE j.id = p_id AND j.claimed_by = p_worker_id AND j.status = 'claimed'
       AND j.lease_expires_at > clock_timestamp()
       AND j.attempts < j.max_attempts
    RETURNING j.id
  ), ended AS (
    UPDATE public.job j
       SET status = 'failed',
           finished_at = clock_timestamp(),
           outcome = p_outcome
     WHERE j.id = p_id AND j.claimed_by = p_worker_id AND j.status = 'claimed'
       AND j.lease_expires_at > clock_timestamp()
       AND j.attempts >= j.max_attempts
    RETURNING j.id
  )
  SELECT EXISTS (SELECT 1 FROM requeued UNION ALL SELECT 1 FROM ended);
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.fail_job(text, text, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fail_job(text, text, jsonb) TO app_rt, worker_rt;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.claim_job(p_worker_id text, p_lease interval, p_kinds text[])
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
  ), unheld AS MATERIALIZED (
    SELECT j.workspace_id, j.id FROM public.job j
     WHERE j.status = 'claimed' AND j.lease_expires_at < now()
       AND j.subject_id IS NOT NULL
       AND j.kind = ANY(p_kinds)
     FOR UPDATE SKIP LOCKED
  ), candidate AS (
    SELECT j.workspace_id, j.id FROM public.job j
     WHERE (j.status = 'queued' OR (j.status = 'claimed' AND j.lease_expires_at < now()))
       AND j.kind = ANY(p_kinds)
       AND j.attempts < j.max_attempts
       AND (j.backoff_ends_at IS NULL OR j.backoff_ends_at <= now())
       AND NOT EXISTS (
         SELECT 1 FROM public.job s
          WHERE s.workspace_id = j.workspace_id
            AND s.kind = j.kind
            AND s.subject_id IS NOT NULL
            AND s.subject_id = j.subject_id
            AND s.id <> j.id
            AND s.status = 'claimed'
            AND (s.lease_expires_at > now()
                 OR NOT EXISTS (
                   SELECT 1 FROM unheld u
                    WHERE u.workspace_id = s.workspace_id AND u.id = s.id
                 ))
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.job q
          WHERE q.workspace_id = j.workspace_id
            AND q.kind = j.kind
            AND q.subject_id IS NOT NULL
            AND q.subject_id = j.subject_id
            AND q.status = 'queued'
            AND (q.enqueued_at, q.id) < (j.enqueued_at, j.id)
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
         backoff_ends_at = NULL,
         attempts = j.attempts + 1
    FROM candidate c
   WHERE j.workspace_id = c.workspace_id AND j.id = c.id
  RETURNING j.*;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.claim_job(text, interval, text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_job(text, interval, text[]) TO app_rt, worker_rt;
