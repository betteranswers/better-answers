import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";

import type { AskSteps } from "@better-answers/core/answering";
import type { Result, UserPrincipal } from "@better-answers/core/kernel";
import type { Tx } from "@better-answers/core/store/postgres";

import type { StepRefusal } from "../../ask/ask-steps.ts";
import type { McpScope } from "../../auth/constants.ts";
import type { RefusalAnswer } from "../../refusal.ts";

type Readonlyish<T> = T extends (infer Item)[]
  ? readonly Readonlyish<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: Readonlyish<T[Key]> }
    : T;

type EntryOn<Road extends string, Lent, Input extends z.ZodObject, Output extends z.ZodType> = {
  readonly road: Road;
  readonly name: string;
  readonly title: string;
  readonly description: string;

  readonly scopes: readonly McpScope[];
  readonly input: Input;
  readonly output: Output;
  readonly annotations: ToolAnnotations;
  readonly run: (
    principal: UserPrincipal,
    lent: Lent,
    args: z.infer<Input>,
    now: Date,
  ) => Promise<Result<Readonlyish<z.infer<Output>>, RefusalAnswer | Error>>;

  readonly render: (result: Readonlyish<z.infer<Output>>) => string;
};

export type TransactionEntry<Input extends z.ZodObject, Output extends z.ZodType> = EntryOn<
  "resolvers-transaction",
  Tx,
  Input,
  Output
>;

export type StepsEntry<Input extends z.ZodObject, Output extends z.ZodType> = EntryOn<
  "own-transaction",
  AskSteps<StepRefusal>,
  Input,
  Output
>;

export type Entry<Input extends z.ZodObject, Output extends z.ZodType> =
  | TransactionEntry<Input, Output>
  | StepsEntry<Input, Output>;

export const defineEntry = <Input extends z.ZodObject, Output extends z.ZodType>(
  entry: Entry<Input, Output>,
): Entry<Input, Output> => entry;
