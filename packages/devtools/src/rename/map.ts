import path from "node:path";

import { z } from "zod";

export const STORED_HISTORY = "stored history";

/** Held by the runner rather than each map, so no map can forget one. */
const KEPT: readonly { readonly glob: string; readonly reason: string }[] = [
  { glob: "**/migrations/**", reason: STORED_HISTORY },
  { glob: "docs/archive/**", reason: STORED_HISTORY },
  { glob: "docs/plans/**", reason: STORED_HISTORY },
  { glob: "packages/core/src/audit/stored-names.ts", reason: STORED_HISTORY },
  { glob: "apps/web/src/features/people/audit-acts.ts", reason: STORED_HISTORY },
  { glob: "apps/api/tests/old-words.ts", reason: "the words test's list" },
  // A map rewritten by its own sweep could no longer be replayed.
  { glob: "packages/devtools/renames/**", reason: "a rename map" },
  { glob: "packages/devtools/test/rename.test.ts", reason: "the rename runner's fixtures" },
  { glob: "**/lifts/**", reason: "a lifted snapshot" },
];

/** Each pass asks once per occurrence, and every ask would compile each glob again. */
const keptReasons = new Map<string, string | undefined>();

/** The reason a path is never edited, or undefined when a sweep may edit it. */
export const keptReason = (file: string): string | undefined => {
  if (keptReasons.has(file)) return keptReasons.get(file);
  const reason = KEPT.find((kept) => path.matchesGlob(file, kept.glob))?.reason;
  keptReasons.set(file, reason);
  return reason;
};

const GLOB_SYNTAX = /[*?[{]/;

/** A glob's literal head stands for what it names, so `docs/archive/**` names a kept path. */
const namesKeptPath = (glob: string): boolean => {
  const head = glob.split(GLOB_SYNTAX, 1)[0] ?? "";
  return keptReason(head === glob ? glob : `${head}any`) !== undefined;
};

const isPattern = (source: string): boolean => {
  try {
    new RegExp(source);
    return true;
  } catch {
    // The constructor's message adds nothing the refusal does not already say.
    return false;
  }
};

const words = z.string().regex(/^[a-z0-9]+(?: [a-z0-9]+)*$/, "lower-case words, one space apart");

const sweptPaths = z.array(
  z.string().refine((glob) => !namesKeptPath(glob), {
    error: (issue) =>
      `the map names ${String(issue.input)}, which a sweep never edits: stored history, the words test's list, a map or a lifted snapshot`,
  }),
);

const sense = z
  .strictObject({
    sense: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1).optional(),
    matches: z.array(z.string().refine(isPattern, "not a regular expression")).min(1).optional(),
  })
  .refine((one) => one.paths !== undefined || one.matches !== undefined, {
    error: "a sense names the paths it holds, the text it matches, or both",
  });

const renameMap = z
  .strictObject({
    noun: z.string().min(1),
    readerWord: z.string().min(1),
    sweep: z.string().min(1),
    collisions: z.array(z.strictObject({ with: z.string().min(1), codeWord: words })),
    words: z.array(z.strictObject({ from: words, to: words })).min(1),
    symbols: z.strictObject({ paths: sweptPaths }),
    text: z.strictObject({ paths: sweptPaths }),
    senses: z.array(sense),
  })
  .superRefine((map, context) => {
    const written = new Set(map.words.map((rule) => rule.to));
    for (const collision of map.collisions) {
      if (written.has(collision.codeWord)) continue;
      context.addIssue({
        code: "custom",
        path: ["collisions"],
        message: `the collision with ${collision.with} names the code word "${collision.codeWord}", which no rule in words writes`,
      });
    }
  });

export type RenameMap = z.infer<typeof renameMap>;

export const parseRenameMap = (json: string): RenameMap => {
  const parsed = renameMap.safeParse(JSON.parse(json));
  if (!parsed.success) {
    throw new Error(`The rename map cannot be applied:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
};

export const inAllowlist = (globs: readonly string[], file: string): boolean =>
  globs.some((glob) => path.matchesGlob(file, glob));

/** Compiled once, when first reached, as an unparsed map's bad pattern must throw no sooner. Flagless, so `test` keeps no state. */
const patterns = new Map<string, RegExp>();

const patternOf = (source: string): RegExp => {
  const compiled = patterns.get(source) ?? new RegExp(source);
  patterns.set(source, compiled);
  return compiled;
};

/** The first sense whose paths hold the file and whose patterns match the text, if any. */
export const senseOf = (map: RenameMap, file: string, found: string): string | undefined =>
  map.senses.find(
    (one) =>
      (one.paths === undefined || inAllowlist(one.paths, file)) &&
      (one.matches === undefined || one.matches.some((pattern) => patternOf(pattern).test(found))),
  )?.sense;
