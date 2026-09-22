import type { inferProcedureBuilderResolverOptions } from "@trpc/server";
import { describe, expect, expectTypeOf, it } from "vitest";

import type { UserPrincipal } from "@better-answers/core/kernel";
import type { Tx } from "@better-answers/core/store/postgres";

import type { Doors } from "../src/doors.ts";
import { mutationProcedure, ownTransactionProcedure, queryProcedure } from "../src/trpc/base.ts";

type QueryContext = inferProcedureBuilderResolverOptions<typeof queryProcedure>["ctx"];
type MutationContext = inferProcedureBuilderResolverOptions<typeof mutationProcedure>["ctx"];
type OwnTransactionContext = inferProcedureBuilderResolverOptions<
  typeof ownTransactionProcedure
>["ctx"];

describe("the three roads a procedure takes", () => {
  it("is three procedures, not one wearing three names", () => {
    const roads = new Set([queryProcedure, mutationProcedure, ownTransactionProcedure]);

    expect(roads.size).toBe(3);
  });

  it("keeps every door from a procedure that runs inside the resolver's transaction", () => {
    expectTypeOf<QueryContext["tx"]>().toEqualTypeOf<Tx>();
    expectTypeOf<QueryContext["doors"]>().toEqualTypeOf<undefined>();
    expectTypeOf<MutationContext["tx"]>().toEqualTypeOf<Tx>();
    expectTypeOf<MutationContext["doors"]>().toEqualTypeOf<undefined>();

    // @ts-expect-error — a context holding a transaction reaches no door, so this pairing
    // does not compile.
    expectTypeOf<QueryContext["doors"]["postgres"]>().toBeUnknown();
  });

  it("hands the doors, and no transaction, to a procedure whose act opens its own", () => {
    expectTypeOf<OwnTransactionContext["doors"]>().toEqualTypeOf<Doors>();
    expectTypeOf<OwnTransactionContext>().not.toHaveProperty("tx");
  });

  it("hands every road the Principal its own door re-judges", () => {
    expectTypeOf<QueryContext["principal"]>().toEqualTypeOf<UserPrincipal>();
    expectTypeOf<MutationContext["principal"]>().toEqualTypeOf<UserPrincipal>();
    expectTypeOf<OwnTransactionContext["principal"]>().toEqualTypeOf<UserPrincipal>();
  });
});
