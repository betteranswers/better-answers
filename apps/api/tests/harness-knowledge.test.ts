import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { head } from "@better-answers/core/store/git";

import { connectAsHost } from "./flow.ts";
import { askedOfTheHarness } from "./harness-asked.ts";
import { harnessControl } from "./harness-control.ts";
import { actingIn, openTestGit } from "./harness.ts";
import { calledTool, rpcListOf, rpcOf, structured, type Rpc } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const landedConcepts = z.object({
  concepts: z.array(z.object({ iri: z.string(), title: z.string() })),
});

const conceptsSeeded = async (body: unknown) => {
  const answered = await harnessControl(app()).request("/__harness/concepts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(answered.status, "the harness's /__harness/concepts failed").toBe(200);
  return landedConcepts.parse(await answered.json()).concepts;
};

/** What the harness answers a seed it refuses: the status, and the fields its schema named. */
const seedRefused = async (concepts: readonly unknown[]) => {
  const workspace = await app().provision();
  const answered = await harnessControl(app()).request("/__harness/concepts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts,
    }),
  });
  return { status: answered.status, said: await answered.json() };
};

/** One MCP call by `person`, over a token of their own. */
const calledBy = async (person: { readonly email: string }, tool: string, args: Rpc) => {
  const client = app().client();
  const { accessToken } = await connectAsHost(app(), client, person, {
    scope: "knowledge:read offline_access",
  });
  return structured(await calledTool(client, accessToken, tool, args));
};

const aWorkspaceWithAViewer = async () => {
  const workspace = await app().provision();
  const viewer = await app().person();
  await app().addMember(workspace.workspaceId, viewer.id, "Viewer");
  return { workspace, viewer };
};

const evidenceOf = (opened: Rpc) => rpcListOf(rpcOf(opened["concept"])["evidence"]);

const foundBy = async (person: { readonly email: string }, query: string) =>
  rpcListOf((await calledBy(person, "find", { query }))["hits"]).map((hit) => hit["iri"]);

describe("the browser suite's knowledge harness", () => {
  it("lands a Restricted concept find returns to Admins, not Viewers", async () => {
    const { workspace, viewer } = await aWorkspaceWithAViewer();

    const [restricted, internal] = await conceptsSeeded({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        {
          title: "Quarry gate hours",
          body: "The synthetic quarry gate opens at seven.",
          sensitivity: "Restricted",
          sources: [{ title: "Synthetic gate log", passages: ["The gate opened at seven."] }],
        },
        {
          title: "Quarry visitor badges",
          body: "Every synthetic quarry visitor wears a badge.",
          sensitivity: "Internal",
          linksTo: ["Quarry gate hours"],
        },
      ],
    });

    const admin = await foundBy(workspace.admin, "quarry");
    const seen = await foundBy(viewer, "quarry");

    expect(admin).toEqual(expect.arrayContaining([restricted?.iri, internal?.iri]));
    expect(seen).toContain(internal?.iri);
    expect(seen).not.toContain(restricted?.iri);
  });

  it("lands a concept whose cited passage opens for an Admin", async () => {
    const workspace = await app().provision();
    const [concept] = await conceptsSeeded({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        {
          title: "Quarry weighbridge checks",
          body: "The synthetic weighbridge is checked each morning.",
          sources: [{ title: "Synthetic weighbridge log", passages: ["Checked at six."] }],
        },
      ],
    });

    const opened = await calledBy(workspace.admin, "open", { iri: concept?.iri });
    const [cited] = rpcListOf(rpcOf(opened["concept"])["evidence"]);
    expect(cited).toMatchObject({
      source: "Synthetic weighbridge log",
      locator: expect.any(String),
    });
    const passage = await calledBy(workspace.admin, "open", { locator: cited?.["locator"] });

    expect(passage).toMatchObject({ found: true, passage: { text: "Checked at six." } });
  });

  it("lands a readable concept citing a document a Viewer cannot", async () => {
    const { workspace, viewer } = await aWorkspaceWithAViewer();
    const [concept] = await conceptsSeeded({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        {
          title: "Quarry blast times",
          body: "The synthetic quarry blasts at noon.",
          sources: [
            { title: "Synthetic site notice", passages: ["Blasting is at noon."] },
            {
              title: "Synthetic blast licence 2026",
              label: "The blast licence",
              passages: ["Licensed for noon blasts."],
              sensitivity: "Restricted",
            },
          ],
        },
      ],
    });

    const forTheAdmin = evidenceOf(await calledBy(workspace.admin, "open", { iri: concept?.iri }));
    const opened = await calledBy(viewer, "open", { iri: concept?.iri });
    const licence = await calledBy(workspace.admin, "open", {
      locator: forTheAdmin[1]?.["locator"],
    });

    expect(forTheAdmin).toEqual([
      { id: "source-1", source: "Synthetic site notice", locator: expect.any(String) },
      { id: "source-2", source: "The blast licence", locator: expect.any(String) },
    ]);
    expect(licence).toMatchObject({ passage: { source: "Synthetic blast licence 2026" } });
    expect(evidenceOf(opened)).toEqual([
      { id: "source-1", source: "Synthetic site notice", locator: expect.any(String) },
      { id: "source-2", source: "The blast licence" },
    ]);
    expect(JSON.stringify(opened)).not.toContain("Synthetic blast licence 2026");
  });

  it("lands a source naming a concept, and a page locator", async () => {
    const workspace = await app().provision();
    const [earlier, concept] = await conceptsSeeded({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        { title: "Quarry haul roads", body: "Synthetic haul roads are graded weekly." },
        {
          title: "Quarry speed limits",
          body: "Synthetic haul roads carry a limit.",
          sources: [{ concept: "Quarry haul roads" }, { title: "Synthetic site rules", at: "p.4" }],
        },
      ],
    });

    const evidence = evidenceOf(await calledBy(workspace.admin, "open", { iri: concept?.iri }));

    expect(evidence).toEqual([
      { id: "source-1", source: "Quarry haul roads", iri: earlier?.iri },
      { id: "source-2", source: "Synthetic site rules", at: "p.4" },
    ]);
  });

  it("refuses a source naming a concept not seeded before it", async () => {
    const refused = await seedRefused([
      {
        title: "Quarry haul roads",
        body: "Synthetic haul roads are graded weekly.",
        sources: [{ concept: "Quarry speed limits" }],
      },
      { title: "Quarry speed limits", body: "Synthetic haul roads carry a limit." },
    ]);

    expect(refused).toEqual({
      status: 400,
      said: { fields: [{ field: "concepts.0.sources.0.concept", rule: expect.any(String) }] },
    });
  });

  it("refuses a page locator given together with a passage", async () => {
    const refused = await seedRefused([
      {
        title: "Quarry speed limits",
        body: "Synthetic haul roads carry a limit.",
        sources: [{ title: "Synthetic site rules", at: "p.4", passages: ["Ten miles an hour."] }],
      },
    ]);

    expect(refused).toEqual({
      status: 400,
      said: { fields: [{ field: "concepts.0.sources.0.at", rule: expect.any(String) }] },
    });
  });

  it("refuses a document sensitivity that is no sensitivity word", async () => {
    const refused = await seedRefused([
      {
        title: "Quarry blast times",
        body: "The synthetic quarry blasts at noon.",
        sources: [
          { title: "Synthetic blast licence", passages: ["Noon blasts."], sensitivity: "Secret" },
        ],
      },
    ]);

    expect(refused).toEqual({
      status: 400,
      said: { fields: [{ field: "concepts.0.sources.0.sensitivity", rule: expect.any(String) }] },
    });
  });

  it.each([
    [
      "a link to a concept not seeded before it",
      [
        {
          title: "Quarry haul roads",
          body: "Synthetic haul roads are graded weekly.",
          linksTo: ["Quarry speed limits"],
        },
        { title: "Quarry speed limits", body: "Synthetic haul roads carry a limit." },
      ],
      "concepts.0.linksTo.0",
    ],
    [
      "a title two concepts of one seed carry",
      [
        { title: "Quarry speed limits", body: "Synthetic haul roads carry a limit." },
        {
          title: "Quarry speed limits",
          body: "A second synthetic file under the first one's title.",
        },
      ],
      "concepts.1.title",
    ],
  ])("refuses %s", async (_, concepts, field) => {
    const refused = await seedRefused(concepts);

    expect(refused).toEqual({
      status: 400,
      said: { fields: [{ field, rule: expect.any(String) }] },
    });
  });

  it("lands the further frontmatter keys a concept is given", async () => {
    const workspace = await app().provision();
    const [concept] = await conceptsSeeded({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        {
          title: "Quarry dust limits",
          body: "Synthetic dust is damped down hourly.",
          frontmatter: {
            description: "How synthetic dust is kept down.",
            tags: ["dust", "air"],
            verified: [{ by: "process:synthetic-verifier", at: "2026-03-03T09:41:00Z" }],
          },
        },
      ],
    });

    const opened = await calledBy(workspace.admin, "open", { iri: concept?.iri });

    expect(rpcOf(rpcOf(opened["concept"])["frontmatter"])).toMatchObject({
      title: "Quarry dust limits",
      description: "How synthetic dust is kept down.",
      tags: ["dust", "air"],
      verified: [{ by: "process:synthetic-verifier", at: "2026-03-03T09:41:00Z" }],
    });
  });
});

const askedToSeed = (body: unknown) => askedOfTheHarness(app(), "/__harness/concepts", body);

const heldIn = async (
  table: "concept_index" | "connected_source" | "group",
  workspaceId: string,
): Promise<number> => {
  const counted = await app().database.superuser.query<{ held: number }>(
    `SELECT count(*)::int AS held FROM "${table}" WHERE workspace_id = $1`,
    [workspaceId],
  );
  return counted.rows[0]?.held ?? 0;
};

type Provisioned = { readonly workspaceId: string; readonly admin: { readonly id: string } };

const seedingBy = (workspace: Provisioned) => ({
  workspaceId: workspace.workspaceId,
  userId: workspace.admin.id,
});

/** The repository's commit on `main`, or null where it has none. */
const headOf = async (workspace: Provisioned): Promise<string | null> =>
  head(
    await actingIn(app(), seedingBy(workspace), async (principal) => principal),
    openTestGit(app()),
  );

/** Both stores, read as a refused seed leaves them. */
const leftIn = async (workspace: Provisioned) => ({
  concepts: await heldIn("concept_index", workspace.workspaceId),
  connectedSources: await heldIn("connected_source", workspace.workspaceId),
  groups: await heldIn("group", workspace.workspaceId),
  repository: existsSync(path.join(openTestGit(app()).root, `${workspace.workspaceId}.git`)),
  head: await headOf(workspace),
});

const NOTHING = { concepts: 0, connectedSources: 0, groups: 0, repository: false, head: null };

const refusedNaming = (...fields: readonly (readonly [field: string, rule: string])[]) => ({
  status: 400,
  said: {
    fields: fields.map(([field, rule]) => ({ field, rule: expect.stringContaining(rule) })),
  },
});

const aMemberAt = async (workspace: Provisioned, role: "Editor" | "Viewer") => {
  const member = await app().person();
  await app().addMember(workspace.workspaceId, member.id, role);
  return { workspaceId: workspace.workspaceId, userId: member.id };
};

const A_CITED_SOURCE = { title: "Synthetic spares list", passages: ["Two spare pumps."] };

describe("a concepts seed the harness refuses before it writes", () => {
  it("refuses a held title, and writes none of the seed", async () => {
    const workspace = await app().provision();
    await conceptsSeeded({
      ...seedingBy(workspace),
      concepts: [{ title: "Quarry pump checks", body: "Synthetic pumps are checked weekly." }],
    });
    const before = await headOf(workspace);

    const answered = await askedToSeed({
      ...seedingBy(workspace),
      concepts: [
        {
          title: "Quarry pump spares",
          body: "Two synthetic pumps are kept spare.",
          sources: [A_CITED_SOURCE],
        },
        { title: "Quarry pump checks", body: "Synthetic pumps are checked daily." },
      ],
    });

    expect(answered).toEqual(
      refusedNaming(["concepts.1.title", "knowledge/quarry-pump-checks.md"]),
    );
    expect(await leftIn(workspace)).toEqual({
      ...NOTHING,
      concepts: 1,
      repository: true,
      head: before,
    });
  });

  it("refuses a group member who is no member", async () => {
    const workspace = await app().provision();
    const outsider = await app().person();

    const answered = await askedToSeed({
      ...seedingBy(workspace),
      concepts: [
        {
          title: "Quarry shift rota",
          body: "Synthetic shifts change at six.",
          groupMemberIds: [outsider.id],
          sources: [A_CITED_SOURCE],
        },
        {
          title: "Quarry pay bands",
          body: "Synthetic pay bands are reviewed yearly.",
          audience: "groups",
          groupMemberIds: [workspace.admin.id, outsider.id],
        },
      ],
    });

    expect(answered).toEqual(
      refusedNaming(["concepts.1.groupMemberIds.1", "group_member_member_fk"]),
    );
    expect(await leftIn(workspace)).toEqual(NOTHING);
  });

  it("refuses a Viewer as a seed's writer", async () => {
    const workspace = await app().provision();

    const answered = await askedToSeed({
      ...(await aMemberAt(workspace, "Viewer")),
      concepts: [{ title: "Quarry signage", body: "Synthetic signs are repainted yearly." }],
    });

    expect(answered).toEqual(refusedNaming(["userId", "Editor"]));
    expect(await leftIn(workspace)).toEqual(NOTHING);
  });

  it("refuses an Editor's seed that asks an Admin's override", async () => {
    const workspace = await app().provision();

    const answered = await askedToSeed({
      ...(await aMemberAt(workspace, "Editor")),
      concepts: [
        { title: "Quarry fencing", body: "Synthetic fences are walked weekly." },
        {
          title: "Quarry wage reviews",
          body: "Synthetic wages are reviewed yearly.",
          audience: "groups",
          groupMemberIds: [workspace.admin.id],
        },
        {
          title: "Quarry blast licences",
          body: "Synthetic blasts are licensed yearly.",
          sources: [A_CITED_SOURCE, { ...A_CITED_SOURCE, sensitivity: "Restricted" }],
        },
      ],
    });

    expect(answered).toEqual(
      refusedNaming(
        ["concepts.1.audience", "Admin"],
        ["concepts.2.sources.1.sensitivity", "Admin"],
      ),
    );
    expect(await leftIn(workspace)).toEqual(NOTHING);
  });

  it("lands an Editor's seed that asks no override", async () => {
    const workspace = await app().provision();

    const [concept] = await conceptsSeeded({
      ...(await aMemberAt(workspace, "Editor")),
      concepts: [
        {
          title: "Quarry signage",
          body: "Synthetic signs are repainted yearly.",
          sources: [A_CITED_SOURCE],
        },
      ],
    });

    expect(concept).toMatchObject({ title: "Quarry signage" });
    expect(await leftIn(workspace)).toMatchObject({ concepts: 1, connectedSources: 1 });
  });
});
