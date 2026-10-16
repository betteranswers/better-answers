import type { ErasureDoors, ErasureLog } from "../src/erasure/index.ts";
import type { ObjectDoor } from "../src/store/objects/index.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

export const erasureDoorsFor = (
  scenario: Scenario,
  objects: ObjectDoor,
  at: Date,
  log: ErasureLog = { info: () => undefined },
): ErasureDoors => ({
  git: scenario.git,
  postgres: scenario.postgres,
  objects,
  clock: { now: () => at },
  log,
});
