# packages/schema

- Create every tenant table `withRLS()`, and ship its zero-rows test: under forced row-level security and the non-owner runtime role, a table without a policy returns no rows. The map tables are tenant tables. The identity set is exempt.
- A definer function guards its arguments against the transaction's scope before any DDL, pins its `search_path`, schema-qualifies every object, and has `EXECUTE` revoked from `PUBLIC` and granted only to the runtime roles that call it. Usually that is one role. Each tier runs as its own role, so a definer that both tiers call, such as `submit_suggestion_set` or `analyse_map`, is granted to `app_rt` and `worker_rt`, and its entry in `src/definer-reach.ts` names each caller.
