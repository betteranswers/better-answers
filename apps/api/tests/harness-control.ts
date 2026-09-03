import { Hono } from "hono";
import { z } from "zod";

import { llmPurpose } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { TestApp } from "./harness.ts";

/**
 * The harness, reachable over HTTP, for the one caller that cannot hold it in the same
 * process: the browser suite (`apps/web/e2e`). A Playwright test provisions a workspace
 * and reads the code that was emailed the same way an endpoint test does — through
 * `TestApp` — rather than reaching into the database or waiting on a mail server.
 *
 * It is mounted by `tests/serve.ts` alone, in front of the app rather than inside it, so
 * these paths are never part of the server the deploy unit builds and the hostname fence
 * never sees them. `createServer` knows nothing about this file.
 *
 * The prefix is `/__harness` because a path that could be mistaken for a product address
 * is a path someone will one day serve by accident.
 */

export const HARNESS_PREFIX = "/__harness";

const provisioning = z.object({
  name: z.string().min(1).optional(),
  adminEmail: z.string().min(1).optional(),
});
const person = z.object({ email: z.string().min(1).optional() });
const membership = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["Admin", "Editor", "Viewer"]),
});
const revocation = z.object({ userId: z.string().min(1) });
const seeding = z.object({
  workspaceId: z.string().min(1),
  // The enum the column is declared from, never a restatement of it (`[DEPS2]`): a purpose
  // added to the platform is accepted here the day it is added.
  routes: z.array(
    z.object({
      purpose: z.enum(llmPurpose.enumValues),
      provider: z.string().min(1),
      model: z.string().min(1),
    }),
  ),
});
const ending = z.object({ workspaceId: z.string().min(1), userId: z.string().min(1) });

/** A body a test got wrong is the test's mistake, and it says which field in one line. */
const readBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T> => {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Error(`the harness was called wrongly: ${parsed.error.message}`);
  return parsed.data;
};

export const harnessControl = (app: TestApp): Hono => {
  const control = new Hono();

  control.post(`${HARNESS_PREFIX}/workspaces`, async (context) => {
    const asked = await readBody(context.req.raw, provisioning);
    return context.json(await app.provision(asked));
  });

  control.post(`${HARNESS_PREFIX}/people`, async (context) => {
    const asked = await readBody(context.req.raw, person);
    return context.json(await app.person(asked.email));
  });

  control.post(`${HARNESS_PREFIX}/members`, async (context) => {
    const asked = await readBody(context.req.raw, membership);
    await app.addMember(asked.workspaceId, asked.userId, asked.role);
    return context.json({ added: true });
  });

  control.post(`${HARNESS_PREFIX}/revocations`, async (context) => {
    const asked = await readBody(context.req.raw, revocation);
    // A second in the future, as the endpoint suite revokes: the instant has to post-date
    // the credential being refused, and a browser's clock is not this process's.
    await app.revokeCredentials(asked.userId, new Date(Date.now() + 1_000));
    return context.json({ revoked: true });
  });

  control.delete(`${HARNESS_PREFIX}/members`, async (context) => {
    const asked = await readBody(context.req.raw, ending);
    await app.removeMember(asked.workspaceId, asked.userId);
    return context.json({ removed: true });
  });

  /**
   * The routes a workspace has chosen, seeded as the System screen will one day write them
   * (T-038). It is a surface of its own rather than a field on `/workspaces`, because a test
   * that wants a workspace with no routes at all wants exactly what provisioning already does.
   */
  control.post(`${HARNESS_PREFIX}/routes`, async (context) => {
    const asked = await readBody(context.req.raw, seeding);
    const client = await app.database.superuser.connect();
    try {
      const seed = testData(client);
      for (const route of asked.routes) {
        await seed.llmRoute({ workspaceId: asked.workspaceId, ...route });
      }
    } finally {
      client.release();
    }
    return context.json({ seeded: asked.routes.length });
  });

  /**
   * The last code sent to an address, read from the captured email transport. This is the
   * only place a browser test may read a code from: the app's logger is forbidden from
   * ever holding one (`[LOG1]`).
   */
  control.get(`${HARNESS_PREFIX}/codes`, (context) => {
    const email = context.req.query("email") ?? "";
    return context.json({ code: app.codeSentTo(email) });
  });

  return control;
};
