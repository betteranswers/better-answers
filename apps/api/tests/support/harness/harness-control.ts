import { Hono } from "hono";
import { DatabaseError } from "pg";
import { z } from "zod";

import { setOperatorMark } from "@better-answers/core/workspaces";
import {
  INVITATION_ACCEPTED_STATUS,
  INVITATION_CANCELLED_STATUS,
  INVITATION_WAITING_STATUS,
  llmPurpose,
  ROLES,
} from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import { IDENTITY_PRINCIPAL } from "../../../src/identity-principal.ts";
import { authenticatorKeyOf, holdAnAuthenticator, savedRecoveryCodes } from "../factor-harness.ts";
import {
  codeSentPastItsExpiry,
  confirmationsAgedOverAnHourAgo,
  pendingSessionsPastTheirHour,
  restoredByTheOperator,
  aSeededSessionFor,
} from "../provoke.ts";
import {
  askingNamed,
  askingScripting,
  setUpAsking,
  type ScriptedModels,
} from "./harness-asking.ts";
import {
  conceptIndexSeeding,
  conceptsSeeding,
  editSuggesting,
  nameOwners,
  ownersNaming,
  seedConceptIndex,
  seedConcepts,
  seedEditSuggestion,
} from "./harness-knowledge.ts";
import {
  accessAsking,
  askToJoin,
  flagTheName,
  groupsMaking,
  makeGroups,
  nameFlagging,
} from "./harness-people.ts";
import { questionsSeeding, seedQuestions } from "./harness-questions.ts";
import {
  connectedSourcesSeeding,
  inOneTransaction,
  syncMoving,
  moveTheSync,
  seedConnectedSources,
} from "./harness-sources.ts";
import type { TestApp } from "./harness.ts";

const HARNESS_PREFIX = "/__harness";

const provisioning = z.object({
  name: z.string().min(1).optional(),
  adminEmail: z.string().min(1).optional(),
});
const person = z.object({
  email: z.string().min(1).optional(),
  displayName: z.string().optional(),
});
const member = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(ROLES),
});
const revocation = z.object({ userId: z.string().min(1) });
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
const aSession = z.object({
  userId: z.string().min(1),
  userAgent: z.string().min(1).nullish(),
});
const codeAging = z.object({ email: z.string().min(1) });
const byEmail = z.object({ email: z.string().min(1) });
const CODES_GIVEN = ["saved", "none"] as const;

type CodesGiven = (typeof CODES_GIVEN)[number];

const enrolling = byEmail.extend({ codes: z.enum(CODES_GIVEN).default("saved") });

type Enrolled = { readonly key: string; readonly recoveryCodes: readonly string[] };

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

const personIdOf = async (app: TestApp, email: string): Promise<string> => {
  const found = await app.database.superuser.query<{ id: string }>(
    'SELECT id FROM "user" WHERE lower(email) = lower($1)',
    [email],
  );
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error(`the harness holds no person at ${email}`);
  return id;
};

const modelsOf = (models: ScriptedModels | undefined): ScriptedModels => {
  if (models === undefined) throw new Error("the harness was started with no scripted model wire");
  return models;
};

const readBody = async <T>(request: Request, schema: z.ZodType<T>): Promise<T> =>
  schema.parse(await request.json());

const whyNotWritten = (error: Error) => {
  if (error instanceof z.ZodError) {
    return {
      fields: error.issues.map((issue) => ({ field: issue.path.join("."), rule: issue.message })),
    };
  }
  if (error instanceof DatabaseError && error.constraint !== undefined) {
    return { constraint: error.constraint, said: error.message, detail: error.detail };
  }
  return undefined;
};

export const harnessControl = (app: TestApp, models?: ScriptedModels): Hono => {
  const control = new Hono();
  const enrolled = enrolments(app);

  control.onError((error, context) => {
    const why = whyNotWritten(error);
    if (why === undefined) throw error;
    return context.json(why, 400);
  });

  control.post(`${HARNESS_PREFIX}/workspaces`, async (context) => {
    const asked = await readBody(context.req.raw, provisioning);
    return context.json(await app.provision(asked));
  });

  control.post(`${HARNESS_PREFIX}/people`, async (context) => {
    const asked = await readBody(context.req.raw, person);
    return context.json(await app.person(asked.email, asked.displayName));
  });

  control.post(`${HARNESS_PREFIX}/members`, async (context) => {
    const asked = await readBody(context.req.raw, member);
    await app.addMember(asked.workspaceId, asked.userId, asked.role);
    return context.json({ added: true });
  });

  control.post(`${HARNESS_PREFIX}/invitations`, async (context) => {
    const asked = await readBody(context.req.raw, invitation);
    return context.json(await app.invite(asked));
  });

  control.post(`${HARNESS_PREFIX}/revocations`, async (context) => {
    const asked = await readBody(context.req.raw, revocation);

    await app.endEverySignInAndToken(asked.userId, new Date());
    return context.json({ revoked: true });
  });

  control.post(`${HARNESS_PREFIX}/confirmations/aged`, async (context) => {
    const asked = await readBody(context.req.raw, aging);
    await confirmationsAgedOverAnHourAgo(app, asked.userId);
    return context.json({ aged: true });
  });

  control.post(`${HARNESS_PREFIX}/sessions`, async (context) => {
    const asked = await readBody(context.req.raw, aSession);
    const agent =
      asked.userAgent === undefined || asked.userAgent === null
        ? {}
        : { userAgent: asked.userAgent };
    return context.json({ sessionId: await aSeededSessionFor(app, asked.userId, agent) });
  });

  control.post(`${HARNESS_PREFIX}/pending-sessions/aged`, async (context) => {
    const asked = await readBody(context.req.raw, aging);
    await pendingSessionsPastTheirHour(app, asked.userId);
    return context.json({ aged: true });
  });

  control.post(`${HARNESS_PREFIX}/codes/aged`, async (context) => {
    const asked = await readBody(context.req.raw, codeAging);
    await codeSentPastItsExpiry(app, asked.email);
    return context.json({ aged: true });
  });

  control.post(`${HARNESS_PREFIX}/authenticators`, async (context) => {
    const asked = await readBody(context.req.raw, enrolling);
    const personId = await personIdOf(app, asked.email);
    const held = enrolled.get(personId) ?? (await enrolled.enrol(personId, asked.codes));
    return context.json(held);
  });

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
    await inOneTransaction(app, async (client) => {
      const seed = testData(client);
      for (const modelChoice of asked.modelChoices) {
        await seed.modelChoice({ workspaceId: asked.workspaceId, ...modelChoice });
      }
    });
    return context.json({ seeded: asked.modelChoices.length });
  });

  control.post(`${HARNESS_PREFIX}/connected-sources`, async (context) => {
    const asked = await readBody(context.req.raw, connectedSourcesSeeding);
    return context.json({ connectedSources: await seedConnectedSources(app, asked) });
  });

  control.post(`${HARNESS_PREFIX}/syncs`, async (context) => {
    const asked = await readBody(context.req.raw, syncMoving);
    return context.json(await moveTheSync(app, asked));
  });

  control.post(`${HARNESS_PREFIX}/concepts`, async (context) => {
    const asked = await readBody(context.req.raw, conceptsSeeding);
    return context.json(await seedConcepts(app, asked));
  });

  control.post(`${HARNESS_PREFIX}/concept-index`, async (context) => {
    const asked = await readBody(context.req.raw, conceptIndexSeeding);
    return context.json(await seedConceptIndex(app, asked));
  });

  control.post(`${HARNESS_PREFIX}/owners`, async (context) => {
    const asked = await readBody(context.req.raw, ownersNaming);
    return context.json(await nameOwners(app, asked));
  });

  control.post(`${HARNESS_PREFIX}/suggestions`, async (context) => {
    const asked = await readBody(context.req.raw, editSuggesting);
    return context.json(await seedEditSuggestion(app, asked));
  });

  control.post(`${HARNESS_PREFIX}/asking`, async (context) => {
    const asked = await readBody(context.req.raw, askingScripting);
    await setUpAsking(app, modelsOf(models), asked);
    return context.json({ scripted: true });
  });

  control.post(`${HARNESS_PREFIX}/asking/releases`, async (context) => {
    const asked = await readBody(context.req.raw, askingNamed);
    return context.json({ released: modelsOf(models).release(asked.workspaceId) });
  });

  control.get(`${HARNESS_PREFIX}/asking/calls`, (context) => {
    const workspaceId = context.req.query("workspaceId") ?? "";
    return context.json(modelsOf(models).callsTo(workspaceId));
  });

  control.post(`${HARNESS_PREFIX}/questions`, async (context) => {
    const asked = await readBody(context.req.raw, questionsSeeding);
    return context.json({ records: await seedQuestions(app, asked) });
  });

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
