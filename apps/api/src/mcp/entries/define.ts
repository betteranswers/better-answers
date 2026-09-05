import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";

import type { UserPrincipal } from "@better-answers/core/kernel";
import type { Tx } from "@better-answers/core/store/postgres";

import type { McpScope } from "../../auth/constants.ts";

/**
 * One entry of the MCP surface (CONTEXT.md, *MCP tool*): a named, described, typed
 * function that never takes a workspace and returns structured content with its human
 * rendering. `annotations` is required by the type, by the lint rule
 * `better-answers/mcp-entry-annotations`, and by the functional test over the emitted
 * `tools/list` — prototype 61 saw claude.ai split the surface into read and write
 * tools from `readOnlyHint` alone. The input's keys are refused by
 * `better-answers/mcp-entry-no-workspace-argument` and by the same test if any is
 * `workspace`, `bundle` or `tenant` — the principal comes from the token, never an
 * argument (ADR 0018).
 *
 * `run` takes the Principal first and the transaction that resolved it; the surface
 * wraps every call in `withPrincipal`, so the role is read in the same transaction as
 * the read the entry does.
 */

/** The slices' results are `readonly` throughout; a zod output type is not. This meets them. */
export type Readonlyish<T> = T extends (infer Item)[]
  ? readonly Readonlyish<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: Readonlyish<T[Key]> }
    : T;

export type Entry<Input extends z.ZodObject, Output extends z.ZodType> = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /**
   * Every scope the token must hold to reach this entry; `tools/list` shows only what
   * the token's scopes reach. `knowledge:read` is the surface's prerequisite and is on
   * every entry; the one write needs `feedback:write` as well.
   */
  readonly scopes: readonly McpScope[];
  readonly input: Input;
  readonly output: Output;
  readonly annotations: ToolAnnotations;
  readonly run: (
    principal: UserPrincipal,
    tx: Tx,
    args: z.infer<Input>,
  ) => Promise<Readonlyish<z.infer<Output>>>;
  /** The text of the result — the human rendering, never `JSON.stringify` of the structure. */
  readonly render: (result: Readonlyish<z.infer<Output>>) => string;
};

export const defineEntry = <Input extends z.ZodObject, Output extends z.ZodType>(
  entry: Entry<Input, Output>,
): Entry<Input, Output> => entry;

/** The names an entry's input may never carry: the principal comes from the token (ADR 0018). */
export const FORBIDDEN_ARGUMENT_NAMES = ["workspace", "bundle", "tenant"] as const;
