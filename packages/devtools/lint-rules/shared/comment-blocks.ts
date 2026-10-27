import type { Comment } from "@oxlint/plugins";

const NOTICE =
  /^(?:!|\/\s*<reference\b|@vitest-environment\b|@license\b|SPDX-License-Identifier\b|Copyright\b)/u;

type Directive = { readonly opening: RegExp; readonly separator?: RegExp };

const DIRECTIVES: readonly Directive[] = [
  {
    opening: /^(?:eslint|oxlint)-(?<kind>disable|enable)(?:-next-line|-line)?\b/u,
    separator: /\s-{2,}/u,
  },
  { opening: /^Stryker (?<kind>disable|restore)\b/u, separator: /:/u },
  {
    opening:
      /^(?:@ts-[a-z-]+|prettier-ignore|oxfmt-ignore|biome-ignore|jscpd:ignore-(?:start|end)|[vc]8 ignore|istanbul ignore)\b/u,
  },
];

export type Block = readonly [Comment, ...Comment[]];

export const lastOf = (block: Block): Comment => block.at(-1) ?? block[0];

export const proseOf = (comment: Comment): string =>
  comment.value
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/u, ""))
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

export const isExempt = (comment: Comment): boolean => {
  const prose = proseOf(comment);
  return NOTICE.test(prose) || directiveIn(prose) !== undefined;
};

const joins = (text: string, previous: Comment, comment: Comment): boolean =>
  standsAlone(text, previous) &&
  standsAlone(text, comment) &&
  comment.loc.start.line === previous.loc.end.line + 1;

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
