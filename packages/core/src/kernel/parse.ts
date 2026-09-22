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

const absent = (raw: unknown, segments: ReadonlyArray<PropertyKey>): boolean => {
  let held: unknown = raw;
  for (const segment of segments) {
    if (typeof held !== "object" || held === null || typeof segment === "symbol") return true;
    // The value was never checked against a shape, so its entries are walked, not asserted.
    held = Object.entries(held).find(([name]) => name === String(segment))?.[1];
  }
  return held === undefined;
};

const wordOf = (issue: z.core.$ZodIssue, raw: unknown): IssueWord => {
  if (issue.code === "invalid_type" && absent(raw, issue.path)) return "missing";
  return WORD_OF_CODE.get(issue.code) ?? "refused";
};

export const parse = <Schema extends z.ZodType>(
  schema: Schema,
  raw: unknown,
): Result<z.output<Schema>, Malformed> => {
  const read = schema.safeParse(raw);
  if (read.success) return ok(read.data);

  const fields: Record<string, IssueWord> = {};
  for (const issue of read.error.issues) {
    fields[pathOf(issue.path)] ??= wordOf(issue, raw);
  }
  return err({ word: MALFORMED, fields });
};
