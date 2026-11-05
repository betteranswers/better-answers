import { defineRule } from "@oxlint/plugins";

import { entryCallOf, findProperty } from "../shared/entry-calls.ts";

export const mcpEntryAnnotationsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Every MCP entry declares `annotations`, with at least `readOnlyHint`.",
    },
    messages: {
      missing:
        "This MCP entry declares no `annotations`. Add an `annotations` object with `readOnlyHint` and the other MCP tool hints.",
      noReadOnlyHint:
        "This MCP entry's `annotations` has no `readOnlyHint`. Add it, because the MCP host uses `readOnlyHint` alone to tell read tools from write tools.",
      opaque:
        "This MCP entry's config is not an object literal, so the rule cannot check its `annotations`. Write the config inline.",
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
