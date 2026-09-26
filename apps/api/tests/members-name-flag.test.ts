import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmailMessage } from "../src/email.ts";
import { startApp, type TestApp } from "./harness.ts";
import { displayNameHeldBy, sessionPointedAt, whileCommitsAreRefused } from "./provoke.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

let app: TestApp;

/** What the relay took; the harness's own list keeps a refused message too. */
const delivered: EmailMessage[] = [];

/** In address order, as the relay's messages are sorted before they are compared. */
let operators: readonly [string, string];

let formerOperator: string;

// While set, the transport refuses mail to it, as an SMTP relay refusing that address would.
let relayRefuses: string | undefined;

beforeAll(async () => {
  app = await startApp({
    onEmail: (message) => {
      if (message.to === relayRefuses) throw new Error("the relay refused the message");
      delivered.push(message);
    },
  });
  const [first, second, former] = [
    await app.person("a-operator@example.test"),
    await app.person("b-operator@example.test"),
    await app.person(),
  ];
  for (const { email } of [first, second, former]) await app.markOperator(email, "grant");
  await app.markOperator(former.email, "revoke");
  operators = [first.email, second.email];
  formerOperator = former.email;
});

afterAll(async () => {
  await app.stop();
});

const NAME_FLAGGED = "people.person.name_flagged";

const FLAG_RAISED = "people.name_flag.raised";

const RUDE_NAME = "Rude Name";

const aWorkspaceWithAFlaggable = async (name = "Calder Joinery") => {
  const workspace = await app.provision({ name });
  const person = await app.person(undefined, RUDE_NAME);
  await app.addMember(workspace.workspaceId, person.id, "Viewer");
  const signedIn = await webSignedIn(app, workspace.admin.email);
  return { workspace, person, ...signedIn };
};

const flaggedIn = async (workspaceId: string) =>
  (
    await app.database.superuser.query<{ actor: string; subject_id: string; detail: object }>(
      "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY at, id",
      [workspaceId, NAME_FLAGGED],
    )
  ).rows;

const raisedFor = async (personId: string) =>
  (
    await app.database.superuser.query<{ actor: string; subject_id: string; detail: object }>(
      "SELECT actor, subject_id, detail FROM identity_audit_event WHERE subject_id = $1 AND act = $2 ORDER BY at, id",
      [personId, FLAG_RAISED],
    )
  ).rows;

/** Every email about the person the relay took, whoever it went to. */
const toldTheOperatorOf = (personId: string) =>
  delivered.filter((message) => message.text.includes(personId));

const sentToTheOperator = (personId: string) => ({ personId, sentToTheOperator: true });

const whatLanded = async (workspaceId: string, personId: string) => ({
  flagged: await flaggedIn(workspaceId),
  raised: await raisedFor(personId),
  told: toldTheOperatorOf(personId),
});

const NOTHING_LANDED = { flagged: [], raised: [], told: [] };

/** A member of the workspace at `role`, on the web's own client. */
const signedInAs = async (workspaceId: string, role: "Editor" | "Viewer") => {
  const member = await app.person();
  await app.addMember(workspaceId, member.id, role);
  return (await webSignedIn(app, member.email)).api;
};

describe("flagging a display name over tRPC", () => {
  it("answers sent to the operator, flagging on both audit logs", async () => {
    const { workspace, person, api } = await aWorkspaceWithAFlaggable();

    const answered = await api.members.flagDisplayName.mutate({ personId: person.id });

    expect(answered).toEqual(sentToTheOperator(person.id));
    expect(await flaggedIn(workspace.workspaceId)).toEqual([
      { actor: `human:${workspace.admin.id}`, subject_id: person.id, detail: {} },
    ]);
    expect(await raisedFor(person.id)).toEqual([
      {
        actor: `human:${workspace.admin.id}`,
        subject_id: person.id,
        detail: { workspaceId: workspace.workspaceId },
      },
    ]);
  });

  it("emails each marked person the workspace, person id and name", async () => {
    const { workspace, person, api } = await aWorkspaceWithAFlaggable("Hollins Freight");

    await api.members.flagDisplayName.mutate({ personId: person.id });

    const told = toldTheOperatorOf(person.id).toSorted((a, b) => a.to.localeCompare(b.to));
    expect(told).toEqual(
      operators.map((to) => ({
        to,
        subject: "A display name is flagged in Hollins Freight",
        text: [
          "An Admin of Hollins Freight flagged a display name as inappropriate.",
          "",
          `Workspace: Hollins Freight (${workspace.workspaceId})`,
          `Person: ${person.id}`,
          "Current display name: Rude Name",
          "",
          "The name stands until it is corrected. No Admin can change it.",
        ].join("\n"),
      })),
    );
    expect(told.map((message) => message.to)).not.toContain(formerOperator);
  });

  it("answers a second flag alike, writing and emailing nothing new", async () => {
    const { workspace, person, api } = await aWorkspaceWithAFlaggable();
    await api.members.flagDisplayName.mutate({ personId: person.id });

    const again = await api.members.flagDisplayName.mutate({ personId: person.id });

    expect(again).toEqual(sentToTheOperator(person.id));
    expect(await flaggedIn(workspace.workspaceId)).toHaveLength(1);
    expect(await raisedFor(person.id)).toHaveLength(1);
    expect(toldTheOperatorOf(person.id)).toHaveLength(operators.length);
  });

  it("answers alike wherever else the person belongs or is flagged", async () => {
    const { workspace, api } = await aWorkspaceWithAFlaggable();
    const elsewhere = await app.provision();
    const { api: elsewhereApi } = await webSignedIn(app, elsewhere.admin.email);
    const onlyHere = await app.person(undefined, "Only Here");
    const alsoElsewhere = await app.person(undefined, "Also Elsewhere");
    const flaggedElsewhere = await app.person(undefined, "Flagged Elsewhere");
    for (const person of [onlyHere, alsoElsewhere, flaggedElsewhere]) {
      await app.addMember(workspace.workspaceId, person.id, "Editor");
    }
    for (const person of [alsoElsewhere, flaggedElsewhere]) {
      await app.addMember(elsewhere.workspaceId, person.id, "Viewer");
    }
    await elsewhereApi.members.flagDisplayName.mutate({ personId: flaggedElsewhere.id });

    const answers = [
      await api.members.flagDisplayName.mutate({ personId: onlyHere.id }),
      await api.members.flagDisplayName.mutate({ personId: alsoElsewhere.id }),
      await api.members.flagDisplayName.mutate({ personId: flaggedElsewhere.id }),
    ];

    expect(answers).toEqual([
      sentToTheOperator(onlyHere.id),
      sentToTheOperator(alsoElsewhere.id),
      sentToTheOperator(flaggedElsewhere.id),
    ]);
  });
});

describe("what no Admin act does", () => {
  it("leaves the flagged display name as the person gave it", async () => {
    const { person, api } = await aWorkspaceWithAFlaggable();

    await api.members.flagDisplayName.mutate({ personId: person.id });

    expect(await displayNameHeldBy(app, person.id)).toBe(RUDE_NAME);
  });

  it("renames only the calling Admin, whoever the display-name act names", async () => {
    const { workspace, person, client } = await aWorkspaceWithAFlaggable();

    const given = await client.json("/trpc/person.setDisplayName", {
      displayName: "Renamed By An Admin",
      personId: person.id,
    });

    expect(given.status).toBe(200);
    expect(await displayNameHeldBy(app, person.id)).toBe(RUDE_NAME);
    expect(await displayNameHeldBy(app, workspace.admin.id)).toBe("Renamed By An Admin");
  });
});

describe("who may flag a display name", () => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses a member at %s, role-forbids, recording and emailing nothing",
    async (role) => {
      const { workspace, person } = await aWorkspaceWithAFlaggable();
      const api = await signedInAs(workspace.workspaceId, role);

      const refused = await refusalOfCall(
        api.members.flagDisplayName.mutate({ personId: person.id }),
      );

      expect(refused).toMatchObject({
        data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
      });
      expect(await whatLanded(workspace.workspaceId, person.id)).toEqual(NOTHING_LANDED);
    },
  );

  it("refuses an Admin of another workspace pointed at this one", async () => {
    const { workspace, person } = await aWorkspaceWithAFlaggable();
    const elsewhere = await app.provision();
    const { api } = await webSignedIn(app, elsewhere.admin.email);
    await sessionPointedAt(app, elsewhere.admin.id, workspace.workspaceId);

    const refused = await refusalOfCall(
      api.members.flagDisplayName.mutate({ personId: person.id }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 401, refusal: { word: "not-a-member", class: "unauthenticated" } },
    });
    expect(await raisedFor(person.id)).toEqual([]);
    expect(toldTheOperatorOf(person.id)).toEqual([]);
  });

  it("refuses a member of another workspace as no member here", async () => {
    const mine = await app.provision();
    const { person: theirs } = await aWorkspaceWithAFlaggable();
    const { api } = await webSignedIn(app, mine.admin.email);

    const refused = await refusalOfCall(
      api.members.flagDisplayName.mutate({ personId: theirs.id }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-member", class: "absent" } },
    });
    expect(await raisedFor(theirs.id)).toEqual([]);
    expect(toldTheOperatorOf(theirs.id)).toEqual([]);
  });
});

describe("the operator's email", () => {
  it("goes only after the commit, never for a failed flag", async () => {
    const { workspace, person, api } = await aWorkspaceWithAFlaggable();

    const failed = await whileCommitsAreRefused(app, "identity_audit_event", () =>
      refusalOfCall(api.members.flagDisplayName.mutate({ personId: person.id })),
    );

    expect(failed).toMatchObject({ data: { httpStatus: 500 } });
    expect(await whatLanded(workspace.workspaceId, person.id)).toEqual(NOTHING_LANDED);
  });

  it("fails to one operator yet reaches the other, logging it", async () => {
    const { person, api } = await aWorkspaceWithAFlaggable();
    const [refused, reached] = operators;
    relayRefuses = refused;
    const answered = await api.members.flagDisplayName
      .mutate({ personId: person.id })
      .finally(() => {
        relayRefuses = undefined;
      });

    expect(answered).toEqual(sentToTheOperator(person.id));
    expect(await raisedFor(person.id)).toHaveLength(1);
    expect(toldTheOperatorOf(person.id).map((message) => message.to)).toEqual([reached]);
    expect(app.logs.filter((line) => line["person_id"] === person.id)).toEqual([
      expect.objectContaining({
        level: 40,
        event: "trpc.email_failed",
        msg: "the name flag's email to the operator did not go",
      }),
    ]);
    expect(JSON.stringify(app.logs)).not.toContain(RUDE_NAME);
  });
});
