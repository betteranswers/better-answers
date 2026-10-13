import type pg from "pg";

/** A day of the UTC month `monthsOn` after this one, at midnight; its first day unless told. */
export const inTheMonth = (monthsOn: number, day = 1): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsOn, day));
};

export const contentPartitionOf = (month: Date): string =>
  `question_content_${String(month.getUTCFullYear())}_${String(month.getUTCMonth() + 1).padStart(2, "0")}`;

/** Each month's partition of the questions' content, in month order, with its catalogue flags. */
export const contentPartitions = async (client: Pick<pg.PoolClient, "query">) => {
  const found = await client.query<{ name: string; rls: boolean; forced: boolean }>(
    `SELECT child.relname AS name, child.relrowsecurity AS rls, child.relforcerowsecurity AS forced
       FROM pg_inherits i
       JOIN pg_class child ON child.oid = i.inhrelid
      WHERE i.inhparent = 'public.question_content'::regclass
      ORDER BY child.relname`,
  );
  return found.rows;
};
