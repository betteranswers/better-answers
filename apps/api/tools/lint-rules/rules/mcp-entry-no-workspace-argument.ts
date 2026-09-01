import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { entryCallOf, findProperty, propertyName } from "../shared/entry-calls.ts";

/**
 * No MCP entry takes a workspace, bundle or tenant argument (ADR 0018, `[SEC2]`): the
 * principal comes from the token and never from an argument. The rule reads the
 * entry's input schema — `defineEntry`'s `input` or `registerTool`'s `inputSchema`,
 * as `z.object({ … })` or a raw shape — and refuses any key that names one of the
 * three. The functional test over the emitted `inputSchema` holds it at runtime.
 */
const FORBIDDEN = ["workspace", "bundle", "tenant"];

/** Methods that wrap a schema and return one — the shape is on the object they hang off. */
const WRAPPERS = new Set(["refine", "superRefine", "transform", "describe", "brand", "readonly"]);

const shapeOf = (value: ESTree.Node): ESTree.ObjectExpression | undefined => {
  if (value.type === "ObjectExpression") return value;
  if (value.type !== "CallExpression") return undefined;
  const { callee } = value;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.property.type !== "Identifier"
  ) {
    return undefined;
  }
  // z.object({ … }) — the first argument is the shape.
  if (callee.property.name === "object") {
    const [shape] = value.arguments;
    return shape !== undefined && shape.type === "ObjectExpression" ? shape : undefined;
  }
  // `z.object({…}).refine(…)` and friends: unwrap to the object they narrow.
  if (WRAPPERS.has(callee.property.name)) return shapeOf(callee.object);
  return undefined;
};

export const mcpEntryNoWorkspaceArgumentRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "No MCP entry input names a workspace, bundle or tenant.",
    },
    messages: {
      forbidden:
        "`{{name}}` is not an argument an MCP entry may take: the principal comes from the token, never from an argument (ADR 0018, [SEC2]).",
      opaque:
        "This MCP entry's input is not an inline `z.object({ … })` or raw shape, so its keys cannot be checked here; declare the shape inline (the runtime test over the emitted schema is the fence for a registration from data).",
      spread:
        "A spread or computed key in an MCP entry's input cannot be checked for a workspace argument; write the keys out.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const call = entryCallOf(node);
        if (
          call === undefined ||
          call.config === undefined ||
          call.config.type !== "ObjectExpression"
        )
          return;
        const input = findProperty(
          call.config,
          call.kind === "defineEntry" ? "input" : "inputSchema",
        );
        if (input === undefined) return;
        const shape = shapeOf(input.value);
        if (shape === undefined) {
          // A `defineEntry` declares its shape inline (this is where the shape is
          // authored), so an opaque one is a real gap. A `registerTool` from a
          // variable — the platform's generic mount over the `ENTRIES` array — carries
          // a shape already checked at its `defineEntry`; the runtime test is its fence.
          if (call.kind === "defineEntry") context.report({ node: input, messageId: "opaque" });
          return;
        }
        for (const property of shape.properties) {
          const name = propertyName(property);
          if (name === undefined) {
            context.report({ node: property, messageId: "spread" });
            continue;
          }
          const lowered = name.toLowerCase();
          if (FORBIDDEN.some((word) => lowered.includes(word))) {
            context.report({ node: property, messageId: "forbidden", data: { name } });
          }
        }
      },
    };
  },
});
