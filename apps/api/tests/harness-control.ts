import { Hono } from "hono";
import { z } from "zod";

import { llmPurpose } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import type { TestApp } from "./harness.ts";

const HARNESS_PREFIX = "/__harness";

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

  routes: z.array(
    z.object({
      purpose: z.enum(llmPurpose.enumValues),
      provider: z.string().min(1),
      model: z.string().min(1),
    }),
  ),
});
const ending = z.object({ workspaceId: z.string().min(1), userId: z.string().min(1) });

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

    await app.revokeCredentials(asked.userId, new Date(Date.now() + 1_000));
    return context.json({ revoked: true });
  });

  control.delete(`${HARNESS_PREFIX}/members`, async (context) => {
    const asked = await readBody(context.req.raw, ending);
    await app.removeMember(asked.workspaceId, asked.userId);
    return context.json({ removed: true });
  });

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

  control.get(`${HARNESS_PREFIX}/codes`, (context) => {
    const email = context.req.query("email") ?? "";
    return context.json({ code: app.codeSentTo(email) });
  });

  return control;
};
