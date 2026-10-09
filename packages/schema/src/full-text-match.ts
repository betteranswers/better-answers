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

type Placeholder = `$${number}`;

export const MATCH_STRENGTHS = ["strong", "weak"] as const;
export type MatchStrength = (typeof MATCH_STRENGTHS)[number];

/** Where a page of matches ended: the row's distinct query words held, its rank, then its key. */
export type MatchBound<Key> = {
  readonly matched: number;
  readonly rank: number;
  readonly key: Key;
};

export type AnyWordMatch = {
  readonly joins: string;
  readonly matches: string;
  readonly columns: string;
  readonly strength: (strength: MatchStrength) => string;
  readonly after: (bound: {
    readonly matched: Placeholder;
    readonly rank: Placeholder;
    readonly key: readonly Placeholder[];
  }) => string;
  readonly order: string;
};

/**
 * Matches a row holding any of the text's words, ranked by how many distinct ones it holds, then by
 * cover density, then by `keys`. The words are Postgres's own parse, quoted by its own output, so
 * nothing typed is read as query syntax.
 */
export const anyWordMatch = (
  vector: string,
  text: Placeholder,
  keys: readonly string[],
): AnyWordMatch => ({
  joins: `CROSS JOIN LATERAL (
            SELECT parsed.lexemes,
                   (SELECT string_agg(array_to_tsvector(ARRAY[lexeme])::text, ' | ')
                      FROM unnest(parsed.lexemes) AS lexeme)::tsquery AS query
              FROM (SELECT tsvector_to_array(to_tsvector(${FULL_TEXT_LANGUAGE}, ${text})) AS lexemes) AS parsed
          ) AS asked
          CROSS JOIN LATERAL (
            SELECT length(${vector}) - length(ts_delete(${vector}, asked.lexemes)) AS matched,
                   ts_rank_cd(${vector}, asked.query)::double precision AS rank
          ) AS ranked`,
  matches: `${vector} @@ asked.query`,
  columns: "ranked.matched, ranked.rank",
  strength: (strength) =>
    `2 * ranked.matched ${strength === "strong" ? ">=" : "<"} cardinality(asked.lexemes)`,
  after: ({ matched, rank, key }) =>
    `(-ranked.matched, -ranked.rank, ${keys.join(", ")}) > (-${matched}::bigint, -${rank}::double precision, ${key.join(", ")})`,
  order: `ranked.matched DESC, ranked.rank DESC, ${keys.join(", ")}`,
});

/**
 * pg_dump carries no mark on a pg_catalog function, so a restore drops it: migrate runs this on
 * every invocation, never once from the journal.
 */
export const MARK_THE_MATCH_LEAKPROOF =
  "ALTER FUNCTION pg_catalog.ts_match_vq(tsvector, tsquery) LEAKPROOF";
