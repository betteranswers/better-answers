-- Custom migration (hand-written SQL; ADR 0032).
-- Hand-written because it grants on the graph tables, whose DDL the one-journal rule keeps
-- out of a generated migration, and because drizzle-kit emits no function and no grant.
-- The queue's substrate (ADR 0031): the FORCE line withRLS() cannot emit, the four SQL
-- functions both tiers call (ADR 0031's queue agreement, fixtured in contracts/queue/), and
-- the privileges the worker's two job kinds need — which land in the same migration as the
-- code that uses them rather than standing here unused, exactly as migrations 0015, 0016 and
-- 0020 reasoned when they took them away.

-- FORCE applies RLS to the table's owner too (ADR 0032); the coverage test fails on any
-- tenant table whose FORCE line is missing.
ALTER TABLE "job" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- **Nothing deletes a job.** A job's row is the record of a run — queued, claimed, finished or
-- poisoned — and neither tier has a road that removes one: the queue retires a job by moving
-- its status, never by taking the row away. Migration 0000's default privileges would have
-- handed both runtime roles DELETE; revoked here, so a run's record cannot be removed by the
-- role that made it. UPDATE stays, because the four INVOKER functions below are what update a
-- row, under the caller's own role and the caller's own scope. Proved by "refuses both
-- runtime roles a DELETE on the queue" in packages/schema/test/rls.test.ts.
REVOKE DELETE ON "job" FROM app_rt, worker_rt;
--> statement-breakpoint
-- **Every one of these four is SECURITY INVOKER, and that is the decision.** They run under
-- the caller's own role and inside the caller's own transaction, so RLS does the tenant
-- fencing on every row they touch and the workspace scope is the one the caller already set
-- (`app.workspace_id`). A definer function would have to guard its arguments against that
-- scope by hand, and there is nothing here it could do that the policy does not
-- already do — so none is written. What the functions add is the *transition*: the claim is
-- one statement no two workers can both win, and the three that follow are refusals a
-- client cannot forget to make.
--
-- `search_path` is pinned and every object is schema-qualified anyway, because a function
-- that resolved `job` through the caller's path would be a different function per caller.

-- **claim_job: the oldest claimable job in this workspace, handed to exactly one worker.**
--
-- Claimable is *queued*, or *claimed* with a lapsed lease — a worker that stopped answering
-- has its job taken back, which is what a lease is for (`CONTEXT.md`). `FOR UPDATE SKIP
-- LOCKED` is what makes two workers claiming at once take two different jobs rather than
-- one waiting on the other.
--
-- **The reaper's rule is applied here, at claim time, and nowhere else.** A job that has
-- been claimed as many times as it may be is poisoned by the claim that would have been its
-- next one, so an expired lease is never lost (something always looks at it again) and a
-- poisoned job is never retried (nothing claims it after). A separate reaper would be a
-- second process to run and a window in which a job is neither.
--
-- The poison arm takes its rows through `ORDER BY … FOR UPDATE SKIP LOCKED` too, so two
-- workers arriving together cannot take the same rows in different orders and deadlock.
--
-- Every stamp a job carries — `claimed_at`, `heartbeat_at`, `lease_expires_at`,
-- `finished_at` — is `clock_timestamp()`, the instant the statement ran, and never `now()`,
-- the instant its transaction began: a rebuild's finish is stamped when it finished, not
-- when its transaction opened, so the row can say how long a job took. The claim's lease
-- *comparisons* keep `now()`, one instant for the whole claim. `enqueued_at` is the row's
-- default and stays `now()`.
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
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.claim_job(text, interval) FROM PUBLIC;
--> statement-breakpoint
-- Both tiers: the worker claims, and the app claims in a test and in the ops command that
-- runs a rebuild in the foreground. That is what makes this an agreement (ADR 0031).
GRANT EXECUTE ON FUNCTION public.claim_job(text, interval) TO app_rt, worker_rt;
--> statement-breakpoint
-- **heartbeat_job: the claimant says it is still alive, and the lease moves.**
--
-- Only for the claimant, only while the job is still *claimed*, and **only while its lease
-- stands**: an expired lease revokes the claimant. A worker whose lease lapsed is told
-- `false` whether or not anybody has claimed the job since — the moment the lease lapsed
-- the job became somebody else's to take, and a late heartbeat that pushed the lease out
-- again would be that worker taking back a job the queue had already offered on, racing
-- whichever claim was about to win it. The lease is compared against `clock_timestamp()`, the
-- instant the statement ran, because a heartbeat's own transaction is short and a finish's
-- may be long-lived. `false` and not an exception, because a heartbeat runs beside the
-- work — an exception here would abort the transaction the work is in.
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
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.heartbeat_job(text, text, interval) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.heartbeat_job(text, text, interval) TO app_rt, worker_rt;
--> statement-breakpoint
-- **finish_job and fail_job: the two ends, written by the claimant and by nobody else.**
--
-- The same four conditions as the heartbeat, and the same `false`: a worker whose lease
-- lapsed mid-run must not be able to stamp *done* over the run that replaced it — nor over
-- a job the queue is about to hand out again, which is why the lease itself is a condition
-- and not only the claimant's name. The worker logs such a finish as unrecorded
-- (`recorded=false` in `loop.py`), and the row keeps what the run that holds the lease writes.
--
-- A failure is **terminal**. Retries in this queue happen by a lease lapsing — the crash
-- case — and not by a job saying it failed: a job that ran and reported what went wrong has
-- said something an operator should read, and running it again would bury that under the
-- same failure two more times. The attempt count therefore counts claims, and poison is the
-- verdict on a job that keeps losing its worker.
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
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.finish_job(text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.finish_job(text, text, jsonb) TO app_rt, worker_rt;
--> statement-breakpoint
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
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.fail_job(text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fail_job(text, text, jsonb) TO app_rt, worker_rt;
--> statement-breakpoint
-- **The schema stamp the worker refuses to claim without** (`apps/worker/CODING_RULES.md`,
-- the never-migrates rule). The worker holds a generated, committed view of this schema and
-- compares the migration it was generated from against the last row of the migrator's own
-- table before it claims anything; a mismatch means the deploy order slipped and the worker
-- would be reading a shape that has moved. It is one SELECT on one table it can do nothing
-- else with — the schema is the migrator's, and USAGE without a table grant reaches nothing.
-- Deliberately not granted in T-003's migrations, because the check that reads it did not
-- exist yet. Proved by "lets the worker read the migration stamp, and refuses it every other
-- road to the migrator's own table" in packages/schema/test/rls.test.ts.
GRANT USAGE ON SCHEMA "drizzle" TO worker_rt;
--> statement-breakpoint
GRANT SELECT ON "drizzle"."__drizzle_migrations" TO worker_rt;
--> statement-breakpoint
-- **The index row, read and never written.** Both of the worker's job kinds read it: the
-- nightly audit compares its own parse of each file against `content_hash`, and the full
-- rebuild copies the row's identity, kind, status and visibility columns onto the generation
-- it writes rather than re-deriving them — the records' derived visibility is the app's
-- (ADR 0031), and a worker that re-derived it would be a second opinion about who may read
-- a concept. Migration 0015 revoked ALL; this grants the read back and nothing more, so the
-- worker still cannot write a row the app derives. Proved by "lets the worker read the
-- concept index and never write it (migration 0022)" in packages/schema/test/rls.test.ts.
GRANT SELECT ON "concept_index" TO worker_rt;
--> statement-breakpoint
-- **The graph, for a full rebuild and for nothing else.** Migration 0016 revoked ALL on all
-- three and said the grants would land with the job that uses them; this is that job.
--
-- The shape of these three grants is the guarantee: INSERT on the two row tables and no
-- UPDATE and no DELETE, so a rebuild can only ever write **into the generation it is
-- building** and can never edit or remove a row of the live one. Sweeping a retired
-- generation is the app's (`graph-sweep`, T-058), which is why DELETE is nobody's here.
-- `graph_generation` takes UPDATE as well, because the flip that makes a rebuilt map visible
-- is one row update on that table — and it is the only update the worker may make anywhere
-- in the graph. Proved by "lets the worker build a generation beside the live one and flip
-- it, and refuses it every edit to a node or an edge (migration 0022)" in
-- packages/schema/test/rls.test.ts.
GRANT SELECT, INSERT ON "graph_node" TO worker_rt;
--> statement-breakpoint
GRANT SELECT, INSERT ON "graph_edge" TO worker_rt;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "graph_generation" TO worker_rt;
--> statement-breakpoint
-- **The generation boundary, held by the database and not by the code that chose `live + 1`.**
-- The grants above say *what* the worker may touch; these two triggers say *which generation*,
-- because a grant cannot. A rebuild writes the next generation beside the live one and makes it
-- live by one row update (ADR 0023, ADR 0032), and an ordinary edit's delta writes into the
-- live one; nothing else is a map write. So a flip is refused unless it moves the row to
-- exactly `live_gen + 1` — never back to a swept generation, never forward past one nobody
-- built — and a bundle-and-record row is refused unless its `gen` is the live generation
-- (the delta's) or the one after it (a rebuild's). The source-entity partition carries no
-- generation (`gen IS NULL`) and is reconciled per document rather than rebuilt, so it is
-- exempt. Both run under the caller's own role, so RLS scopes the generation row the guard
-- reads exactly as it scopes the row being written. Proved by "refuses a flip to any
-- generation but the next, and a row in any generation but the live one or the next" in
-- packages/schema/test/rls.test.ts, beside the served path.
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
$$;
--> statement-breakpoint
CREATE TRIGGER graph_generation_flip_guard
BEFORE UPDATE OF live_gen ON public.graph_generation
FOR EACH ROW EXECUTE FUNCTION public.graph_generation_flip_guard();
--> statement-breakpoint
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
$$;
--> statement-breakpoint
CREATE TRIGGER graph_node_generation_guard
BEFORE INSERT ON public.graph_node
FOR EACH ROW EXECUTE FUNCTION public.graph_row_generation_guard();
--> statement-breakpoint
CREATE TRIGGER graph_edge_generation_guard
BEFORE INSERT ON public.graph_edge
FOR EACH ROW EXECUTE FUNCTION public.graph_row_generation_guard();
