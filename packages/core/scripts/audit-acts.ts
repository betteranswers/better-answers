import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { declarations } from "../src/audit/index.ts";
import { loadEveryEntryPoint } from "../test/entry-points.ts";

/** The web never imports core, so it reads the acts core declares from this copy. */
export const AUDIT_ACTS_MODULE = path.resolve(
  import.meta.dirname,
  "../../../apps/web/src/features/people/audit-acts.ts",
);

const GENERATE = "pnpm --filter @better-answers/core run generate:audit-acts";

/** A slice declares its acts as its module loads, so every entry point is loaded first. */
export const declaredActNames = async (): Promise<readonly string[]> => {
  await loadEveryEntryPoint();
  return declarations().flatMap((declaration) => declaration.acts);
};

export const renderAuditActs = (names: readonly string[]): string =>
  [
    `// Generated, never edited: ${GENERATE}`,
    "",
    "export const DECLARED_ACTS = [",
    ...names.toSorted(byCodeUnit).map((name) => `  "${name}",`),
    "] as const;",
    "",
  ].join("\n");
