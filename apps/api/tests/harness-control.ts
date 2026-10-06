import { Hono } from "hono";
import { z } from "zod";

import { ensureTestWorkspace } from "@better-answers/core/members";
import { BOOTSTRAP, setOperatorMark } from "@better-answers/core/workspaces";
import {
  INVITATION_ACCEPTED_STATUS,
  INVITATION_CANCELLED_STATUS,
  INVITATION_WAITING_STATUS,
  llmPurpose,
  ROLES,
} from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import { IDENTITY_PRINCIPAL } from "../src/identity-principal.ts";
import { authenticatorKeyOf, holdAnAuthenticator, savedRecoveryCodes } from "./factor-harness.ts";
import {
  accessAsking,
  askToJoin,
  flagTheName,
  groupsMaking,
  makeGroups,
  nameFlagging,
} from "./harness-people.ts";
import {
  connectedSourcesSeeding,
  indexRunMoving,
  moveTheIndexRun,
  seedConnectedSources,
} from "./harness-sources.ts";
import type { TestApp } from "./harness.ts";
import {
  codeSentPastItsExpiry,
  pendingSessionsPastTheirHour,
  restoredByTheOperator,
  sessionsSignedInOverAnHourAgo,
} from "./provoke.ts";

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
  role: z.enum(ROLES),
});
const revocation = z.object({ userId: z.string().min(1) });
/** The store's own words for an invitation's status, which a spec may seed one at. */
const STORED_STATUSES = [
  INVITATION_WAITING_STATUS,
  INVITATION_ACCEPTED_STATUS,
  INVITATION_CANCELLED_STATUS,
] as const;
const invitation = z.object({
  workspaceId: z.string().min(1),
  email: z.string().min(1),
  inviterId: z.string().min(1),
  role: z.enum(ROLES),
  status: z.enum(STORED_STATUSES).optional(),
  expiresAt: z.coerce.date().optional(),
});
const seeding = z.object({
  workspaceId: z.string().min(1),

  modelChoices: z.array(
    z.object({
      purpose: z.enum(llmPurpose.enumValues),
      provider: z.string().min(1),
      model: z.string().min(1),
    }),
  ),
});
const ending = z.object({ workspaceId: z.string().min(1), userId: z.string().min(1) });
const MARK_CHANGES = ["grant", "revoke"] as const;
const marking = z.object({ email: z.string().min(1), change: z.enum(MARK_CHANGES) });
const aging = z.object({ userId: z.string().min(1) });
const codeAging = z.object({ email: z.string().min(1) });
const byEmail = z.object({ email: z.string().min(1) });
/** Saved by default, as a first setup leaves an Admin; `none` is someone just made one. */
const CODES_GIVEN = ["saved", "none"] as const;

type CodesGiven = (typeof CODES_GIVEN)[number];

const enrolling = byEmail.extend({ codes: z.enum(CODES_GIVEN).default("saved") });

type Enrolled = { readonly key: string; readonly recoveryCodes: readonly string[] };

/** Asked again for the same person, the harness answers what it gave them the first time. */
const enrolments = (app: TestApp) => {
  const held = new Map<string, Enrolled>();
  return {
    get: (personId: string) => held.get(personId),
    enrol: async (personId: string, codes: CodesGiven): Promise<Enrolled> => {
      const key = authenticatorKeyOf(app, personId) ?? (await holdAnAuthenticator(app, personId));
      const recoveryCodes = codes === "saved" ? await savedRecoveryCodes(app, personId) : [];
      const enrolled = { key, recoveryCodes };
      held.set(personId, enrolled);
      return enrolled;
    },
  };
};
const testWorkspace = z.object({
  testingDomain: z.string().min(1),
  slug: z.string().min(1),
  admin: z.string().min(1),
  editor: z.string().min(1),
  viewer: z.string().min(1),
});

const personIdOf = async (app: TestApp, email: string): Promise<string> => {
  const found = await app.database.superuser.query<{ id: string }>(
    'SELECT id FROM "user" WHERE lower(email) = lower($1)',
    [email],
  );
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error(`the harness holds no person at ${email}`);
  return id;
};

const readBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T> => {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) throw new Error(`the harness was called wrongly: ${parsed.error.message}`);
  return parsed.data;
};

/** Routes under `/__harness` through which the browser suite drives the TestApp as a test would. */
export const harnessControl = (app: TestApp): Hono => {
  const control = new Hono();
  const enrolled = enrolments(app);

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

  // The pending hour is too long for a spec to wait, so its clock is moved back the same way.
  control.post(`${HARNESS_PREFIX}/pending-sessions/aged`, async (context) => {
    const asked = await readBody(context.req.raw, aging);
    await pendingSessionsPastTheirHour(app, asked.userId);
    return context.json({ aged: true });
  });

  // A code's lifetime is too long for a spec to wait, so its expiry is moved back the same way.
  control.post(`${HARNESS_PREFIX}/codes/aged`, async (context) => {
    const asked = await readBody(context.req.raw, codeAging);
    await codeSentPastItsExpiry(app, asked.email);
    return context.json({ aged: true });
  });

  // Sealed as the plugin seals one, spending no emailed code; the key answered makes the codes.
  control.post(`${HARNESS_PREFIX}/authenticators`, async (context) => {
    const asked = await readBody(context.req.raw, enrolling);
    const personId = await personIdOf(app, asked.email);
    const held = enrolled.get(personId) ?? (await enrolled.enrol(personId, asked.codes));
    return context.json(held);
  });

  // The ops command's own restore, so a spec meets the person as the operator leaves them.
  control.post(`${HARNESS_PREFIX}/restores`, async (context) => {
    const asked = await readBody(context.req.raw, byEmail);
    return context.json({ code: await restoredByTheOperator(app, asked.email) });
  });

  control.delete(`${HARNESS_PREFIX}/members`, async (context) => {
    const asked = await readBody(context.req.raw, ending);
    await app.removeMember(asked.workspaceId, asked.userId);
    return context.json({ removed: true });
  });

  control.post(`${HARNESS_PREFIX}/model-choices`, async (context) => {
    const asked = await readBody(context.req.raw, seeding);
    const client = await app.database.superuser.connect();
    try {
      const seed = testData(client);
      for (const modelChoice of asked.modelChoices) {
        await seed.modelChoice({ workspaceId: asked.workspaceId, ...modelChoice });
      }
    } finally {
      client.release();
    }
    return context.json({ seeded: asked.modelChoices.length });
  });

  control.post(`${HARNESS_PREFIX}/connected-sources`, async (context) => {
    const asked = await readBody(context.req.raw, connectedSourcesSeeding);
    return context.json({ connectedSources: await seedConnectedSources(app, asked) });
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

  // The fixture command's own act, so the journeys run by hand meet the workspace it makes.
  control.post(`${HARNESS_PREFIX}/test-workspaces`, async (context) => {
    const asked = await readBody(context.req.raw, testWorkspace);
    const ensured = await ensureTestWorkspace(BOOTSTRAP, app.doors.postgres, asked);
    if (!ensured.ok) {
      const { error } = ensured;
      const why = error instanceof Error ? error.message : JSON.stringify(error);
      throw new Error(`the test workspace was refused: ${why}`);
    }
    return context.json({ workspaceId: ensured.value.workspaceId });
  });

  control.post(`${HARNESS_PREFIX}/groups`, async (context) => {
    const asked = await readBody(context.req.raw, groupsMaking);
    return context.json(await makeGroups(app, asked));
  });

  control.post(`${HARNESS_PREFIX}/access-requests`, async (context) => {
    const asked = await readBody(context.req.raw, accessAsking);
    return context.json(await askToJoin(app, asked));
  });

  control.post(`${HARNESS_PREFIX}/name-flags`, async (context) => {
    const asked = await readBody(context.req.raw, nameFlagging);
    return context.json(await flagTheName(app, asked));
  });

  control.get(`${HARNESS_PREFIX}/codes`, (context) => {
    const email = context.req.query("email") ?? "";
    return context.json({ code: app.codeSentTo(email) });
  });

  control.get(`${HARNESS_PREFIX}/links`, (context) => {
    const email = context.req.query("email") ?? "";
    return context.json({ token: app.linkSentTo(email) });
  });

  control.get(`${HARNESS_PREFIX}/emails`, (context) => {
    const to = context.req.query("to") ?? "";
    return context.json({ sent: app.emails.filter((message) => message.to === to).length });
  });

  return control;
};
