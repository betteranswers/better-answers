export type DefinerReach = {
  readonly fn: string;

  readonly args: string;

  readonly reaches: readonly string[];

  readonly reason: string;
};

export const identityOf = (fn: { readonly fn: string; readonly args: string }): string =>
  `${fn.fn}(${fn.args})`;

export const DEFINER_REACH_NOTE =
  "A security_definer function reaches tables past its caller's grants, and which tables is its body's and is held by nothing: a reviewer reads it where the diff is. What is held is the roster in packages/schema/src/definer-reach.ts — the SECURITY DEFINER set in the catalogue equals the set named there, both ways — so a fifth arrives as a red suite rather than in silence.";

export const SECURITY_DEFINER_REACH = [
  {
    fn: "public.create_workspace_partition",
    args: "p_workspace_id text",
    reaches: ["index.passage"],
    reason:
      "Past the caller's grants. `app_rt` holds USAGE on `index` and no CREATE, so making a partition of the passage table is a thing it can do through this function and in no other way; the function revokes both runtime roles on the partition it makes, which is why a statement reaches a tenant's rows through the policied parent and never through the child.",
  },
  {
    fn: "public.create_question_content_partition",
    args: "p_month date",
    reaches: ["public.question_content"],
    reason:
      "Past the caller's grants. `app_rt` holds no CREATE on `public`, so making a month's partition of a record's content is a thing it can do through this function and in no other way. It takes no workspace: a month's partition holds every tenant's rows, each reached through the policied parent. With no scope to guard its argument against, it refuses any month but the four around the database's own clock, so a caller cannot make partitions without end. The function forces row-level security on the partition it makes and revokes both runtime roles on it, and a second call for a month makes nothing.",
  },
  {
    fn: "public.submit_suggestion_set",
    args: "p_set_id text, p_kind text, p_proposer text, p_requests jsonb",
    reaches: ["public.concept_write_request", "public.suggestion"],
    reason:
      "Past both callers' grants. ALL is revoked on `concept_write_request` for `app_rt` and `worker_rt` alike and on `suggestion` for `worker_rt`, so the surface shows the worker holding nothing on either table while its whole write path into the suggestions runs through this one function, which guards the set's size, its kinds against the calling role and the request count before writing a row.",
  },
  {
    fn: "public.suggestion_set_summary",
    args: "p_set_id text",
    reaches: ["public.suggestion"],
    reason:
      "Not past its caller's grants: `app_rt` holds SELECT on `suggestion` anyway, and the function is a definer for the same reason its sibling is rather than for a reach of its own.",
  },
  {
    fn: "public.concept_write_request_for",
    args: "p_suggestion_id text",
    reaches: ["public.concept_write_request"],
    reason:
      "Past the caller's grants. `app_rt`'s ALL is revoked on the table, so the read the acceptance path makes of a proposed concept's body exists only here, scoped to the transaction's own workspace.",
  },
  {
    fn: "public.concept_write_requests_naming",
    args: "p_people text[], p_addresses text[]",
    reaches: ["public.concept_write_request"],
    reason:
      "Past the caller's grants. `app_rt`'s ALL is revoked on the table, so the erasure map's read of which requests name a person exists only here. It answers suggestion ids alone, never a request's text, and only in the transaction's own workspace. It refuses a person that is not a person id and an address that is not an email address, so a caller cannot use it to test a request's text for a word of its choosing.",
  },
  {
    fn: "public.erase_from_the_suggestions",
    args: "p_workspace_id text, p_people text[], p_pseudonym text",
    reaches: ["public.suggestion"],
    reason:
      "Past the caller's grants. `suggestion_decides_once` refuses any update to a decided suggestion and any change of proposer, except from the table's owner, which this function runs as. It refuses a workspace other than the transaction's, a person that is not a person id, and a pseudonym that no `erasure_request` in the workspace carries. Within those, it rewrites who proposed and decided to `human:<pseudonym>` and the decider's reason to a fixed sentence, and the trigger refuses any other change. `app_rt` can write `erasure_request` and chooses the person ids, so the guards bound the rewrite's shape and tie its pseudonym to a recorded erasure. They do not prove the people are that erasure's subject.",
  },
  {
    fn: "public.erase_from_the_write_requests",
    args: "p_workspace_id text, p_people text[], p_addresses text[], p_pseudonym text",
    reaches: ["public.concept_write_request", "public.suggestion"],
    reason:
      "Past the caller's grants. `app_rt` holds no privilege on `concept_write_request`. The function has the guards of `erase_from_the_suggestions`, and also refuses an address that is not an email address, so it rewrites only `human:<person id>` and `human:<address>`, each ending at an address boundary, to `human:<pseudonym>`. A body the rewrite would push past its CHECK becomes a fixed sentence, and a waiting suggestion it belongs to is returned through the decision path. The same limit holds: the guards do not prove the people and addresses are the erasure's subject.",
  },
  {
    fn: "public.pseudonymise_record_actors",
    args: "p_workspace_id text, p_table text, p_people text[], p_pseudonym text",
    reaches: ["public.write_up_version", "public.guide_definition_version"],
    reason:
      "Past the caller's grants. `app_rt` holds no UPDATE on either version table, because a version is never rewritten, so an erasure's rewrite of who saved one runs through this function and in no other way. It has the guards of `erase_from_the_suggestions`: it refuses a workspace other than the transaction's, a person that is not a person id, and a pseudonym that no `erasure_request` in the workspace carries. It refuses a table other than the two, names each table in static SQL, and rewrites `actor` from `human:<person id>` to `human:<pseudonym>` and nothing else, so a version's text stays as saved. The guards do not prove the people are that erasure's subject.",
  },
  {
    fn: "public.analyse_map",
    args: "",
    reaches: ["public.map_node", "public.map_edge"],
    reason:
      "Past both callers' grants, and two callers because the worker's rebuild runs as `worker_rt` and the api's import as `app_rt`. ANALYZE takes the table's owner or MAINTAIN, which neither runtime role holds, so analysing the map for the planner after a bulk write runs through this function and in no other way. MAINTAIN was not granted instead because it also lets the role VACUUM, REINDEX and LOCK TABLE the map. The statistics it refreshes are the tables', so they cover every tenant's rows at once and no scope guards them. Row writes never block it; it waits, for five seconds at most, on another analyse held to that analyse's commit, on an autovacuum of either table, or on an exclusive lock a migration has queued. Each caller runs it after its write commits and logs a failure, so a failed analyse never undoes the write.",
  },
] as const satisfies readonly DefinerReach[];
