import { parseSync, type Program } from "oxc-parser";

export type ParsedSource = {
  readonly program: Program;

  /** Counts from 1. */
  readonly lineOf: (offset: number) => number;
};

/** @throws when the file does not parse, which would otherwise read as holding nothing. */
export const parsedSource = (file: string, source: string): ParsedSource => {
  const parsed = parseSync(file, source);
  const [first] = parsed.errors;
  if (first !== undefined) throw new Error(`${file} does not parse: ${first.message}`);
  const starts = [0, ...[...source.matchAll(/\n/g)].map((match) => match.index + 1)];
  return {
    program: parsed.program,
    lineOf: (offset) => starts.findLastIndex((start) => start <= offset) + 1,
  };
};
