import { describe, expect, it } from "vitest";

import { connectAsHost, refresh, revokeAtEndpoint, setActiveWorkspace } from "./flow.ts";
import type { TestClient } from "./harness.ts";
import { callMcp } from "./mcp-call.ts";
import {
  anAdminOfElsewherePointedAt,
  NOT_A_MEMBER_ANSWERED,
  ROLE_FORBIDS_ANSWERED,
} from "./people-refusals.ts";
import { failureOf, whileAuditRowsVanish } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const CREDENTIALS_REVOKED = "people.member.credentials_revoked";

const REVOKED_HERE = {
  data: { httpStatus: 401, refusal: { word: "credentials-revoked", class: "unauthenticated" } },
};

const instantHeld = async (workspaceId: string, personId: string) => {
  const held = await app().database.superuser.query<{ at: Date | null }>(
    "SELECT credentials_revoked_at AS at FROM member WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, personId],
  );
  return held.rows[0]?.at;
};

const revocationsIn = async (workspaceId: string) => {
  const rows = await app().database.superuser.query<{
    actor: string;
    subject_id: string;
    detail: object;
  }>(
    "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND act = $2 ORDER BY id",
    [workspaceId, CREDENTIALS_REVOKED],
  );
  return rows.rows;
};

const refreshTokensOf = async (personId: string) => {
  const found = await app().database.superuser.query<{ workspace_id: string; revoked: boolean }>(
    `SELECT reference_id AS workspace_id, revoked IS NOT NULL AS revoked FROM oauth_refresh_token
      WHERE user_id = $1 ORDER BY reference_id`,
    [personId],
  );
  return found.rows;
};

const NOTHING_LANDED = { instant: null, revocations: [] };

const whatLanded = async (workspaceId: string, personId: string) => ({
  instant: await instantHeld(workspaceId, personId),
  revocations: await revocationsIn(workspaceId),
});

const aMemberOfTwoWorkspaces = async () => {
  const here = await app().provision({ name: "Acme" });
  const elsewhere = await app().provision({ name: "Zenith" });
  const person = await app().person(undefined, "Priya Shah");
  await app().addMember(here.workspaceId, person.id, "Editor");
  await app().addMember(elsewhere.workspaceId, person.id, "Viewer");
  const { api } = await webSignedIn(app(), here.admin.email);
  return { here, elsewhere, person, admin: api };
};

/** A member of two workspaces signs in with neither active, so each session picks this one. */
const signedInHere = async (email: string, workspaceId: string) => {
  const signedIn = await webSignedIn(app(), email);
  expect((await setActiveWorkspace(signedIn.client, workspaceId)).status).toBe(200);
  return signedIn;
};

/** The member's client holds a grant in each workspace, and a third client presents them. */
const connectedInBoth = async () => {
  const members = await aMemberOfTwoWorkspaces();
  const { here, elsewhere, person } = members;
  const inHere = await connectAsHost(app(), app().client(), person, { pick: here.workspaceId });
  const inElsewhere = await connectAsHost(app(), app().client(), person, {
    pick: elsewhere.workspaceId,
  });
  expect([inHere.refreshToken, inElsewhere.refreshToken]).toEqual([
    expect.stringMatching(/./),
    expect.stringMatching(/./),
  ]);
  return { ...members, inHere, inElsewhere, host: app().client() };
};

const tokenAnswers = async (
  host: TestClient,
  tokens: { readonly accessToken: string; readonly refreshToken: string | undefined },
) => ({
  mcp: (await callMcp(host, tokens.accessToken, "tools/list")).status,
  refresh: (await refresh(host, tokens.refreshToken ?? "")).status,
});

describe("revoking a member's credentials in this workspace over tRPC", () => {
  it("refuses every session the member holds here, admitting one elsewhere", async () => {
    const { here, elsewhere, person, admin } = await aMemberOfTwoWorkspaces();
    const first = await signedInHere(person.email, here.workspaceId);
    const second = await signedInHere(person.email, here.workspaceId);
    for (const { api } of [first, second]) {
      expect((await api.session.membership.query()).workspace.id).toBe(here.workspaceId);
    }

    const revoked = await admin.members.revokeCredentials.mutate({ personId: person.id });

    expect(revoked).toEqual({ personId: person.id, revokedAt: expect.stringMatching(ISO_INSTANT) });
    expect(await refusalOfCall(first.api.session.membership.query())).toMatchObject(REVOKED_HERE);
    expect(await refusalOfCall(second.api.session.membership.query())).toMatchObject(REVOKED_HERE);
    expect((await setActiveWorkspace(second.client, elsewhere.workspaceId)).status).toBe(200);
    expect(await second.api.session.membership.query()).toMatchObject({
      workspace: { id: elsewhere.workspaceId },
      role: "Viewer",
    });
    expect(await revocationsIn(here.workspaceId)).toEqual([
      { actor: `human:${here.admin.id}`, subject_id: person.id, detail: {} },
    ]);
    expect(await revocationsIn(elsewhere.workspaceId)).toEqual([]);
  });

  it("admits the member's fresh sign-in once the revocation lands", async () => {
    const { here, person, admin } = await aMemberOfTwoWorkspaces();
    const before = await signedInHere(person.email, here.workspaceId);
    await admin.members.revokeCredentials.mutate({ personId: person.id });

    const again = await signedInHere(person.email, here.workspaceId);

    expect(await refusalOfCall(before.api.session.membership.query())).toMatchObject(REVOKED_HERE);
    expect(await again.api.session.membership.query()).toMatchObject({
      workspace: { id: here.workspaceId },
      person: { id: person.id },
      role: "Editor",
    });
  });

  it("ends the member's tokens for this workspace, not another's", async () => {
    const { elsewhere, person, admin, inHere, inElsewhere, host } = await connectedInBoth();

    await admin.members.revokeCredentials.mutate({ personId: person.id });

    expect(await refreshTokensOf(person.id)).toEqual([
      { workspace_id: elsewhere.workspaceId, revoked: false },
    ]);
    const hereAnswers = await tokenAnswers(host, inHere);
    expect({ here: hereAnswers, elsewhere: await tokenAnswers(host, inElsewhere) }).toEqual({
      here: { mcp: 401, refresh: 400 },
      elsewhere: { mcp: 200, refresh: 200 },
    });
  });

  it("keeps elsewhere's tokens when this one's is presented to revoke", async () => {
    const { person, admin, inHere, inElsewhere, host } = await connectedInBoth();
    await admin.members.revokeCredentials.mutate({ personId: person.id });

    const revoking = await revokeAtEndpoint(host, inHere.refreshToken ?? "");

    expect(revoking.status).toBe(400);
    expect(await tokenAnswers(host, inElsewhere)).toEqual({ mcp: 200, refresh: 200 });
  });

  it("answers alike whether or not the person belongs elsewhere", async () => {
    const { here, elsewhere, person, admin } = await aMemberOfTwoWorkspaces();
    const onlyHere = await app().person(undefined, "Sam Okoro");
    await app().addMember(here.workspaceId, onlyHere.id, "Viewer");

    const answers = [
      await admin.members.revokeCredentials.mutate({ personId: person.id }),
      await admin.members.revokeCredentials.mutate({ personId: onlyHere.id }),
    ];

    expect(answers).toEqual([
      { personId: person.id, revokedAt: expect.stringMatching(ISO_INSTANT) },
      { personId: onlyHere.id, revokedAt: expect.stringMatching(ISO_INSTANT) },
    ]);
    const listed = JSON.stringify(await admin.members.list.query());
    for (const said of [JSON.stringify(answers), listed]) {
      expect(said).not.toContain(elsewhere.workspaceId);
      expect(said).not.toContain(elsewhere.name);
    }
  });

  it("lists the act's instant, taken from the api's clock", async () => {
    const { person, admin } = await aMemberOfTwoWorkspaces();
    const before = Date.now();

    const { revokedAt } = await admin.members.revokeCredentials.mutate({ personId: person.id });

    const after = Date.now();
    expect(Date.parse(revokedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(revokedAt)).toBeLessThanOrEqual(after);
    const listed = await admin.members.list.query();
    expect(listed.find((member) => member.personId === person.id)?.credentialsRevokedAt).toBe(
      revokedAt,
    );
  });

  it("revokes the only Admin's own credentials, ending their session", async () => {
    const workspace = await app().provision();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const revoked = await api.members.revokeCredentials.mutate({ personId: workspace.admin.id });

    expect(revoked).toMatchObject({ personId: workspace.admin.id });
    expect(await refusalOfCall(api.members.list.query())).toMatchObject(REVOKED_HERE);
  });
});

describe("a revoked Admin on the People procedures", () => {
  it("refuses a revoked Admin's session on every People procedure", async () => {
    const workspace = await app().provision();
    const second = await app().person(undefined, "Ada Hartley");
    await app().addMember(workspace.workspaceId, second.id, "Admin");
    const { api: theirs } = await webSignedIn(app(), second.email);
    const { api: mine } = await webSignedIn(app(), workspace.admin.email);
    await mine.members.revokeCredentials.mutate({ personId: second.id });

    const refused = [
      await refusalOfCall(theirs.members.list.query()),
      await refusalOfCall(
        theirs.members.changeRole.mutate({ personId: workspace.admin.id, role: "Viewer" }),
      ),
      await refusalOfCall(
        theirs.members.revokeCredentials.mutate({ personId: workspace.admin.id }),
      ),
    ];

    expect(refused).toMatchObject([REVOKED_HERE, REVOKED_HERE, REVOKED_HERE]);
    expect(await whatLanded(workspace.workspaceId, workspace.admin.id)).toEqual({
      instant: null,
      revocations: [{ actor: `human:${workspace.admin.id}`, subject_id: second.id, detail: {} }],
    });
    expect((await mine.session.membership.query()).role).toBe("Admin");
  });
});

describe("who may revoke a member's credentials", () => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses a member at %s, role-forbids, recording nothing",
    async (role) => {
      const workspace = await app().provision();
      const actor = await app().person();
      await app().addMember(workspace.workspaceId, actor.id, role);
      const { api } = await webSignedIn(app(), actor.email);

      const refused = await refusalOfCall(
        api.members.revokeCredentials.mutate({ personId: workspace.admin.id }),
      );

      expect(refused).toMatchObject(ROLE_FORBIDS_ANSWERED);
      expect(await whatLanded(workspace.workspaceId, workspace.admin.id)).toEqual(NOTHING_LANDED);
    },
  );

  it("refuses an Admin of another workspace pointed at this one", async () => {
    const workspace = await app().provision();
    const api = await anAdminOfElsewherePointedAt(app(), workspace.workspaceId);

    const refused = await refusalOfCall(
      api.members.revokeCredentials.mutate({ personId: workspace.admin.id }),
    );

    expect(refused).toMatchObject(NOT_A_MEMBER_ANSWERED);
    expect(await whatLanded(workspace.workspaceId, workspace.admin.id)).toEqual(NOTHING_LANDED);
  });

  it("refuses a member of another workspace as no member here", async () => {
    const mine = await app().provision();
    const theirs = await app().provision();
    const stranger = await app().person();
    await app().addMember(theirs.workspaceId, stranger.id, "Viewer");
    const { api } = await webSignedIn(app(), mine.admin.email);

    const refused = await refusalOfCall(
      api.members.revokeCredentials.mutate({ personId: stranger.id }),
    );

    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "no-such-member", class: "absent" } },
    });
    expect(await whatLanded(theirs.workspaceId, stranger.id)).toEqual(NOTHING_LANDED);
    expect(await revocationsIn(mine.workspaceId)).toEqual([]);
  });
});

describe("a revocation that fails partway", () => {
  it("leaves instant and tokens when its audit row never lands", async () => {
    const { here, person, admin } = await aMemberOfTwoWorkspaces();
    await connectAsHost(app(), app().client(), person, { pick: here.workspaceId });

    const failed = await whileAuditRowsVanish(app(), () =>
      refusalOfCall(admin.members.revokeCredentials.mutate({ personId: person.id })),
    );

    expect(failureOf(failed)).toEqual({
      message: "revokeCredentialsHere failed",
      httpStatus: 500,
      refusal: undefined,
    });
    expect(await whatLanded(here.workspaceId, person.id)).toEqual(NOTHING_LANDED);
    expect(await refreshTokensOf(person.id)).toEqual([
      { workspace_id: here.workspaceId, revoked: false },
    ]);
  });
});
