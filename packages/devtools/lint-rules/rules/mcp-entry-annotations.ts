import { defineRule } from "@oxlint/plugins";

import { entryCallOf, findProperty } from "../shared/entry-calls.ts";

export const mcpEntryAnnotationsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Every MCP entry declares `annotations` (readOnlyHint at least).",
    },
    messages: {
      missing:
        "This MCP entry declares no `annotations`; every entry carries readOnlyHint and its siblings (ADR 0018).",
      noReadOnlyHint:
        "This MCP entry's `annotations` carry no `readOnlyHint`; the host splits read from write tools on it alone (prototype 61).",
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
        const annotations = findProperty(call.config, "annotations");
        if (annotations === undefined) {
          context.report({ node: call.config, messageId: "missing" });
          return;
        }

        if (
          annotations.value.type === "ObjectExpression" &&
          findProperty(annotations.value, "readOnlyHint") === undefined
        ) {
          context.report({ node: annotations, messageId: "noReadOnlyHint" });
        }
      },
    };
  },
});
