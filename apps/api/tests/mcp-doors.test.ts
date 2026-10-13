import type { OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import type { AskSteps } from "@better-answers/core/answering";
import {
  attempt,
  ok,
  type PrincipalRefusal,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import { withPrincipal, withPrincipalRead, type Tx } from "@better-answers/core/store/postgres";
import type { JudgeState, QuestionVerdict } from "@better-answers/schema";
import { configProbeWritten } from "@better-answers/schema/testing/probes";

import { MCP_SCOPES } from "../src/auth/constants.ts";
import type { Entry, StepsEntry, TransactionEntry } from "../src/mcp/entries/define.ts";
import { entriesAt } from "../src/mcp/entries/index.ts";
import { createMcpSurface, doorOf } from "../src/mcp/surface.ts";
import { capturingLogger, MCP_URL, PUBLIC_URL } from "./harness.ts";
import { rendered, toolAnswered } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

type ServedEntry = Entry<z.ZodObject, z.ZodType>;

/** What a probe keeps of the entry it stands for: its road, its name and what it declares. */
type Declared = Pick<ServedEntry, "road" | "name" | "scopes" | "annotations">;

/** The schemas are the probe's own, so the call reaches the action whatever its entry takes. */
const PROBE = {
  title: "Probe",
  description: "Writes one row.",
  input: z.object({}),
  output: z.object({ outcome: z.literal("landed") }),
  render: () => "landed",
};

/** Writes through the one transaction its road lets it reach: its own, or its read step's. */
const writing = ({ road, ...declared }: Declared, key: string): ServedEntry =>
  road === "own-transaction"
    ? {
        ...declared,
        ...PROBE,
        road,
        run: async (principal, steps) => {
          const written = await steps.read((tx) =>
            attempt(() => configProbeWritten(tx, principal.workspaceId, key)),
          );
          return written.ok ? ok({ outcome: "landed" }) : written;
        },
      }
    : {
        ...declared,
        ...PROBE,
        road,
        run: async (principal, tx) => {
          await configProbeWritten(tx, principal.workspaceId, key);
          return ok({ outcome: "landed" });
        },
      };

/** The bearer check alone is stood in for; the gate and the member resolve behind it are real. */
const verifiedAs = (claims: {
  readonly workspaceId: string;
  readonly userId: string;
}): OAuthTokenVerifier => ({
  verifyAccessToken: async (token) => ({
    token,
    clientId: "probe",
    scopes: [...MCP_SCOPES],
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    extra: { tokenId: `probe-${claims.workspaceId}`, claims: { ...claims, issuedAt: new Date() } },
  }),
});

const failedLine = z.object({ entry: z.string(), err: z.object({ code: z.string() }) });

/** Called through the surface as a workspace's Admin, the probe standing for `declared`. */
const calledAsAnAdmin = async (declared: Declared) => {
  const workspace = await app().provision();
  const key = `probe-${workspace.workspaceId}`;
  const { logger, logs } = capturingLogger();
  const surface = createMcpSurface({
    door: app().doors.postgres,
    verifier: verifiedAs({ workspaceId: workspace.workspaceId, userId: workspace.admin.id }),
    publicUrl: PUBLIC_URL,
    mcpUrl: MCP_URL,
    logger,
    serverVersion: "0.0.0",
    clock: app().doors.clock,
    entries: [writing(declared, key)],
  });

  const answer = await toolAnswered(
    { fetch: async (path, init) => surface(new Request(`${PUBLIC_URL}${path}`, init)) },
    "a-bearer",
    declared.name,
    {},
  );
  const written = await app().database.superuser.query(
    "SELECT 1 FROM workspace_config WHERE workspace_id = $1 AND key = $2",
    [workspace.workspaceId, key],
  );
  return {
    said: rendered(answer),
    rows: written.rowCount,
    failed: logs
      .filter((line) => line["event"] === "mcp.failed")
      .map((line) => failedLine.parse(line)),
  };
};

const probe = (
  readOnlyHint: boolean,
  road: Declared["road"] = "resolvers-transaction",
): Declared => ({
  road,
  name: "probe",
  scopes: ["knowledge:read"],
  annotations: { readOnlyHint },
});

/** Postgres refused the write at its statement, and the transaction left no row. */
const FAILED_AT_ITS_STATEMENT = {
  said: "probe failed.",
  rows: 0,
  failed: [{ entry: "probe", err: expect.objectContaining({ code: "25006" }) }],
};

describe("a write inside an entry's transaction", () => {
  it("fails at its statement where the entry declares the hint", async () => {
    expect(await calledAsAnAdmin(probe(true))).toEqual(FAILED_AT_ITS_STATEMENT);
  });

  it("lands under an entry that declares it writes", async () => {
    const { said, rows, failed } = await calledAsAnAdmin(probe(false));

    expect([said, rows, failed]).toEqual(["landed", 1, []]);
  });
});

describe("a write through the own-transaction road's read step", () => {
  it.each([
    ["a read-only entry", true],
    ["a writing entry", false],
  ])("fails at its statement under %s", async (_case, readOnlyHint) => {
    expect(await calledAsAnAdmin(probe(readOnlyHint, "own-transaction"))).toEqual(
      FAILED_AT_ITS_STATEMENT,
    );
  });
});

describe("every entry the server composes", () => {
  it("fails a write wherever its road or hint forbids one", async () => {
    const outcomes: unknown[] = [];
    for (const entry of entriesAt(PUBLIC_URL)) {
      const { said, rows, failed } = await calledAsAnAdmin(entry);
      outcomes.push([entry.name, entry.road, said, rows, failed.map((line) => line.err.code)]);
    }

    expect(outcomes).toEqual([
      ["find", "resolvers-transaction", "find failed.", 0, ["25006"]],
      ["ask", "own-transaction", "ask failed.", 0, ["25006"]],
      ["open", "resolvers-transaction", "open failed.", 0, ["25006"]],
      ["give_feedback", "resolvers-transaction", "landed", 1, []],
    ]);
  });

  it("is handed no door to open a second transaction through", () => {
    expectTypeOf(entriesAt).parameters.toEqualTypeOf<[origin: string]>();
    expectTypeOf<Parameters<TransactionEntry<z.ZodObject, z.ZodType>["run"]>>().toEqualTypeOf<
      [principal: UserPrincipal, tx: Tx, args: z.infer<z.ZodObject>, now: Date]
    >();
    expectTypeOf<Parameters<StepsEntry<z.ZodObject, z.ZodType>["run"]>>().toEqualTypeOf<
      [
        principal: UserPrincipal,
        steps: AskSteps<PrincipalRefusal>,
        args: z.infer<z.ZodObject>,
        now: Date,
      ]
    >();
  });
});

describe("the steps the own-transaction road hands an entry", () => {
  type Steps = AskSteps<PrincipalRefusal>;

  it("are the record's two writes and one read", () => {
    expectTypeOf<keyof Steps>().toEqualTypeOf<"openRecord" | "read" | "completeRecord">();
  });

  it("take a record's data, never a transaction to write through", () => {
    expectTypeOf<Parameters<Steps["openRecord"]>>().toEqualTypeOf<
      [
        opening: {
          readonly question: string;
          readonly collections: readonly string[];
          readonly askedAt: Date;
        },
      ]
    >();
    type Completion = Parameters<Steps["completeRecord"]>[0];
    expectTypeOf<Parameters<Steps["completeRecord"]>>().toEqualTypeOf<[completion: Completion]>();
    expectTypeOf<Omit<Completion, "concepts">>().toEqualTypeOf<{
      readonly recordId: string;
      readonly verdict: QuestionVerdict;
      readonly judgeState: JudgeState;
      readonly unmappedPassages: readonly { readonly locator: string }[];
    }>();
    expectTypeOf<keyof Completion["concepts"][number]>().toEqualTypeOf<
      "iri" | "contentHash" | "trust" | "judged"
    >();
  });

  it("lend a transaction to the read step alone", () => {
    expectTypeOf<Parameters<Parameters<Steps["read"]>[0]>>().toEqualTypeOf<[tx: Tx]>();
  });
});

describe("the door an entry's transaction opens through", () => {
  it.each([
    ["read-only where the hint is declared true", { readOnlyHint: true }, withPrincipalRead],
    ["read-write where the hint is declared false", { readOnlyHint: false }, withPrincipal],
    ["read-write where no hint is declared", {}, withPrincipal],
  ])("is %s", (_case, annotations, door) => {
    expect(doorOf(annotations)).toBe(door);
  });
});
