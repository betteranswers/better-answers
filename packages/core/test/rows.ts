import type pg from "pg";
import { z } from "zod";

const records = z.array(z.record(z.string(), z.unknown()));

/** `pg` types a result's rows `any`; parsing keeps every selected column and drops the `any`. */
export const rowsFrom = (result: { readonly rows: unknown }) => records.parse(result.rows);

const counted = z.tuple([z.object({ open: z.number() })]);

export const openReservationsIn = async (pool: pg.Pool, workspaceId: string): Promise<number> => {
  const read = await pool.query(
    "SELECT count(*)::integer AS open FROM spend_reservation WHERE workspace_id = $1",
    [workspaceId],
  );
  const [row] = counted.parse(read.rows);
  return row.open;
};
