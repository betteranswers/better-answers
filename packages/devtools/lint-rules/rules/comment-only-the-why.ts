import { defineRule } from "@oxlint/plugins";

import type { Comment, Fix, Fixer, Range } from "@oxlint/plugins";

const WORD_LIMIT = 25;

const EXEMPT_OPENING =
  /^(?:!|\/\s*<reference\b|eslint-|oxlint-|@ts-|@vitest-environment\b|@license\b|prettier-ignore\b|oxfmt-ignore\b|biome-ignore\b|jscpd:ignore|v8 ignore\b|c8 ignore\b|istanbul ignore\b|SPDX-License-Identifier\b|Copyright\b)/;

const CITATIONS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: "a ticket id", pattern: /\bT-\d+\b/ },
  { what: "an ADR number", pattern: /\bADR[ -]?\d+\b/i },
  { what: "a rule tag", pattern: /\[[A-Z]{2,}\d+\]/ },
  { what: "a date", pattern: /\b\d{4}-\d{2}-\d{2}\b/ },
  { what: "a date", pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/ },
];

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
        "A comment block is 25 words at most and cites no ticket, date, rule tag or ADR number ([COMMENT1]). Directives and notices are exempt.",
    },
    messages: {
      tooLong:
        "This comment runs to {{words}} words; a comment gives a reason the code cannot — a constraint, a trade-off, a gotcha — in {{limit}} at most ([COMMENT1]). Delete what the code already says.",
      cites:
        "This comment cites {{what}} (`{{cited}}`); a comment never says which ticket, decision or rule asked for the code ([COMMENT1]). git, a spec and an ADR are where that is read.",
    },
  },
  createOnce(context) {
    return {
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
          const cited = CITATIONS.map((citation) => ({
            what: citation.what,
            found: citation.pattern.exec(prose)?.[0],
          })).find((citation) => citation.found !== undefined);
          if (cited?.found !== undefined) {
            context.report({
              loc,
              messageId: "cites",
              data: { what: cited.what, cited: cited.found },
              fix,
            });
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
