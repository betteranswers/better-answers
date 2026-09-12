CREATE TABLE "subject_request" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"person_id" text,
	"identifiers" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"clock_started_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"extended_to" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"answer" text,
	CONSTRAINT "subject_request_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "subject_request_kind_check" CHECK (kind IN ('access', 'erasure')),
	CONSTRAINT "subject_request_identifiers_check" CHECK (jsonb_typeof(identifiers) = 'object'
         AND jsonb_typeof(identifiers -> 'emails') IS NOT DISTINCT FROM 'array'
         AND jsonb_typeof(identifiers -> 'names') IS NOT DISTINCT FROM 'array'
         AND jsonb_typeof(identifiers -> 'other') IS NOT DISTINCT FROM 'array'),
	CONSTRAINT "subject_request_subject_check" CHECK (person_id IS NOT NULL OR jsonb_array_length(identifiers -> 'emails') + jsonb_array_length(identifiers -> 'names') + jsonb_array_length(identifiers -> 'other') > 0),
	CONSTRAINT "subject_request_clock_check" CHECK (clock_started_at >= received_at
         AND due_at > clock_started_at
         AND (extended_to IS NULL OR extended_to > due_at)),
	CONSTRAINT "subject_request_answer_check" CHECK ((answered_at IS NULL) = (answer IS NULL))
);
--> statement-breakpoint
ALTER TABLE "subject_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subject_request" ADD CONSTRAINT "subject_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_request" ADD CONSTRAINT "subject_request_person_id_user_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "subject_request_workspace_isolation" ON "subject_request" AS PERMISSIVE FOR ALL TO public USING ("subject_request"."workspace_id" = (select current_workspace_id())) WITH CHECK ("subject_request"."workspace_id" = (select current_workspace_id()));