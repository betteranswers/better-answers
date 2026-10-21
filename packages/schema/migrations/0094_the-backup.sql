CREATE TABLE "backup" (
	"kind" text NOT NULL,
	"store" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"bytes" bigint,
	"location" text,
	"report_url" text,
	"contains_personal_data" boolean NOT NULL,
	"expires_at" timestamp with time zone,
	"rto_minutes" integer,
	CONSTRAINT "backup_kind_store_started_at_pk" PRIMARY KEY("kind","store","started_at"),
	CONSTRAINT "backup_kind_check" CHECK (kind IN ('backup', 'drill', 'restore')),
	CONSTRAINT "backup_store_check" CHECK (store IN ('postgres', 'objectstore', 'git', 'git-mirror', 'all')),
	CONSTRAINT "backup_outcome_check" CHECK (outcome IN ('ok', 'failed')),
	CONSTRAINT "backup_span_check" CHECK (finished_at >= started_at AND (bytes IS NULL OR bytes >= 0)
          AND (rto_minutes IS NULL OR rto_minutes >= 0)),
	CONSTRAINT "backup_shape_check" CHECK ((kind = 'backup' AND store <> 'all' AND report_url IS NULL AND rto_minutes IS NULL)
          OR (kind = 'drill' AND store = 'all' AND bytes IS NULL AND expires_at IS NULL
              AND report_url IS NOT NULL AND rto_minutes IS NOT NULL AND NOT contains_personal_data)
          OR (kind = 'restore' AND store IN ('postgres', 'objectstore', 'git') AND bytes IS NULL
              AND expires_at IS NULL AND report_url IS NULL AND rto_minutes IS NOT NULL
              AND NOT contains_personal_data)),
	CONSTRAINT "backup_recorded_copy_check" CHECK ((outcome = 'ok') = (location IS NOT NULL)
          AND (outcome = 'ok' OR (bytes IS NULL AND expires_at IS NULL)))
);--> statement-breakpoint
REVOKE ALL ON "backup" FROM app_rt;
