import { pgTable, text } from "drizzle-orm/pg-core";

import { stamp } from "./column-helpers.ts";

export const workspace = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: stamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
});
