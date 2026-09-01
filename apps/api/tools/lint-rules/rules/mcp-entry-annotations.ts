import { defineRule } from "@oxlint/plugins";

import { entryCallOf, findProperty } from "../shared/entry-calls.ts";

/**
 * Every MCP entry carries its `annotations` (T-004; ADR 0018's 2026-08-31 amendment):
 * prototype 61 saw claude.ai split the surface into read and write tools from
 * `readOnlyHint` alone, so an entry without annotations is an entry the host cannot
 * place. The functional test over the emitted `tools/list` holds the same line at
 * runtime; this rule holds it at the declaration.
 */
export const mcpEntryAnnotationsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Every MCP entry declares `annotations` (readOnlyHint at least).",
    },
    messages: {
      missing:
        "This MCP entry declares no `annotations`; every entry carries readOnlyHint and its siblings (ADR 0018).",
      opaque:
        "This MCP entry's config is not an object literal, so its `annotations` cannot be checked here; declare it inline.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const call = entryCallOf(node);
        if (call === undefined) return;
        if (call.config === undefined || call.config.type !== "ObjectExpression") {
          context.report({ node, messageId: "opaque" });
          return;
        }
        if (findProperty(call.config, "annotations") === undefined) {
          context.report({ node: call.config, messageId: "missing" });
        }
      },
    };
  },
});
