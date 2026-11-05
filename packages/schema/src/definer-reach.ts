export type DefinerReach = {
  readonly fn: string;

  readonly args: string;

  readonly reaches: readonly string[];

  readonly reason: string;
};

export const identityOf = (fn: { readonly fn: string; readonly args: string }): string =>
  `${fn.fn}(${fn.args})`;

export const DEFINER_REACH_NOTE =
  "A SECURITY DEFINER function reaches tables beyond its caller's grants, and only the function's body says which tables, so a reviewer reads the body in the diff. packages/schema/src/definer-reach.ts lists every SECURITY DEFINER function, and a test fails unless the catalogue's SECURITY DEFINER functions are exactly the ones listed there, so a new definer function cannot arrive unnoticed.";

export const SECURITY_DEFINER_REACH = [
  {
    fn: "public.create_workspace_partition",
    args: "p_workspace_id text",
    reaches: ["index.passage"],
    reason:
      "`app_rt` may create a workspace's partition of `index.passage` through this function because it holds USAGE on `index` and no CREATE, so the function is its only way to make one. The function revokes both runtime roles on the new partition, so a statement reaches a tenant's rows only through the parent table, which has the row-level policy, and never through the partition.",
  },
  {
    fn: "public.create_question_content_partition",
    args: "p_month date",
    reaches: ["public.question_content"],
    reason:
      "`app_rt` may create a month's partition of `public.question_content` through this function because it holds no CREATE on `public`, so the function is its only way to make one. A month's partition holds every tenant's rows, each reached through the parent table's policy, so the function takes no workspace. With no scope to check its argument against, it refuses any month except the four around the database's own clock, so a caller cannot create partitions without limit. It forces row-level security on the new partition and revokes both runtime roles on it, and a second call for the same month creates nothing.",
  },
  {
    fn: "public.submit_suggestion_set",
    args: "p_set_id text, p_kind text, p_proposer text, p_requests jsonb",
    reaches: ["public.concept_write_request", "public.suggestion"],
    reason:
      "`app_rt` and `worker_rt` may write suggestions through this function because ALL is revoked on `concept_write_request` for both roles and on `suggestion` for `worker_rt`, so the function is the worker's only way to write suggestions. The roles surface therefore shows the worker with no privilege on either table. Before it writes a row, the function checks the set's size, checks each kind against the calling role, and checks the request count.",
  },
  {
    fn: "public.suggestion_set_summary",
    args: "p_set_id text",
    reaches: ["public.suggestion"],
    reason:
      "`app_rt` may read `suggestion` through this function because it already holds SELECT on that table, so the function gives it no extra access. The function is SECURITY DEFINER only to match `submit_suggestion_set`.",
  },
  {
    fn: "public.concept_write_request_for",
    args: "p_suggestion_id text",
    reaches: ["public.concept_write_request"],
    reason:
      "`app_rt` may read a proposed concept's body from `concept_write_request` through this function because its ALL on the table is revoked and accepting a suggestion needs the body. The function reads only within the transaction's own workspace.",
  },
  {
    fn: "public.concept_write_requests_naming",
    args: "p_people text[], p_addresses text[]",
    reaches: ["public.concept_write_request"],
    reason:
      "`app_rt` may find which write requests name a person through this function because its ALL on `concept_write_request` is revoked and the erasure map needs that answer. The function returns suggestion ids only, never a request's text, and only in the transaction's own workspace. It refuses a person that is not a person id and an address that is not an email address, so a caller cannot use it to test whether a request's text contains a word of its choosing.",
  },
  {
    fn: "public.erase_from_the_suggestions",
    args: "p_workspace_id text, p_people text[], p_pseudonym text",
    reaches: ["public.suggestion"],
    reason:
      "`app_rt` may rewrite who proposed and who decided a suggestion through this function because `suggestion_decides_once` refuses any update to a decided suggestion, and any change of proposer, from everyone except the table's owner, and the function runs as that owner. The function refuses a workspace other than the transaction's, a person that is not a person id, and a pseudonym that no `erasure_request` in the workspace carries. Within those limits it rewrites the proposer and the decider to `human:<pseudonym>` and the decider's reason to a fixed sentence, and the trigger refuses any other change. `app_rt` can write `erasure_request` and chooses the person ids, so these checks limit the shape of the rewrite and tie its pseudonym to a recorded erasure. They do not prove that the people are that erasure's subject.",
  },
  {
    fn: "public.erase_from_the_write_requests",
    args: "p_workspace_id text, p_people text[], p_addresses text[], p_pseudonym text",
    reaches: ["public.concept_write_request", "public.suggestion"],
    reason:
      "`app_rt` may rewrite the people named in `concept_write_request` and the matching `suggestion` rows through this function because it holds no privilege on `concept_write_request`. The function has the checks of `erase_from_the_suggestions` and also refuses an address that is not an email address. It rewrites only `human:<person id>` and `human:<address>`, each ending at an address boundary, to `human:<pseudonym>`. If the rewrite would push a body past its CHECK limit, the function replaces the body with a fixed sentence and returns the waiting suggestion it belongs to through the decision path. As with `erase_from_the_suggestions`, the checks do not prove that the people and addresses are the erasure's subject.",
  },
  {
    fn: "public.pseudonymise_record_actors",
    args: "p_workspace_id text, p_table text, p_people text[], p_pseudonym text",
    reaches: ["public.write_up_version", "public.guide_definition_version"],
    reason:
      "`app_rt` may rewrite who saved a `write_up_version` or `guide_definition_version` row through this function because it holds no UPDATE on either version table, since a saved version is never rewritten. The function has the checks of `erase_from_the_suggestions`: it refuses a workspace other than the transaction's, a person that is not a person id, and a pseudonym that no `erasure_request` in the workspace carries. It also refuses any table except those two, names each table in static SQL, and changes only `actor` from `human:<person id>` to `human:<pseudonym>`, so the version's text stays as saved. The checks do not prove that the people are that erasure's subject.",
  },
  {
    fn: "public.analyse_map",
    args: "",
    reaches: ["public.map_node", "public.map_edge"],
    reason:
      "`worker_rt` and `app_rt` may run ANALYZE on `map_node` and `map_edge` through this function because ANALYZE needs the table's owner or the MAINTAIN privilege, and neither runtime role has either. The worker calls it after a map rebuild and the api calls it after an import, so the planner has fresh statistics after a bulk write. MAINTAIN was not granted because it would also let the roles run VACUUM, REINDEX, and LOCK TABLE on the map. The statistics cover every tenant's rows at once, so no workspace scope applies. Row writes never block the function, and it waits at most five seconds for another analyse to commit, for an autovacuum of either table, or for an exclusive lock that a migration has queued. Each caller runs it after its own write commits and logs a failure, so a failed analyse never undoes the write.",
  },
] as const satisfies readonly DefinerReach[];
