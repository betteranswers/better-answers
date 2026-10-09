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

export type Planned<T> = { readonly answer: Answered<T>; readonly indexes: readonly string[] };

/** Runs `work` as `person` under the api's role, and names every index its statements' plans used. */
export const planned = async <T>(
  db: MigratedPostgres,
  person: UserPrincipal,
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
    return { answer, indexes };
  } finally {
    await pool.end();
  }
};
