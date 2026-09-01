/**
 * The one module every `drizzle-zod` import goes through (ADR 0028): drizzle-orm v1
 * moves the package to a `drizzle-orm/zod` export condition, and that upgrade should
 * be one edit here. `drizzle-zod` is import-banned everywhere else in the repo.
 */
export { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
