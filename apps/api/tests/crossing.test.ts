import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { REFUSAL_CLASSES } from "@better-answers/core/kernel";
import { ulid } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { connectAsHost } from "./flow.ts";
import { startApp, type LogLine, type TestApp, type TestClient } from "./harness.ts";
import { callMcp } from "./mcp-call.ts";
import {
  constraintDefinition,
  memberOfTwoWorkspaces,
  seededIn,
  sessionPointedAt,
  signedInClient,
  THE_THREE_CONFIRMATIONS,
} from "./provoke.ts";
import { anAdminOnTheWeb, refusalOfCall, webSignedIn } from "./web-client.ts";

const MEMBERSHIP = `${TRPC_ENDPOINT}/session.membership`;

const MEMBER_WORKSPACE_FK = "member_workspace_id_workspace_id_fk";

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

const anAdmin = async () => {
  const { workspace, api } = await anAdminOnTheWeb(app);
  return { workspaceId: workspace.workspaceId, api };
};

const bindingIn = (workspaceId: string, publishedAt: Date | null): Promise<string> =>
  seededIn(app, async (seed) => (await seed.sourceBinding({ workspaceId, publishedAt })).id);

const A_SORT_CODE = { category: "bank-details", ruleId: "sort-code-with-account-number" };

/**
 * One word stands for its class: a class falls on one status, and the walk holds every word to
 * its class.
 */
const A_WORD_OF_EACH_CLASS = [
  [
    "malformed",
    { word: "malformed", fields: { bindingId: "bad-format" } },
    400,
    async () => (await anAdmin()).api.sources.findings.query({ bindingId: "not-a-binding-id" }),
  ],
  [
    "forbidden",
    { word: "role-forbids" },
    403,
    async () => {
      const workspace = await app.provision();
      const editor = await app.person();
      await app.addMember(workspace.workspaceId, editor.id, "Editor");
      return (await webSignedIn(app, editor.email)).api.sources.list.query();
    },
  ],
  [
    "absent",
    { word: "no-such-document" },
    404,
    async () => {
      const { workspaceId, api } = await anAdmin();
      const bindingId = await bindingIn(workspaceId, null);
      return api.sources.narrowDocuments.mutate({
        bindingId,
        findingGroups: [{ documentId: ulid(), tier: "always", ...A_SORT_CODE }],
      });
    },
  ],
  [
    "inapplicable",
    { word: "not-the-always-set" },
    422,
    async () =>
      (await anAdmin()).api.sources.keepInText.mutate({
        bindingId: ulid(),
        findingGroups: [{ documentId: ulid(), tier: "default-on", ...A_SORT_CODE }],
        reason: "The sort code is the company's own.",
      }),
  ],
  [
    "conflict",
    { word: "already-published" },
    409,
    async () => {
      const { workspaceId, api } = await anAdmin();
      const bindingId = await bindingIn(workspaceId, new Date("2026-09-22T09:00:00.000Z"));
      return api.sources.publish.mutate({ bindingId, confirmations: THE_THREE_CONFIRMATIONS });
    },
  ],
  [
    "precondition",
    { word: "not-indexed" },
    412,
    async () => {
      const { workspaceId, api } = await anAdmin();
      const bindingId = await bindingIn(workspaceId, null);
      return api.sources.publish.mutate({ bindingId, confirmations: THE_THREE_CONFIRMATIONS });
    },
  ],
] as const;

describe("a word of every class an act answers, crossing tRPC", () => {
  it.each(A_WORD_OF_EACH_CLASS)(
    "sends a %s refusal's own word and status, logged once",
    async (refusalClass, refusal, status, provoke) => {
      const refused = await refusalOfCall(provoke());

      expect(refused).toMatchObject({
        data: { httpStatus: status, refusal: { ...refusal, class: refusalClass } },
      });
      expect(logsOf("trpc.refused").map((line) => [line["refusal"], line["class"]])).toEqual([
        [refusal.word, refusalClass],
      ]);
    },
  );
});

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

  it("sends the membership read's own refusal as an unauthenticated word", async () => {
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

  it("logs a refusal once, at info, with the word sent", async () => {
    await membership(app.client());

    expect(
      logsOf("trpc.refused").map((line) => [line["refusal"], line["class"], line["level"]]),
    ).toEqual([["no-session", "unauthenticated", 30]]);
    expect(logsOf("trpc.failed")).toEqual([]);
  });

  it("sends a failure as internal, naming no fault, logged once", async () => {
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

  it("logs once a rejection the resolver throws", async () => {
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
  it("reaches an agent as its word, class and malformed field", async () => {
    const { client, token } = await asAnAgent();

    const said = await toolText(client, token, "give_feedback", { iri: "x", verdict: "flag" });

    expect(said.isError).toBe(true);
    expect(said.text).toBe("Refused: malformed (malformed). Fields: reason not-in-set.");
    expect(
      logsOf("mcp.refused").map((line) => [line["entry"], line["refusal"], line["class"]]),
    ).toEqual([["give_feedback", "malformed", "malformed"]]);
  });

  it("names a failure by its entry, not credentials, logged once", async () => {
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
  it("are each driven by a case above, and no others", () => {
    const driven = ["unauthenticated", ...A_WORD_OF_EACH_CLASS.map(([driving]) => driving)];

    expect([...REFUSAL_CLASSES].sort()).toEqual([...new Set(driven)].sort());
    expect(driven).toHaveLength(REFUSAL_CLASSES.length);
  });
});
