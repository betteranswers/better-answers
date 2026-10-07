import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { ACTION_HEADLINES, declarations } from "../src/audit/index.ts";
import { loadEveryEntryPoint } from "../test/entry-points.ts";

/** The web never imports core, so it reads the actions core declares from this copy. */
export const AUDIT_ACTIONS_MODULE = path.resolve(
  import.meta.dirname,
  "../../../apps/web/src/features/people/audit-actions.ts",
);

const GENERATE = "pnpm --filter @better-answers/core run generate:audit-actions";

/** A slice declares its actions as its module loads, so every entry point is loaded first. */
export const declaredActionNames = async (): Promise<readonly string[]> => {
  await loadEveryEntryPoint();
  return declarations().flatMap((declaration) => declaration.actions);
};

const HEADLINE_OF: ReadonlyMap<string, string> = new Map(Object.entries(ACTION_HEADLINES));

/** Core's headline is the only copy, so an action without one stops the generator. */
const headlineOf = (name: string): string => {
  const headline = HEADLINE_OF.get(name);
  if (headline === undefined) throw new Error(`${name} has no headline in ACTION_HEADLINES`);
  return headline;
};

export const renderAuditActions = (names: readonly string[]): string => {
  const sorted = names.toSorted(byCodeUnit);
  return [
    `// Generated, never edited: ${GENERATE}`,
    "",
    "export const DECLARED_ACTIONS = [",
    ...sorted.map((name) => `  "${name}",`),
    "] as const;",
    "",
    "export const HEADLINES = {",
    ...sorted.map((name) => `  "${name}": ${JSON.stringify(headlineOf(name))},`),
    "} as const satisfies Readonly<Record<(typeof DECLARED_ACTIONS)[number], string>>;",
    "",
  ].join("\n");
};
