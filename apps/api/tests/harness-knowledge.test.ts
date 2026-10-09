import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectAsHost } from "./flow.ts";
import { harnessControl } from "./harness-control.ts";
import { calledTool, rpcListOf, structured } from "./mcp-call.ts";
import { appForSuite } from "./suite-app.ts";

const app = appForSuite();

const seededConcepts = z.object({
  concepts: z.array(z.object({ iri: z.string(), title: z.string() })),
});

const seedConcepts = async (body: unknown) => {
  const answered = await harnessControl(app()).request("/__harness/concepts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(answered.status, "the harness's /__harness/concepts failed").toBe(200);
  return seededConcepts.parse(await answered.json()).concepts;
};

const foundBy = async (person: { readonly email: string }, query: string) => {
  const client = app().client();
  const { accessToken } = await connectAsHost(app(), client, person, {
    scope: "knowledge:read offline_access",
  });
  const found = await calledTool(client, accessToken, "find", { query });
  return rpcListOf(structured(found)["hits"]).map((hit) => hit["iri"]);
};

describe("the browser suite's knowledge harness", () => {
  it("lands a Restricted concept find returns to Admins, not Viewers", async () => {
    const workspace = await app().provision();
    const viewer = await app().person();
    await app().addMember(workspace.workspaceId, viewer.id, "Viewer");

    const [restricted, internal] = await seedConcepts({
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
});
