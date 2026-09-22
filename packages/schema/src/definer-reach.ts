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
    reaches: ["index.chunk"],
    reason:
      "Past the caller's grants. `app_rt` holds USAGE on `index` and no CREATE, so making a partition of the chunk table is a thing it can do through this function and in no other way; the function revokes both runtime roles on the partition it makes, which is why a statement reaches a tenant's rows through the policied parent and never through the child.",
  },
  {
    fn: "public.submit_suggestion_set",
    args: "p_set_id text, p_kind text, p_proposer text, p_requests jsonb",
    reaches: ["public.concept_write_request", "public.suggestion"],
    reason:
      "Past both callers' grants. ALL is revoked on `concept_write_request` for `app_rt` and `worker_rt` alike and on `suggestion` for `worker_rt`, so the surface shows the worker holding nothing on either table while its whole write path into the inbox runs through this one function, which guards the set's size, its kinds against the calling role and the request count before writing a row.",
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
] as const satisfies readonly DefinerReach[];
