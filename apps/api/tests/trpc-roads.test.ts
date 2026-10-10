import type { inferProcedureBuilderResolverOptions } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Logger } from "pino";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  err,
  ok,
  type SecondFactorStanding,
  systemClock,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import type { Tx } from "@better-answers/core/store/postgres";
import { configProbeWritten } from "@better-answers/schema/testing/probes";

import type { Doors } from "../src/doors.ts";
import type { Refusal, RefusalAnswer } from "../src/refusal.ts";
import type { GatedSessionReader } from "../src/second-factor-gate.ts";
import {
  crossing,
  mutationProcedure,
  operatorProcedure,
  ownTransactionProcedure,
  personProcedure,
  queryProcedure,
  router,
} from "../src/trpc/base.ts";
import { appRouter } from "../src/trpc/router.ts";
import { capturingLogger, doorsFor } from "./harness.ts";
import { appForSuite } from "./suite-app.ts";

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

const contextOf = (doors: Doors, log: Logger, readSession: GatedSessionReader) => ({
  doors,
  clock: systemClock(),
  readSession,
  headers: new Headers(),
  log,
  mail: { send: async () => {}, publicUrl: "https://app.example.test" },
});

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
    createContext: () =>
      contextOf(NO_DATABASE, logger, async () => ({ ...A_SIGNED_IN_PERSON, standing })),
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

const app = appForSuite();

/** One body on both member roads: the same write, through each road's own resolver. */
const writingRoads = (key: string) => {
  const probeWrite = async (principal: UserPrincipal, tx: Tx) => {
    await configProbeWritten(tx, principal.workspaceId, key);
    return ok("landed");
  };
  return router({
    queried: queryProcedure.query(({ ctx }) =>
      crossing(ctx, "probeWrite", probeWrite(ctx.principal, ctx.tx)),
    ),
    mutated: mutationProcedure.mutation(({ ctx }) =>
      crossing(ctx, "probeWrite", probeWrite(ctx.principal, ctx.tx)),
    ),
  });
};

/** Asked as the web asks, as a workspace's Admin: a query over GET, a mutation over POST. */
const askedAsAnAdmin = async (road: "queried" | "mutated") => {
  const workspace = await app().provision();
  const key = `probe-${workspace.workspaceId}`;
  const { logger, logs } = capturingLogger();
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request(
      `https://app.example.test/trpc/${road}`,
      road === "queried"
        ? { method: "GET" }
        : { method: "POST", headers: { "content-type": "application/json" } },
    ),
    router: writingRoads(key),
    createContext: () =>
      contextOf(app().doors, logger, async () => ({
        user: { id: workspace.admin.id, email: workspace.admin.email },
        session: {
          id: A_SIGNED_IN_PERSON.session.id,
          createdAt: new Date(),
          activeOrganizationId: workspace.workspaceId,
        },
        standing: "not-required",
      })),
  });
  const written = await app().database.superuser.query(
    "SELECT 1 FROM workspace_config WHERE workspace_id = $1 AND key = $2",
    [workspace.workspaceId, key],
  );
  return { status: response.status, rows: written.rowCount, logs };
};

const failedLine = z.object({ action: z.string(), err: z.object({ code: z.string() }) });

describe("a write on the member roads", () => {
  it("fails at its statement on the query road, leaving nothing", async () => {
    const { status, rows, logs } = await askedAsAnAdmin("queried");

    expect([status, rows]).toEqual([500, 0]);
    expect(
      logs.filter((line) => line["event"] === "trpc.failed").map((line) => failedLine.parse(line)),
    ).toEqual([{ action: "probeWrite", err: expect.objectContaining({ code: "25006" }) }]);
  });

  it("lands on the mutation road", async () => {
    const { status, rows } = await askedAsAnAdmin("mutated");

    expect([status, rows]).toEqual([200, 1]);
  });
});

const definitionOf = z.object({ type: z.string().optional(), middlewares: z.array(z.unknown()) });

/** A road and the procedures built on it carry their definitions, typed by tRPC's own internals. */
const middlewaresOf = (procedure: object) => definitionOf.parse(Reflect.get(procedure, "_def"));

describe("every query the router serves", () => {
  it("runs on a road that opens no read-write member transaction", () => {
    const roads = [queryProcedure, personProcedure, operatorProcedure].map(
      (road) => middlewaresOf(road).middlewares[0],
    );

    const queries = Object.entries(appRouter._def.procedures).filter(
      ([, procedure]) => middlewaresOf(procedure).type === "query",
    );
    const elsewhere = queries
      .filter(([, procedure]) => !roads.includes(middlewaresOf(procedure).middlewares[0]))
      .map(([path]) => path);

    expect(queries.map(([path]) => path)).toContain("members.list");
    expect(elsewhere).toEqual([]);
  });

  it("tells a query on the mutation road apart", () => {
    const astray = mutationProcedure.query(() => "read");

    expect(middlewaresOf(astray).middlewares[0]).toBe(
      middlewaresOf(mutationProcedure).middlewares[0],
    );
    expect(middlewaresOf(astray).middlewares[0]).not.toBe(
      middlewaresOf(queryProcedure).middlewares[0],
    );
  });
});
