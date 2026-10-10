import type { OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { ok, type UserPrincipal } from "@better-answers/core/kernel";
import { withPrincipal, withPrincipalRead, type Tx } from "@better-answers/core/store/postgres";
import { configProbeWritten } from "@better-answers/schema/testing/probes";

import { MCP_SCOPES } from "../src/auth/constants.ts";
import type { Entry } from "../src/mcp/entries/define.ts";
import { entriesAt } from "../src/mcp/entries/index.ts";
import { createMcpSurface, doorOf } from "../src/mcp/surface.ts";
import { capturingLogger, MCP_URL, PUBLIC_URL } from "./harness.ts";
import { rendered, toolAnswered } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

type ServedEntry = Entry<z.ZodObject, z.ZodType>;

/** What a probe keeps of the entry it stands for: its name and what it declares. */
type Declared = Pick<ServedEntry, "name" | "scopes" | "annotations">;

/** The schemas are the probe's own, so the call reaches the action whatever its entry takes. */
const writing = (declared: Declared, key: string): ServedEntry => ({
  ...declared,
  title: "Probe",
  description: "Writes one row.",
  input: z.object({}),
  output: z.object({ outcome: z.literal("landed") }),
  run: async (principal, tx) => {
    await configProbeWritten(tx, principal.workspaceId, key);
    return ok({ outcome: "landed" });
  },
  render: () => "landed",
});

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

const probe = (readOnlyHint: boolean): Declared => ({
  name: "probe",
  scopes: ["knowledge:read"],
  annotations: { readOnlyHint },
});

describe("a write inside an entry's transaction", () => {
  it("fails at its statement where the entry declares the hint", async () => {
    const { said, rows, failed } = await calledAsAnAdmin(probe(true));

    expect([said, rows]).toEqual(["probe failed.", 0]);
    expect(failed).toEqual([{ entry: "probe", err: expect.objectContaining({ code: "25006" }) }]);
  });

  it("lands under an entry that declares it writes", async () => {
    const { said, rows, failed } = await calledAsAnAdmin(probe(false));

    expect([said, rows, failed]).toEqual(["landed", 1, []]);
  });
});

describe("every entry the server composes", () => {
  it("opens its transaction as its own hint declares", async () => {
    const outcomes: unknown[] = [];
    for (const entry of entriesAt(PUBLIC_URL)) {
      const { said, rows, failed } = await calledAsAnAdmin(entry);
      outcomes.push([entry.name, said, rows, failed.map((line) => line.err.code)]);
    }

    expect(outcomes).toEqual([
      ["find", "find failed.", 0, ["25006"]],
      ["ask", "ask failed.", 0, ["25006"]],
      ["open", "open failed.", 0, ["25006"]],
      ["give_feedback", "landed", 1, []],
    ]);
  });

  it("is handed no door to open a second transaction through", () => {
    expectTypeOf(entriesAt).parameters.toEqualTypeOf<[origin: string]>();
    expectTypeOf<Parameters<ServedEntry["run"]>>().toEqualTypeOf<
      [principal: UserPrincipal, tx: Tx, args: z.infer<z.ZodObject>, now: Date]
    >();
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
