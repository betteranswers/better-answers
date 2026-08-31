/**
 * The Postgres door: the handle, the transaction helper, and the RLS session setter.
 *
 * `SET LOCAL app.workspace_id` from the `Principal` on every transaction. RLS with
 * `FORCE ROW LEVEL SECURITY`, the non-owner `app_rt` role and default-deny
 * (`pgTable.withRLS()`) is the tenancy **guarantee**; this door is ergonomics over it
 * (ADR 0029). Drizzle exposes no query lifecycle hook, so there is no interception
 * pattern to port — the guarantee lives in the database.
 */
export {};
