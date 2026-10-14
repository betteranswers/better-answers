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

/** Where a page of matches ended: the row's weight, its rank, then its key. */
export type MatchBound<Key> = {
  readonly weight: number;
  readonly rank: number;
  readonly key: Key;
};

export type AnyWordMatch = {
  readonly joins: string;
  readonly matches: string;
  readonly columns: string;
  readonly strength: (strength: MatchStrength) => string;
  readonly after: (bound: {
    readonly weight: Placeholder;
    readonly rank: Placeholder;
    readonly key: readonly Placeholder[];
  }) => string;
  readonly order: string;
};

/** BM25's saturation: past it, more of one word adds little. */
const SATURATION = 1.2;

/** What one place of a word counts for, by its weight class: `ts_rank`'s own defaults. */
const PLACE_COUNTS =
  "CASE place WHEN 'A' THEN 1.0 WHEN 'B' THEN 0.4 WHEN 'C' THEN 0.2 ELSE 0.1 END";

/** How many rows a reader may read, and how many of them hold each of the query's words. */
export type CorpusCounts = { readonly size: number; readonly frequencies: readonly number[] };

/** In `anyWordMatch`'s order. Quoted by Postgres's own output, so nothing typed is query syntax. */
export const QUERY_WORDS = `SELECT array_to_tsvector(ARRAY[parsed.lexeme])::text AS word
    FROM unnest(tsvector_to_array(to_tsvector(${FULL_TEXT_LANGUAGE}, $1))) WITH ORDINALITY AS parsed(lexeme, at)
   ORDER BY parsed.at`;

/**
 * One pass over `documents`, a `SELECT` of the `search` column of the rows the reader may read, so a
 * weight tells nothing of a row they may not. The words bind from `$first` on, as `QUERY_WORDS`
 * gives them.
 */
export const corpusCounts = (documents: string, words: number, first: number): string =>
  `SELECT count(*)::integer AS size,
          ARRAY[${Array.from(
            { length: words },
            (_, at) =>
              `count(*) FILTER (WHERE document.search @@ $${first + at}::tsquery)::integer`,
          ).join(", ")}]::integer[] AS frequencies
     FROM (${documents}) AS document`;

/**
 * BM25F with no length normalisation, which lost recall. The rarities come from `counts`, bound as a
 * `CorpusCounts`, so a cursor can hold them fixed while the corpus changes under it.
 */
export const anyWordMatch = (
  vector: string,
  text: Placeholder,
  keys: readonly string[],
  counts: { readonly size: Placeholder; readonly frequencies: Placeholder },
): AnyWordMatch => ({
  joins: `CROSS JOIN LATERAL (
            SELECT parsed.lexemes,
                   (SELECT string_agg(array_to_tsvector(ARRAY[lexeme])::text, ' | ')
                      FROM unnest(parsed.lexemes) AS lexeme)::tsquery AS query,
                   (SELECT array_agg(ln(1 + (${counts.size}::double precision - counted.held + 0.5)
                                           / (counted.held + 0.5)) ORDER BY counted.at)
                      FROM unnest(${counts.frequencies}::double precision[]) WITH ORDINALITY
                           AS counted(held, at)) AS rarities
              FROM (SELECT tsvector_to_array(to_tsvector(${FULL_TEXT_LANGUAGE}, ${text})) AS lexemes) AS parsed
          ) AS asked
          CROSS JOIN LATERAL (
            SELECT length(${vector}) - length(ts_delete(${vector}, asked.lexemes)) AS matched,
                   (SELECT coalesce(sum(word.rarity * counted.often * ${SATURATION + 1}
                                        / (${SATURATION} + counted.often) ORDER BY word.lexeme), 0)
                      FROM unnest(asked.lexemes, asked.rarities) AS word(lexeme, rarity)
                      JOIN unnest(${vector}) AS held ON held.lexeme = word.lexeme
                     CROSS JOIN LATERAL (
                       SELECT sum(${PLACE_COUNTS})::double precision AS often
                         FROM unnest(held.weights) AS place
                     ) AS counted) AS weight,
                   ts_rank_cd(${vector}, asked.query)::double precision AS rank
          ) AS ranked`,
  matches: `${vector} @@ asked.query`,
  columns: "ranked.weight, ranked.rank",
  strength: (strength) =>
    `2 * ranked.matched ${strength === "strong" ? ">=" : "<"} cardinality(asked.lexemes)`,
  after: ({ weight, rank, key }) =>
    `(-ranked.weight, -ranked.rank, ${keys.join(", ")}) > (-${weight}::double precision, -${rank}::double precision, ${key.join(", ")})`,
  order: `ranked.weight DESC, ranked.rank DESC, ${keys.join(", ")}`,
});

/**
 * pg_dump carries no mark on a pg_catalog function, so a restore drops it: migrate runs this on
 * every invocation, never once from the journal.
 */
export const MARK_THE_MATCH_LEAKPROOF =
  "ALTER FUNCTION pg_catalog.ts_match_vq(tsvector, tsquery) LEAKPROOF";
