import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The tenant itself — and Better Auth's organisation model, mapped onto it
 * (`schema.organization.modelName: "workspace"`, ADR 0009's 2026-09-01 amendment).
 *
 * Not `withRLS()`, on purpose: the pre-consent workspace picker must read a workspace's
 * name before any scope exists, so the table holding that name cannot sit under
 * `current_workspace_id()`. It is the last member of the identity set — read by key
 * (a membership's workspace id), never listed across tenants by the platform — and the
 * tenant guarantee (ADR 0032) begins at the first row a resolved principal reaches.
 * Named in `IDENTITY_SET` (`identity-tables.ts`), the coverage test's exemption list.
 *
 * `slug`, `logo` and `metadata` are the organisation model's columns; the platform
 * reads `name` and `id`.
 */
export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  metadata: text("metadata"),
});
