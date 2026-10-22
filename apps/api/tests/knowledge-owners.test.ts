import { describe, expect, it } from "vitest";

import { conceptsSeeding, nameOwners, ownersNaming, seedConcepts } from "./harness-knowledge.ts";
import { appForSuite } from "./suite-app.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const memberAt = async (workspaceId: string, role: "Editor" | "Viewer") => {
  const member = await app().person();
  await app().addMember(workspaceId, member.id, role);
  return member;
};

const aWorkspaceHoldingPolicy = async () => {
  const workspace = await app().provision();
  const editor = await memberAt(workspace.workspaceId, "Editor");
  const viewer = await memberAt(workspace.workspaceId, "Viewer");
  await seedConcepts(
    app(),
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        { title: "Expenses", collection: "policy", body: "Claims are made within a month." },
      ],
    }),
  );
  return { workspace, editor, viewer };
};

describe("collections and owners through the api", () => {
  it("carries the owner's collections on the member read", async () => {
    const { workspace, editor } = await aWorkspaceHoldingPolicy();
    await nameOwners(
      app(),
      ownersNaming.parse({
        workspaceId: workspace.workspaceId,
        userId: workspace.admin.id,
        owners: [{ collection: "policy", personId: editor.id }],
      }),
    );
    const { api } = await webSignedIn(app(), editor.email);

    const member = await api.session.member.query();

    expect(member.owns).toEqual({ collections: ["policy"], concepts: 0 });
  });

  it("refuses an Editor naming an owner, by role", async () => {
    const { workspace, editor, viewer } = await aWorkspaceHoldingPolicy();
    const asked = { collection: "policy", personId: viewer.id };
    const asTheEditor = await webSignedIn(app(), editor.email);
    const asTheAdmin = await webSignedIn(app(), workspace.admin.email);

    const refused = await refusalOfCall(asTheEditor.api.knowledge.nameOwner.mutate(asked));
    const named = await asTheAdmin.api.knowledge.nameOwner.mutate(asked);

    expect(refused).toMatchObject({
      data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
    });
    expect(named).toMatchObject({ personId: viewer.id });
  });

  it("names an owner and answers the new list", async () => {
    const { workspace, viewer } = await aWorkspaceHoldingPolicy();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const before = await api.knowledge.collections.query();
    await api.knowledge.nameOwner.mutate({ collection: "policy", personId: viewer.id });
    const after = await api.knowledge.collections.query();

    expect(before).toEqual({ collections: [{ collection: "policy", owner: null, overrides: 0 }] });
    expect(after).toEqual({
      collections: [
        { collection: "policy", owner: { id: viewer.id, name: viewer.name }, overrides: 0 },
      ],
    });
  });
});
