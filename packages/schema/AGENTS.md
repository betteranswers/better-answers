# packages/schema

- Create every tenant table `withRLS()`, and ship its zero-rows test: under forced row-level security and the non-owner runtime role, a table without a policy returns no rows. The map tables are tenant tables. Only the identity set is exempt.
- Every privilege a migration installs, default privileges included, lands with a test of the path it must refuse, beside the path it serves: the wrong role, another tenant's scope, and a partition reached directly. A partition child is a table of its own, so assert its denial on the child.
- A definer function guards its arguments against the transaction's scope before any DDL, pins its `search_path`, schema-qualifies every object, and has `EXECUTE` revoked from `PUBLIC` and granted to its one caller.
- The migration that creates `audit_event` or `identity_audit_event` revokes `UPDATE` and `DELETE` from the api's role and grants the worker's role nothing. Test each refusal.
- No LLM-authored SQL runs against a shared store.
