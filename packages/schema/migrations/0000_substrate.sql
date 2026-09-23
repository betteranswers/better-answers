-- Custom migration (hand-written SQL; ADR 0032).

DO $$ BEGIN
  CREATE ROLE app_rt NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE ROLE worker_rt NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE SCHEMA "index";--> statement-breakpoint
-- A missing scope is an empty GUC: nullif() turns '' into NULL, and NULL matches no row's
-- tenant column — zero rows, never an error.
CREATE FUNCTION current_workspace_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(current_setting('app.workspace_id', true), '') $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_rt, worker_rt;--> statement-breakpoint
GRANT USAGE ON SCHEMA "index" TO app_rt, worker_rt;--> statement-breakpoint
-- Migrations run as the owner, so default privileges cover every table they create
-- later in the journal; the runtime roles never own an object.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rt, worker_rt;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "index" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rt, worker_rt;
