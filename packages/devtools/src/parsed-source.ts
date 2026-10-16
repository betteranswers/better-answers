import { type Comment, parseSync, type Program } from "oxc-parser";

export type ParsedSource = {
  readonly program: Program;

  readonly comments: readonly Comment[];

  readonly lineOf: (offset: number) => number;
};

export const parsedSource = (file: string, source: string): ParsedSource => {
  const parsed = parseSync(file, source);
  const [first] = parsed.errors;
  if (first !== undefined) throw new Error(`${file} does not parse: ${first.message}`);
  const starts = [0, ...[...source.matchAll(/\n/g)].map((match) => match.index + 1)];
  return {
    program: parsed.program,
    comments: parsed.comments,
    lineOf: (offset) => starts.findLastIndex((start) => start <= offset) + 1,
  };
};
