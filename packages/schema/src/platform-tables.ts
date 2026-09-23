import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The key can only be true, so a second stamp rewrites the row and a reader needs no ordering.
export const contractStamp = pgTable(
  "contract_stamp",
  {
    onlyRow: boolean("only_row").primaryKey().default(true),
    digest: text("digest").notNull(),
    stampedAt: timestamp("stamped_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  () => [check("contract_stamp_only_row_check", sql`only_row`)],
);

export const STAMP_THE_CONTRACT =
  "INSERT INTO contract_stamp (only_row, digest, stamped_at) VALUES (true, $1, now())" +
  " ON CONFLICT (only_row) DO UPDATE SET digest = excluded.digest," +
  " stamped_at = excluded.stamped_at";
