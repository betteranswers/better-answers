import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

import { ACTION_HEADLINES, declarations } from "../src/audit/index.ts";
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

const HEADLINE_OF: ReadonlyMap<string, string> = new Map(Object.entries(ACTION_HEADLINES));

/** Core's headline is the only copy, so an act without one stops the generator. */
const headlineOf = (name: string): string => {
  const headline = HEADLINE_OF.get(name);
  if (headline === undefined) throw new Error(`${name} has no headline in ACTION_HEADLINES`);
  return headline;
};

export const renderAuditActs = (names: readonly string[]): string => {
  const sorted = names.toSorted(byCodeUnit);
  return [
    `// Generated, never edited: ${GENERATE}`,
    "",
    "export const DECLARED_ACTS = [",
    ...sorted.map((name) => `  "${name}",`),
    "] as const;",
    "",
    "export const HEADLINES = {",
    ...sorted.map((name) => `  "${name}": ${JSON.stringify(headlineOf(name))},`),
    "} as const satisfies Readonly<Record<(typeof DECLARED_ACTS)[number], string>>;",
    "",
  ].join("\n");
};
