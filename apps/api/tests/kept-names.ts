import { refusalRegister } from "@better-answers/core/kernel";

import { ENTRIES } from "../src/mcp/entries/index.ts";
import { readUnder } from "./tree-walk.ts";

/** Every slice that declares refusals, loaded so the register holds all of them. */
const SLICES = [
  () => import("@better-answers/core/access"),
  () => import("@better-answers/core/answering"),
  () => import("@better-answers/core/audit"),
  () => import("@better-answers/core/concepts"),
  () => import("@better-answers/core/erasure"),
  () => import("@better-answers/core/guides"),
  () => import("@better-answers/core/llm"),
  () => import("@better-answers/core/members"),
  () => import("@better-answers/core/runs"),
  () => import("@better-answers/core/sources"),
  () => import("@better-answers/core/sweeps"),
  () => import("@better-answers/core/workspaces"),
];

type ZodLike = {
  readonly _zod: { readonly def: { readonly type: string } & Record<string, unknown> };
};

const isZod = (value: unknown): value is ZodLike =>
  typeof value === "object" && value !== null && "_zod" in value;

const keysOf = (value: unknown): readonly string[] =>
  typeof value === "object" && value !== null ? Object.keys(value) : [];

const valuesOf = (value: unknown): readonly unknown[] =>
  typeof value === "object" && value !== null ? Object.values(value) : [];

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
    return def.type === "object" && typeof value === "object" && value !== null
      ? Object.values(value)
      : [];
  });

/** Every key, enum value and literal a schema declares: the wire's own names. */
const namesInSchema = (schema: unknown, seen: Set<unknown> = new Set()): readonly string[] => {
  if (!isZod(schema) || seen.has(schema)) return [];
  seen.add(schema);
  const { def } = schema._zod;
  return [...ownNamesOf(def), ...innerOf(def).flatMap((inner) => namesInSchema(inner, seen))];
};

const QUOTED_ACT = /"([a-z_]+\.[a-z_]+\.[a-z_]+)"/g;

const MOVED_FROM = /movedFrom: "([^"]+)"/g;

const matchesIn = (text: string, pattern: RegExp): readonly string[] =>
  [...text.matchAll(pattern)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

/**
 * The names this codebase does not own, read from where each is declared, so a hand-kept pattern
 * cannot drift from them.
 */
export const keptNamesUnder = async (
  root: string,
): Promise<Readonly<Record<string, readonly string[]>>> => {
  for (const slice of SLICES) await slice();
  return {
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
    "stored act names": matchesIn(
      readUnder(root, "apps/web/src/features/people/audit-acts.ts"),
      QUOTED_ACT,
    ),
    "old page addresses": matchesIn(
      readUnder(root, "apps/web/src/shared/navigation.ts"),
      MOVED_FROM,
    ),
  };
};
