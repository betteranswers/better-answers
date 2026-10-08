import type { inferProcedureBuilderResolverOptions } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  err,
  type SecondFactorStanding,
  systemClock,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import type { Tx } from "@better-answers/core/store/postgres";

import type { Doors } from "../src/doors.ts";
import type { Refusal, RefusalAnswer } from "../src/refusal.ts";
import {
  crossing,
  mutationProcedure,
  ownTransactionProcedure,
  personProcedure,
  queryProcedure,
  router,
} from "../src/trpc/base.ts";
import { capturingLogger, doorsFor } from "./harness.ts";

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

  it("keeps every door from a procedure inside the resolver's transaction", () => {
    expectTypeOf<QueryContext["tx"]>().toEqualTypeOf<Tx>();
    expectTypeOf<QueryContext["doors"]>().toEqualTypeOf<undefined>();
    expectTypeOf<MutationContext["tx"]>().toEqualTypeOf<Tx>();
    expectTypeOf<MutationContext["doors"]>().toEqualTypeOf<undefined>();

    // @ts-expect-error — a context holding a transaction reaches no door.
    expectTypeOf<QueryContext["doors"]["postgres"]>().toBeUnknown();
  });

  it("hands the doors and no transaction to the own-transaction road", () => {
    expectTypeOf<OwnTransactionContext["doors"]>().toEqualTypeOf<Doors>();
    expectTypeOf<OwnTransactionContext>().not.toHaveProperty("tx");
  });

  it("hands every road the Principal its own door re-judges", () => {
    expectTypeOf<QueryContext["principal"]>().toEqualTypeOf<UserPrincipal>();
    expectTypeOf<MutationContext["principal"]>().toEqualTypeOf<UserPrincipal>();
    expectTypeOf<OwnTransactionContext["principal"]>().toEqualTypeOf<UserPrincipal>();
  });
});

const FIRST_ID = "01K6H0A7Q3W9E2R5T8Y1U4I6O0";
const SECOND_ID = "01K6H0A7Q3W9E2R5T8Y1U4I6O1";

/** Nothing here queries, and a pool opens no connection until something does. */
const NO_DATABASE = doorsFor("postgres://nobody@127.0.0.1:1/none");

const A_SIGNED_IN_PERSON = {
  user: { id: "01K6H0A7Q3W9E2R5T8Y1U4I6P0", email: "priya@acme.test" },
  session: { id: "01K6H0A7Q3W9E2R5T8Y1U4I6P1", createdAt: new Date("2026-10-01T09:00:00.000Z") },
  standing: "not-required",
} as const;

const wire = z.object({ error: z.object({ data: z.object({ refusal: z.unknown() }) }) });

/** A procedure whose action answers `answered`, asked as the web asks, through tRPC's own handler. */
const refusalCrossing = async (
  answered: RefusalAnswer,
  standing: SecondFactorStanding = A_SIGNED_IN_PERSON.standing,
) => {
  const { logger, logs } = capturingLogger();
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request("https://app.example.test/trpc/refuseTheSet", {
      method: "POST",
      headers: { "content-type": "application/json" },
    }),
    router: router({
      refuseTheSet: personProcedure.mutation(({ ctx }) =>
        crossing(ctx, "refuseTheSet", Promise.resolve(err(answered))),
      ),
    }),
    createContext: () => ({
      doors: NO_DATABASE,
      clock: systemClock(),
      readSession: async () => ({ ...A_SIGNED_IN_PERSON, standing }),
      headers: new Headers(),
      log: logger,
      mail: { send: async () => {}, publicUrl: "https://app.example.test" },
    }),
  });
  const { refusal } = wire.parse(await response.json()).error.data;
  return { status: response.status, refusal, logs };
};

describe("a refusal naming items, crossing tRPC", () => {
  it("sends each item's word keyed by id, beside the set's", async () => {
    const crossed = await refusalCrossing({
      word: "last-admin",
      items: { [FIRST_ID]: "last-admin", [SECOND_ID]: "no-such-member" },
    });

    expect(crossed.status).toBe(412);
    expect(crossed.refusal).toStrictEqual({
      word: "last-admin",
      class: "precondition",
      items: { [FIRST_ID]: "last-admin", [SECOND_ID]: "no-such-member" },
    });
  });

  it.each([
    ["a word", "no-such-member", 404, { word: "no-such-member", class: "absent" }],
    [
      "a malformed input",
      { word: "malformed", fields: { memberIds: "too-big" } },
      400,
      { word: "malformed", class: "malformed", fields: { memberIds: "too-big" } },
    ],
  ] as const)("sends %s exactly as before, with no items", async (_, answered, status, sent) => {
    const crossed = await refusalCrossing(answered);

    expect(crossed.status).toBe(status);
    expect(crossed.refusal).toStrictEqual(sent);
  });

  it("types a refusal's detail as fields or items, never both", () => {
    type Malformed = { word: "malformed"; class: "malformed" };
    type Fields = { fields: { memberIds: "too-big" } };
    type Items = { items: Record<string, "malformed"> };

    expectTypeOf<Malformed>().toExtend<Refusal>();
    expectTypeOf<Malformed & Fields>().toExtend<Refusal>();
    expectTypeOf<Malformed & Items>().toExtend<Refusal>();
    expectTypeOf<Malformed & Fields & Items>().not.toExtend<Refusal>();
  });

  it("logs the set's word and class, never an item id", async () => {
    const { logs } = await refusalCrossing({
      word: "last-admin",
      items: { [FIRST_ID]: "last-admin", [SECOND_ID]: "no-such-member" },
    });

    const refused = logs.filter((line) => line["event"] === "trpc.refused");
    expect(refused.map((line) => [line["action"], line["refusal"], line["class"]])).toEqual([
      ["refuseTheSet", "last-admin", "precondition"],
    ]);
    expect(JSON.stringify(refused)).not.toMatch(/01K6H0A7Q3W9E2R5T8Y1U4I6O[01]/);
  });
});

describe("a pending session crossing tRPC", () => {
  it("refuses a procedure outside the pending set before its action", async () => {
    for (const standing of ["confirm", "setup"] as const) {
      const crossed = await refusalCrossing("no-such-member", standing);

      expect([crossed.status, crossed.refusal]).toStrictEqual([
        412,
        { word: "second-factor-pending", class: "precondition" },
      ]);
    }
  });

  it("lets a confirmed session through to the action's own answer", async () => {
    const crossed = await refusalCrossing("no-such-member", "confirmed");

    expect(crossed.refusal).toStrictEqual({ word: "no-such-member", class: "absent" });
  });
});
