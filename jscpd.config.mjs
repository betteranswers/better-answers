/**
 * What jscpd refuses, and everything it is deliberately blind to.
 *
 * This is a JavaScript module and not the `.jscpd.json` the tool reads on its own, for one
 * reason: every exclusion below has to carry why it is there. jscpd 5.1.2 parses its config
 * with a strict JSON parser — a `//` line in `.jscpd.json` is rejected, and worse, the run
 * then continues on the defaults and exits zero, so a config nobody could read looks exactly
 * like a tree with nothing in it. `scripts/jscpd.mjs` turns these values into the command
 * line instead, which the tool cannot half-read.
 *
 * The threshold is zero because a percentage is a dial someone tunes down the day it fires.
 * A copy is either folded into a helper or named — in the config below, or beside the copy
 * itself with jscpd's `jscpd:ignore-start` / `jscpd:ignore-end` comments, which is the better
 * of the two whenever the reason belongs next to the code.
 */

/** @typedef {import("@better-answers/devtools/jscpd").JscpdConfig} JscpdConfig */

/** @type {JscpdConfig} */
export const jscpdConfig = {
  // The two halves of the tree that hold source: what deploys and what is imported.
  paths: ["apps", "packages"],
  // The tiers' own languages. Anything else here — JSON, YAML, Markdown, the lockfiles —
  // is configuration or prose, where repetition is the format and not a defect.
  formats: ["typescript", "tsx", "python"],
  // Five lines or fifty tokens: jscpd's own defaults, and roughly the size below which two
  // similar blocks are a coincidence of syntax rather than a copy.
  minLines: 5,
  minTokens: 50,
  threshold: 0,
  ignore: [
    // Installed, not written: shadcn, Kibo and AI Elements source under the SPA's shared UI
    // directory is vendored by the registry and re-installed rather than edited (ADR 0033).
    // Two registry components that share a Radix shape are the registry's business.
    "apps/web/src/shared/ui/**",
    // Verbatim third-party snapshots under ADR 0027, edited upstream and never here — the
    // anti-slop oxlint plugin is one, and any lift that follows it is another.
    "**/lifts/**",
    // Generated from the migration journal by
    // `packages/schema/scripts/generate-worker-schema.ts`; two tables with the same columns
    // are the schema's doing and a clone here would be a finding against a generator.
    "apps/worker/src/better_answers_worker/schema_view.py",
    // Not ours, and resolver output besides: the two lockfiles are excluded by name as well
    // as by format, so the exclusion survives a day someone adds a lock format to the list.
    "pnpm-lock.yaml",
    "apps/worker/uv.lock",
    // Build output, installed dependencies, the Python virtual environment and the
    // worktrees agents run in: none of it is source this repository writes.
    "**/node_modules/**",
    "**/dist/**",
    "**/.venv/**",
    "**/.claude/worktrees/**",
  ],
};
