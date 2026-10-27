import pg from "pg";
import { z } from "zod";

import type { MigratedPostgres } from "@better-answers/schema/testing";

import type { UserPrincipal } from "../../src/kernel/index.ts";
import type { Answered, Tx } from "../../src/store/postgres/index.ts";
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

const planNode = z.object({
  "Node Type": z.string(),
  "CTE Name": z.string().optional(),
  Filter: z.string().optional(),
  get Plans() {
    return z.array(planNode).optional();
  },
});

type PlanNode = z.infer<typeof planNode>;

const loggedPlan = z.object({ Plan: planNode });

const nodesOf = (node: PlanNode): readonly PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(nodesOf),
];

/** auto_explain logs `duration: … plan:` and then the plan as one JSON object. */
const nodesIn = (notice: string): readonly PlanNode[] => {
  if (!notice.startsWith("duration:")) return [];
  const logged = loggedPlan.parse(JSON.parse(notice.slice(notice.indexOf("{"))));
  return nodesOf(logged.Plan);
};

export type Planned<T> = {
  readonly answer: Answered<T>;
  readonly indexes: readonly string[];
  readonly nodes: readonly PlanNode[];
};

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
