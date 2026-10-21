import { sql } from "drizzle-orm";
import { bigint, boolean, check, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { listed, stamp } from "./column-helpers.ts";

export const contractStamp = pgTable(
  "contract_stamp",
  {
    onlyRow: boolean("only_row").primaryKey().default(true),
    digest: text("digest").notNull(),
    stampedAt: stamp("stamped_at").notNull().defaultNow(),
  },
  () => [check("contract_stamp_only_row_check", sql`only_row`)],
);

export const STAMP_THE_CONTRACT =
  "INSERT INTO contract_stamp (only_row, digest, stamped_at) VALUES (true, $1, now())" +
  " ON CONFLICT (only_row) DO UPDATE SET digest = excluded.digest," +
  " stamped_at = excluded.stamped_at";

export const UPLOAD_SWEEP_MODES = ["list", "remove"] as const;

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

export const BACKUP_KINDS = ["backup", "drill", "restore"] as const;
export const BACKUP_STORES = ["postgres", "objectstore", "git", "git-mirror", "all"] as const;
export const BACKUP_OUTCOMES = ["ok", "failed"] as const;

export const backup = pgTable(
  "backup",
  {
    kind: text("kind").notNull(),
    store: text("store").notNull(),
    startedAt: stamp("started_at").notNull(),
    finishedAt: stamp("finished_at").notNull(),
    outcome: text("outcome").notNull(),
    bytes: bigint("bytes", { mode: "number" }),
    location: text("location"),
    reportUrl: text("report_url"),
    containsPersonalData: boolean("contains_personal_data").notNull(),
    expiresAt: stamp("expires_at"),
    rtoMinutes: integer("rto_minutes"),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.store, table.startedAt] }),
    check("backup_kind_check", sql.raw(`kind IN (${listed(BACKUP_KINDS)})`)),
    check("backup_store_check", sql.raw(`store IN (${listed(BACKUP_STORES)})`)),
    check("backup_outcome_check", sql.raw(`outcome IN (${listed(BACKUP_OUTCOMES)})`)),
    check(
      "backup_span_check",
      sql`finished_at >= started_at AND (bytes IS NULL OR bytes >= 0)
          AND (rto_minutes IS NULL OR rto_minutes >= 0)`,
    ),
    check(
      "backup_shape_check",
      sql`(kind = 'backup' AND store <> 'all' AND report_url IS NULL AND rto_minutes IS NULL)
          OR (kind = 'drill' AND store = 'all' AND bytes IS NULL AND expires_at IS NULL
              AND report_url IS NOT NULL AND rto_minutes IS NOT NULL AND NOT contains_personal_data)
          OR (kind = 'restore' AND store IN ('postgres', 'objectstore', 'git') AND bytes IS NULL
              AND expires_at IS NULL AND report_url IS NULL AND rto_minutes IS NOT NULL
              AND NOT contains_personal_data)`,
    ),
    check(
      "backup_recorded_copy_check",
      sql`(outcome = 'ok') = (location IS NOT NULL)
          AND (outcome = 'ok' OR (bytes IS NULL AND expires_at IS NULL))`,
    ),
  ],
);
