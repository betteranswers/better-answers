import { describe, expect, it } from "vitest";

import {
  conceptsSeeding,
  nameOwners,
  ownersNaming,
  seedConcepts,
} from "../support/harness/harness-knowledge.ts";
import { appForSuite } from "../support/suite-app.ts";
import { refusalOfCall, webSignedIn } from "../support/web-client.ts";

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
  const { concepts } = await seedConcepts(
    app(),
    conceptsSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        { title: "Expenses", collection: "policy", body: "Claims are made within a month." },
        { title: "Leave", collection: "policy", body: "Leave is booked a fortnight ahead." },
      ],
    }),
  );
  return { workspace, editor, viewer, iris: concepts.map(({ iri }) => iri) };
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

  it("refuses an Editor owning nothing the list and naming", async () => {
    const { workspace, editor } = await aWorkspaceHoldingPolicy();
    const asTheEditor = await webSignedIn(app(), editor.email);
    const asTheAdmin = await webSignedIn(app(), workspace.admin.email);
    const asked = { collection: "policy", personId: editor.id };

    const listed = await refusalOfCall(asTheEditor.api.knowledge.collections.query());
    const named = await refusalOfCall(asTheEditor.api.knowledge.nameOwner.mutate(asked));
    await asTheAdmin.api.knowledge.nameOwner.mutate(asked);
    const listedOnceOwning = await asTheEditor.api.knowledge.collections.query();

    expect(listed).toMatchObject({
      data: { httpStatus: 403, refusal: { word: "owner-forbids", class: "forbidden" } },
    });
    expect(named).toMatchObject({
      data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
    });
    expect(listedOnceOwning).toEqual({
      collections: [
        { collection: "policy", owner: { id: editor.id, name: editor.name }, overrides: 0 },
      ],
    });
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

describe("naming one owner on many concepts through the api", () => {
  it("names the owner of each concept as an Admin alone", async () => {
    const { workspace, editor, viewer, iris } = await aWorkspaceHoldingPolicy();
    const asTheEditor = await webSignedIn(app(), editor.email);
    const asTheAdmin = await webSignedIn(app(), workspace.admin.email);
    const asked = { iris, personId: viewer.id };
    const ask = { collections: [], sort: { column: "title" as const, desc: false }, page: 1 };

    const refused = await refusalOfCall(asTheEditor.api.knowledge.setOwners.mutate(asked));
    const named = await asTheAdmin.api.knowledge.setOwners.mutate(asked);
    const read = await asTheAdmin.api.knowledge.allKnowledge.query(ask);

    expect(refused).toMatchObject({
      data: { httpStatus: 403, refusal: { word: "role-forbids", class: "forbidden" } },
    });
    expect(named.named).toBe(2);
    expect(read.rows.map(({ owner }) => owner)).toEqual([
      { id: viewer.id, name: viewer.name, own: true },
      { id: viewer.id, name: viewer.name, own: true },
    ]);
  });

  it("refuses a batch naming a person outside the workspace", async () => {
    const { workspace, iris } = await aWorkspaceHoldingPolicy();
    const { api } = await webSignedIn(app(), workspace.admin.email);
    const stranger = await app().person();

    const refused = await refusalOfCall(
      api.knowledge.setOwners.mutate({ iris, personId: stranger.id }),
    );

    expect(refused).toMatchObject({ data: { refusal: { word: "no-such-member" } } });
  });
});
