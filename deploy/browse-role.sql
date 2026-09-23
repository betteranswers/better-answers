BEGIN;

DO $$ BEGIN
  CREATE ROLE browse_ro LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Every tenant table forces row-level security, so without the bypass this role reads no tenant row.
ALTER ROLE browse_ro WITH LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE browse_ro SET default_transaction_read_only = on;

GRANT USAGE ON SCHEMA public, "index" TO browse_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public, "index" TO browse_ro;
-- The chunk view classes each row through it, and a view that refuses its reader is a dead end.
GRANT EXECUTE ON FUNCTION public.narrower_class(text, text) TO browse_ro;

-- A login that reads a live token, code or key can act as its holder, which no read-only login may.
DO $$
DECLARE
  held record;
BEGIN
  FOR held IN
    SELECT w.relation, string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) AS readable
      FROM (VALUES
              ('public.session', ARRAY['token']),
              ('public.account', ARRAY['access_token', 'refresh_token', 'id_token', 'password']),
              ('public.verification', ARRAY['value']),
              ('public.jwks', ARRAY['private_key']),
              ('public.oauth_client', ARRAY['client_secret']),
              ('public.oauth_access_token', ARRAY['token']),
              ('public.oauth_refresh_token', ARRAY['token', 'rotation_replay_response'])
           ) AS w(relation, withheld)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = w.relation::regclass
     WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attname <> ALL (w.withheld)
     GROUP BY w.relation
  LOOP
    EXECUTE format('REVOKE SELECT ON %s FROM browse_ro', held.relation);
    EXECUTE format('GRANT SELECT (%s) ON %s TO browse_ro', held.readable, held.relation);
  END LOOP;
END $$;

-- One transaction: run as psql runs it, statement by statement, a failure after the grant-all would leave every credential column readable.
COMMIT;
