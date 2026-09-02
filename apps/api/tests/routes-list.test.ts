import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { signIn } from "./flow.ts";
import { startApp, type TestApp, type TestClient } from "./harness.ts";

/**
 * `routes.list` from the outside (`[TEST1]`, `[APP3]`): a person signs in with a code
 * the way the product's sign-in does, and asks the tRPC endpoint for their
 * workspace's routes. What the procedure refuses is the substance (`[SEC3]`), so
 * every refusal the path can produce has its own test here.
 *
 * One refusal cannot be produced from this seat: `role-disagrees` fires when a
 * credential carries a role the member row contradicts, and a cookie session carries
 * no role claim at all (ADR 0018's 2026-08-31 amendment — the role is read per call,
 * in the same transaction as the read). It is demonstrated where it can be, at the
 * resolver's own seam (`packages/core/test/principal.test.ts`), and it reaches the
 * wire through the same single mapping every refusal below takes.
 */

const TRPC_ROUTES_LIST = "/trpc/routes.list";

const routeShape = z.object({
  purpose: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  dimensions: z.number().nullable(),
  fixed: z.boolean(),
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

/** The routes a workspace has chosen, seeded as the System screen will one day write them. */
const seedRoutes = async (workspaceId: string): Promise<void> => {
  const client = await app.database.superuser.connect();
  try {
    const seed = testData(client);
    await seed.llmRoute({
      workspaceId,
      purpose: "answering",
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    await seed.llmRoute({
      workspaceId,
      purpose: "embedding",
      provider: "mistral",
      model: "mistral-embed",
    });
  } finally {
    client.release();
  }
};

/** A signed-in browser: the email step, the code from the captured email, no OAuth flow. */
const signedInClient = async (email: string): Promise<TestClient> => {
  const client = app.client();
  const signedIn = await signIn(app, client, email, "");
  expect(signedIn.status).toBe(302);
  return client;
};

const listRoutes = (client: TestClient): Promise<Response> => client.fetch(TRPC_ROUTES_LIST);

const refusalOf = async (response: Response): Promise<string> =>
  refused.parse(await response.json()).error.message;

describe("the routes list over the wire", () => {
  it("answers a workspace member one route per purpose, with the embedding route fixed at its dimensions", async () => {
    const workspace = await app.provision();
    await seedRoutes(workspace.workspaceId);

    const response = await listRoutes(await signedInClient(workspace.admin.email));

    expect(response.status).toBe(200);
    expect(answered.parse(await response.json()).result.data).toEqual([
      { purpose: "extraction", provider: null, model: null, dimensions: null, fixed: false },
      { purpose: "enrichment", provider: null, model: null, dimensions: null, fixed: false },
      {
        purpose: "answering",
        provider: "anthropic",
        model: "claude-sonnet-5",
        dimensions: null,
        fixed: false,
      },
      { purpose: "judging", provider: null, model: null, dimensions: null, fixed: false },
      {
        purpose: "embedding",
        provider: "mistral",
        model: "mistral-embed",
        dimensions: EMBEDDING_DIMENSIONS,
        fixed: true,
      },
    ]);
  });

  it.each(["Admin", "Editor", "Viewer"] as const)(
    "lets a member at %s read the list — the screen is read-only and no role is gated out of it",
    async (role) => {
      const workspace = await app.provision();
      await seedRoutes(workspace.workspaceId);
      const person = await app.person();
      await app.addMember(workspace.workspaceId, person.id, role);

      const response = await listRoutes(await signedInClient(person.email));

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

    const response = await listRoutes(await signedInClient(mine.admin.email));

    const listed = answered.parse(await response.json()).result.data;
    expect(listed.map((route) => route.model)).not.toContain("mistral-large");
  });
});

describe("what the routes list refuses", () => {
  it("refuses a request with no session", async () => {
    const response = await listRoutes(app.client());

    expect(response.status).toBe(401);
    expect(await refusalOf(response)).toBe("no-session");
  });

  it("refuses a signed-in person who has not yet picked a workspace", async () => {
    // Two memberships: the session-create hook sets no active workspace, and the
    // picker has not been passed.
    const first = await app.provision();
    const second = await app.provision();
    const person = await app.person();
    await app.addMember(first.workspaceId, person.id, "Viewer");
    await app.addMember(second.workspaceId, person.id, "Viewer");

    const response = await listRoutes(await signedInClient(person.email));

    expect(response.status).toBe(401);
    expect(await refusalOf(response)).toBe("no-active-workspace");
  });

  it("refuses a person whose membership ended while their session was still live", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(workspace.admin.email);
    await app.removeMember(workspace.workspaceId, workspace.admin.id);

    const response = await listRoutes(client);

    expect(response.status).toBe(401);
    expect(await refusalOf(response)).toBe("not-a-member");
  });

  it("refuses a session issued before the person's credentials were revoked", async () => {
    const workspace = await app.provision();
    // The act ends every session made before the instant it names, so the session
    // that must survive to be refused by the resolver is one made after the
    // revocation ran and before the instant it wrote.
    await app.revokeCredentials(workspace.admin.id, new Date(Date.now() + 60_000));
    const client = await signedInClient(workspace.admin.email);

    const response = await listRoutes(client);

    expect(response.status).toBe(401);
    expect(await refusalOf(response)).toBe("credentials-revoked");
  });

  it("refuses a member row whose role is not one of the platform's three", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(workspace.admin.email);
    const { superuser } = app.database;
    const where = "workspace_id = $1 AND user_id = $2";
    const member = [workspace.workspaceId, workspace.admin.id];
    // The database's CHECK is what keeps this row out of an estate; the resolver
    // refuses it anyway, and the only way to ask it is to stand the fence down.
    await superuser.query('ALTER TABLE "member" DROP CONSTRAINT "member_role_check"');
    try {
      await superuser.query(`UPDATE "member" SET role = 'Owner' WHERE ${where}`, member);

      const response = await listRoutes(client);

      expect(response.status).toBe(401);
      expect(await refusalOf(response)).toBe("role-unknown");
    } finally {
      await superuser.query(`UPDATE "member" SET role = 'Admin' WHERE ${where}`, member);
      await superuser.query(
        `ALTER TABLE "member" ADD CONSTRAINT "member_role_check" CHECK (role IN ('Admin', 'Editor', 'Viewer'))`,
      );
    }
  });

  it("refuses a session whose active workspace is not a workspace id", async () => {
    const workspace = await app.provision();
    const client = await signedInClient(workspace.admin.email);
    await app.database.superuser.query(
      "UPDATE session SET active_workspace_id = 'not-a-workspace-id' WHERE user_id = $1",
      [workspace.admin.id],
    );

    const response = await listRoutes(client);

    expect(response.status).toBe(401);
    expect(await refusalOf(response)).toBe("malformed-claims");
  });
});
