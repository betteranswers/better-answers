import { CONFIGURED_LLM_ROUTES, LISTED_LLM_ROUTES, testData } from "@better-answers/schema/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { TRPC_IP_RULE } from "../src/auth/index.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { startApp, type TestApp, type TestClient } from "./harness.ts";
import {
  constraintDefinition,
  memberOfTwoWorkspaces,
  sessionPointedAt,
  signedInClient,
} from "./provoke.ts";

const TRPC_ROUTES_LIST = `${TRPC_ENDPOINT}/routes.list`;

const routeShape = z.object({
  purpose: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  dimensions: z.number().nullable(),
  fixed: z.boolean(),

  retentionTail: z.string().nullable(),
});
const answered = z.object({ result: z.object({ data: z.array(routeShape) }) });
const refused = z.object({ error: z.object({ message: z.string() }) });

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.stop();
});

const seedRoutes = async (workspaceId: string): Promise<void> => {
  const client = await app.database.superuser.connect();
  try {
    const seed = testData(client);
    for (const route of CONFIGURED_LLM_ROUTES) await seed.llmRoute({ workspaceId, ...route });
  } finally {
    client.release();
  }
};

const listRoutes = (client: TestClient): Promise<Response> => client.fetch(TRPC_ROUTES_LIST);

const messageOf = async (response: Response): Promise<string> =>
  refused.parse(await response.json()).error.message;

const MEMBER_ROLE_CHECK = "member_role_check";

describe("the routes list over the wire", () => {
  it("answers one route per purpose, embedding fixed at its dimensions", async () => {
    const workspace = await app.provision();
    await seedRoutes(workspace.workspaceId);

    const response = await listRoutes(await signedInClient(app, workspace.admin.email));

    expect(response.status).toBe(200);
    expect(answered.parse(await response.json()).result.data).toEqual(LISTED_LLM_ROUTES);
  });

  it.each(["Admin", "Editor", "Viewer"] as const)(
    "lets a member at %s read the list",
    async (role) => {
      const workspace = await app.provision();
      await seedRoutes(workspace.workspaceId);
      const person = await app.person();
      await app.addMember(workspace.workspaceId, person.id, role);

      const response = await listRoutes(await signedInClient(app, person.email));

      expect(response.status).toBe(200);
      const listed = answered.parse(await response.json()).result.data;
      expect(listed.find((route) => route.purpose === "answering")?.model).toBe("claude-sonnet-5");
    },
  );

  it("never shows a member of one workspace another workspace's routes", async () => {
    const mine = await app.provision();
    await seedRoutes(mine.workspaceId);
    const theirs = await app.provision();
    const client = await app.database.superuser.connect();
    try {
      await testData(client).llmRoute({
        workspaceId: theirs.workspaceId,
        purpose: "answering",
        provider: "mistral",
        model: "mistral-large",
      });
    } finally {
      client.release();
    }

    const response = await listRoutes(await signedInClient(app, mine.admin.email));

    const listed = answered.parse(await response.json()).result.data;
    expect(listed.map((route) => route.model)).not.toContain("mistral-large");
  });
});

describe("what the routes list refuses", () => {
  it("refuses a request with no session", async () => {
    const response = await listRoutes(app.client());

    expect(response.status).toBe(401);
    expect(await messageOf(response)).toBe("no-session");
  });

  it("refuses a signed-in person with no workspace picked yet", async () => {
    const response = await listRoutes(await memberOfTwoWorkspaces(app));

    expect(response.status).toBe(401);
    expect(await messageOf(response)).toBe("no-active-workspace");
  });

  it("refuses a person whose membership ended mid-session", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(app, workspace.admin.email);
    await app.removeMember(workspace.workspaceId, workspace.admin.id);

    const response = await listRoutes(client);

    expect(response.status).toBe(401);
    expect(await messageOf(response)).toBe("not-a-member");
  });

  it("refuses a session issued before the person's credentials were revoked", async () => {
    const workspace = await app.provision();

    await app.revokeCredentials(workspace.admin.id, new Date(Date.now() + 60_000));
    const client = await signedInClient(app, workspace.admin.email);

    const response = await listRoutes(client);

    expect(response.status).toBe(401);
    expect(await messageOf(response)).toBe("credentials-revoked");
  });

  it("refuses a member role outside the platform's three", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(app, workspace.admin.email);
    const { superuser } = app.database;
    const where = "workspace_id = $1 AND user_id = $2";
    const member = [workspace.workspaceId, workspace.admin.id];

    const definition = await constraintDefinition(app, MEMBER_ROLE_CHECK);
    try {
      await superuser.query(`ALTER TABLE "member" DROP CONSTRAINT "${MEMBER_ROLE_CHECK}"`);
      await superuser.query(`UPDATE "member" SET role = 'Owner' WHERE ${where}`, member);

      const response = await listRoutes(client);

      expect(response.status).toBe(401);
      expect(await messageOf(response)).toBe("role-unknown");
    } finally {
      await superuser.query(`UPDATE "member" SET role = 'Admin' WHERE ${where}`, member);
      await superuser.query(
        `ALTER TABLE "member" ADD CONSTRAINT "${MEMBER_ROLE_CHECK}" ${definition}`,
      );
    }
    expect(await constraintDefinition(app, MEMBER_ROLE_CHECK)).toBe(definition);
  });

  it("refuses one address's flood before each request spends a lookup", async () => {
    const client = app.client("203.0.113.60");
    const statuses: number[] = [];

    // The window is wall-clock aligned, so a burst straddling a boundary starts its count
    // again: ask until refused, not a fixed number.
    for (let attempt = 0; attempt <= TRPC_IP_RULE.max * 2 + 1; attempt += 1) {
      const status = (await listRoutes(client)).status;
      statuses.push(status);
      if (status === 429) break;
    }

    expect(statuses).toContain(429);

    expect((await listRoutes(app.client("203.0.113.61"))).status).toBe(401);
  });

  it("refuses a session whose active workspace is no workspace id", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(app, workspace.admin.email);
    await sessionPointedAt(app, workspace.admin.id, "not-a-workspace-id");

    const response = await listRoutes(client);

    expect(response.status).toBe(401);
    expect(await messageOf(response)).toBe("malformed-claims");
  });
});
