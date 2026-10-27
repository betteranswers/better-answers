import { z } from "zod";

const records = z.array(z.record(z.string(), z.unknown()));

/** `pg` types a result's rows `any`; parsing keeps every selected column and drops the `any`. */
export const rowsFrom = (result: { readonly rows: unknown }) => records.parse(result.rows);
