import type { ErasureLog } from "../src/erasure/index.ts";
import type { ObjectDoor } from "../src/store/objects/index.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

/**
 * The doors every erasure act takes, the clock stopped at `at`. The log drops each line unless
 * one is given.
 */
export const erasureDoorsFor = (
  scenario: Scenario,
  objects: ObjectDoor,
  at: Date,
  log: ErasureLog = { info: () => undefined },
) => ({
  git: scenario.git,
  postgres: scenario.postgres,
  objects,
  clock: { now: () => at },
  log,
});
