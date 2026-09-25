/**
 * pg_dump carries no mark on a pg_catalog function, so a restore drops it: migrate runs this on
 * every invocation, never once from the journal.
 */
export const MARK_THE_MATCH_LEAKPROOF =
  "ALTER FUNCTION pg_catalog.ts_match_vq(tsvector, tsquery) LEAKPROOF";
