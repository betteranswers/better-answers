import { defineRule } from "@oxlint/plugins";

import { blocksIn, directiveIn, lastOf, proseOf, standsAlone } from "../shared/comment-blocks.ts";

import type { Block } from "../shared/comment-blocks.ts";
import type { Comment, ESTree, Fix, Fixer } from "@oxlint/plugins";

const DECLARATIONS = new Set([
  "VariableDeclaration",
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSDeclareFunction",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "ExportAllDeclaration",
  "TSExportAssignment",
]);

/** A line comment's text after `//`, any further slashes, and the one space that follows. */
const lineOf = (comment: Comment): string => comment.value.replace(/^\/* ?/, "").trimEnd();

const docBlockOf = (block: Block): string => {
  if (block.length === 1) return `/** ${lineOf(block[0])} */`;
  const starred = block.map(lineOf).map((line) => (line === "" ? " *" : ` * ${line}`));
  return ["/**", ...starred, " */"].join("\n");
};

/** A directive reaches past `//` lines to the code, so the run under one stays `//`. */
const underADirective = (text: string, comments: readonly Comment[], block: Block): boolean =>
  comments.some(
    (comment) =>
      comment.loc.end.line === block[0].loc.start.line - 1 &&
      standsAlone(text, comment) &&
      directiveIn(proseOf(comment)) !== undefined,
  );

/** Each run of stand-alone line comments, keyed by the line just below it. */
const lineBlocksAbove = (
  text: string,
  comments: readonly Comment[],
): ReadonlyMap<number, Block> => {
  const above = new Map<number, Block>();
  for (const block of blocksIn(text, comments)) {
    if (standsAlone(text, block[0]) && !underADirective(text, comments, block)) {
      above.set(lastOf(block).loc.end.line + 1, block);
    }
  }
  return above;
};

export const declarationDocBlockRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "A comment on a module-scope declaration or export is a `/** */` doc block, so an editor shows it wherever the name is used ([COMMENT1]).",
    },
    messages: {
      lineComment:
        "A declaration's comment is a `/** */` doc block, never `//` ([COMMENT1]); an editor shows a doc block wherever the name is used. Write this block as `/** … */`.",
    },
  },
  createOnce(context) {
    const report = (block: Block): void => {
      const [first] = block;
      const last = lastOf(block);
      const fix = (fixer: Fixer): Fix | null =>
        block.some((comment) => comment.value.includes("*/"))
          ? null
          : fixer.replaceTextRange([first.range[0], last.range[1]], docBlockOf(block));
      context.report({
        loc: { start: first.loc.start, end: last.loc.end },
        messageId: "lineComment",
        fix,
      });
    };

    return {
      "Program:exit"(program: ESTree.Program): void {
        const { text } = context.sourceCode;
        const above = lineBlocksAbove(text, context.sourceCode.getAllComments());
        for (const statement of program.body) {
          const block = DECLARATIONS.has(statement.type)
            ? above.get(statement.loc.start.line)
            : undefined;
          if (block !== undefined) report(block);
        }
      },
    };
  },
});
