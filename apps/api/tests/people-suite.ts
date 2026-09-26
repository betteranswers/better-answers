import { afterAll, beforeAll } from "vitest";

import { startApp, type TestApp } from "./harness.ts";
import { askToJoin } from "./harness-people.ts";
import { sessionPointedAt } from "./provoke.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type Api = Awaited<ReturnType<typeof webSignedIn>>["api"];

export const anAddress = (who: string): string =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@client.example`;

/** Its transport refuses the addresses in `unreachable`, as an SMTP relay that is down would. */
export const appForSuite = (unreachable: ReadonlySet<string>): (() => TestApp) => {
  let started: TestApp | undefined;

  beforeAll(async () => {
    started = await startApp({
      onEmail: (message) => {
        if (unreachable.has(message.to)) throw new Error("the relay refused the message");
      },
    });
  });

  afterAll(async () => {
    await started?.stop();
  });

  return () => {
    if (started === undefined) throw new Error("the suite's TestApp has not started");
    return started;
  };
};

export const emailsTo = (app: TestApp, address: string) =>
  app.emails.filter((message) => message.to === address);

export const eventsOn = async (app: TestApp, subjectId: string): Promise<string[]> =>
  (
    await app.database.superuser.query<{ act: string }>(
      "SELECT act FROM audit_event WHERE subject_id = $1 ORDER BY id",
      [subjectId],
    )
  ).rows.map((row) => row.act);

export const asksToJoin = async (
  app: TestApp,
  workspace: { readonly slug: string },
  displayName: string,
  reason: string,
) => {
  const requester = await app.person(anAddress(displayName.toLowerCase()), displayName);
  await askToJoin(app, { slug: workspace.slug, requesterId: requester.id, reason });
  return requester;
};

/** Keyed by role, so an assertion names the role a wrong answer went to. */
export const answeredBelowAdmin = async (
  app: TestApp,
  workspaceId: string,
  call: (api: Api) => Promise<unknown>,
): Promise<Readonly<Record<string, unknown>>> => {
  const answers: (readonly [string, unknown])[] = [];
  for (const role of ["Editor", "Viewer"] as const) {
    const person = await app.person(anAddress(role.toLowerCase()));
    await app.addMember(workspaceId, person.id, role);
    const { api } = await webSignedIn(app, person.email);
    answers.push([role, await refusalOfCall(call(api))]);
  }
  return Object.fromEntries(answers);
};

/** What another workspace's Admin is answered with their session pointed at this workspace. */
export const answeredToAnAdminPointedHere = async (
  app: TestApp,
  workspaceId: string,
  call: (api: Api) => Promise<unknown>,
): Promise<unknown> => {
  const elsewhere = await app.provision();
  const { api } = await webSignedIn(app, elsewhere.admin.email);
  await sessionPointedAt(app, elsewhere.admin.id, workspaceId);
  return refusalOfCall(call(api));
};
