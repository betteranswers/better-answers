import { defineRule } from "@oxlint/plugins";

import { citationIn } from "../../src/citations.ts";

import type { Comment, ESTree, Fix, Fixer, SourceCode } from "@oxlint/plugins";

const WORD_LIMIT = 25;

const DOC_BLOCK_LIMIT = 50;

const DOCUMENTED_SOURCE = /[/\\]packages[/\\](?:core|schema)[/\\]src[/\\]/;

const NOTICE =
  /^(?:!|\/\s*<reference\b|@vitest-environment\b|@license\b|SPDX-License-Identifier\b|Copyright\b)/;

type Directive = { readonly opening: RegExp; readonly separator?: RegExp };

/** A disable must give a reason; every other directive may. */
const DIRECTIVES: readonly Directive[] = [
  {
    opening: /^(?:eslint|oxlint)-(?<kind>disable|enable)(?:-next-line|-line)?\b/,
    separator: /\s-{2,}/,
  },
  { opening: /^Stryker (?<kind>disable|restore)\b/, separator: /:/ },
  {
    opening:
      /^(?:@ts-[a-z-]+|prettier-ignore|oxfmt-ignore|biome-ignore|jscpd:ignore-(?:start|end)|[vc]8 ignore|istanbul ignore)\b/,
  },
];

type Block = readonly [Comment, ...Comment[]];

const proseOf = (comment: Comment): string =>
  comment.value
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/, ""))
    .join("\n")
    .trim();

const wordsIn = (prose: string): number => prose.match(/\S+/g)?.length ?? 0;

type Opened = { readonly directive: Directive; readonly opening: RegExpExecArray };

const directiveIn = (prose: string): Opened | undefined => {
  for (const directive of DIRECTIVES) {
    const opening = directive.opening.exec(prose);
    if (opening !== null) return { directive, opening };
  }
  return undefined;
};

/** Undefined means a separator the directive needs is missing, so it gives no reason at all. */
const reasonOf = (prose: string, opened: Opened): string | undefined => {
  const rest = prose.slice(opened.opening[0].length);
  const { separator } = opened.directive;
  if (separator === undefined) return rest;
  const split = separator.exec(rest);
  return split === null ? undefined : rest.slice(split.index + split[0].length);
};

const standsAlone = (text: string, comment: Comment): boolean => {
  const lineStart = text.lastIndexOf("\n", comment.range[0]) + 1;
  return comment.type === "Line" && text.slice(lineStart, comment.range[0]).trim() === "";
};

const isExempt = (comment: Comment): boolean => {
  const prose = proseOf(comment);
  return NOTICE.test(prose) || directiveIn(prose) !== undefined;
};

/** A dropped exempt comment leaves a gap in the line count, so it still ends a block. */
const joins = (text: string, previous: Comment, comment: Comment): boolean =>
  standsAlone(text, previous) &&
  standsAlone(text, comment) &&
  comment.loc.start.line === previous.loc.end.line + 1;

const blocksIn = (text: string, comments: readonly Comment[]): readonly Block[] => {
  const blocks: [Comment, ...Comment[]][] = [];
  for (const comment of comments) {
    if (isExempt(comment)) continue;
    const open = blocks.at(-1);
    const previous = open?.at(-1);
    if (previous === undefined || !joins(text, previous, comment)) blocks.push([comment]);
    else open?.push(comment);
  }
  return blocks;
};

type Finding = {
  readonly messageId: "cites" | "tooLong" | "reasonTooLong";
  readonly data: Readonly<Record<string, string | number>>;
};

const findingIn = (
  prose: string,
  limit: number,
  overLimit: "tooLong" | "reasonTooLong",
): Finding | undefined => {
  const cited = citationIn(prose);
  if (cited !== undefined) return { messageId: "cites", data: { ...cited } };
  const words = wordsIn(prose);
  return words > limit ? { messageId: overLimit, data: { words, limit } } : undefined;
};

const FUNCTION_VALUES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

const declaresAFunction = (declaration: ESTree.Node | null): boolean => {
  if (declaration === null) return false;
  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.every(
      (declarator) => declarator.init !== null && FUNCTION_VALUES.has(declarator.init.type),
    );
  }
  return (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "TSDeclareFunction" ||
    FUNCTION_VALUES.has(declaration.type)
  );
};

const docBlockOf = (
  statement: ESTree.Program["body"][number],
  sourceCode: SourceCode,
): Comment | undefined => {
  const exported =
    statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
  if (!exported || !declaresAFunction(statement.declaration)) return undefined;
  const block = sourceCode.getCommentsBefore(statement).at(-1);
  return block?.type === "Block" && block.value.startsWith("*") ? block : undefined;
};

const docBlocksIn = (program: ESTree.Program, sourceCode: SourceCode): ReadonlySet<number> => {
  const starts = new Set<number>();
  for (const statement of program.body) {
    const block = docBlockOf(statement, sourceCode);
    if (block !== undefined) starts.add(block.range[0]);
  }
  return starts;
};

export const commentOnlyTheWhyRule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "A comment is 25 words at most and cites no ticket, date, rule tag or ADR number ([COMMENT1]); a doc block on an exported function in packages/core or packages/schema may run to 50. A disable gives its reason on the same line, and a directive's reason counts against the cap ([COMMENT3]).",
    },
    messages: {
      tooLong:
        "This comment runs to {{words}} words; a comment says only what the code cannot — a constraint, a trade-off, a trap — in {{limit}} at most ([COMMENT1]). Delete what the code already says.",
      cites:
        "This comment cites {{what}} (`{{cited}}`); a comment never says which ticket, decision or rule asked for the code ([COMMENT1]). git, a spec and an ADR are where that is read.",
      unexplained:
        "This disable gives no reason; name what it suppresses and say why on the same line, after ` -- ` (`: ` for Stryker) ([COMMENT3]).",
      reasonTooLong:
        "This directive's reason runs to {{words}} words, and a reason counts against the comment cap of {{limit}} ([COMMENT3]). Say the constraint alone.",
    },
  },
  createOnce(context) {
    const checkDirective = (comment: Comment): void => {
      const prose = proseOf(comment);
      const opened = directiveIn(prose);
      if (opened === undefined) return;
      const reason = reasonOf(prose, opened);
      if (reason === undefined || wordsIn(reason) === 0) {
        if (opened.opening.groups?.["kind"] === "disable") {
          context.report({ loc: comment.loc, messageId: "unexplained" });
        }
        return;
      }
      const found = findingIn(reason, WORD_LIMIT, "reasonTooLong");
      if (found !== undefined) context.report({ loc: comment.loc, ...found });
    };

    const checkBlock = (block: Block, documented: ReadonlySet<number>): void => {
      const [first] = block;
      const last = block.at(-1) ?? first;
      const limit = documented.has(first.range[0]) ? DOC_BLOCK_LIMIT : WORD_LIMIT;
      const found = findingIn(block.map(proseOf).join("\n"), limit, "tooLong");
      if (found === undefined) return;
      const fix = (fixer: Fixer): Fix => fixer.removeRange([first.range[0], last.range[1]]);
      context.report({ loc: { start: first.loc.start, end: last.loc.end }, ...found, fix });
    };

    return {
      "Program:exit"(program): void {
        const { sourceCode } = context;
        const documented = DOCUMENTED_SOURCE.test(context.filename)
          ? docBlocksIn(program, sourceCode)
          : new Set<number>();
        const comments = sourceCode.getAllComments();
        for (const comment of comments) checkDirective(comment);
        for (const block of blocksIn(sourceCode.text, comments)) checkBlock(block, documented);
      },
    };
  },
});
