import { existsSync } from "node:fs";
import path from "node:path";

import type { ESTree } from "@oxlint/plugins";

export type RootsHelper = {
  readonly file: string;
  readonly exports: readonly string[];
};

const ROOT_AND_WORKSPACE = ["repositoryRoot", "workspaceRoot"] as const;

export const ROOTS_OF: ReadonlyMap<string, RootsHelper> = new Map([
  ["apps/api", { file: "apps/api/tests/support/roots/roots.ts", exports: ROOT_AND_WORKSPACE }],
  ["apps/web", { file: "apps/web/test/support/roots.ts", exports: ROOT_AND_WORKSPACE }],
  [
    "packages/core",
    { file: "packages/core/test/support/roots/roots.ts", exports: ROOT_AND_WORKSPACE },
  ],
  ["packages/devtools", { file: "packages/devtools/src/paths.ts", exports: ["repositoryRoot"] }],
  [
    "packages/schema",
    { file: "packages/schema/test/support/roots/roots.ts", exports: ROOT_AND_WORKSPACE },
  ],
]);

export const TOOLCHAIN_WORKSPACE = "packages/devtools";

export const TOOLCHAIN_PATHS = "@better-answers/devtools/paths";

export type Placement = {
  readonly workspace: string;
  readonly file: string;
  readonly depth: number;
};

export type Climb = {
  readonly rise: number;
  readonly written: string;
  readonly fromCwd: boolean;
};

const REPOSITORY_MARKER = "pnpm-workspace.yaml";

const WORKSPACE_PARENTS: ReadonlySet<string> = new Set(["apps", "packages"]);

const repositoryOf = (directory: string): string | undefined => {
  for (let at = directory; ; at = path.dirname(at)) {
    if (existsSync(path.join(at, REPOSITORY_MARKER))) return at;
    if (path.dirname(at) === at) return undefined;
  }
};

export const placementOfFile = (file: string): Placement | null => {
  const repository = repositoryOf(path.dirname(file));
  if (repository === undefined) return null;
  const parts = path.relative(repository, file).split(path.sep);
  const [parent, name] = parts;
  if (parent === undefined || name === undefined || parts.length < 3) return null;
  if (!WORKSPACE_PARENTS.has(parent)) return null;
  return { workspace: `${parent}/${name}`, file: parts.join("/"), depth: parts.length - 3 };
};

export const reachesRoot = (depth: number, rise: number, written: string): boolean => {
  let level = depth - rise;
  if (rise > 0 && level <= 0) return true;
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

const identifierName = (node: ESTree.Node | undefined): string | undefined =>
  node?.type === "Identifier" ? node.name : undefined;

const memberName = (node: ESTree.Node | undefined): string | undefined =>
  node?.type === "MemberExpression" && !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : undefined;

const calleeName = (callee: ESTree.Node): string | undefined =>
  identifierName(callee) ?? memberName(callee);

const isCallTo = (node: ESTree.Node | undefined, name: string): node is ESTree.CallExpression =>
  node?.type === "CallExpression" && calleeName(node.callee) === name;

const isMeta = (node: ESTree.Node | undefined, name: "dirname" | "filename" | "url"): boolean =>
  node?.type === "MemberExpression" &&
  node.object.type === "MetaProperty" &&
  memberName(node) === name;

const isFileName = (node: ESTree.Node | undefined): boolean =>
  isMeta(node, "filename") || isMeta(node, "url") || identifierName(node) === "__filename";

const isFile = (node: ESTree.Node | undefined): boolean => {
  if (isFileName(node)) return true;
  if (isCallTo(node, "fileURLToPath")) return isFile(node.arguments[0]);
  return (
    node?.type === "MemberExpression" &&
    node.object.type === "NewExpression" &&
    memberName(node) === "pathname" &&
    isFile(node.object.arguments[0])
  );
};

const isFolder = (node: ESTree.Node | undefined): boolean =>
  isMeta(node, "dirname") || identifierName(node) === "__dirname";

const riseOf = (node: ESTree.Node | undefined): number | undefined => {
  if (isFolder(node)) return 0;
  if (isFile(node)) return -1;
  if (!isCallTo(node, "dirname") || node.arguments.length !== 1) return undefined;
  const inner = riseOf(node.arguments[0]);
  return inner === undefined ? undefined : inner + 1;
};

const JOINERS: ReadonlySet<string> = new Set(["join", "resolve"]);

const isJoiner = (callee: ESTree.Node): boolean => JOINERS.has(calleeName(callee) ?? "");

const FILE_READERS: ReadonlySet<string> = new Set([
  "readFileSync",
  "readFile",
  "readdirSync",
  "readdir",
  "existsSync",
  "statSync",
  "writeFileSync",
  "writeFile",
  "createReadStream",
]);

const leadingLiterals = (nodes: readonly ESTree.Node[]): readonly string[] => {
  const literals: string[] = [];
  for (const node of nodes) {
    const text = stringOf(node);
    if (text === undefined) break;
    literals.push(text);
  }
  return literals;
};

const urlClimb = (node: ESTree.NewExpression): Climb | undefined => {
  const [specifier, base] = node.arguments;
  const isUrl = node.callee.type === "Identifier" && node.callee.name === "URL";
  const written = isUrl && isMeta(base, "url") ? stringOf(specifier) : undefined;
  return written === undefined ? undefined : { rise: 0, written, fromCwd: false };
};

const joinClimb = (node: ESTree.CallExpression): Climb | undefined => {
  const [anchor, ...rest] = node.arguments;
  const rise = riseOf(anchor);
  if (!isJoiner(node.callee) || rise === undefined) return undefined;
  return { rise, written: leadingLiterals(rest).join("/"), fromCwd: false };
};

const isAnchorOfParent = (node: ESTree.CallExpression): boolean => {
  const parent = node.parent;
  if (parent.type !== "CallExpression" || parent.arguments[0] !== node) return false;
  return isJoiner(parent.callee) || calleeName(parent.callee) === "dirname";
};

const dirnameClimb = (node: ESTree.CallExpression): Climb | undefined => {
  const rise = riseOf(node);
  if (rise === undefined || !isCallTo(node, "dirname") || isAnchorOfParent(node)) return undefined;
  return { rise, written: "", fromCwd: false };
};

const templateClimb = (node: ESTree.TemplateLiteral): Climb | undefined => {
  const rise = riseOf(node.expressions[0]);
  const [lead, ...after] = node.quasis;
  if (rise === undefined || lead?.value.cooked !== "") return undefined;
  const written = after.map((quasi) => quasi.value.cooked ?? "").join("x");
  return written.startsWith("/") ? { rise, written, fromCwd: false } : undefined;
};

const cwdClimb = (node: ESTree.CallExpression): Climb | undefined => {
  if (!FILE_READERS.has(calleeName(node.callee) ?? "")) return undefined;
  const written = stringOf(node.arguments[0]);
  return written?.split("/")[0] === ".." ? { rise: 0, written, fromCwd: true } : undefined;
};

export const climbOf = (node: ESTree.Node): Climb | undefined => {
  if (node.type === "NewExpression") return urlClimb(node);
  if (node.type === "TemplateLiteral") return templateClimb(node);
  if (node.type !== "CallExpression") return undefined;
  return joinClimb(node) ?? dirnameClimb(node) ?? cwdClimb(node);
};

export const importsToolchainRoot = (node: ESTree.ImportDeclaration): boolean =>
  node.source.value === TOOLCHAIN_PATHS &&
  node.specifiers.some(
    (specifier) =>
      specifier.type === "ImportSpecifier" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name === "repositoryRoot",
  );
