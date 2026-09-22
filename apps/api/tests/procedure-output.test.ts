import type { AnyProcedure, inferProcedureOutput } from "@trpc/server";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { Result } from "@better-answers/core/kernel";

import { appRouter, type AppRouter } from "../src/trpc/router.ts";

type Leaf<Path extends string, Output> = { readonly path: Path; readonly output: Output };

type LeavesOf<Node, Here extends string> = Node extends AnyProcedure
  ? Leaf<Here, inferProcedureOutput<Node>>
  : {
      readonly [Key in keyof Node & string]: LeavesOf<
        Node[Key],
        Here extends "" ? Key : `${Here}.${Key}`
      >;
    }[keyof Node & string];

type EveryProcedure = LeavesOf<AppRouter["_def"]["procedures"], "">;

type ResultAnswering<Leaves> = Extract<Leaves, Leaf<string, { readonly ok: boolean }>>;

type PathsAnsweringAResult<Leaves> = [ResultAnswering<Leaves>] extends [never]
  ? "none"
  : ResultAnswering<Leaves>["path"];

describe("what a procedure may answer the wire", () => {
  it("reaches every procedure the router carries, by the path its caller names", () => {
    expect(Object.keys(appRouter._def.procedures).sort()).toEqual([
      "routes.list",
      "session.membership",
    ]);
    expectTypeOf<EveryProcedure["path"]>().toEqualTypeOf<"session.membership" | "routes.list">();
  });

  it("answers no caller a Result, which would cross a refusal as a success", () => {
    expectTypeOf<PathsAnsweringAResult<EveryProcedure>>().toEqualTypeOf<"none">();
  });

  it("names the procedure that answered one, by its path", () => {
    expectTypeOf<
      PathsAnsweringAResult<Leaf<"sources.narrow", Result<string, "no-such-binding">>>
    >().toEqualTypeOf<"sources.narrow">();
  });
});
