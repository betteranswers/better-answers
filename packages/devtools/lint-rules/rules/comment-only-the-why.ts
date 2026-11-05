import { defineRule } from "@oxlint/plugins";
import type { Comment, Fix, Fixer } from "@oxlint/plugins";

import { citationIn } from "../../src/comments/citations.ts";
import { blocksIn, directiveIn, lastOf, proseOf } from "../shared/comment-blocks.ts";
import type { Block, Opened } from "../shared/comment-blocks.ts";

const WORD_LIMIT = 25;

const A_COUNT_OF_CALLERS =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|both)\s+(?:other\s+)?(?:specs|callers|call\s+sites)\b/iu;

const wordsIn = (prose: string): number => prose.match(/\S+/gu)?.length ?? 0;

const reasonOf = (prose: string, opened: Opened): string | undefined => {
  const rest = prose.slice(opened.opening[0].length);
  const { separator } = opened.directive;
  if (separator === undefined) return rest;
  const split = separator.exec(rest);
  return split === null ? undefined : rest.slice(split.index + split[0].length);
};

type Finding = {
  readonly messageId: "cites" | "countsCallers" | "tooLong" | "reasonTooLong";
  readonly data: Readonly<Record<string, string | number>>;
};

const findingIn = (prose: string, overLimit: "tooLong" | "reasonTooLong"): Finding | undefined => {
  const cited = citationIn(prose);
  if (cited !== undefined) return { messageId: "cites", data: { ...cited } };
  const counted = A_COUNT_OF_CALLERS.exec(prose);
  if (counted !== null)
    return { messageId: "countsCallers", data: { counted: counted[0].replace(/\s+/gu, " ") } };
  const words = wordsIn(prose);
  return words > WORD_LIMIT
    ? { messageId: overLimit, data: { words, limit: WORD_LIMIT } }
    : undefined;
};

export const commentOnlyTheWhyRule = defineRule({
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "A comment has 25 words at most, cites no ticket or document, and does not count the code that uses it. Keep a comment only for a constraint outside this repository (a library, a platform or a protocol), a public contract, a generated-file marker, a licence, or the reason for a suppression. A disable directive gives its reason on the same line, and that reason counts towards the 25 words.",
    },
    messages: {
      tooLong:
        "This comment runs to {{words}} words, over the limit of {{limit}}. Keep a comment only for a constraint outside this repository (a library, a platform or a protocol), a public contract, a generated-file marker, a licence, or the reason for a suppression. Delete every other comment. Move its reason into a name, a type, a test, a grant or a lint, or open an issue for it in the tracker.",
      cites:
        "This comment cites {{what}} (`{{cited}}`). A comment does not say which ticket, decision or rule asked for the code, because git history, the specs and the ADRs record that. Delete the citation and keep only the constraint.",
      countsCallers:
        "This comment counts the code that uses it (`{{counted}}`). A search finds the callers, and the count is wrong as soon as another caller is added. Delete the count. If the callers share a reason, put it in a name or a test title.",
      unexplained:
        "This disable directive gives no reason. On the same line, after ` -- ` (or `: ` for Stryker), name what it suppresses and say why.",
      reasonTooLong:
        "This directive's reason runs to {{words}} words, and the reason counts towards the comment limit of {{limit}}. Shorten it to the constraint alone.",
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
      const found = findingIn(reason, "reasonTooLong");
      if (found !== undefined) context.report({ loc: comment.loc, ...found });
    };

    const checkBlock = (block: Block): void => {
      const [first] = block;
      const last = lastOf(block);
      const found = findingIn(block.map(proseOf).join("\n"), "tooLong");
      if (found === undefined) return;
      const fix = (fixer: Fixer): Fix => fixer.removeRange([first.range[0], last.range[1]]);
      context.report({ loc: { start: first.loc.start, end: last.loc.end }, ...found, fix });
    };

    return {
      "Program:exit"(): void {
        const { sourceCode } = context;
        const comments = sourceCode.getAllComments();
        for (const comment of comments) checkDirective(comment);
        for (const block of blocksIn(sourceCode.text, comments)) checkBlock(block);
      },
    };
  },
});
