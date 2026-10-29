import { existsSync } from "node:fs";
import path from "node:path";

import type { ESTree } from "@oxlint/plugins";

export const ROOTS_OF: ReadonlyMap<string, string> = new Map([
  ["apps/api", "apps/api/tests/support/roots/roots.ts"],
  ["apps/web", "apps/web/test/support/roots.ts"],
  ["packages/core", "packages/core/test/support/roots/roots.ts"],
  ["packages/devtools", "@better-answers/devtools/paths"],
  ["packages/schema", "packages/schema/test/support/roots/roots.ts"],
]);

export type Placement = {
  readonly workspace: string;
  readonly depth: number;
};

const REPOSITORY_MARKER = "pnpm-workspace.yaml";

const upwardFrom = (directory: string, marker: string): string | undefined => {
  for (let at = directory; ; at = path.dirname(at)) {
    if (existsSync(path.join(at, marker))) return at;
    if (path.dirname(at) === at) return undefined;
  }
};

export const placementOfFile = (file: string): Placement | null => {
  const directory = path.dirname(file);
  const workspace = upwardFrom(directory, "package.json");
  const repository = upwardFrom(directory, REPOSITORY_MARKER);
  if (workspace === undefined || repository === undefined || workspace === repository) return null;
  return {
    workspace: path.relative(repository, workspace).split(path.sep).join("/"),
    depth: path.relative(workspace, directory).split(path.sep).filter(Boolean).length,
  };
};

export const reachesRoot = (depth: number, written: string): boolean => {
  let level = depth;
  for (const segment of written.split("/")) {
    if (segment === "..") {
      level -= 1;
      if (level <= 0) return true;
    } else if (segment !== "" && segment !== ".") {
      level += 1;
    }
  }
  return false;
};

const templateText = (node: ESTree.TemplateLiteral): string | undefined =>
  node.expressions.length === 0 ? (node.quasis[0]?.value.cooked ?? undefined) : undefined;

const stringOf = (node: ESTree.Node | undefined): string | undefined => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  return node?.type === "TemplateLiteral" ? templateText(node) : undefined;
};

const isMeta = (node: ESTree.Node | undefined, name: "dirname" | "url"): boolean =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "MetaProperty" &&
  node.property.type === "Identifier" &&
  node.property.name === name;

const isFileDirectory = (node: ESTree.Node | undefined): boolean =>
  isMeta(node, "dirname") || (node?.type === "Identifier" && node.name === "__dirname");

const JOINERS: ReadonlySet<string> = new Set(["join", "resolve"]);

const isJoiner = (callee: ESTree.Node): boolean => {
  if (callee.type === "Identifier") return JOINERS.has(callee.name);
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    JOINERS.has(callee.property.name)
  );
};

const leadingLiterals = (nodes: readonly ESTree.Node[]): readonly string[] => {
  const literals: string[] = [];
  for (const node of nodes) {
    const text = stringOf(node);
    if (text === undefined) break;
    literals.push(text);
  }
  return literals;
};

const urlClimb = (node: ESTree.NewExpression): string | undefined => {
  const [specifier, base] = node.arguments;
  const isUrl = node.callee.type === "Identifier" && node.callee.name === "URL";
  return isUrl && isMeta(base, "url") ? stringOf(specifier) : undefined;
};

const joinClimb = (node: ESTree.CallExpression): string | undefined => {
  const [anchor, ...rest] = node.arguments;
  if (!isJoiner(node.callee) || !isFileDirectory(anchor)) return undefined;
  const written = leadingLiterals(rest);
  return written.length === 0 ? undefined : written.join("/");
};

export const climbWritten = (node: ESTree.Node): string | undefined => {
  if (node.type === "NewExpression") return urlClimb(node);
  return node.type === "CallExpression" ? joinClimb(node) : undefined;
};
