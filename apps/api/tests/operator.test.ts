import type { inferProcedureBuilderResolverOptions } from "@trpc/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import type { OperatorPrincipal, Principal } from "@better-answers/core/kernel";
import type { Tx } from "@better-answers/core/store/postgres";
import { setOperatorMark } from "@better-answers/core/workspaces";
import { ulid } from "@better-answers/schema";

import { runOps } from "../src/ops/index.ts";
import type { operatorProcedure } from "../src/trpc/base.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { appRouter } from "../src/trpc/router.ts";
import { connectAsHost, refresh, signIn } from "./flow.ts";
import { capturingLogger, type TestApp } from "./harness.ts";
import { callMcp } from "./mcp-call.ts";
import { sessionsSignedInOverAnHourAgo } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const IDENTITY_ACTOR = "process:better-answers-identity";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type OperatorContext = inferProcedureBuilderResolverOptions<typeof operatorProcedure>["ctx"];

type WebApi = Awaited<ReturnType<typeof webSignedIn>>["api"];

/** Every console procedure, each asked with an input it would take from the operator. */
const CONSOLE_CALLS: readonly (readonly [string, (api: WebApi) => Promise<unknown>])[] = [
  ["console.workspaces.list", (api) => api.console.workspaces.list.query()],
  [
    "console.people.revokeCredentials",
    (api) => api.console.people.revokeCredentials.mutate({ personId: ulid() }),
  ],
];

/** The same procedures as a client holding only a bearer asks for them. */
const BEARER_ASKS: readonly (readonly [string, RequestInit])[] = [
  ["console.workspaces.list", {}],
  [
    "console.people.revokeCredentials",
    { method: "POST", body: JSON.stringify({ personId: ulid() }) },
  ],
];

const answeredUser = z.object({ user: z.looseObject({ id: z.string() }) });

type Run = { readonly exitCode: number; readonly lines: readonly string[] };

const ops = async (argv: readonly string[]): Promise<Run> => {
  const lines: string[] = [];
  const exitCode = await runOps(argv, app().doors, {
    fetch: async (url, init) => app().server.request(url, init),
    stdin: async () => "",
    say: (line) => {
      lines.push(line);
    },
    logger: capturingLogger().logger,
  });
  return { exitCode, lines };
};

const operatorRowsOf = async (personId: string) => {
  const found = await app().database.superuser.query(
    `SELECT act, actor, subject_id, detail FROM identity_audit_event
      WHERE subject_id = $1 AND act LIKE 'people.operator.%' ORDER BY at, id`,
    [personId],
  );
  return found.rows;
};

const operatorRowCount = async (): Promise<number> => {
  const found = await app().database.superuser.query<{ rows: number }>(
    "SELECT count(*)::int AS rows FROM identity_audit_event WHERE act LIKE 'people.operator.%'",
  );
  return found.rows[0]?.rows ?? 0;
};

const markHeldBy = async (personId: string): Promise<boolean | undefined> => {
  const found = await app().database.superuser.query<{ operator: boolean }>(
    'SELECT operator FROM "user" WHERE id = $1',
    [personId],
  );
  return found.rows[0]?.operator;
};

const marking = async (
  application: TestApp,
  email: string,
  change: "grant" | "revoke",
): Promise<void> => {
  const marked = await setOperatorMark(
    { kind: "platform", actorId: "process:better-answers-test" },
    application.doors.postgres,
    { email, change },
  );
  if (!marked.ok) throw new Error(`the mark was refused: ${String(marked.error)}`);
};

const theOperatorOnTheWeb = async () => {
  const workspace = await app().provision();
  await marking(app(), workspace.admin.email, "grant");
  return { workspace, ...(await webSignedIn(app(), workspace.admin.email)) };
};

/** Every role a workspace gives, each signed in on the web, none of them carrying the mark. */
const everyRoleOnTheWeb = async () => {
  const workspace = await app().provision();
  const editor = await app().person();
  const viewer = await app().person();
  await app().addMember(workspace.workspaceId, editor.id, "Editor");
  await app().addMember(workspace.workspaceId, viewer.id, "Viewer");

  const signedIn = [];
  for (const email of [workspace.admin.email, editor.email, viewer.email]) {
    signedIn.push(await webSignedIn(app(), email));
  }
  return signedIn;
};

/** The tRPC surface reads no bearer, so the operator's own token is a caller with no session. */
const theOperatorsBearerAt = async (path: string, init: RequestInit = {}) => {
  const { workspace } = await theOperatorOnTheWeb();
  const { accessToken } = await connectAsHost(app(), app().client(), workspace.admin);
  const response = await app()
    .client()
    .fetch(`${TRPC_ENDPOINT}/${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    });
  return { status: response.status, answer: await response.json() };
};

describe("operator — the mark an ops command sets and clears", () => {
  it("grants the mark, recorded under the platform's identity actor", async () => {
    const person = await app().person();

    const run = await ops(["operator", "--email", person.email, "--grant"]);

    expect(run).toEqual({
      exitCode: 0,
      lines: [`operator: done — ${person.email} is the operator`],
    });
    expect(await markHeldBy(person.id)).toBe(true);
    expect(await operatorRowsOf(person.id)).toEqual([
      {
        act: "people.operator.granted",
        actor: IDENTITY_ACTOR,
        subject_id: person.id,
        detail: {},
      },
    ]);
  });

  it("revokes the mark, recording the revocation as its own row", async () => {
    const person = await app().person();
    await ops(["operator", "--email", person.email, "--grant"]);

    const run = await ops(["operator", "--revoke", "--email", person.email.toUpperCase()]);

    expect(run).toEqual({
      exitCode: 0,
      lines: [`operator: done — ${person.email.toUpperCase()} is no longer the operator`],
    });
    expect(await markHeldBy(person.id)).toBe(false);
    expect((await operatorRowsOf(person.id)).map((row) => [row.act, row.actor])).toEqual([
      ["people.operator.granted", IDENTITY_ACTOR],
      ["people.operator.revoked", IDENTITY_ACTOR],
    ]);
  });

  it("writes nothing for a person already standing as asked", async () => {
    const person = await app().person();
    await ops(["operator", "--email", person.email, "--grant"]);

    const again = await ops(["operator", "--email", person.email, "--grant"]);
    const someoneElse = await app().person();
    const never = await ops(["operator", "--email", someoneElse.email, "--revoke"]);

    expect([again, never]).toEqual([
      {
        exitCode: 0,
        lines: [`operator: done — ${person.email} was already the operator; nothing written`],
      },
      {
        exitCode: 0,
        lines: [`operator: done — ${someoneElse.email} was not the operator; nothing written`],
      },
    ]);
    expect(await operatorRowsOf(person.id)).toHaveLength(1);
    expect(await operatorRowsOf(someoneElse.id)).toEqual([]);
  });

  it("refuses an address nobody has signed in with, writing nothing", async () => {
    const before = await operatorRowCount();

    const run = await ops(["operator", "--email", "nobody@acme.invalid", "--grant"]);

    expect(run).toEqual({
      exitCode: 1,
      lines: [
        "operator: REFUSED — no-such-user: nobody@acme.invalid has not signed in; have them sign in with an email code first, then run this again",
      ],
    });
    expect(await operatorRowCount()).toBe(before);
  });

  it.each([
    ["neither --grant nor --revoke", ["--email", "a@b.c"]],
    ["both --grant and --revoke", ["--email", "a@b.c", "--grant", "--revoke"]],
    ["no --email", ["--grant"]],
  ])("answers usage to %s", async (_shape, flags) => {
    const run = await ops(["operator", ...flags]);

    expect(run).toEqual({
      exitCode: 2,
      lines: ["operator: --email <email> and one of --grant or --revoke are required"],
    });
  });

  it("names the command in the usage", async () => {
    const run = await ops(["help"]);

    expect(run.lines.join("\n")).toContain("operator --email <email> --grant|--revoke");
  });
});

describe("the mark the identity provider never takes or returns", () => {
  it("refuses a first sign-in whose body sets the mark", async () => {
    const email = `mallory-${Date.now()}@acme.invalid`;
    const client = app().client();
    const asked = await client.json("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });
    expect(asked.status).toBe(200);

    const signedIn = await client.json("/sign-in/email-otp", {
      email,
      otp: app().codeSentTo(email),
      operator: true,
    });

    expect(signedIn.status).toBe(400);
    const marked = await app().database.superuser.query(
      'SELECT 1 FROM "user" WHERE lower(email) = lower($1) AND operator',
      [email],
    );
    expect(marked.rowCount).toBe(0);
  });

  it("leaves the mark out of the session the library answers", async () => {
    const person = await app().person();
    await marking(app(), person.email, "grant");
    const client = app().client();

    const signedIn = await signIn(app(), client, person.email);
    const session = await client.fetch("/get-session");

    const answered = [await signedIn.json(), await session.json()].map(
      (body) => answeredUser.parse(body).user,
    );
    expect(answered.map((user) => [user.id, Object.hasOwn(user, "operator")])).toEqual([
      [person.id, false],
      [person.id, false],
    ]);
  });
});

describe("the console's list of every workspace, the operator's alone", () => {
  it("hands a console procedure the operator, never a Principal", () => {
    expectTypeOf<OperatorContext["operator"]>().toEqualTypeOf<OperatorPrincipal>();
    expectTypeOf<OperatorContext["tx"]>().toEqualTypeOf<Tx>();
    expectTypeOf<OperatorContext["doors"]>().toEqualTypeOf<undefined>();
    expectTypeOf<OperatorContext>().not.toHaveProperty("principal");
    expectTypeOf<OperatorPrincipal>().not.toExtend<Principal>();
  });

  it("lists each workspace with its slug, members and creation", async () => {
    const { api } = await theOperatorOnTheWeb();
    const acme = await app().provision({ name: "Acme Holdings" });
    const colleague = await app().person();
    await app().addMember(acme.workspaceId, colleague.id, "Editor");

    const listed = await api.console.workspaces.list.query();

    expect(listed.find((workspace) => workspace.id === acme.workspaceId)).toEqual({
      id: acme.workspaceId,
      name: "Acme Holdings",
      slug: `ws-${acme.workspaceId.toLowerCase()}`,
      memberCount: 2,
      createdAt: expect.stringMatching(ISO_INSTANT),
    });
  });

  it("refuses every console procedure the router serves, none left out", () => {
    const consoleProcedures = Object.keys(appRouter._def.procedures)
      .filter((path) => path.startsWith("console."))
      .sort();

    expect(CONSOLE_CALLS.map(([path]) => path).toSorted()).toEqual(consoleProcedures);
    expect(BEARER_ASKS.map(([path]) => path).toSorted()).toEqual(consoleProcedures);
  });

  it.each(CONSOLE_CALLS)("refuses %s to Admin, Editor and Viewer", async (_path, call) => {
    const refusals: unknown[] = [];
    for (const { api } of await everyRoleOnTheWeb()) {
      refusals.push(await refusalOfCall(call(api)));
    }

    expect(refusals).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({
          data: expect.objectContaining({
            httpStatus: 403,
            refusal: { word: "not-the-operator", class: "forbidden" },
          }),
        }),
      ),
    );
  });

  it.each(BEARER_ASKS)("refuses %s to the operator's own OAuth bearer", async (path, init) => {
    expect(await theOperatorsBearerAt(path, init)).toMatchObject({
      status: 401,
      answer: { error: { data: { refusal: { word: "no-session" } } } },
    });
  });

  it("refuses the operator from the moment the mark is cleared", async () => {
    const { workspace, api } = await theOperatorOnTheWeb();
    expect(Array.isArray(await api.console.workspaces.list.query())).toBe(true);

    await marking(app(), workspace.admin.email, "revoke");

    expect(await refusalOfCall(api.console.workspaces.list.query())).toMatchObject({
      data: { refusal: { word: "not-the-operator", class: "forbidden" } },
    });
  });
});

describe("revoking a person's credentials everywhere, from the console", () => {
  const revocationRowsOf = async (personId: string) => {
    const found = await app().database.superuser.query(
      `SELECT act, actor, subject_id, detail FROM identity_audit_event
        WHERE subject_id = $1 AND act = 'people.person.credentials_revoked'`,
      [personId],
    );
    return found.rows;
  };

  const sessionsHeldBy = async (personId: string): Promise<number | undefined> => {
    const found = await app().database.superuser.query<{ held: number }>(
      "SELECT count(*)::int AS held FROM session WHERE user_id = $1",
      [personId],
    );
    return found.rows[0]?.held;
  };

  const refreshTokensOf = async (personId: string) => {
    const found = await app().database.superuser.query(
      `SELECT reference_id AS workspace_id, revoked IS NOT NULL AS revoked FROM oauth_refresh_token
        WHERE user_id = $1 ORDER BY reference_id`,
      [personId],
    );
    return found.rows;
  };

  const revokedAtOf = async (personId: string) => {
    const found = await app().database.superuser.query(
      'SELECT credentials_revoked_at FROM "user" WHERE id = $1',
      [personId],
    );
    return found.rows;
  };

  it("ends a person's sessions and tokens in both their workspaces", async () => {
    const { workspace: operators, api } = await theOperatorOnTheWeb();
    const acme = await app().provision({ name: "Acme" });
    const beta = await app().provision({ name: "Beta" });
    const person = acme.admin;
    await app().addMember(beta.workspaceId, person.id, "Editor");
    const inAcme = await connectAsHost(app(), app().client(), person, { pick: acme.workspaceId });
    const inBeta = await connectAsHost(app(), app().client(), person, { pick: beta.workspaceId });
    const host = app().client();
    expect(await sessionsHeldBy(person.id)).toBe(2);
    expect([
      (await callMcp(host, inAcme.accessToken, "tools/list")).status,
      (await callMcp(host, inBeta.accessToken, "tools/list")).status,
    ]).toEqual([200, 200]);

    const revoked = await api.console.people.revokeCredentials.mutate({ personId: person.id });

    expect(revoked).toEqual({ personId: person.id, revokedAt: expect.stringMatching(ISO_INSTANT) });
    expect(await sessionsHeldBy(person.id)).toBe(0);
    expect(await refreshTokensOf(person.id)).toEqual(
      [acme.workspaceId, beta.workspaceId]
        .toSorted()
        .map((workspaceId) => ({ workspace_id: workspaceId, revoked: true })),
    );
    expect([
      (await callMcp(host, inAcme.accessToken, "tools/list")).status,
      (await callMcp(host, inBeta.accessToken, "tools/list")).status,
      (await refresh(host, inAcme.refreshToken ?? "")).status,
      (await refresh(host, inBeta.refreshToken ?? "")).status,
    ]).toEqual([401, 401, 400, 400]);
    expect(await revocationRowsOf(person.id)).toEqual([
      {
        act: "people.person.credentials_revoked",
        actor: `human:${operators.admin.id}`,
        subject_id: person.id,
        detail: {},
      },
    ]);

    // Consent resolves the person in the workspace picked, so reaching the code at the client's
    // redirect is a fresh sign-in admitted there.
    for (const workspaceId of [acme.workspaceId, beta.workspaceId]) {
      await connectAsHost(app(), app().client(), person, { pick: workspaceId });
    }
  });

  it("admits the person's fresh sign-in once the revocation lands", async () => {
    const { api } = await theOperatorOnTheWeb();
    const acme = await app().provision();
    const before = await webSignedIn(app(), acme.admin.email);
    await api.console.people.revokeCredentials.mutate({ personId: acme.admin.id });

    const again = await webSignedIn(app(), acme.admin.email);

    expect(await refusalOfCall(before.api.session.membership.query())).toMatchObject({
      data: { refusal: { word: "no-session" } },
    });
    expect(await again.api.session.membership.query()).toMatchObject({
      workspace: { id: acme.workspaceId },
      person: { id: acme.admin.id },
      role: "Admin",
    });
  });

  it("refuses the operator's sign-in over an hour old, writing nothing", async () => {
    const { workspace, api } = await theOperatorOnTheWeb();
    const person = await app().person();
    await sessionsSignedInOverAnHourAgo(app(), workspace.admin.id);

    const refused = await refusalOfCall(
      api.console.people.revokeCredentials.mutate({ personId: person.id }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "sign-in-too-old", class: "unauthenticated" } },
    });
    expect(await revokedAtOf(person.id)).toEqual([{ credentials_revoked_at: null }]);
    expect(await revocationRowsOf(person.id)).toEqual([]);
  });

  it("admits the operator again after a fresh sign-in", async () => {
    const { workspace } = await theOperatorOnTheWeb();
    const person = await app().person();
    await sessionsSignedInOverAnHourAgo(app(), workspace.admin.id);

    const { api } = await webSignedIn(app(), workspace.admin.email);
    const revoked = await api.console.people.revokeCredentials.mutate({ personId: person.id });

    expect(revoked.personId).toBe(person.id);
    expect(await revocationRowsOf(person.id)).toHaveLength(1);
  });

  it("refuses a person nobody holds, writing nothing", async () => {
    const { api } = await theOperatorOnTheWeb();
    const nobody = ulid();

    const refused = await refusalOfCall(
      api.console.people.revokeCredentials.mutate({ personId: nobody }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-user", class: "absent" } },
    });
    expect(await revocationRowsOf(nobody)).toEqual([]);
  });
});

describe("the session's read of whether its person is the operator", () => {
  it("names the operator, who needs no workspace for it", async () => {
    const person = await app().person();
    await marking(app(), person.email, "grant");
    const { api } = await webSignedIn(app(), person.email);

    expect(await api.session.operator.query()).toEqual({ operator: true, name: person.name });
  });

  it("answers no to an Admin, an Editor and a Viewer", async () => {
    const answers: unknown[] = [];
    for (const { api } of await everyRoleOnTheWeb()) {
      answers.push(await api.session.operator.query());
    }

    expect(answers).toEqual([{ operator: false }, { operator: false }, { operator: false }]);
  });

  it("answers no from the moment the mark is cleared", async () => {
    const { workspace, api } = await theOperatorOnTheWeb();
    await marking(app(), workspace.admin.email, "revoke");

    expect(await api.session.operator.query()).toEqual({ operator: false });
  });

  it("refuses a caller with no session, the operator's bearer included", async () => {
    expect(await theOperatorsBearerAt("session.operator")).toMatchObject({
      status: 401,
      answer: { error: { data: { refusal: { word: "no-session", class: "unauthenticated" } } } },
    });
  });
});
