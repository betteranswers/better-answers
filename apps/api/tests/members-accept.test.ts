import { describe, expect, it } from "vitest";

import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { whileCommitsAreRefused } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { NO_SESSION_ANSWERED, refusalOfCall, webSignedIn } from "./web-client.ts";

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

/** The act reads its instant from this clock, so an invitation can be read after its week is up. */
const clockShift = { ms: 0 };

const app = appForSuite({ clock: { now: () => new Date(Date.now() + clockShift.ms) } });

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ACCEPT_INVITATION = `${TRPC_ENDPOINT}/person.acceptInvitation`;

const anAddress = (who: string): string =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@client.example`;

type Api = Awaited<ReturnType<typeof webSignedIn>>["api"];

const ACCEPT_LINK = /\/invitations\/([0-9A-HJKMNP-TV-Z]{26})\b/;

/** The id the accept link in the latest invitation to `address` names; a sign-in code is skipped. */
const linkedInvitationId = (address: string): string => {
  const id = app()
    .emails.filter((message) => message.to === address)
    .map((message) => message.text.match(ACCEPT_LINK)?.[1])
    .findLast((found) => found !== undefined);
  if (id === undefined) throw new Error(`no accept link went to ${address}`);
  return id;
};

const anAdmin = async (name = "Calder Joinery") => {
  const workspace = await app().provision({ name });
  return { workspace, ...(await webSignedIn(app(), workspace.admin.email)) };
};

/** An Admin's invitation to a new address, and that address signed in with a display name. */
const anInvitee = async (role: "Admin" | "Editor" | "Viewer" = "Editor") => {
  const admin = await anAdmin();
  const address = anAddress("priya");
  await admin.api.members.invite.mutate({ address, role });
  const invitee = await webSignedIn(app(), address);
  await invitee.api.person.setDisplayName.mutate({ displayName: "Priya Shah" });
  return { admin, address, invitationId: linkedInvitationId(address), ...invitee };
};

const personIdOf = async (address: string): Promise<string> => {
  const found = await app().database.superuser.query<{ id: string }>(
    'SELECT id FROM "user" WHERE lower(email) = lower($1)',
    [address],
  );
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error(`nobody holds ${address}`);
  return id;
};

const membershipsOf = async (workspaceId: string, personId: string) =>
  (
    await app().database.superuser.query<{ role: string }>(
      "SELECT role FROM member WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, personId],
    )
  ).rows;

const joinedEventsOf = async (personId: string) =>
  (
    await app().database.superuser.query<{
      act: string;
      actor: string;
      workspace_id: string;
      detail: Record<string, string>;
    }>(
      `SELECT act, actor, workspace_id, detail FROM audit_event
        WHERE subject_id = $1 AND act = 'people.member.joined' ORDER BY id`,
      [personId],
    )
  ).rows;

const statusOf = async (invitationId: string): Promise<string | undefined> =>
  (
    await app().database.superuser.query<{ status: string }>(
      "SELECT status FROM invitation WHERE id = $1",
      [invitationId],
    )
  ).rows[0]?.status;

/** Nothing of a refused or failed accept is left behind: no member, no event, still waiting. */
const nothingLanded = async (at: {
  readonly workspaceId: string;
  readonly address: string;
  readonly invitationId: string;
}) => {
  const personId = await personIdOf(at.address);
  expect(await membershipsOf(at.workspaceId, personId)).toEqual([]);
  expect(await joinedEventsOf(personId)).toEqual([]);
  expect(await statusOf(at.invitationId)).toBe("pending");
};

const refusedAs = (httpStatus: number, word: string, refusalClass: string) => ({
  data: { httpStatus, refusal: { word, class: refusalClass } },
});

const accepting = (api: Api, invitationId: string) =>
  refusalOfCall(api.person.acceptInvitation.mutate({ invitationId }));

describe("accepting an invitation over tRPC", () => {
  it("reads the invitation, naming the workspace, role and inviter", async () => {
    const { api, invitationId } = await anInvitee("Editor");

    const read = await api.person.invitation.query({ invitationId });

    expect(read).toEqual({
      invitationId,
      workspaceName: "Calder Joinery",
      role: "Editor",
      invitedBy: "Test person",
      expiresAt: expect.stringMatching(ISO_INSTANT),
    });
  });

  it("joins at the invited role, the session pointed at it", async () => {
    const { admin, api, address, invitationId } = await anInvitee("Editor");
    const personId = await personIdOf(address);

    const joined = await api.person.acceptInvitation.mutate({ invitationId });

    const { workspaceId } = admin.workspace;
    expect(joined).toEqual({ workspaceId, workspaceName: "Calder Joinery", role: "Editor" });
    expect(await api.session.membership.query()).toEqual({
      workspace: { id: workspaceId, name: "Calder Joinery" },
      person: { id: personId, name: "Priya Shah", email: address },
      role: "Editor",
    });
    expect(await joinedEventsOf(personId)).toEqual([
      {
        act: "people.member.joined",
        actor: `human:${personId}`,
        workspace_id: workspaceId,
        detail: { invitationId, role: "Editor" },
      },
    ]);
    expect(await statusOf(invitationId)).toBe("accepted");
    expect(await admin.api.members.invitations.query()).toEqual([]);
  });

  it("moves a member of another workspace to the one joined", async () => {
    const elsewhere = await app().provision({ name: "Elsewhere Ltd" });
    const person = await app().person(anAddress("sam"), "Sam Okoro");
    await app().addMember(elsewhere.workspaceId, person.id, "Viewer");
    const { api } = await webSignedIn(app(), person.email);
    expect(await api.session.membership.query()).toMatchObject({
      workspace: { name: "Elsewhere Ltd" },
    });
    const admin = await anAdmin("Ryedale Metalwork");
    await admin.api.members.invite.mutate({ address: person.email, role: "Admin" });

    await api.person.acceptInvitation.mutate({ invitationId: linkedInvitationId(person.email) });

    expect(await api.session.membership.query()).toMatchObject({
      workspace: { id: admin.workspace.workspaceId, name: "Ryedale Metalwork" },
      role: "Admin",
    });
    expect(await membershipsOf(elsewhere.workspaceId, person.id)).toEqual([{ role: "Viewer" }]);
  });

  it("matches the invited address whatever its case", async () => {
    const { workspace } = await anAdmin();
    const address = anAddress("una");
    const invited = await app().invite({
      workspaceId: workspace.workspaceId,
      email: address.toUpperCase(),
      inviterId: workspace.admin.id,
      role: "Viewer",
    });
    const { api } = await webSignedIn(app(), address);
    await api.person.setDisplayName.mutate({ displayName: "Una Price" });

    expect(await api.person.acceptInvitation.mutate({ invitationId: invited.id })).toMatchObject({
      role: "Viewer",
    });
  });
});

describe("refusing an accept over tRPC", () => {
  it("refuses a person signed in with another address", async () => {
    const { admin, invitationId, address } = await anInvitee();
    const other = anAddress("other");
    const { api } = await webSignedIn(app(), other);
    await api.person.setDisplayName.mutate({ displayName: "Theo Other" });

    expect(await refusalOfCall(api.person.invitation.query({ invitationId }))).toMatchObject(
      refusedAs(403, "invitation-for-another-address", "forbidden"),
    );
    expect(await accepting(api, invitationId)).toMatchObject(
      refusedAs(403, "invitation-for-another-address", "forbidden"),
    );
    await nothingLanded({ workspaceId: admin.workspace.workspaceId, address: other, invitationId });
    await nothingLanded({ workspaceId: admin.workspace.workspaceId, address, invitationId });
  });

  it("refuses the invited address while it is unverified", async () => {
    const { admin, api, address, invitationId } = await anInvitee();
    await app().setEmailVerified(address, false);

    expect(await accepting(api, invitationId)).toMatchObject(
      refusedAs(403, "invitation-for-another-address", "forbidden"),
    );
    await nothingLanded({ workspaceId: admin.workspace.workspaceId, address, invitationId });
  });

  it("refuses an expired invitation until a resend revives it", async () => {
    const { admin, api, address, invitationId } = await anInvitee();

    clockShift.ms = EIGHT_DAYS_MS;
    try {
      expect(await accepting(api, invitationId)).toMatchObject(
        refusedAs(412, "invitation-expired", "precondition"),
      );
      await nothingLanded({ workspaceId: admin.workspace.workspaceId, address, invitationId });

      await admin.api.members.resendInvitation.mutate({ invitationId });

      expect(await api.person.acceptInvitation.mutate({ invitationId })).toMatchObject({
        role: "Editor",
      });
    } finally {
      clockShift.ms = 0;
    }
  });

  it("refuses a cancelled invitation no-such-invitation", async () => {
    const { admin, api, address, invitationId } = await anInvitee();
    await admin.api.members.cancelInvitation.mutate({ invitationId });

    expect(await accepting(api, invitationId)).toMatchObject(
      refusedAs(404, "no-such-invitation", "absent"),
    );
    const personId = await personIdOf(address);
    expect(await membershipsOf(admin.workspace.workspaceId, personId)).toEqual([]);
    expect(await joinedEventsOf(personId)).toEqual([]);
    expect(await statusOf(invitationId)).toBe("canceled");
  });

  it.each([
    ["an id no invitation holds", "01J0000000000000000000000Z"],
    ["a link that names no id", "not-an-invitation"],
  ])("refuses %s no-such-invitation", async (_link, invitationId) => {
    const { api } = await anInvitee();

    expect(await accepting(api, invitationId)).toMatchObject(
      refusedAs(404, "no-such-invitation", "absent"),
    );
  });

  it("refuses a current member already-a-member, once or twice", async () => {
    const { admin, api, address, invitationId } = await anInvitee("Viewer");
    await api.person.acceptInvitation.mutate({ invitationId });

    expect(await accepting(api, invitationId)).toMatchObject(
      refusedAs(409, "already-a-member", "conflict"),
    );
    const personId = await personIdOf(address);
    expect(await membershipsOf(admin.workspace.workspaceId, personId)).toEqual([
      { role: "Viewer" },
    ]);
    expect(await joinedEventsOf(personId)).toHaveLength(1);
  });

  it("refuses a person with no display name until named", async () => {
    const { workspace, api: adminApi } = await anAdmin();
    const address = anAddress("nameless");
    await adminApi.members.invite.mutate({ address, role: "Viewer" });
    const invitationId = linkedInvitationId(address);
    const { api } = await webSignedIn(app(), address);

    expect(await accepting(api, invitationId)).toMatchObject(
      refusedAs(412, "no-display-name", "precondition"),
    );
    await nothingLanded({ workspaceId: workspace.workspaceId, address, invitationId });

    await api.person.setDisplayName.mutate({ displayName: "Nia Named" });
    expect(await api.person.acceptInvitation.mutate({ invitationId })).toMatchObject({
      role: "Viewer",
    });
  });

  it("refuses a caller with no session", async () => {
    const { invitationId } = await anInvitee();

    const response = await app().client().json(ACCEPT_INVITATION, { invitationId });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject(NO_SESSION_ANSWERED);
  });
});

describe("a failed accept over tRPC", () => {
  it("lands no member, no event, and no workspace pick", async () => {
    const { admin, api, address, invitationId } = await anInvitee();

    const failed = await whileCommitsAreRefused(app(), "member", () =>
      accepting(api, invitationId),
    );

    expect(failed).toMatchObject({ data: { httpStatus: 500 } });
    await nothingLanded({ workspaceId: admin.workspace.workspaceId, address, invitationId });
    expect(await refusalOfCall(api.session.membership.query())).toMatchObject(
      refusedAs(401, "no-active-workspace", "unauthenticated"),
    );
  });
});
