import pg from "pg";

import type { MigratedPostgres } from "@better-answers/schema/testing";

import type { UserPrincipal } from "../src/kernel/index.ts";
import type { Answered, Tx } from "../src/store/postgres/index.ts";
import { answered, readingAs } from "./suite-postgres.ts";

/**
 * auto_explain plans the statement the call itself ran; at test size a sequential scan beats
 * every index, so it is switched off.
 */
const PLANNED_AS_THE_APP = [
  "-c role=app_rt",
  "-c session_preload_libraries=auto_explain",
  "-c auto_explain.log_min_duration=0",
  "-c auto_explain.log_level=notice",
  "-c auto_explain.log_format=json",
  "-c enable_seqscan=off",
].join(" ");

const INDEX_NAMED = /"Index Name": "(?<index>[^"]+)"/gu;

/** A plan's node as auto_explain's JSON writes it, with the keys a suite reads. */
type PlanNode = {
  readonly "Node Type": string;
  readonly "CTE Name"?: string;
  readonly Filter?: string;
  readonly Plans?: readonly PlanNode[];
};

const nodesOf = (node: PlanNode): readonly PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(nodesOf),
];

/** auto_explain logs `duration: … plan:` and then the plan as one JSON object. */
const nodesIn = (notice: string): readonly PlanNode[] => {
  if (!notice.startsWith("duration:")) return [];
  const logged: { readonly Plan: PlanNode } = JSON.parse(notice.slice(notice.indexOf("{")));
  return nodesOf(logged.Plan);
};

export type Planned<T> = {
  readonly answer: Answered<T>;
  readonly indexes: readonly string[];
  readonly nodes: readonly PlanNode[];
};

/**
 * Runs `work` as `person` under the api's role, and names every index its statements' plans
 * used, with every node of those plans.
 */
export const planned = async <T>(
  db: MigratedPostgres,
  person: { readonly workspaceId: string; readonly userId: string },
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Planned<T>> => {
  const pool = new pg.Pool({ connectionString: db.connectionUri, options: PLANNED_AS_THE_APP });
  const plans: string[] = [];
  pool.on("connect", (client) => {
    client.on("notice", (notice) => {
      plans.push(notice.message ?? "");
    });
  });
  try {
    const answer = answered(await readingAs(pool, person, work));
    const indexes = plans.flatMap((plan) =>
      [...plan.matchAll(INDEX_NAMED)].flatMap((named) => named.groups?.["index"] ?? []),
    );
    return { answer, indexes, nodes: plans.flatMap(nodesIn) };
  } finally {
    await pool.end();
  }
};
