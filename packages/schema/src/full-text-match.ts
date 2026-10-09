import { customType } from "drizzle-orm/pg-core";

/**
 * A query under one configuration matches nothing stored under another. A generated column takes it
 * through `sql.raw`: the `sql` tag binds strings.
 */
export const FULL_TEXT_LANGUAGE = "'english'";

/** Drizzle has no `tsvector` type of its own. */
export const searchVector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

/** Takes words, quoted phrases and `-` as a reader types them, and never raises on prose. */
export const fullTextQuery = (placeholder: string): string =>
  `websearch_to_tsquery(${FULL_TEXT_LANGUAGE}, ${placeholder})`;

/**
 * pg_dump carries no mark on a pg_catalog function, so a restore drops it: migrate runs this on
 * every invocation, never once from the journal.
 */
export const MARK_THE_MATCH_LEAKPROOF =
  "ALTER FUNCTION pg_catalog.ts_match_vq(tsvector, tsquery) LEAKPROOF";
