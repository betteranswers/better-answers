import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";

import type { UserPrincipal } from "@better-answers/core/kernel";
import type { Tx } from "@better-answers/core/store/postgres";

import type { McpScope } from "../../auth/constants.ts";

type Readonlyish<T> = T extends (infer Item)[]
  ? readonly Readonlyish<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: Readonlyish<T[Key]> }
    : T;

export type Entry<Input extends z.ZodObject, Output extends z.ZodType> = {
  readonly name: string;
  readonly title: string;
  readonly description: string;

  readonly scopes: readonly McpScope[];
  readonly input: Input;
  readonly output: Output;
  readonly annotations: ToolAnnotations;
  readonly run: (
    principal: UserPrincipal,
    tx: Tx,
    args: z.infer<Input>,
    now: Date,
  ) => Promise<Readonlyish<z.infer<Output>>>;

  readonly render: (result: Readonlyish<z.infer<Output>>) => string;
};

export const defineEntry = <Input extends z.ZodObject, Output extends z.ZodType>(
  entry: Entry<Input, Output>,
): Entry<Input, Output> => entry;
