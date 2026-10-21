import type { AnyRouter, inferProcedureBuilderResolverOptions } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Logger } from "pino";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  err,
  ok,
  type OperatorPrincipal,
  type SecondFactorStanding,
  systemClock,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import type { Tx } from "@better-answers/core/store/postgres";
import {
  ANSWERING_WORKSPACE_HEADER,
  TAB_WORKSPACE_HEADER,
} from "@better-answers/schema/tab-workspace";
import { configProbeWritten } from "@better-answers/schema/testing/probes";

import type { ModelDoors } from "../src/ask-steps.ts";
import { ASK_KEEP_ALIVE_MS } from "../src/ask-stream.ts";
import type { Doors } from "../src/doors.ts";
import type { Refusal, RefusalAnswer } from "../src/refusal.ts";
import type { GatedSessionReader } from "../src/second-factor-gate.ts";
import { askingProcedure } from "../src/trpc/ask.ts";
import {
  crossing,
  mutationProcedure,
  operatorMutationProcedure,
  operatorQueryProcedure,
  ownTransactionProcedure,
  personProcedure,
  queryProcedure,
  router,
} from "../src/trpc/base.ts";
import { knowledgeReadProcedure } from "../src/trpc/knowledge.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { appRouter } from "../src/trpc/router.ts";
import { capturingLogger, doorsFor, type TestClient } from "./harness.ts";
import { signedInClient } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { postedFromATab, sessionMovedTo } from "./web-client.ts";

type QueryContext = inferProcedureBuilderResolverOptions<typeof queryProcedure>["ctx"];
type MutationContext = inferProcedureBuilderResolverOptions<typeof mutationProcedure>["ctx"];
type OwnTransactionContext = inferProcedureBuilderResolverOptions<
  typeof ownTransactionProcedure
>["ctx"];
type AskingContext = inferProcedureBuilderResolverOptions<typeof askingProcedure>["ctx"];

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
    expectTypeOf<QueryContext["modelDoors"]>().toEqualTypeOf<undefined>();
    expectTypeOf<MutationContext["modelDoors"]>().toEqualTypeOf<undefined>();

    // @ts-expect-error — a context holding a transaction reaches no door.
    expectTypeOf<QueryContext["doors"]["postgres"]>().toBeUnknown();
  });

  it("hands the doors and no transaction to the own-transaction road", () => {
    expectTypeOf<OwnTransactionContext["doors"]>().toEqualTypeOf<Doors>();
    expectTypeOf<OwnTransactionContext["modelDoors"]>().toEqualTypeOf<ModelDoors>();
    expectTypeOf<OwnTransactionContext>().not.toHaveProperty("tx");
    expectTypeOf<AskingContext>().toEqualTypeOf<OwnTransactionContext>();
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

const NO_MODEL = {
  credentials: undefined,
  models: {
    callModel: () => Promise.reject(new Error("no procedure here calls a model")),
    decide: () => Promise.reject(new Error("no procedure here calls a model")),
    decideYesNo: () => Promise.reject(new Error("no procedure here calls a model")),
    streamModel: () => {
      throw new Error("no procedure here calls a model");
    },
  },
};

const contextOf = (
  doors: Doors,
  log: Logger,
  readSession: GatedSessionReader,
  headers = new Headers(),
) => ({
  doors,
  modelDoors: NO_MODEL,
  askKeepAliveMs: ASK_KEEP_ALIVE_MS,
  clock: systemClock(),
  readSession,
  headers,
  resHeaders: new Headers(),
  log,
  mail: { send: async () => {}, publicUrl: "https://app.example.test" },
});

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

type Road = "queried" | "mutated";

type Asking = {
  readonly readSession: GatedSessionReader;
  readonly log: Logger;
  readonly held?: string;
};

const askedOver = (road: Road, roads: AnyRouter, { readSession, log, held }: Asking) =>
  fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request(
      `https://app.example.test/trpc/${road}`,
      road === "queried"
        ? { method: "GET" }
        : { method: "POST", headers: { "content-type": "application/json" } },
    ),
    router: roads,
    createContext: () =>
      contextOf(
        app().doors,
        log,
        readSession,
        new Headers(held === undefined ? {} : { [TAB_WORKSPACE_HEADER]: held }),
      ),
  });

const signedInAs =
  (person: { readonly id: string; readonly email: string }, workspaceId: string) => async () => ({
    user: { id: person.id, email: person.email },
    session: {
      id: A_SIGNED_IN_PERSON.session.id,
      createdAt: new Date(),
      activeOrganizationId: workspaceId,
    },
    standing: "not-required" as const,
  });

const askedAsAnAdmin = async (road: Road) => {
  const workspace = await app().provision();
  const key = `probe-${workspace.workspaceId}`;
  const { logger, logs } = capturingLogger();
  const response = await askedOver(road, writingRoads(key), {
    readSession: signedInAs(workspace.admin, workspace.workspaceId),
    log: logger,
    held: workspace.workspaceId,
  });
  const written = await app().database.superuser.query(
    "SELECT 1 FROM workspace_config WHERE workspace_id = $1 AND key = $2",
    [workspace.workspaceId, key],
  );
  return { status: response.status, rows: written.rowCount, logs };
};

const failedLine = z.object({ action: z.string(), err: z.object({ code: z.string() }) });

const operatorWritingRoads = (name: string) => {
  const probeWrite = async (operator: OperatorPrincipal, tx: Tx) => {
    await tx.query('UPDATE "user" SET name = $2 WHERE id = $1', [operator.userId, name]);
    return ok("landed");
  };
  return router({
    queried: operatorQueryProcedure.query(({ ctx }) =>
      crossing(ctx, "probeWrite", probeWrite(ctx.operator, ctx.tx)),
    ),
    mutated: operatorMutationProcedure.mutation(({ ctx }) =>
      crossing(ctx, "probeWrite", probeWrite(ctx.operator, ctx.tx)),
    ),
  });
};

const askedAsTheOperator = async (road: Road) => {
  const workspace = await app().provision();
  await app().markOperator(workspace.admin.email, "grant");
  const name = `probe-${workspace.workspaceId}`;
  const { logger, logs } = capturingLogger();
  const response = await askedOver(road, operatorWritingRoads(name), {
    readSession: signedInAs(workspace.admin, workspace.workspaceId),
    log: logger,
  });
  const written = await app().database.superuser.query(
    'SELECT 1 FROM "user" WHERE id = $1 AND name = $2',
    [workspace.admin.id, name],
  );
  return { status: response.status, rows: written.rowCount, logs };
};

describe.each([
  ["member", askedAsAnAdmin],
  ["operator", askedAsTheOperator],
] as const)("a write on the %s roads", (_side, asked) => {
  it("fails at its statement on the query road, leaving nothing", async () => {
    const { status, rows, logs } = await asked("queried");

    expect([status, rows]).toEqual([500, 0]);
    expect(
      logs.filter((line) => line["event"] === "trpc.failed").map((line) => failedLine.parse(line)),
    ).toEqual([{ action: "probeWrite", err: expect.objectContaining({ code: "25006" }) }]);
  });

  it("lands on the mutation road", async () => {
    const { status, rows } = await asked("mutated");

    expect([status, rows]).toEqual([200, 1]);
  });
});

const definitionOf = z.object({ type: z.string().optional(), middlewares: z.array(z.unknown()) });

/** A road and the procedures built on it carry their definitions, typed by tRPC's own internals. */
const middlewaresOf = (procedure: object) => definitionOf.parse(Reflect.get(procedure, "_def"));

describe("every query the router serves", () => {
  it("runs on a road that opens no read-write transaction itself", () => {
    const roads = [
      queryProcedure,
      knowledgeReadProcedure,
      personProcedure,
      operatorQueryProcedure,
    ].map((road) => middlewaresOf(road).middlewares[0]);

    const queries = Object.entries(appRouter._def.procedures).filter(
      ([, procedure]) => middlewaresOf(procedure).type === "query",
    );
    const elsewhere = queries
      .filter(([, procedure]) => !roads.includes(middlewaresOf(procedure).middlewares[0]))
      .map(([path]) => path);

    expect(queries.map(([path]) => path)).toEqual(
      expect.arrayContaining(["members.list", "console.workspaces.list"]),
    );
    expect(elsewhere).toEqual([]);
  });

  it.each([
    ["member", mutationProcedure, queryProcedure],
    ["operator", operatorMutationProcedure, operatorQueryProcedure],
  ] as const)("tells a query on the %s mutation road apart", (_side, mutationRoad, queryRoad) => {
    const astray = mutationRoad.query(() => "read");

    expect(middlewaresOf(astray).middlewares[0]).toBe(middlewaresOf(mutationRoad).middlewares[0]);
    expect(middlewaresOf(astray).middlewares[0]).not.toBe(middlewaresOf(queryRoad).middlewares[0]);
  });
});

const MUTATIONS = Object.entries(appRouter._def.procedures).filter(
  ([, procedure]) => middlewaresOf(procedure).type === "mutation",
);

const QUERIES = Object.entries(appRouter._def.procedures).filter(
  ([, procedure]) => middlewaresOf(procedure).type === "query",
);

const ROADS_NAMING_NO_WORKSPACE = [
  personProcedure,
  operatorMutationProcedure,
  operatorQueryProcedure,
].map((road) => middlewaresOf(road).middlewares[0]);

const namesNoWorkspace = (procedure: object): boolean =>
  ROADS_NAMING_NO_WORKSPACE.includes(middlewaresOf(procedure).middlewares[0]);

const answeredWord = z.object({
  error: z
    .object({ data: z.object({ refusal: z.object({ word: z.string() }).optional() }) })
    .optional(),
});

const switchedAway = async () => {
  const left = await app().provision();
  const here = await app().provision();
  await app().addMember(here.workspaceId, left.admin.id, "Admin");
  const client = await signedInClient(app(), left.admin.email);
  await sessionMovedTo(client, here.workspaceId);
  return { client, left, here };
};

const queriedFromATab = (client: TestClient, path: string, held?: string): Promise<Response> =>
  client.fetch(`${TRPC_ENDPOINT}/${path}`, {
    headers: held === undefined ? {} : { [TAB_WORKSPACE_HEADER]: held },
  });

const wordOf = async (answered: Response): Promise<string | undefined> =>
  answeredWord.parse(await answered.json()).error?.data.refusal?.word;

const MEMBER_READ = "session.member";

const memberRead = z.object({
  result: z.object({ data: z.object({ workspace: z.object({ id: z.string() }) }) }),
});

describe("every query the router serves on a workspace road", () => {
  it("is refused, its tab naming another workspace", async () => {
    const { client, left } = await switchedAway();
    const paths = QUERIES.filter(
      ([path, procedure]) => !namesNoWorkspace(procedure) && path !== MEMBER_READ,
    ).map(([path]) => path);

    const words: (readonly [string, string | undefined])[] = [];
    for (const path of paths) {
      words.push([path, await wordOf(await queriedFromATab(client, path, left.workspaceId))]);
    }

    expect(paths).toEqual(expect.arrayContaining(["members.list", "knowledge.find"]));
    expect(words).toEqual(paths.map((path) => [path, "workspace-switched"]));
  });

  it("answers the member read whatever workspace the tab names", async () => {
    const { client, left, here } = await switchedAway();

    const answered = await queriedFromATab(client, MEMBER_READ, left.workspaceId);

    expect(answered.status).toBe(200);
    expect(memberRead.parse(await answered.json()).result.data.workspace.id).toBe(here.workspaceId);
  });

  it("answers from the session's workspace when the tab names none", async () => {
    const { client, here } = await switchedAway();

    const unnamed = await queriedFromATab(client, "members.list");
    const named = await queriedFromATab(client, "members.list", here.workspaceId);

    expect([unnamed.status, named.status]).toEqual([200, 200]);
  });

  it("says which workspace answered a read naming none", async () => {
    const { client, here } = await switchedAway();

    const unnamed = await queriedFromATab(client, "members.list");

    expect(unnamed.headers.get(ANSWERING_WORKSPACE_HEADER)).toBe(here.workspaceId);
  });

  it("says no workspace answered a read it refused", async () => {
    const { client, left } = await switchedAway();

    const refused = await queriedFromATab(client, "members.list", left.workspaceId);

    expect(await wordOf(refused)).toBe("workspace-switched");
    expect(refused.headers.get(ANSWERING_WORKSPACE_HEADER)).toBeNull();
  });

  it("says no workspace answered a read on the person's road", async () => {
    const { client } = await switchedAway();
    const paths = QUERIES.filter(([, procedure]) => namesNoWorkspace(procedure)).map(
      ([path]) => path,
    );

    const answering: (string | null)[] = [];
    for (const path of paths) {
      answering.push((await queriedFromATab(client, path)).headers.get(ANSWERING_WORKSPACE_HEADER));
    }

    expect(paths).toEqual(expect.arrayContaining(["person.workspaces"]));
    expect(answering).toEqual(paths.map(() => null));
  });
});

describe("every mutation on an own-transaction road", () => {
  it("is one this list names", () => {
    const roads = [ownTransactionProcedure, askingProcedure].map(
      (road) => middlewaresOf(road).middlewares[0],
    );

    const paths = MUTATIONS.filter(([, procedure]) =>
      roads.includes(middlewaresOf(procedure).middlewares[0]),
    ).map(([path]) => path);

    expect(paths.toSorted()).toEqual([
      "ask.question",
      "members.approveRequest",
      "members.bulkChangeRole",
      "members.bulkResendInvitations",
      "members.changeRole",
      "members.exportAuditLog",
      "members.flagDisplayName",
      "members.invite",
      "members.resendInvitation",
      "sources.connect",
    ]);
  });
});

const WORKSPACE_MUTATIONS = MUTATIONS.filter(([, procedure]) => !namesNoWorkspace(procedure)).map(
  ([path]) => path,
);

const wordsOfEach = async (
  paths: readonly string[],
  posted: (path: string) => Promise<Response>,
): Promise<(readonly [string, string | undefined])[]> => {
  const words: (readonly [string, string | undefined])[] = [];
  for (const path of paths) {
    const answered = await posted(`${TRPC_ENDPOINT}/${path}`);
    words.push([path, answeredWord.parse(await answered.json()).error?.data.refusal?.word]);
  }
  return words;
};

describe("every mutation the router serves", () => {
  it("is refused on a workspace road, its tab naming another", async () => {
    const { client, left } = await switchedAway();

    const words = await wordsOfEach(WORKSPACE_MUTATIONS, (path) =>
      postedFromATab(client, path, {}, left.workspaceId),
    );

    expect(WORKSPACE_MUTATIONS).toEqual(
      expect.arrayContaining(["members.remove", "members.invite", "sources.connect"]),
    );
    expect(words).toEqual(WORKSPACE_MUTATIONS.map((path) => [path, "workspace-switched"]));
  });

  it("is refused on a workspace road, its tab naming none", async () => {
    const { client } = await switchedAway();

    const words = await wordsOfEach(WORKSPACE_MUTATIONS, (path) => client.json(path, {}));

    expect(words).toEqual(WORKSPACE_MUTATIONS.map((path) => [path, "workspace-unnamed"]));
  });

  it("never asks the person's or operator's road for a workspace", async () => {
    const { client } = await switchedAway();
    const paths = MUTATIONS.filter(([, procedure]) => namesNoWorkspace(procedure)).map(
      ([path]) => path,
    );

    const words: (string | undefined)[] = [];
    for (const path of paths) {
      const answered = await client.json(`${TRPC_ENDPOINT}/${path}`, {});
      words.push(answeredWord.parse(await answered.json()).error?.data.refusal?.word);
    }

    expect(paths).toEqual(
      expect.arrayContaining(["person.setDisplayName", "console.people.correctDisplayName"]),
    );
    expect(words).not.toContain("workspace-switched");
  });
});
