import type pg from "pg";

type UsesBefore = {
  readonly workspaceId: string;
  readonly actor: string;
  readonly before: Date;
  readonly iri: string;
  readonly from: number;
  readonly to: number;
};

/** One `copied` use of a concept for each second from `from` to `to` before `before`. */
export const usesOfAConcept = (pool: pg.Pool, uses: UsesBefore): Promise<pg.QueryResult> =>
  pool.query(
    `INSERT INTO usage (workspace_id, id, actor, at, act, iri)
     SELECT $1, lpad(n::text, 26, '0'), $2, $3::timestamptz - n * interval '1 second',
            'copied', $4
       FROM generate_series($5::int, $6::int) AS n`,
    [uses.workspaceId, uses.actor, uses.before.toISOString(), uses.iri, uses.from, uses.to],
  );
