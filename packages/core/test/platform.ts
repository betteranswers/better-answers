import { testData } from "@better-answers/schema/testing";
import type pg from "pg";

import type { PlatformPrincipal } from "../src/kernel/index.ts";

/**
 * The platform principal T-005's bootstrap provisions under, and the one person a
 * provisioning needs first — shared by every core suite that provisions a workspace,
 * so the actor the ledger names for it is one fact across the suites and not a copy
 * in each.
 */
export const bootstrap: PlatformPrincipal = {
  kind: "platform",
  actorId: "process:better-answers-bootstrap",
};

/** A person on the identity set, seeded as the superuser through the factory; their id. */
export const seedPerson = async (pool: pg.Pool): Promise<string> => {
  const client = await pool.connect();
  try {
    return (await testData(client).user()).id;
  } finally {
    client.release();
  }
};
