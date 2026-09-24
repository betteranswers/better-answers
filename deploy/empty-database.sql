SET client_min_messages = warning;

-- Every schema, not only those a dump names, so nothing made after the dump outlives a restore.
DO $empty$
DECLARE
  held name;
BEGIN
  FOR held IN
    SELECT nspname FROM pg_catalog.pg_namespace
     WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', held);
  END LOOP;
END $empty$;

-- As a new database has it: a dump carries no CREATE for public, only how its grants differ.
CREATE SCHEMA public AUTHORIZATION pg_database_owner;
GRANT USAGE ON SCHEMA public TO PUBLIC;
COMMENT ON SCHEMA public IS 'standard public schema';
