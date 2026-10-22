import { describe, expect, it } from "vitest";

import {
  commitAuthorsOf,
  conceptsSeeding,
  nameOwners,
  ownersNaming,
  seedConcepts,
  seedEditSuggestion,
} from "./harness-knowledge.ts";
import { appForSuite } from "./suite-app.ts";
import { refusalOfCall, webSignedIn } from "./web-client.ts";

const app = appForSuite();

const EXPENSES = { title: "Expenses", collection: "policy", body: "Claims are made in a month." };

const memberAt = async (workspaceId: string, role: "Editor" | "Viewer", name: string) => {
  const member = await app().person(undefined, name);
  await app().addMember(workspaceId, member.id, role);
  return member;
};

const aSuggestionWaitingOnAViewer = async () => {
  const workspace = await app().provision();
  const proposer = await memberAt(workspace.workspaceId, "Editor", "Priya Proposer");
  const owner = await memberAt(workspace.workspaceId, "Viewer", "Olu Owner");
  const outsider = await memberAt(workspace.workspaceId, "Viewer", "Ola Outsider");
  const byTheAdmin = { workspaceId: workspace.workspaceId, userId: workspace.admin.id };
  const seeded = await seedConcepts(
    app(),
    conceptsSeeding.parse({ ...byTheAdmin, concepts: [EXPENSES] }),
  );
  const [concept] = seeded.concepts;
  if (concept === undefined) throw new Error("the concept was not seeded");
  await nameOwners(
    app(),
    ownersNaming.parse({ ...byTheAdmin, owners: [{ collection: "policy", personId: owner.id }] }),
  );
  const suggested = (body: string) =>
    seedEditSuggestion(app(), {
      workspaceId: workspace.workspaceId,
      userId: proposer.id,
      iri: concept.iri,
      body,
    });
  const { suggestionId } = await suggested("Claims are made within sixty days.");
  return { workspace, proposer, owner, outsider, concept, suggestionId, suggested };
};

const suggestionRow = async (suggestionId: string) => {
  const found = await app().database.superuser.query<Record<string, unknown>>(
    "SELECT status, decider, reason FROM suggestion WHERE id = $1",
    [suggestionId],
  );
  return found.rows[0];
};

describe("Waiting on you through the api", () => {
  it("commits an owner's acceptance with the proposer as author", async () => {
    const { workspace, proposer, owner, concept, suggestionId } =
      await aSuggestionWaitingOnAViewer();
    const { api } = await webSignedIn(app(), owner.email);

    const accepted = await api.inbox.accept.mutate({
      decisions: [{ suggestionId, expectedTarget: concept.iri }],
    });
    const { authors } = await commitAuthorsOf(app(), {
      workspaceId: workspace.workspaceId,
      iri: concept.iri,
    });

    expect(accepted).toEqual({ outcomes: [{ suggestionId, outcome: "accepted" }] });
    expect(authors).toEqual([
      `${proposer.name} <${proposer.email}>`,
      `${workspace.admin.name} <${workspace.admin.email}>`,
    ]);
  });

  it("records the decider and reason of a decline", async () => {
    const { owner, suggestionId } = await aSuggestionWaitingOnAViewer();
    const { api } = await webSignedIn(app(), owner.email);

    await api.inbox.decline.mutate({ suggestionId, reason: "The figure is from last year" });

    expect(await suggestionRow(suggestionId)).toEqual({
      status: "declined",
      decider: `human:${owner.id}`,
      reason: "The figure is from last year",
    });
  });

  it("answers an outsider's item as not found", async () => {
    const { owner, outsider, suggestionId } = await aSuggestionWaitingOnAViewer();
    const asTheOwner = await webSignedIn(app(), owner.email);
    const asTheOutsider = await webSignedIn(app(), outsider.email);

    const opened = await asTheOwner.api.inbox.item.query({ suggestionId });
    const refused = await refusalOfCall(asTheOutsider.api.inbox.item.query({ suggestionId }));

    expect(opened.item.suggestionId).toBe(suggestionId);
    expect(refused).toMatchObject({
      data: { httpStatus: 404, refusal: { word: "not-found", class: "absent" } },
    });
  });

  it("returns a stale suggestion to its proposer", async () => {
    const { workspace, owner, concept, suggestionId, suggested } =
      await aSuggestionWaitingOnAViewer();
    const stale = await suggested("Claims are made within ninety days.");
    const { api } = await webSignedIn(app(), owner.email);
    const authorsOf = async () =>
      (await commitAuthorsOf(app(), { workspaceId: workspace.workspaceId, iri: concept.iri }))
        .authors;
    await api.inbox.accept.mutate({ decisions: [{ suggestionId, expectedTarget: concept.iri }] });
    const before = await authorsOf();

    const returned = await api.inbox.accept.mutate({
      decisions: [{ suggestionId: stale.suggestionId, expectedTarget: concept.iri }],
    });

    expect(returned).toEqual({
      outcomes: [{ suggestionId: stale.suggestionId, outcome: "stale-precondition" }],
    });
    expect(await suggestionRow(stale.suggestionId)).toMatchObject({ status: "returned" });
    expect(await authorsOf()).toEqual(before);
  });
});
