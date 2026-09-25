import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";

import { setActiveWorkspace } from "./flow.ts";
import type { TestClient } from "./harness.ts";
import { signedInClient } from "./provoke.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const ROLES = ["Admin", "Editor", "Viewer"] as const;

type Scene = {
  readonly workspaceId: string;
  readonly slug: string;
  readonly viewerEmail: string;
  readonly viewerMemberId: string;
  readonly invitationId: string;
  readonly clients: Readonly<Record<(typeof ROLES)[number], TestClient>>;
};

type Call = { readonly query: string } | { readonly body: object };

type Row<Of> = readonly [path: string, callOf: (scene: Of) => Call];

const anAddress = (): string => `${ulid().toLowerCase()}@example.invalid`;

/** Each with a call the plugin would act on, were the path open. */
const CLOSED: readonly Row<Scene>[] = [
  [
    "/organization/invite-member",
    ({ workspaceId }) => ({
      body: { email: anAddress(), role: "Viewer", organizationId: workspaceId },
    }),
  ],
  ["/organization/cancel-invitation", ({ invitationId }) => ({ body: { invitationId } })],
  ["/organization/accept-invitation", ({ invitationId }) => ({ body: { invitationId } })],
  ["/organization/reject-invitation", ({ invitationId }) => ({ body: { invitationId } })],
  [
    "/organization/update-member-role",
    ({ workspaceId, viewerMemberId }) => ({
      body: { memberId: viewerMemberId, role: "Editor", organizationId: workspaceId },
    }),
  ],
  [
    "/organization/remove-member",
    ({ workspaceId, viewerEmail }) => ({
      body: { memberIdOrEmail: viewerEmail, organizationId: workspaceId },
    }),
  ],
  ["/organization/leave", ({ workspaceId }) => ({ body: { organizationId: workspaceId } })],
  [
    "/organization/create",
    () => ({ body: { name: "Self-serve", slug: `self-serve-${ulid().toLowerCase()}` } }),
  ],
  [
    "/organization/update",
    ({ workspaceId }) => ({ body: { organizationId: workspaceId, data: { name: "Renamed" } } }),
  ],
  ["/organization/delete", ({ workspaceId }) => ({ body: { organizationId: workspaceId } })],
  ["/organization/check-slug", ({ slug }) => ({ body: { slug } })],
];

type KeptScene = {
  readonly home: string;
  readonly other: string;
  readonly invitationId: string;
  readonly client: TestClient;
};

const KEPT: readonly Row<KeptScene>[] = [
  ["/organization/set-active", ({ other }) => ({ body: { organizationId: other } })],
  ["/organization/list", () => ({ query: "" })],
  ["/organization/get-invitation", ({ invitationId }) => ({ query: `?id=${invitationId}` })],
  ["/organization/list-user-invitations", () => ({ query: "" })],
  ["/organization/get-active-member", () => ({ query: "" })],
  ["/organization/get-active-member-role", () => ({ query: "" })],
  ["/organization/get-full-organization", () => ({ query: "" })],
  ["/organization/get-organization", ({ home }) => ({ query: `?organizationId=${home}` })],
  ["/organization/has-permission", () => ({ body: { permissions: { member: ["create"] } } })],
  ["/organization/list-invitations", ({ home }) => ({ query: `?organizationId=${home}` })],
  ["/organization/list-members", ({ home }) => ({ query: `?organizationId=${home}` })],
];

const send = (client: TestClient, where: string, call: Call): Promise<Response> =>
  "body" in call ? client.json(where, call.body) : client.fetch(`${where}${call.query}`);

const aScene = async (): Promise<Scene> => {
  const acme = await app().provision({ name: "Acme" });
  const editor = await app().person();
  const viewer = await app().person();
  await app().addMember(acme.workspaceId, editor.id, "Editor");
  const viewerMember = await app().addMember(acme.workspaceId, viewer.id, "Viewer");
  const invited = await app().invite({
    workspaceId: acme.workspaceId,
    email: anAddress(),
    inviterId: acme.admin.id,
  });
  return {
    workspaceId: acme.workspaceId,
    slug: acme.slug,
    viewerEmail: viewer.email,
    viewerMemberId: viewerMember.id,
    invitationId: invited.id,
    clients: {
      Admin: await signedInClient(app(), acme.admin.email),
      Editor: await signedInClient(app(), editor.email),
      Viewer: await signedInClient(app(), viewer.email),
    },
  };
};

const aKeptScene = async (): Promise<KeptScene> => {
  const home = await app().provision({ name: "Home" });
  const other = await app().provision({ name: "Other" });
  const third = await app().provision({ name: "Third" });
  await app().addMember(other.workspaceId, home.admin.id, "Viewer");
  const invited = await app().invite({
    workspaceId: third.workspaceId,
    email: home.admin.email,
    inviterId: third.admin.id,
  });
  const client = await signedInClient(app(), home.admin.email);
  expect((await setActiveWorkspace(client, home.workspaceId)).status).toBe(200);
  return { home: home.workspaceId, other: other.workspaceId, invitationId: invited.id, client };
};

/** Every row a write through the plugin could touch, and every email sent. */
const identityRows = async () => {
  const read = async (sql: string) => (await app().database.superuser.query(sql)).rows;
  return {
    workspaces: await read("SELECT id, name, slug FROM workspace ORDER BY id"),
    members: await read("SELECT workspace_id, user_id, role FROM member ORDER BY id"),
    invitations: await read("SELECT id, status FROM invitation ORDER BY id"),
    emails: app().emails.length,
  };
};

const reviewedOrganisationPaths = (): readonly string[] =>
  readFileSync(path.join(import.meta.dirname, "better-auth-endpoints.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/organization/"));

const pathsOf = (rows: readonly Row<never>[]): readonly string[] => rows.map(([where]) => where);

describe("the organisation plugin's mounted paths", () => {
  it("names every mounted path as closed or kept", () => {
    expect([...pathsOf(CLOSED), ...pathsOf(KEPT)].toSorted()).toEqual(
      reviewedOrganisationPaths().toSorted(),
    );
  });
});

describe("the organisation plugin's writes and slug check", () => {
  it.each(CLOSED)("refuses %s for Admin, Editor and Viewer", async (where, callOf) => {
    const scene = await aScene();
    const before = await identityRows();

    for (const role of ROLES) {
      const answered = await send(scene.clients[role], where, callOf(scene));
      expect(answered.status, `${where} as ${role}`).toBe(404);
    }

    expect(await identityRows()).toEqual(before);
  });
});

describe("the organisation plugin's kept endpoints", () => {
  it.each(KEPT)("still answers %s to a signed-in person", async (where, callOf) => {
    const scene = await aKeptScene();

    expect((await send(scene.client, where, callOf(scene))).status).toBe(200);
  });

  it("switches the session's workspace through the picker's path", async () => {
    const scene = await aKeptScene();

    await setActiveWorkspace(scene.client, scene.other);

    const session = await (await scene.client.fetch("/get-session")).json();
    expect(session).toMatchObject({ session: { activeOrganizationId: scene.other } });
  });
});
