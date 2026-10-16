import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const fixture = z.object({
  patterns: z.array(z.object({ name: z.string(), pattern: z.string() })),
});

const CASES = path.resolve(import.meta.dirname, "../../../contracts/citation/cases.json");

const read = (): z.infer<typeof fixture> => {
  const parsed: unknown = JSON.parse(readFileSync(CASES, "utf8"));
  return fixture.parse(parsed);
};

type Citation = { readonly what: string; readonly cited: string };

const patterns: readonly { readonly what: string; readonly pattern: RegExp }[] =
  read().patterns.map((one) => ({ what: one.name, pattern: new RegExp(one.pattern) }));

export const citationIn = (prose: string): Citation | undefined => {
  for (const { what, pattern } of patterns) {
    const found = pattern.exec(prose);
    if (found !== null) return { what, cited: found[0] };
  }
  return undefined;
};
