import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const LIBRARY = /^(?:better-auth(?:\/|$)|@better-auth\/)|(?:^|\/)auth-client(?:\.ts)?$/;

type Node = ESTree.Node;

type Named = { readonly name: string; readonly at: number };

type Touches = (node: Node | null | undefined) => boolean;

type Declared = { readonly name: string; readonly node: Node };

type Fault = "inferred" | "leaked";

type Taint = { readonly tainted: ReadonlySet<string>; readonly touches: Touches };

const unwrapped = (statement: Node): Node | null | undefined =>
  statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
    ? statement.declaration
    : statement;

const declaredBy = (statement: Node): Declared[] => {
  const node = unwrapped(statement);
  if (node === null || node === undefined) return [];
  if (node.type === "VariableDeclaration") {
    return node.declarations.flatMap((one) =>
      one.id.type === "Identifier" ? [{ name: one.id.name, node: one }] : [],
    );
  }
  return "id" in node && node.id?.type === "Identifier" ? [{ name: node.id.name, node }] : [];
};

const importedFromTheLibrary = (program: ESTree.Program): Set<string> =>
  new Set(
    program.body.flatMap((statement) =>
      statement.type === "ImportDeclaration" && LIBRARY.test(statement.source.value)
        ? statement.specifiers.map((specifier) => specifier.local.name)
        : [],
    ),
  );

/** A declaration that names a tainted binding is tainted too, until no more are reached. */
const taintedIn = (
  program: ESTree.Program,
  declared: readonly Declared[],
  identifiers: readonly Named[],
): Taint => {
  const tainted = importedFromTheLibrary(program);
  const touches: Touches = (node) =>
    node !== null &&
    node !== undefined &&
    identifiers.some(
      ({ name, at }) => at >= node.range[0] && at < node.range[1] && tainted.has(name),
    );
  for (let grew = true; grew;) {
    const reached = declared.filter(({ name, node }) => !tainted.has(name) && touches(node));
    for (const { name } of reached) tainted.add(name);
    grew = reached.length > 0;
  }
  return { tainted, touches };
};

const functionFault = (fn: Node, touches: Touches): Fault | undefined => {
  if (!("params" in fn) || !("body" in fn)) return undefined;
  if (fn.returnType === null || fn.returnType === undefined) {
    return touches(fn.body) ? "inferred" : undefined;
  }
  return [...fn.params, fn.returnType].some(touches) ? "leaked" : undefined;
};

const declaratorFault = (node: ESTree.VariableDeclarator, touches: Touches): Fault | undefined => {
  const { id, init } = node;
  if (id.typeAnnotation !== null && id.typeAnnotation !== undefined) {
    return touches(id.typeAnnotation) ? "leaked" : undefined;
  }
  if (init === null) return undefined;
  if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
    return functionFault(init, touches);
  }
  return touches(init) ? "inferred" : undefined;
};

const faultOf = (node: Node, touches: Touches): Fault | undefined => {
  if (node.type === "FunctionDeclaration") return functionFault(node, touches);
  if (node.type === "VariableDeclarator") return declaratorFault(node, touches);
  return touches(node) ? "leaked" : undefined;
};

const exportedNames = (statement: Node): string[] => {
  if (statement.type === "ExportNamedDeclaration" && statement.source === null) {
    const named = statement.specifiers.map((specifier) =>
      specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value,
    );
    return [...named, ...declaredBy(statement).map(({ name }) => name)];
  }
  if (statement.type !== "ExportDefaultDeclaration") return [];
  const { declaration } = statement;
  if (declaration.type === "Identifier") return [declaration.name];
  return declaredBy(statement).map(({ name }) => name);
};

const reexportsTheLibrary = (statement: Node): boolean =>
  (statement.type === "ExportNamedDeclaration" || statement.type === "ExportAllDeclaration") &&
  statement.source !== null &&
  LIBRARY.test(statement.source.value);

export const authTypesStayInTheSeamRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "No type inferred from Better Auth leaves auth-hooks.ts; its exports carry the platform's own types.",
    },
    messages: {
      inferred:
        "`{{name}}` is exported with an inferred type, from code that reads Better Auth. Write its type out as a platform type, and map what the library answers to it inside auth-hooks.ts.",
      leaked:
        "`{{name}}`'s exported type names Better Auth or a type inferred from it. Map what the library answers to a platform type inside auth-hooks.ts, and export that.",
      reexported:
        "This re-exports Better Auth or authClient. Export a platform type that auth-hooks.ts maps the library's answer to.",
    },
  },
  createOnce(context) {
    let identifiers: Named[] = [];
    return {
      Program() {
        identifiers = [];
      },
      Identifier(node) {
        identifiers.push({ name: node.name, at: node.range[0] });
      },
      "Program:exit"(program) {
        const declared = program.body.flatMap(declaredBy);
        const { tainted, touches } = taintedIn(program, declared, identifiers);
        const byName = new Map(declared.map((one) => [one.name, one.node]));
        const faultOfName = (name: string): Fault | undefined => {
          const node = byName.get(name);
          if (node !== undefined) return faultOf(node, touches);
          return tainted.has(name) ? "leaked" : undefined;
        };
        for (const statement of program.body) {
          if (reexportsTheLibrary(statement)) {
            context.report({ node: statement, messageId: "reexported" });
          }
          for (const name of exportedNames(statement)) {
            const fault = faultOfName(name);
            if (fault !== undefined) {
              context.report({ node: statement, messageId: fault, data: { name } });
            }
          }
        }
      },
    };
  },
});
