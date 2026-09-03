import { Hono } from "hono";
import { z } from "zod";

import { testData } from "@better-answers/schema/testing";

import { MCP_HOSTNAME, type TestApp } from "./harness.ts";

/**
 * The browser suite's control face: the parts of `TestApp` a Playwright test needs, reachable
 * over HTTP because that suite runs in another process (`apps/web/e2e`, `tests/serve.ts`).
 *
 * It is mounted **in front of** the app rather than inside it, so nothing here can be reached
 * on a deployed estate: `serve.ts` is a test file, this face exists only in the wrapper that
 * file builds, and the server the deploy unit runs is `src/main.ts`, which never imports either.
 *
 * A browser cannot be given a `TestApp`, and a test that reached into Postgres itself would be
 * seeding rows the platform's own acts have never written. So every route below is one call
 * onto the harness the endpoint suites already use — provision, a person, a membership, the
 * sign-in flow — and the browser gets back only what it must carry: ids, an address, a cookie.
 */

/** The one prefix the wrapper mounts this under; the browser suite is built from this string. */
export const CONTROL_PREFIX = "/__test__";

const routeSeed = z.object({
  purpose: z.enum(["extraction", "enrichment", "answering", "judging", "embedding"]),
  provider: z.string().min(1),
  model: z.string().min(1),
});

const workspaceRequest = z.object({ routes: z.array(routeSeed).default([]) });
const memberRequest = z.object({
  workspaceId: z.string().min(1),
  role: z.enum(["Admin", "Editor", "Viewer"]),
});
const sessionRequest = z.object({ email: z.email() });

/** A cookie as a browser must be told to hold it; the jar's own `name=value` split apart. */
export type ControlCookie = { readonly name: string; readonly value: string };

const cookiesOf = (header: string): ControlCookie[] =>
  header
    .split("; ")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const index = pair.indexOf("=");
      return { name: pair.slice(0, index), value: pair.slice(index + 1) };
    });

export const createControlRoutes = (app: TestApp): Hono => {
  const routes = new Hono();

  /** A workspace with its Admin, and the routes it has chosen. */
  routes.post("/workspace", async (context) => {
    const asked = workspaceRequest.parse(await context.req.json());
    const workspace = await app.provision();
    const client = await app.database.superuser.connect();
    try {
      const seed = testData(client);
      for (const route of asked.routes) {
        await seed.llmRoute({ workspaceId: workspace.workspaceId, ...route });
      }
    } finally {
      client.release();
    }
    return context.json({
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      adminEmail: workspace.admin.email,
    });
  });

  /** A second person in a workspace, at a role — the three the platform has. */
  routes.post("/member", async (context) => {
    const asked = memberRequest.parse(await context.req.json());
    const person = await app.person();
    await app.addMember(asked.workspaceId, person.id, asked.role);
    return context.json({ email: person.email });
  });

  /**
   * A session, made the way the product's own sign-in makes one: the email step, then the
   * six-digit code out of the captured email. It runs in this process against `mcp.`, because
   * Better Auth compares the browser's `Origin` against its base URL and that is the origin
   * its base URL names; the browser is then handed the cookie the flow left in the jar.
   *
   * When T-037 lands the SPA's sign-in screen, the browser drives it and this route goes.
   */
  routes.post("/session", async (context) => {
    const asked = sessionRequest.parse(await context.req.json());
    const client = app.client(undefined, MCP_HOSTNAME);
    const requested = await client.form("/sign-in", { step: "email", email: asked.email });
    if (requested.status !== 200) {
      return context.json({ error: `the code request answered ${requested.status}` }, 500);
    }
    const entered = await client.form("/sign-in", {
      step: "code",
      email: asked.email,
      code: app.codeSentTo(asked.email),
    });
    if (entered.status !== 302) {
      return context.json({ error: `the code answered ${entered.status}` }, 500);
    }
    return context.json({ cookies: cookiesOf(client.cookies()) });
  });

  return routes;
};
