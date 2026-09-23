import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";

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

export const UPLOAD_SWEEP_MODES = ["list", "remove"] as const;

// One row per pass over every workspace, so it names none: counts only, never a key.
export const sweepPass = pgTable(
  "sweep_pass",
  {
    id: text("id").primaryKey(),
    at: stamp("at").notNull().defaultNow(),
    uploadSweep: text("upload_sweep").notNull(),
    workspaces: integer("workspaces").notNull(),
    refused: integer("refused").notNull(),
    found: integer("found").notNull(),
    removed: integer("removed").notNull(),
    generations: integer("generations").notNull(),
  },
  () => [
    check(
      "sweep_pass_upload_sweep_check",
      sql.raw(`upload_sweep IN (${listed(UPLOAD_SWEEP_MODES)})`),
    ),
    check(
      "sweep_pass_counts_check",
      sql`refused BETWEEN 0 AND workspaces AND removed BETWEEN 0 AND found AND generations >= 0
          AND (upload_sweep = 'remove' OR removed = 0)`,
    ),
  ],
);
