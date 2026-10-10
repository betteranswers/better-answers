import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectAsHost } from "./flow.ts";
import { harnessControl } from "./harness-control.ts";
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

/** One MCP call by `person`, over a token of their own. */
const calledBy = async (person: { readonly email: string }, tool: string, args: Rpc) => {
  const client = app().client();
  const { accessToken } = await connectAsHost(app(), client, person, {
    scope: "knowledge:read offline_access",
  });
  return structured(await calledTool(client, accessToken, tool, args));
};

const evidenceOf = (opened: Rpc) => rpcListOf(rpcOf(opened["concept"])["evidence"]);

const foundBy = async (person: { readonly email: string }, query: string) =>
  rpcListOf((await calledBy(person, "find", { query }))["hits"]).map((hit) => hit["iri"]);

describe("the browser suite's knowledge harness", () => {
  it("lands a Restricted concept find returns to Admins, not Viewers", async () => {
    const workspace = await app().provision();
    const viewer = await app().person();
    await app().addMember(workspace.workspaceId, viewer.id, "Viewer");

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
    const workspace = await app().provision();
    const viewer = await app().person();
    await app().addMember(workspace.workspaceId, viewer.id, "Viewer");
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
            verified: [{ by: "process:synthetic-checker", at: "2026-03-03T09:41:00Z" }],
          },
        },
      ],
    });

    const opened = await calledBy(workspace.admin, "open", { iri: concept?.iri });

    expect(rpcOf(rpcOf(opened["concept"])["frontmatter"])).toMatchObject({
      title: "Quarry dust limits",
      description: "How synthetic dust is kept down.",
      tags: ["dust", "air"],
      verified: [{ by: "process:synthetic-checker", at: "2026-03-03T09:41:00Z" }],
    });
  });
});
