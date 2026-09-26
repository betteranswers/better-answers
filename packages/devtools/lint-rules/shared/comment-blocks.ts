import type { Comment } from "@oxlint/plugins";

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

export type Block = readonly [Comment, ...Comment[]];

export const lastOf = (block: Block): Comment => block.at(-1) ?? block[0];

export const proseOf = (comment: Comment): string =>
  comment.value
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/, ""))
    .join("\n")
    .trim();

export type Opened = { readonly directive: Directive; readonly opening: RegExpExecArray };

export const directiveIn = (prose: string): Opened | undefined => {
  for (const directive of DIRECTIVES) {
    const opening = directive.opening.exec(prose);
    if (opening !== null) return { directive, opening };
  }
  return undefined;
};

export const standsAlone = (text: string, comment: Comment): boolean => {
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

/** Touching stand-alone line comments form one block; a directive or notice belongs to none. */
export const blocksIn = (text: string, comments: readonly Comment[]): readonly Block[] => {
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
