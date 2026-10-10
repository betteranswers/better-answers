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
});
