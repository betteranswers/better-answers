import type { ESTree } from "@oxlint/plugins";

export type EntryCall = {
  readonly kind: "defineEntry" | "registerTool";
  readonly config: ESTree.Expression | ESTree.SpreadElement | undefined;
};

export const entryCallOf = (node: ESTree.CallExpression): EntryCall | undefined => {
  const { callee } = node;
  if (callee.type === "Identifier" && callee.name === "defineEntry") {
    return { kind: "defineEntry", config: node.arguments[0] };
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "registerTool"
  ) {
    return { kind: "registerTool", config: node.arguments[1] };
  }
  return undefined;
};

export const propertyName = (
  property: ESTree.ObjectProperty | ESTree.SpreadElement,
): string | undefined => {
  if (property.type !== "Property") return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return undefined;
};

export const findProperty = (
  object: ESTree.ObjectExpression,
  name: string,
): ESTree.ObjectProperty | undefined => {
  for (const property of object.properties) {
    if (property.type === "Property" && propertyName(property) === name) return property;
  }
  return undefined;
};
