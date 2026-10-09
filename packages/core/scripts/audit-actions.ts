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

type DetailKeysOf = Readonly<Record<string, readonly string[]>>;

/** A slice declares its actions as its module loads, so every entry point is loaded first. */
export const declaredDetailKeys = async (): Promise<DetailKeysOf> => {
  await loadEveryEntryPoint();
  return Object.fromEntries(
    declarations().flatMap((declaration) => Object.entries(declaration.detailKeysOf)),
  );
};

const HEADLINE_OF: ReadonlyMap<string, string> = new Map(Object.entries(ACTION_HEADLINES));

/** Core's headline is the only copy, so an action without one stops the generator. */
const headlineOf = (name: string): string => {
  const headline = HEADLINE_OF.get(name);
  if (headline === undefined) throw new Error(`${name} has no headline in ACTION_HEADLINES`);
  return headline;
};

/** One line per action and key, which the formatter never rewraps however many keys an action has. */
const detailKeyLines = (detailKeysOf: DetailKeysOf, sorted: readonly string[]): string[] =>
  sorted.flatMap((name) =>
    (detailKeysOf[name] ?? [])
      .toSorted(byCodeUnit)
      .map((key) => `  [${JSON.stringify(name)}, ${JSON.stringify(key)}],`),
  );

export const renderAuditActions = (detailKeysOf: DetailKeysOf): string => {
  const sorted = Object.keys(detailKeysOf).toSorted(byCodeUnit);
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
    "export const DETAIL_KEYS = [",
    ...detailKeyLines(detailKeysOf, sorted),
    "] as const satisfies readonly (readonly [(typeof DECLARED_ACTIONS)[number], string])[];",
    "",
  ].join("\n");
};
