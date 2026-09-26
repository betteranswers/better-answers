import { Hono } from "hono";
import { z } from "zod";

import { setOperatorMark } from "@better-answers/core/workspaces";
import { llmPurpose } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import { IDENTITY_PRINCIPAL } from "../src/identity-principal.ts";
import type { TestApp } from "./harness.ts";
import { accessAsking, askToJoin, groupsMaking, makeGroups } from "./harness-people.ts";
import {
  bindingsSeeding,
  indexRunMoving,
  moveTheIndexRun,
  seedBindings,
} from "./harness-sources.ts";
import { sessionsSignedInOverAnHourAgo } from "./provoke.ts";

const HARNESS_PREFIX = "/__harness";

const provisioning = z.object({
  name: z.string().min(1).optional(),
  adminEmail: z.string().min(1).optional(),
});
/** An empty display name is a person who has not given one yet, which a spec may want. */
const person = z.object({
  email: z.string().min(1).optional(),
  displayName: z.string().optional(),
});
const membership = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["Admin", "Editor", "Viewer"]),
});
const revocation = z.object({ userId: z.string().min(1) });
const invitation = z.object({
  workspaceId: z.string().min(1),
  email: z.string().min(1),
  inviterId: z.string().min(1),
  role: z.enum(["Admin", "Editor", "Viewer"]),
});
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
const marking = z.object({ email: z.string().min(1), change: z.enum(["grant", "revoke"]) });
const aging = z.object({ userId: z.string().min(1) });

const readBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T> => {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Error(`the harness was called wrongly: ${parsed.error.message}`);
  return parsed.data;
};

/** Routes under `/__harness` through which the browser suite drives the TestApp as a test would. */
export const harnessControl = (app: TestApp): Hono => {
  const control = new Hono();

  control.post(`${HARNESS_PREFIX}/workspaces`, async (context) => {
    const asked = await readBody(context.req.raw, provisioning);
    return context.json(await app.provision(asked));
  });

  control.post(`${HARNESS_PREFIX}/people`, async (context) => {
    const asked = await readBody(context.req.raw, person);
    return context.json(await app.person(asked.email, asked.displayName));
  });

  control.post(`${HARNESS_PREFIX}/members`, async (context) => {
    const asked = await readBody(context.req.raw, membership);
    await app.addMember(asked.workspaceId, asked.userId, asked.role);
    return context.json({ added: true });
  });

  control.post(`${HARNESS_PREFIX}/invitations`, async (context) => {
    const asked = await readBody(context.req.raw, invitation);
    return context.json(await app.invite(asked));
  });

  control.post(`${HARNESS_PREFIX}/revocations`, async (context) => {
    const asked = await readBody(context.req.raw, revocation);

    await app.revokeCredentials(asked.userId, new Date(Date.now() + 1_000));
    return context.json({ revoked: true });
  });

  // An hour is too long for a spec to wait, so the sign-in is moved back behind the api's back.
  control.post(`${HARNESS_PREFIX}/sign-ins/aged`, async (context) => {
    const asked = await readBody(context.req.raw, aging);
    await sessionsSignedInOverAnHourAgo(app, asked.userId);
    return context.json({ aged: true });
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

  control.post(`${HARNESS_PREFIX}/bindings`, async (context) => {
    const asked = await readBody(context.req.raw, bindingsSeeding);
    return context.json({ bindings: await seedBindings(app, asked) });
  });

  control.post(`${HARNESS_PREFIX}/index-runs`, async (context) => {
    const asked = await readBody(context.req.raw, indexRunMoving);
    return context.json(await moveTheIndexRun(app, asked));
  });

  // The ops command's own act under its own principal, so the mark lands as the owner's would.
  control.post(`${HARNESS_PREFIX}/operators`, async (context) => {
    const asked = await readBody(context.req.raw, marking);
    const marked = await setOperatorMark(IDENTITY_PRINCIPAL, app.doors.postgres, asked);
    if (!marked.ok) throw new Error(`the operator mark was refused: ${String(marked.error)}`);
    return context.json({ marked: true });
  });

  control.post(`${HARNESS_PREFIX}/groups`, async (context) => {
    const asked = await readBody(context.req.raw, groupsMaking);
    return context.json(await makeGroups(app, asked));
  });

  control.post(`${HARNESS_PREFIX}/access-requests`, async (context) => {
    const asked = await readBody(context.req.raw, accessAsking);
    return context.json(await askToJoin(app, asked));
  });

  control.get(`${HARNESS_PREFIX}/codes`, (context) => {
    const email = context.req.query("email") ?? "";
    return context.json({ code: app.codeSentTo(email) });
  });

  return control;
};
