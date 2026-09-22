import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { REFUSAL_CLASSES } from "@better-answers/core/kernel";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { connectAsHost } from "./flow.ts";
import { startApp, type LogLine, type TestApp, type TestClient } from "./harness.ts";
import { callMcp } from "./mcp-call.ts";
import {
  constraintDefinition,
  memberOfTwoWorkspaces,
  sessionPointedAt,
  signedInClient,
} from "./provoke.ts";

const MEMBERSHIP = `${TRPC_ENDPOINT}/session.membership`;

const MEMBER_WORKSPACE_FK = "member_workspace_id_workspace_id_fk";

// `ops` reaches malformed and the two transports reach unauthenticated; every other class waits on
// an act no entry calls yet.
const NO_ENTRY_REACHES_THESE_YET = [
  "forbidden",
  "absent",
  "inapplicable",
  "conflict",
  "precondition",
];

const REACHED_TODAY = ["unauthenticated", "malformed"];

const crossed = z.object({
  error: z.object({
    message: z.string(),
    data: z.object({
      httpStatus: z.number(),
      refusal: z.object({ word: z.string(), class: z.string() }).optional(),
    }),
  }),
});

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

beforeEach(() => {
  app.logs.length = 0;
});

const membership = (client: TestClient): Promise<Response> => client.fetch(MEMBERSHIP);

const refusalCrossing = async (response: Response) => crossed.parse(await response.json()).error;

const logsOf = (event: string): readonly LogLine[] =>
  app.logs.filter((line) => line["event"] === event);

const withColumnRenamed = async (
  table: string,
  column: string,
  work: () => Promise<void>,
): Promise<void> => {
  const { superuser } = app.database;
  await superuser.query(`ALTER TABLE "${table}" RENAME COLUMN "${column}" TO "${column}_gone"`);
  try {
    await work();
  } finally {
    await superuser.query(`ALTER TABLE "${table}" RENAME COLUMN "${column}_gone" TO "${column}"`);
  }
};

const toolResult = z.object({
  result: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string() })),
    isError: z.boolean().optional(),
  }),
});

const toolText = async (
  client: TestClient,
  token: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<{ readonly text: string; readonly isError: boolean }> => {
  const called = await callMcp(client, token, "tools/call", { name, arguments: args });
  const body = await called.text();
  const streamed = [...body.matchAll(/^data:(.*)$/gm)].at(-1)?.[1];
  const { result } = toolResult.parse(JSON.parse(streamed ?? body));
  return { text: result.content[0]?.text ?? "", isError: result.isError ?? false };
};

const asAnAgent = async (): Promise<{ readonly client: TestClient; readonly token: string }> => {
  const workspace = await app.provision();
  const client = app.client();
  const tokens = await connectAsHost(app, client, workspace.admin);
  return { client, token: tokens.accessToken };
};

describe("a refusal crossing tRPC", () => {
  it.each([
    ["no-session", async () => membership(app.client())],
    ["no-active-workspace", async () => membership(await memberOfTwoWorkspaces(app))],
    [
      "not-a-member",
      async () => {
        const workspace = await app.provision();
        const client = await signedInClient(app, workspace.admin.email);
        await app.removeMember(workspace.workspaceId, workspace.admin.id);
        return membership(client);
      },
    ],
    [
      "credentials-revoked",
      async () => {
        const workspace = await app.provision();
        await app.revokeCredentials(workspace.admin.id, new Date(Date.now() + 60_000));
        return membership(await signedInClient(app, workspace.admin.email));
      },
    ],
    [
      "malformed-claims",
      async () => {
        const workspace = await app.provision();
        const client = await signedInClient(app, workspace.admin.email);
        await sessionPointedAt(app, workspace.admin.id, "not-a-workspace-id");
        return membership(client);
      },
    ],
  ])("sends %s as itself, under the status its class carries", async (word, provoke) => {
    const response = await provoke();

    expect(response.status).toBe(401);
    const { message, data } = await refusalCrossing(response);
    expect(message).toBe(word);
    expect(data.refusal).toEqual({ word, class: "unauthenticated" });
  });

  it("sends the membership read's own refusal as a word of the class it crosses under", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(app, workspace.admin.email);
    const definition = await constraintDefinition(app, MEMBER_WORKSPACE_FK);
    const phantom = ulid();
    const { superuser } = app.database;

    await superuser.query(`ALTER TABLE "member" DROP CONSTRAINT "${MEMBER_WORKSPACE_FK}"`);
    const seed = await superuser.connect();
    try {
      await testData(seed).member({
        workspaceId: phantom,
        userId: workspace.admin.id,
        role: "Admin",
      });
    } finally {
      seed.release();
    }
    try {
      await sessionPointedAt(app, workspace.admin.id, phantom);

      const response = await membership(client);

      expect(response.status).toBe(401);
      expect((await refusalCrossing(response)).data.refusal).toEqual({
        word: "workspace-gone",
        class: "unauthenticated",
      });
    } finally {
      await superuser.query("DELETE FROM member WHERE workspace_id = $1", [phantom]);
      await superuser.query(
        `ALTER TABLE "member" ADD CONSTRAINT "${MEMBER_WORKSPACE_FK}" ${definition}`,
      );
    }
  });

  it("logs a refusal once, at info, with the word the caller was sent", async () => {
    await membership(app.client());

    expect(
      logsOf("trpc.refused").map((line) => [line["refusal"], line["class"], line["level"]]),
    ).toEqual([["no-session", "unauthenticated", 30]]);
    expect(logsOf("trpc.failed")).toEqual([]);
  });

  it("sends a failure as an internal one, saying nothing of the fault, and logs it once", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(app, workspace.admin.email);

    await withColumnRenamed("workspace", "name", async () => {
      const response = await membership(client);

      expect(response.status).toBe(500);
      const { message, data } = await refusalCrossing(response);
      expect(message).toBe("readMembership failed");
      expect(data.refusal).toBeUndefined();
    });

    expect(logsOf("trpc.failed").map((line) => [line["act"], line["level"]])).toEqual([
      ["readMembership", 50],
    ]);
  });

  it("logs a rejection the resolver throws once too, rather than letting it out unsaid", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(app, workspace.admin.email);

    await withColumnRenamed("member", "role", async () => {
      const response = await membership(client);

      expect(response.status).toBe(500);
      expect((await refusalCrossing(response)).message).toBe("withPrincipal failed");
    });

    expect(logsOf("trpc.failed").map((line) => [line["act"], line["level"]])).toEqual([
      ["withPrincipal", 50],
    ]);
  });
});

describe("a refusal crossing the MCP surface", () => {
  it("reaches an agent as its own word and class, with the field a malformed input names", async () => {
    const { client, token } = await asAnAgent();

    const said = await toolText(client, token, "give_feedback", { iri: "x", verdict: "flag" });

    expect(said.isError).toBe(true);
    expect(said.text).toBe("Refused: malformed (malformed). Fields: reason not-in-set.");
    expect(
      logsOf("mcp.refused").map((line) => [line["entry"], line["refusal"], line["class"]]),
    ).toEqual([["give_feedback", "malformed", "malformed"]]);
  });

  it("sends a failure as the entry's own, never a sentence about credentials, logged once", async () => {
    const { client, token } = await asAnAgent();

    await withColumnRenamed("concept_index", "title", async () => {
      const said = await toolText(client, token, "find", { query: "anything" });

      expect(said.isError).toBe(true);
      expect(said.text).toBe("find failed.");
    });

    expect(logsOf("mcp.failed").map((line) => [line["entry"], line["level"]])).toEqual([
      ["find", 50],
    ]);
  });
});

describe("the classes a word may carry", () => {
  it("names the classes no entry can reach beside the two these suites drive", () => {
    expect([...REFUSAL_CLASSES].sort()).toEqual(
      [...REACHED_TODAY, ...NO_ENTRY_REACHES_THESE_YET].sort(),
    );
  });
});
