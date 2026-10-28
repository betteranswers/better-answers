import type pg from "pg";

export type PostgresDoor = {
  readonly pool: pg.Pool;
};

export const openPostgres = (pool: pg.Pool): PostgresDoor => ({ pool });

export type Tx = Pick<pg.PoolClient, "query">;

export type TxRow = pg.QueryResultRow;

/**
 * Those of `names` that `information_schema.tables` lists in `public`, in no set order: a view
 * counts, a table the role holds no privilege on does not.
 */
export const tablesPresent = async (
  door: PostgresDoor,
  names: readonly string[],
): Promise<readonly string[]> => {
  const result = await door.pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [names],
  );
  return result.rows.map((row) => row.table_name);
};
