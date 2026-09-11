-- Custom migration (hand-written SQL; ADR 0032), the substrate half of migration 0032's
-- pair: drizzle-kit emits no function, and `claim_job` has to be rewritten now that the row
-- it hands out carries a kind a claimant may not run and a subject only one run at a time
-- may hold.
--
-- **A drop and a create, not CREATE OR REPLACE.** The argument list changes, and Postgres
-- identifies a function by its arguments — a replace would have left the two-argument
-- function standing beside the three-argument one, so a caller that had not been taught the
-- new argument would keep claiming every kind in the workspace and nobody would find out.
-- Every privilege is therefore re-issued on the new signature below: a grant belongs to the
-- signature it was made on and does not survive the drop.
DROP FUNCTION public.claim_job(text, interval);
--> statement-breakpoint
-- **claim_job: the oldest claimable job of a kind this claimant runs, handed to exactly one
-- worker — and never a second run of a subject that already has one.**
--
-- Everything migration 0022 wrote about this function still holds: claimable is *queued*, or
-- *claimed* with a lapsed lease; `FOR UPDATE SKIP LOCKED` is what makes two workers claiming
-- at once take two different jobs; the reaper's rule is applied here, at claim time, and
-- nowhere else; every stamp is `clock_timestamp()` and the lease comparisons are `now()`.
-- It stays SECURITY INVOKER with a pinned `search_path` and every object schema-qualified,
-- so row-level security under the caller's own role is what fences every row it touches and
-- there is no argument to guard against the transaction's scope. `EXECUTE` is revoked from
-- PUBLIC and granted to the two roles that call it, restated below on the new signature.
--
-- **`p_kinds` is what this claimant can run, and it filters both arms.** The worker passes
-- the kinds its registry holds; the ops command that runs a rebuild in the foreground passes
-- the rebuild kind alone. A kind nobody passes stays queued — which is how a kind lands in
-- the schema before the handler that runs it exists. The *poison* arm takes the same filter
-- as the candidate arm on purpose: poisoning is a verdict on a job that keeps losing its
-- worker, and a claimant that cannot run a kind has learnt nothing about that job by failing
-- to claim it. The argument has no default, so a caller must say; a NULL array claims
-- nothing, because `kind = ANY(NULL)` is NULL and no row passes it.
--
-- **The sibling check is one run per subject, in SQL.** A candidate whose subject already
-- has a job of the same kind *claimed* under a lease that still stands is passed over, so a
-- binding's documents are never being indexed twice at once — two runs over one binding
-- would race each other's chunk rows, and the last writer would win by accident. The queued
-- side of the same rule is the partial unique index migration 0032 landed: at most one
-- queued job per subject. Together they say a subject has at most one run and at most one
-- job waiting. The sibling is read without a lock: this claim must not wait on the run that
-- holds the lease, only decline to join it. A row whose `subject_id` is NULL has no sibling
-- by construction — NULL never equals NULL — so the two subjectless kinds claim exactly as
-- they always did.
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
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.claim_job(text, interval, text[]) FROM PUBLIC;
--> statement-breakpoint
-- Both tiers: the worker claims, and the app claims in a test and in the ops command that
-- runs a rebuild in the foreground. That is what makes this an agreement (ADR 0031), and it
-- is the grant that admits the app as a claimant — not a statement about which tier runs
-- which kind, which is the descriptor's to make.
GRANT EXECUTE ON FUNCTION public.claim_job(text, interval, text[]) TO app_rt, worker_rt;
