CREATE TABLE "question_asked" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"asked_by" text NOT NULL,
	"transport" text NOT NULL,
	"collections" text[] DEFAULT '{}' NOT NULL,
	"predicate_role" text NOT NULL,
	"predicate_groups" text[] DEFAULT '{}' NOT NULL,
	"completed_at" timestamp with time zone,
	"verdict" text,
	"judge_state" text,
	"concepts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unmapped_passages" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "question_asked_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "question_asked_asked_by_check" CHECK (asked_by ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$'),
	CONSTRAINT "question_asked_transport_check" CHECK (transport IN ('mcp', 'trpc')),
	CONSTRAINT "question_asked_predicate_role_check" CHECK (predicate_role IN ('Admin', 'Editor', 'Viewer')),
	CONSTRAINT "question_asked_verdict_check" CHECK (verdict IS NULL OR verdict IN ('ok', 'warn', 'refuse', 'related')),
	CONSTRAINT "question_asked_judge_state_check" CHECK (judge_state IS NULL OR judge_state IN ('not-judged', 'judged', 'judging-failed')),
	CONSTRAINT "question_asked_completion_check" CHECK ((completed_at IS NULL) = (verdict IS NULL)
         AND (completed_at IS NULL) = (judge_state IS NULL)),
	CONSTRAINT "question_asked_concepts_check" CHECK (jsonb_typeof(concepts) = 'array')
);--> statement-breakpoint
ALTER TABLE "question_asked" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "question_content" (
	"workspace_id" text NOT NULL,
	"record_id" text NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"question" text NOT NULL,
	"drafted" jsonb,
	CONSTRAINT "question_content_workspace_id_record_id_asked_at_pk" PRIMARY KEY("workspace_id","record_id","asked_at"),
	CONSTRAINT "question_content_drafted_check" CHECK (drafted IS NULL OR jsonb_typeof(drafted) = 'array')
-- Hand-written: a month of content leaves by dropping its partition, never by a statement that thins rows.
) PARTITION BY RANGE ("asked_at");--> statement-breakpoint
ALTER TABLE "question_content" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "question_feedback" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"record_id" text NOT NULL,
	"given_at" timestamp with time zone NOT NULL,
	"given_by" text NOT NULL,
	"verdict" text NOT NULL,
	"reason" text,
	"note" text,
	"disputed_sentence" text,
	"disputed_concept" text,
	CONSTRAINT "question_feedback_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "question_feedback_given_by_check" CHECK (given_by ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$'),
	CONSTRAINT "question_feedback_verdict_check" CHECK (verdict IN ('helpful', 'flag')),
	CONSTRAINT "question_feedback_reason_check" CHECK (reason IS NULL OR reason IN ('wrong', 'out-of-date', 'incomplete', 'should-not-have-shown')),
	CONSTRAINT "question_feedback_flag_check" CHECK ((verdict = 'flag') = (reason IS NOT NULL)
         AND (note IS NULL OR verdict = 'flag')
         AND (disputed_sentence IS NULL OR verdict = 'flag')
         AND (disputed_sentence IS NULL) = (disputed_concept IS NULL))
);--> statement-breakpoint
ALTER TABLE "question_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "question_content" ADD CONSTRAINT "question_content_record_fk" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."question_asked"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_feedback" ADD CONSTRAINT "question_feedback_record_fk" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."question_asked"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_asked_workspace_id_asked_by_idx" ON "question_asked" USING btree ("workspace_id","asked_by");--> statement-breakpoint
CREATE INDEX "question_feedback_workspace_id_record_id_idx" ON "question_feedback" USING btree ("workspace_id","record_id");--> statement-breakpoint
CREATE INDEX "question_feedback_workspace_id_given_by_idx" ON "question_feedback" USING btree ("workspace_id","given_by");--> statement-breakpoint
CREATE POLICY "question_asked_workspace_isolation" ON "question_asked" AS PERMISSIVE FOR ALL TO public USING ("question_asked"."workspace_id" = (select current_workspace_id())) WITH CHECK ("question_asked"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "question_content_workspace_isolation" ON "question_content" AS PERMISSIVE FOR ALL TO public USING ("question_content"."workspace_id" = (select current_workspace_id())) WITH CHECK ("question_content"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "question_feedback_workspace_isolation" ON "question_feedback" AS PERMISSIVE FOR ALL TO public USING ("question_feedback"."workspace_id" = (select current_workspace_id())) WITH CHECK ("question_feedback"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
-- Hand-written from here, as each tenant table's substrate is: the policy binds the owner too, and the worker never reads a question.
ALTER TABLE "question_asked" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "question_content" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "question_feedback" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "question_asked", "question_content", "question_feedback" FROM worker_rt;--> statement-breakpoint
-- A record's skeleton and its feedback are kept for good, so the api holds no delete of either.
REVOKE DELETE ON "question_asked", "question_feedback" FROM app_rt;--> statement-breakpoint
-- A request cannot make its own partition: app_rt holds no CREATE on the schema. The daily sweep
-- asks for the month ahead, so a second call for a month answers without making anything.
-- Made and then attached, never `PARTITION OF`, which holds the parent ACCESS EXCLUSIVE while it
-- waits on question_asked for the foreign key: a cycle with any request that is opening a record.
CREATE FUNCTION public.create_question_content_partition(p_month date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  first_day date := make_date(extract(year FROM p_month)::int, extract(month FROM p_month)::int, 1);
  partition_name text := 'question_content_' || to_char(first_day, 'YYYY_MM');
  this_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- No workspace scopes a month, so the argument is held instead to the months a sweep asks for:
  -- the clock's own and the next, with a month either side for a clock that disagrees at a month's end.
  IF first_day IS NULL
     OR first_day < (this_month - interval '1 month')::date
     OR first_day > (this_month + interval '2 months')::date THEN
    RAISE EXCEPTION 'create_question_content_partition: % is not a month a sweep makes', p_month
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF to_regclass(format('public.%I', partition_name)) IS NOT NULL THEN
    RETURN;
  END IF;
  -- What a partition inherits and no more: ALL would copy the parent's comments and statistics too.
  EXECUTE format(
    'CREATE TABLE public.%I (LIKE public.question_content INCLUDING DEFAULTS INCLUDING GENERATED'
    ' INCLUDING CONSTRAINTS INCLUDING STORAGE INCLUDING COMPRESSION)',
    partition_name);
  -- Forced with no policy of its own, and granted to neither runtime role: a statement reaches a
  -- tenant's rows through the policied parent and never through the partition.
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', partition_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', partition_name);
  EXECUTE format('REVOKE ALL ON public.%I FROM app_rt, worker_rt', partition_name);
  -- The bounds are written in UTC, so a month begins at the same instant whatever the session's zone.
  EXECUTE format(
    'ALTER TABLE public.question_content ATTACH PARTITION public.%I FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    to_char(first_day, 'YYYY-MM-DD') || ' 00:00:00+00',
    to_char(first_day + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00');
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.create_question_content_partition(date) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_question_content_partition(date) TO app_rt;--> statement-breakpoint
-- The month this runs in and the next; the sweep makes each month after them.
SELECT public.create_question_content_partition((now() AT TIME ZONE 'UTC')::date);--> statement-breakpoint
SELECT public.create_question_content_partition(((now() AT TIME ZONE 'UTC') + interval '1 month')::date);
