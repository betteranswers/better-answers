-- The owner reads a forced table through its policy, which shows it nothing with no scope set,
-- so the guard lifts the force for its own reads and puts it back.
ALTER TABLE "write_up" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "write_up_include" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.write_up) OR EXISTS (SELECT 1 FROM public.write_up_include) THEN
    RAISE EXCEPTION 'write_up and write_up_include hold rows, so the not-null home and content_hash columns cannot be added';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "write_up" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "write_up_include" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guide_definition" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"template" text NOT NULL,
	"kind" text NOT NULL,
	"collection" text NOT NULL,
	"subject_iri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_definition_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "guide_definition_collection_check" CHECK (collection ~ '^(?!\.{1,2}$)[^/\s]+$')
);--> statement-breakpoint
ALTER TABLE "guide_definition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guide_definition_version" (
	"workspace_id" text NOT NULL,
	"guide_id" text NOT NULL,
	"version" integer NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"content" jsonb NOT NULL,
	CONSTRAINT "guide_definition_version_workspace_id_guide_id_version_pk" PRIMARY KEY("workspace_id","guide_id","version"),
	CONSTRAINT "guide_definition_version_version_check" CHECK (version >= 1),
	CONSTRAINT "guide_definition_version_actor_check" CHECK (actor ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$')
);--> statement-breakpoint
ALTER TABLE "guide_definition_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guide_expected_fact" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"guide_id" text NOT NULL,
	"section_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"collection" text,
	"at_least" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "guide_expected_fact_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "guide_expected_fact_ordinal_check" CHECK (ordinal >= 0),
	CONSTRAINT "guide_expected_fact_tags_check" CHECK (array_position(tags, NULL) IS NULL),
	CONSTRAINT "guide_expected_fact_collection_check" CHECK (collection IS NULL OR collection ~ '^(?!\.{1,2}$)[^/\s]+$'),
	CONSTRAINT "guide_expected_fact_at_least_check" CHECK (at_least >= 1)
);--> statement-breakpoint
ALTER TABLE "guide_expected_fact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guide_role" (
	"workspace_id" text NOT NULL,
	"guide_id" text NOT NULL,
	"role" text NOT NULL,
	"default_layer" text NOT NULL,
	"action_threshold" text NOT NULL,
	CONSTRAINT "guide_role_workspace_id_guide_id_role_pk" PRIMARY KEY("workspace_id","guide_id","role"),
	CONSTRAINT "guide_role_role_check" CHECK (role IN ('Admin', 'Editor', 'Viewer')),
	CONSTRAINT "guide_role_default_layer_check" CHECK (default_layer IN ('assembled', 'quoted')),
	CONSTRAINT "guide_role_action_threshold_check" CHECK (action_threshold IN ('unverified', 'machine-confirmed', 'human-reviewed'))
);--> statement-breakpoint
ALTER TABLE "guide_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "guide_section" (
	"workspace_id" text NOT NULL,
	"guide_id" text NOT NULL,
	"id" text NOT NULL,
	"parent_id" text,
	"ordinal" integer NOT NULL,
	"prompt" text NOT NULL,
	"role_label" text NOT NULL,
	"usage_note" text,
	"layers" text[] NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "guide_section_workspace_id_guide_id_id_pk" PRIMARY KEY("workspace_id","guide_id","id"),
	CONSTRAINT "guide_section_ordinal_check" CHECK (ordinal >= 0),
	CONSTRAINT "guide_section_role_label_check" CHECK (role_label IN ('know', 'say', 'show', 'do')),
	CONSTRAINT "guide_section_layers_check" CHECK (cardinality(layers) > 0 AND layers <@ ARRAY['assembled', 'quoted']::text[])
);--> statement-breakpoint
ALTER TABLE "guide_section" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "write_up_version" (
	"workspace_id" text NOT NULL,
	"write_up_id" text NOT NULL,
	"version" integer NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"markdown" text NOT NULL,
	"includes" jsonb NOT NULL,
	CONSTRAINT "write_up_version_workspace_id_write_up_id_version_pk" PRIMARY KEY("workspace_id","write_up_id","version"),
	CONSTRAINT "write_up_version_version_check" CHECK (version >= 1),
	CONSTRAINT "write_up_version_actor_check" CHECK (actor ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$')
);--> statement-breakpoint
ALTER TABLE "write_up_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usage" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"act" text NOT NULL,
	"write_up_id" text,
	"write_up_version" integer,
	"iri" text,
	CONSTRAINT "usage_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "usage_actor_check" CHECK (actor ~ '^(human:[0-9A-HJKMNP-TV-Z]{26}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)$'),
	CONSTRAINT "usage_act_check" CHECK (act IN ('copied', 'exported', 'submitted')),
	CONSTRAINT "usage_one_target_check" CHECK ((write_up_id IS NOT NULL AND write_up_version IS NOT NULL AND iri IS NULL) OR (write_up_id IS NULL AND write_up_version IS NULL AND iri IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "write_up" ADD COLUMN "home" text NOT NULL;--> statement-breakpoint
ALTER TABLE "write_up" ADD COLUMN "guide_id" text;--> statement-breakpoint
ALTER TABLE "write_up" ADD COLUMN "section_id" text;--> statement-breakpoint
ALTER TABLE "write_up" ADD COLUMN "question_id" text;--> statement-breakpoint
ALTER TABLE "write_up" ADD COLUMN "needs_review" text;--> statement-breakpoint
ALTER TABLE "write_up_include" ADD COLUMN "content_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "write_up_include" ADD COLUMN "expected_fact_id" text;--> statement-breakpoint
ALTER TABLE "write_up_include" ADD COLUMN "wording_heading" text;--> statement-breakpoint
ALTER TABLE "write_up_include" ADD COLUMN "wording_hash" text;--> statement-breakpoint
ALTER TABLE "guide_definition" ADD CONSTRAINT "guide_definition_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_definition" ADD CONSTRAINT "guide_definition_subject_fk" FOREIGN KEY ("workspace_id","subject_iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_definition_version" ADD CONSTRAINT "guide_definition_version_guide_fk" FOREIGN KEY ("workspace_id","guide_id") REFERENCES "public"."guide_definition"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_expected_fact" ADD CONSTRAINT "guide_expected_fact_section_fk" FOREIGN KEY ("workspace_id","guide_id","section_id") REFERENCES "public"."guide_section"("workspace_id","guide_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_role" ADD CONSTRAINT "guide_role_guide_fk" FOREIGN KEY ("workspace_id","guide_id") REFERENCES "public"."guide_definition"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_section" ADD CONSTRAINT "guide_section_guide_fk" FOREIGN KEY ("workspace_id","guide_id") REFERENCES "public"."guide_definition"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_section" ADD CONSTRAINT "guide_section_parent_fk" FOREIGN KEY ("workspace_id","guide_id","parent_id") REFERENCES "public"."guide_section"("workspace_id","guide_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_up_version" ADD CONSTRAINT "write_up_version_write_up_fk" FOREIGN KEY ("workspace_id","write_up_id") REFERENCES "public"."write_up"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_write_up_version_fk" FOREIGN KEY ("workspace_id","write_up_id","write_up_version") REFERENCES "public"."write_up_version"("workspace_id","write_up_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_identity_fk" FOREIGN KEY ("workspace_id","iri") REFERENCES "public"."concept_identity"("workspace_id","iri") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guide_expected_fact_workspace_id_guide_id_section_id_idx" ON "guide_expected_fact" USING btree ("workspace_id","guide_id","section_id");--> statement-breakpoint
CREATE INDEX "usage_workspace_id_write_up_id_write_up_version_idx" ON "usage" USING btree ("workspace_id","write_up_id","write_up_version");--> statement-breakpoint
ALTER TABLE "write_up" ADD CONSTRAINT "write_up_section_fk" FOREIGN KEY ("workspace_id","guide_id","section_id") REFERENCES "public"."guide_section"("workspace_id","guide_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_up_include" ADD CONSTRAINT "write_up_include_expected_fact_fk" FOREIGN KEY ("workspace_id","expected_fact_id") REFERENCES "public"."guide_expected_fact"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "write_up_section_uidx" ON "write_up" USING btree ("workspace_id","guide_id","section_id") WHERE home = 'section';--> statement-breakpoint
CREATE INDEX "write_up_include_workspace_id_expected_fact_id_idx" ON "write_up_include" USING btree ("workspace_id","expected_fact_id");--> statement-breakpoint
ALTER TABLE "write_up" ADD CONSTRAINT "write_up_home_check" CHECK ((home = 'section' AND guide_id IS NOT NULL AND section_id IS NOT NULL AND question_id IS NULL) OR (home = 'response' AND question_id IS NOT NULL AND guide_id IS NULL AND section_id IS NULL));--> statement-breakpoint
ALTER TABLE "write_up" ADD CONSTRAINT "write_up_needs_review_check" CHECK (needs_review IS NULL OR needs_review IN ('concept-changed', 'concept-removed', 'expectation-unmet', 'review-finding'));--> statement-breakpoint
ALTER TABLE "write_up_include" ADD CONSTRAINT "write_up_include_wording_check" CHECK ((wording_heading IS NULL) = (wording_hash IS NULL));--> statement-breakpoint
CREATE POLICY "guide_definition_workspace_isolation" ON "guide_definition" AS PERMISSIVE FOR ALL TO public USING ("guide_definition"."workspace_id" = (select current_workspace_id())) WITH CHECK ("guide_definition"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "guide_definition_version_workspace_isolation" ON "guide_definition_version" AS PERMISSIVE FOR ALL TO public USING ("guide_definition_version"."workspace_id" = (select current_workspace_id())) WITH CHECK ("guide_definition_version"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "guide_expected_fact_workspace_isolation" ON "guide_expected_fact" AS PERMISSIVE FOR ALL TO public USING ("guide_expected_fact"."workspace_id" = (select current_workspace_id())) WITH CHECK ("guide_expected_fact"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "guide_role_workspace_isolation" ON "guide_role" AS PERMISSIVE FOR ALL TO public USING ("guide_role"."workspace_id" = (select current_workspace_id())) WITH CHECK ("guide_role"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "guide_section_workspace_isolation" ON "guide_section" AS PERMISSIVE FOR ALL TO public USING ("guide_section"."workspace_id" = (select current_workspace_id())) WITH CHECK ("guide_section"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "write_up_version_workspace_isolation" ON "write_up_version" AS PERMISSIVE FOR ALL TO public USING ("write_up_version"."workspace_id" = (select current_workspace_id())) WITH CHECK ("write_up_version"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
CREATE POLICY "usage_workspace_isolation" ON "usage" AS PERMISSIVE FOR ALL TO public USING ("usage"."workspace_id" = (select current_workspace_id())) WITH CHECK ("usage"."workspace_id" = (select current_workspace_id()));--> statement-breakpoint
ALTER TABLE "guide_definition" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guide_role" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guide_section" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guide_expected_fact" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guide_definition_version" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "write_up_version" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "write_up_version" FROM app_rt;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "guide_definition_version" FROM app_rt;--> statement-breakpoint
CREATE FUNCTION public.pseudonymise_record_actors(
  p_workspace_id text, p_table text, p_people text[], p_pseudonym text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_actors text[];
  v_erased_as text := 'human:' || p_pseudonym;
  v_rewritten integer;
BEGIN
  PERFORM public.erasure_scope_check(p_workspace_id, p_pseudonym);
  PERFORM public.erasure_needle_pattern(p_people, ARRAY[]::text[]);
  v_actors := ARRAY(SELECT 'human:' || p FROM unnest(p_people) AS p);

  IF p_table = 'write_up_version' THEN
    UPDATE public.write_up_version v
       SET actor = v_erased_as
     WHERE v.workspace_id = p_workspace_id AND v.actor = ANY (v_actors);
  ELSIF p_table = 'guide_definition_version' THEN
    UPDATE public.guide_definition_version v
       SET actor = v_erased_as
     WHERE v.workspace_id = p_workspace_id AND v.actor = ANY (v_actors);
  ELSE
    RAISE EXCEPTION 'pseudonymise_record_actors: p_table names no version table: %', p_table
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  GET DIAGNOSTICS v_rewritten = ROW_COUNT;
  RETURN v_rewritten;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.pseudonymise_record_actors(text, text, text[], text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.pseudonymise_record_actors(text, text, text[], text) TO app_rt;
