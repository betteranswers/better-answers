// Every slice that declares refusals, imported so the register holds all of them.
import "@better-answers/core/access";
import "@better-answers/core/answering";
import "@better-answers/core/audit";
import "@better-answers/core/concepts";
import "@better-answers/core/erasure";
import "@better-answers/core/guides";
import "@better-answers/core/llm";
import "@better-answers/core/members";
import "@better-answers/core/runs";
import "@better-answers/core/sources";
import "@better-answers/core/sweeps";
import "@better-answers/core/workspaces";
import { STORED_ACT_NAMES } from "@better-answers/core/audit";
import { refusalRegister } from "@better-answers/core/kernel";

import { ENTRIES } from "../src/mcp/entries/index.ts";
import { readUnder } from "./tree-walk.ts";

type ZodLike = {
  readonly _zod: { readonly def: { readonly type: string } & Record<string, unknown> };
};

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const isZod = (value: unknown): value is ZodLike => isObject(value) && "_zod" in value;

const keysOf = (value: unknown): readonly string[] => (isObject(value) ? Object.keys(value) : []);

const valuesOf = (value: unknown): readonly unknown[] =>
  isObject(value) ? Object.values(value) : [];

const ownNamesOf = (def: ZodLike["_zod"]["def"]): readonly string[] => {
  if (def.type === "object") return keysOf(def["shape"]);
  if (def.type === "enum") return valuesOf(def["entries"]).map(String);
  if (def.type === "literal") return valuesOf(def["values"]).map(String);
  return [];
};

const innerOf = (def: ZodLike["_zod"]["def"]): readonly unknown[] =>
  Object.values(def).flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (isZod(value)) return [value];
    return def.type === "object" && isObject(value) ? Object.values(value) : [];
  });

/** Every key, enum value and literal a schema declares: the wire's own names. */
const namesInSchema = (schema: unknown, seen: Set<unknown> = new Set()): readonly string[] => {
  if (!isZod(schema) || seen.has(schema)) return [];
  seen.add(schema);
  const { def } = schema._zod;
  return [...ownNamesOf(def), ...innerOf(def).flatMap((inner) => namesInSchema(inner, seen))];
};

const QUOTED_ACT = /"([a-z_]+\.[a-z_]+\.[a-z_]+)"/g;

/** A page's or group's older addresses, a list that may wrap onto lines of its own. */
const MOVED_FROM = /movedFrom: \[([^\]]*)\]/g;

const QUOTED = /"([^"]+)"/g;

const matchesIn = (text: string, pattern: RegExp): readonly string[] =>
  [...text.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

const movedFromIn = (text: string): readonly string[] =>
  matchesIn(text, MOVED_FROM).flatMap((list) => matchesIn(list, QUOTED));

/**
 * The names this codebase does not own, read from where each is declared, so a hand-kept pattern
 * cannot drift from them.
 */
export const keptNamesUnder = (root: string): Readonly<Record<string, readonly string[]>> => ({
  "refusal words": refusalRegister().map(({ word }) => word),
  "MCP entries and schemas": ENTRIES.flatMap((entry) => [
    entry.name,
    ...entry.scopes,
    ...namesInSchema(entry.input),
    ...namesInSchema(entry.output),
  ]),
  "Better Auth's endpoints": readUnder(root, "apps/api/tests/better-auth-endpoints.txt")
    .split("\n")
    .filter((line) => line.startsWith("/")),
  "the stored-names register": STORED_ACT_NAMES,
  "stored act names": matchesIn(
    readUnder(root, "apps/web/src/features/people/audit-acts.ts"),
    QUOTED_ACT,
  ),
  "old page addresses": movedFromIn(readUnder(root, "apps/web/src/shared/navigation.ts")),
});
