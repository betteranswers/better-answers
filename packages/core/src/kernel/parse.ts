import type { z } from "zod";

import { err, ok, type Result } from "./result.ts";
import { MALFORMED } from "./vocabulary.ts";

export const ISSUE_WORDS = [
  "missing",
  "wrong-type",
  "too-small",
  "too-big",
  "bad-format",
  "not-a-multiple",
  "not-in-set",
  "no-shape-matches",
  "unrecognised-key",
  "bad-key",
  "refused",
] as const;

export type IssueWord = (typeof ISSUE_WORDS)[number];

export type FieldIssues = Readonly<Record<string, IssueWord>>;

export type Malformed = {
  readonly word: typeof MALFORMED;

  readonly fields: FieldIssues;
};

const WORD_OF_CODE = new Map<string, IssueWord>([
  ["invalid_type", "wrong-type"],
  ["too_small", "too-small"],
  ["too_big", "too-big"],
  ["invalid_format", "bad-format"],
  ["not_multiple_of", "not-a-multiple"],
  ["invalid_value", "not-in-set"],
  ["invalid_union", "no-shape-matches"],
  ["unrecognized_keys", "unrecognised-key"],
  ["invalid_key", "bad-key"],
  ["custom", "refused"],
]);

export const ROOT_PATH = "";

const pathOf = (segments: ReadonlyArray<PropertyKey>): string =>
  segments.map((segment) => String(segment)).join(".");

const wordOf = (issue: z.core.$ZodIssue): IssueWord => {
  if (issue.code === "invalid_type" && issue.input === undefined) return "missing";
  return WORD_OF_CODE.get(issue.code) ?? "refused";
};

/**
 * Refuses `malformed` with the word of each failing field's first issue, keyed by its dotted path
 * and `ROOT_PATH` for the whole value. No value that failed is carried.
 */
export const parse = <Schema extends z.ZodType>(
  schema: Schema,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the boundary itself: a named type would claim a parse the schema has not yet done
  raw: unknown,
): Result<z.output<Schema>, Malformed> => {
  /**
   * `reportInput` is how a missing key is told from a wrong-typed one; the values it
   * copies onto issues never leave this function.
   */
  const read = schema.safeParse(raw, { reportInput: true });
  if (read.success) return ok(read.data);

  const fields: Record<string, IssueWord> = {};
  for (const issue of read.error.issues) {
    fields[pathOf(issue.path)] ??= wordOf(issue);
  }
  return err({ word: MALFORMED, fields });
};
