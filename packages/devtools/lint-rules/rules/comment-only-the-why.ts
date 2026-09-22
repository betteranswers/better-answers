import { defineRule } from "@oxlint/plugins";

import { citationIn } from "../../src/citations.ts";
import { stringsGoUnread } from "../../src/tag-printing-gates.ts";

import type { Comment, Fix, Fixer, Node, Range } from "@oxlint/plugins";

const WORD_LIMIT = 25;

const A_SPACE = /\s/;

const EXEMPT_OPENING =
  /^(?:!|\/\s*<reference\b|eslint-|oxlint-|@ts-|@vitest-environment\b|@license\b|prettier-ignore\b|oxfmt-ignore\b|biome-ignore\b|jscpd:ignore|v8 ignore\b|c8 ignore\b|istanbul ignore\b|SPDX-License-Identifier\b|Copyright\b)/;

const proseOf = (comment: Comment): string =>
  comment.value
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/, " "))
    .join("\n");

const wordsIn = (prose: string): number => prose.split(/\s+/).filter((word) => word !== "").length;

const startsItsOwnLine = (text: string, comment: Comment): boolean => {
  for (let index = comment.range[0] - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === "\n") return true;
    if (character !== " " && character !== "\t" && character !== "\r") return false;
  }
  return true;
};

const blocksIn = (text: string, comments: readonly Comment[]): readonly (readonly Comment[])[] => {
  const blocks: Comment[][] = [];
  let open: Comment[] | undefined;
  for (const comment of comments) {
    if (comment.type === "Shebang") continue;

    if (EXEMPT_OPENING.test(proseOf(comment).trim())) {
      open = undefined;
      continue;
    }
    const ownLine = startsItsOwnLine(text, comment);
    const previous = open?.at(-1);
    if (
      open !== undefined &&
      previous !== undefined &&
      comment.type === "Line" &&
      ownLine &&
      comment.loc.start.line === previous.loc.end.line + 1
    ) {
      open.push(comment);
      continue;
    }
    open = comment.type === "Line" && ownLine ? [comment] : undefined;
    blocks.push(open ?? [comment]);
  }
  return blocks;
};

export const commentOnlyTheWhyRule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "A comment block is 25 words at most and cites no ticket, date, rule tag or ADR number ([COMMENT1]), and neither does a string a person reads. Directives and notices are exempt.",
    },
    messages: {
      tooLong:
        "This comment runs to {{words}} words; a comment gives a reason the code cannot — a constraint, a trade-off, a gotcha — in {{limit}} at most ([COMMENT1]). Delete what the code already says.",
      cites:
        "This comment cites {{what}} (`{{cited}}`); a comment never says which ticket, decision or rule asked for the code ([COMMENT1]). git, a spec and an ADR are where that is read.",
      stringCites:
        "This string cites {{what}} (`{{cited}}`); a string that reaches a person names what they can act on, never a document they cannot open from where they read it ([COMMENT1]). Say the thing instead.",
    },
  },
  createOnce(context) {
    const refuseCitation = (node: Node, text: string): void => {
      // A string with no space in it is an identifier, a path, a key or a version — a value,
      // not something a person reads.
      if (!A_SPACE.test(text) || stringsGoUnread(context.filename)) return;
      const cited = citationIn(text);
      if (cited === undefined) return;
      context.report({ node, messageId: "stringCites", data: { ...cited } });
    };

    return {
      Literal(node): void {
        if (typeof node.value === "string") refuseCitation(node, node.value);
      },
      TemplateLiteral(node): void {
        for (const quasi of node.quasis) {
          refuseCitation(quasi, quasi.value.cooked ?? quasi.value.raw);
        }
      },
      "Program:exit"(): void {
        const text = context.sourceCode.text;
        for (const block of blocksIn(text, context.sourceCode.getAllComments())) {
          const first = block[0];
          const last = block.at(-1);
          if (first === undefined || last === undefined) continue;
          const prose = block.map(proseOf).join("\n");
          const loc = { start: first.loc.start, end: last.loc.end };
          const range: Range = [first.range[0], last.range[1]];

          const fix = (fixer: Fixer): Fix => fixer.removeRange(range);
          const cited = citationIn(prose);
          if (cited !== undefined) {
            context.report({ loc, messageId: "cites", data: { ...cited }, fix });
            continue;
          }
          const words = wordsIn(prose);
          if (words > WORD_LIMIT) {
            context.report({ loc, messageId: "tooLong", data: { words, limit: WORD_LIMIT }, fix });
          }
        }
      },
    };
  },
});
