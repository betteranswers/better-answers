import { CONCEPT_REFUSALS } from "../concepts/index.ts";
import { ERASURE_REFUSALS } from "../erasure/index.ts";
import { KERNEL_REFUSALS, type Catalogue } from "../kernel/index.ts";
import { MEMBER_REFUSALS } from "../members/index.ts";
import { RUN_REFUSALS } from "../runs/index.ts";
import { SOURCE_REFUSALS } from "../sources/index.ts";
import { WORKSPACE_REFUSALS } from "../workspaces/index.ts";

/**
 * Every refusal word core answers. No other list holds one: a transport reads this and adds only
 * its own.
 */
export const REFUSAL_CATALOGUE = {
  kernel: KERNEL_REFUSALS,
  sources: SOURCE_REFUSALS,
  members: MEMBER_REFUSALS,
  workspaces: WORKSPACE_REFUSALS,
  erasure: ERASURE_REFUSALS,
  concepts: CONCEPT_REFUSALS,
  runs: RUN_REFUSALS,
} as const satisfies Catalogue;
