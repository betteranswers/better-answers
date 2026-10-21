import { diff } from "node:util";

const IN_BOTH = 0;
const ONLY_IN_HELD = 1;
const ONLY_IN_NEXT = -1;

const MARKS = { [IN_BOTH]: "  ", [ONLY_IN_HELD]: "- ", [ONLY_IN_NEXT]: "+ " } as const;

const linesOf = (body: string): readonly string[] => body.replace(/\n+$/u, "").split("\n");

export const bodyDiffLines = (held: string, next: string): readonly string[] =>
  diff(linesOf(held), linesOf(next)).map(([operation, line]) => `${MARKS[operation]}${line}`);
