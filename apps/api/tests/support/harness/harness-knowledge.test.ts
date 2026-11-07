import { existsSync } from "node:fs";
import path from "node:path";

import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { head } from "@better-answers/core/store/git";
import { matching } from "@better-answers/schema/testing/matching";

import { connectAsHost } from "../flow.ts";
import { calledTool, rpcListOf, rpcOf, structured, type Rpc } from "../mcp-call.ts";
import { appForSuite } from "../suite-app.ts";
import { refusalOfCall, webSignedIn } from "../web-client.ts";
import { askedOfTheHarness } from "./harness-asked.ts";
import { harnessControl } from "./harness-control.ts";
import { actingIn, openTestGit } from "./harness.ts";

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
  it("seeds a Restricted concept that `find` shows only to Admins", async () => {
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

    expect(admin).toEqual(matching.arrayContaining([restricted?.iri, internal?.iri]));
    expect(seen).toContain(internal?.iri);
    expect(seen).not.toContain(restricted?.iri);
  });

  it("seeds a concept into the collection the seed names", async () => {
    const workspace = await app().provision();
    await conceptsSeeded({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        {
          title: "Quarry audit trail",
          body: "The synthetic quarry audit trail is kept a year.",
          collection: "audits",
        },
        { title: "Quarry audit basics", body: "A synthetic quarry audit is yearly." },
      ],
    });

    const hits = rpcListOf(
      (await calledBy(workspace.admin, "find", { query: "quarry audit" }))["hits"],
    );

    expect(Object.fromEntries(hits.map((hit) => [hit["title"], hit["collection"]]))).toEqual({
      "Quarry audit trail": "audits",
      "Quarry audit basics": null,
    });
  });

  it("seeds a draft concept that find does not return", async () => {
    const workspace = await app().provision();
    const [draft, stable] = await conceptsSeeded({
      ...seedingBy(workspace),
      concepts: [
        { title: "Quarry blast plan", body: "A synthetic blast plan.", status: "draft" },
        { title: "Quarry blast window", body: "Synthetic blasts happen at noon." },
      ],
    });

    const found = await foundBy(workspace.admin, "quarry blast");

    expect(found).toContain(stable?.iri);
    expect(found).not.toContain(draft?.iri);
  });

  it("seeds two concepts with one file name in two collections", async () => {
    const workspace = await app().provision();

    const landed = await conceptsSeeded({
      ...seedingBy(workspace),
      concepts: [
        {
          title: "Quarry speed limits",
          body: "Synthetic haul roads carry a limit.",
          collection: "haul-roads",
        },
        {
          title: "Quarry speed-limits",
          body: "Synthetic site roads carry a limit.",
          collection: "site-roads",
        },
      ],
    });

    expect(landed.map((concept) => concept.title)).toEqual([
      "Quarry speed limits",
      "Quarry speed-limits",
    ]);
    expect(await leftIn(workspace)).toMatchObject({ concepts: 2 });
  });

  it("links a concept in a collection to one outside it", async () => {
    const workspace = await app().provision();
    const [basics, trail] = await conceptsSeeded({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [
        { title: "Quarry audit basics", body: "A synthetic quarry audit is yearly." },
        {
          title: "Quarry audit trail",
          body: "The synthetic quarry audit trail is kept a year.",
          collection: "audits",
          linksTo: ["Quarry audit basics"],
        },
      ],
    });

    const opened = await calledBy(workspace.admin, "open", { iri: trail?.iri });

    expect(rpcListOf(rpcOf(opened["concept"])["bodyLinks"])).toEqual([
      { ordinal: 0, address: "../quarry-audit-basics.md", target: basics?.iri },
    ]);
  });

  it("seeds a concept whose cited passage an Admin can open", async () => {
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
      locator: matching.any(String),
    });
    const passage = await calledBy(workspace.admin, "open", { locator: cited?.["locator"] });

    expect(passage).toMatchObject({ found: true, passage: { text: "Checked at six." } });
  });

  it("seeds a concept citing a document a Viewer cannot read", async () => {
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
      { id: "source-1", source: "Synthetic site notice", locator: matching.any(String) },
      { id: "source-2", source: "The blast licence", locator: matching.any(String) },
    ]);
    expect(licence).toMatchObject({ passage: { source: "Synthetic blast licence 2026" } });
    expect(evidenceOf(opened)).toEqual([
      { id: "source-1", source: "Synthetic site notice", locator: matching.any(String) },
      { id: "source-2", source: "The blast licence" },
    ]);
    expect(JSON.stringify(opened)).not.toContain("Synthetic blast licence 2026");
  });

  it("seeds a source naming a concept, and a page locator", async () => {
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
      said: { fields: [{ field: "concepts.0.sources.0.concept", rule: matching.any(String) }] },
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
      said: { fields: [{ field: "concepts.0.sources.0.at", rule: matching.any(String) }] },
    });
  });

  it("refuses a document sensitivity that is not a sensitivity level", async () => {
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
      said: { fields: [{ field: "concepts.0.sources.0.sensitivity", rule: matching.any(String) }] },
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
      "a title shared by two concepts in one seed",
      [
        { title: "Quarry speed limits", body: "Synthetic haul roads carry a limit." },
        {
          title: "Quarry speed limits",
          body: "A second synthetic file under the first one's title.",
        },
      ],
      "concepts.1.title",
    ],
    [
      "two titles that differ only in case and spacing",
      [
        {
          title: "Quarry speed limits",
          body: "Synthetic haul roads carry a limit.",
          collection: "haul-roads",
        },
        {
          title: "quarry  Speed Limits",
          body: "Synthetic site roads carry a limit.",
          collection: "site-roads",
        },
      ],
      "concepts.1.title",
    ],
  ])("refuses %s", async (_, concepts, field) => {
    const refused = await seedRefused(concepts);

    expect(refused).toEqual({
      status: 400,
      said: { fields: [{ field, rule: matching.any(String) }] },
    });
  });

  it("seeds the extra frontmatter keys given for a concept", async () => {
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

  it("seeds verifications whose newest sets the trust", async () => {
    const workspace = await app().provision({ adminName: "Priya Shah" });
    const [concept] = await conceptsSeeded({
      ...seedingBy(workspace),
      concepts: [
        {
          title: "Quarry safety partnerships",
          body: "Synthetic quarries report to a safety partnership.",
          verifications: [
            { at: "2026-02-12T09:00:00Z" },
            { by: workspace.admin.id, at: "2026-03-03T09:41:00Z" },
          ],
        },
      ],
    });

    const opened = rpcOf(
      (await calledBy(workspace.admin, "open", { iri: concept?.iri }))["concept"],
    );

    expect(rpcOf(opened["trust"])).toMatchObject({
      tier: "human-reviewed",
      checkedBy: "Priya Shah",
      checkedAt: "2026-03-03T09:41:00.000Z",
    });
    expect(rpcListOf(opened["verifications"]).map((each) => [each["tier"], each["at"]])).toEqual([
      ["human-reviewed", "2026-03-03T09:41:00.000Z"],
      ["machine-confirmed", "2026-02-12T09:00:00.000Z"],
    ]);
  });

  it("refuses verifications given together with a trust", async () => {
    const refused = await seedRefused([
      {
        title: "Quarry safety partnerships",
        body: "Synthetic quarries report to a safety partnership.",
        trust: "human-reviewed",
        verifications: [{ at: "2026-02-12T09:00:00Z" }],
      },
    ]);

    expect(refused).toEqual({
      status: 400,
      said: { fields: [{ field: "concepts.0.trust", rule: matching.any(String) }] },
    });
  });

  it("refuses a verification by someone outside the workspace", async () => {
    const outsider = await app().person();

    const refused = await seedRefused([
      {
        title: "Quarry safety partnerships",
        body: "Synthetic quarries report to a safety partnership.",
        verifications: [{ by: outsider.id, at: "2026-02-12T09:00:00Z" }],
      },
    ]);

    expect(refused).toEqual({
      status: 400,
      said: { fields: [{ field: "concepts.0.verifications.0.by", rule: matching.any(String) }] },
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

const headOf = async (workspace: Provisioned): Promise<string | null> =>
  head(
    await actingIn(app(), seedingBy(workspace), async (principal) => principal),
    openTestGit(app()),
  );

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
    fields: fields.map(([field, rule]) => ({ field, rule: matching.stringContaining(rule) })),
  },
});

const aMemberAt = async (workspace: Provisioned, role: "Editor" | "Viewer") => {
  const member = await app().person();
  await app().addMember(workspace.workspaceId, member.id, role);
  return { workspaceId: workspace.workspaceId, userId: member.id };
};

const A_CITED_SOURCE = { title: "Synthetic spares list", passages: ["Two spare pumps."] };

const A_PLAIN_SEED = [
  {
    title: "Quarry signage",
    body: "Synthetic signs are repainted yearly.",
    sources: [A_CITED_SOURCE],
  },
];

describe("concept seeds the harness refuses before writing anything", () => {
  it("refuses a title already in use and writes nothing", async () => {
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

  it("refuses a group member who is not in the workspace", async () => {
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

  it.each([
    { who: "an Editor", role: "Editor" },
    { who: "a Viewer", role: "Viewer" },
  ] as const)("refuses a seed from $who", async ({ role }) => {
    const workspace = await app().provision();

    const answered = await askedToSeed({
      ...(await aMemberAt(workspace, role)),
      concepts: A_PLAIN_SEED,
    });

    expect(answered).toEqual(refusedNaming(["userId", "seeded by an Admin"]));
    expect(await leftIn(workspace)).toEqual(NOTHING);
  });

  it("refuses a seed from someone outside the workspace", async () => {
    const workspace = await app().provision();
    const outsider = await app().person();

    const answered = await askedToSeed({
      workspaceId: workspace.workspaceId,
      userId: outsider.id,
      concepts: [{ title: "Quarry gate hours", body: "The synthetic gate opens at six." }],
    });

    expect(answered).toEqual(refusedNaming(["userId", "member of the workspace"]));
    expect(await leftIn(workspace)).toEqual(NOTHING);
  });

  it("refuses two titles in one seed that share a file", async () => {
    const workspace = await app().provision();

    const answered = await askedToSeed({
      ...seedingBy(workspace),
      concepts: [
        {
          title: "Quarry speed limits",
          body: "Synthetic haul roads carry a limit.",
          sources: [A_CITED_SOURCE],
        },
        { title: "Quarry speed-limits", body: "Synthetic site roads carry a limit." },
      ],
    });

    expect(answered).toEqual(refusedNaming(["concepts.1.title", "each file to one concept"]));
    expect(await leftIn(workspace)).toEqual(NOTHING);
  });

  it("refuses a group member named twice", async () => {
    const workspace = await app().provision();

    const answered = await askedToSeed({
      ...seedingBy(workspace),
      concepts: [
        {
          title: "Quarry pay bands",
          body: "Synthetic pay bands are reviewed yearly.",
          audience: "groups",
          groupMemberIds: [workspace.admin.id, workspace.admin.id],
          sources: [A_CITED_SOURCE],
        },
      ],
    });

    expect(answered).toEqual(
      refusedNaming(["concepts.0.groupMemberIds.1", "names each member once"]),
    );
    expect(await leftIn(workspace)).toEqual(NOTHING);
  });

  it("seeds the same concepts when an Admin writes them", async () => {
    const workspace = await app().provision();

    const [concept] = await conceptsSeeded({ ...seedingBy(workspace), concepts: A_PLAIN_SEED });

    expect(concept).toMatchObject({ title: "Quarry signage" });
    expect(await leftIn(workspace)).toMatchObject({ concepts: 1, connectedSources: 1 });
  });
});

const harnessPosted = async (address: string, body: unknown): Promise<unknown> => {
  const answered = await harnessControl(app()).request(address, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(answered.status, `the harness's ${address} failed`).toBe(200);
  return answered.json();
};

const seededSuggestion = z.object({ suggestionId: z.string(), setId: z.string() });

describe("a waiting edit suggestion the harness seeds", () => {
  it("seeds an owner and a waiting edit suggestion", async () => {
    const { workspace, viewer: owner } = await aWorkspaceWithAViewer();
    const proposer = await app().person();
    await app().addMember(workspace.workspaceId, proposer.id, "Editor");
    const [concept] = await conceptsSeeded({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      concepts: [{ title: "Quarry signage", collection: "policy", body: "Signs face the road." }],
    });
    await harnessPosted("/__harness/owners", {
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      owners: [{ collection: "policy", personId: owner.id }],
    });

    const seeded = seededSuggestion.parse(
      await harnessPosted("/__harness/suggestions", {
        workspaceId: workspace.workspaceId,
        userId: proposer.id,
        iri: concept?.iri,
        body: "Signs face the road and the footpath.",
      }),
    );
    const { api } = await webSignedIn(app(), owner.email);

    expect(await api.inbox.waiting.query()).toEqual({
      items: [
        matching.objectContaining({
          suggestionId: seeded.suggestionId,
          target: concept?.iri,
          proposer: { id: proposer.id, name: proposer.name },
          owner: { id: owner.id, name: owner.name },
        }),
      ],
    });
  });
});

const seededInclude = z.object({ id: z.string(), iri: z.string(), title: z.string() });

const seededSection = z.object({
  sectionId: z.string(),
  writeUpId: z.string(),
  prompt: z.string(),
  includes: z.array(seededInclude),
});

const seededGuide = z.object({
  guideId: z.string(),
  groupId: z.string(),
  concepts: z.record(z.string(), z.string()),
  sections: z.array(seededSection),
});

const PROMPTS = [
  "Company overview",
  "What we offer",
  "Insurance and financial standing",
  "Certifications",
  "Data protection",
  "Information security",
  "Security testing",
  "Support and service levels",
];

const PROFESSIONAL_INDEMNITY = "Professional indemnity policy";

const HUMAN_REVIEWED = [
  "Public liability policy",
  PROFESSIONAL_INDEMNITY,
  "Filed accounts 2024",
  "Filed accounts 2025",
];

type GuideSeeded = z.output<typeof seededGuide>;

const sectionOf = (seeded: GuideSeeded, prompt: string) => {
  const found = seeded.sections.find((section) => section.prompt === prompt);
  assert(found !== undefined, `the guide has no section ${prompt}`);
  return found;
};

const iriOf = (seeded: GuideSeeded, title: string): string => {
  const iri = seeded.concepts[title];
  assert(iri !== undefined, `the guide seeded no concept ${title}`);
  return iri;
};

const tiersOf = async (
  api: Awaited<ReturnType<typeof webSignedIn>>["api"],
  seeded: GuideSeeded,
): Promise<readonly (readonly [title: string, tier: string])[]> => {
  const tiers: [string, string][] = [];
  for (const [title, iri] of Object.entries(seeded.concepts)) {
    const opened = await api.knowledge.open.query({ iri });
    assert(opened.concept !== undefined, `${title} did not open as a concept`);
    tiers.push([title, opened.concept.trust.tier]);
  }
  return tiers;
};

const aGuideSeeded = async () => {
  const { workspace, viewer } = await aWorkspaceWithAViewer();
  const financier = await app().person();
  await app().addMember(workspace.workspaceId, financier.id, "Editor");
  const seeded = seededGuide.parse(
    await harnessPosted("/__harness/guides", {
      ...seedingBy(workspace),
      financeUserIds: [financier.id],
    }),
  );
  return { workspace, viewer, financier, seeded };
};

const guideRowsIn = async (workspaceId: string) => {
  const counted = await app().database.superuser.query<{
    guides: number;
    versions: number;
    concepts: number;
    groups: number;
  }>(
    `SELECT (SELECT count(*) FROM guide_definition WHERE workspace_id = $1)::int AS guides,
            (SELECT count(*) FROM write_up_version WHERE workspace_id = $1)::int AS versions,
            (SELECT count(*) FROM concept_index WHERE workspace_id = $1)::int AS concepts,
            (SELECT count(*) FROM "group" WHERE workspace_id = $1)::int AS groups`,
    [workspaceId],
  );
  return counted.rows[0];
};

const askedToSeedAGuide = (body: unknown) => askedOfTheHarness(app(), "/__harness/guides", body);

describe("the guide the harness seeds", () => {
  it("seeds eight sections in tree order with 24 includes", async () => {
    const { seeded } = await aGuideSeeded();

    expect(seeded.sections.map(({ prompt }) => prompt)).toEqual(PROMPTS);
    expect(seeded.sections.map(({ includes }) => includes.length)).toEqual([
      4, 3, 4, 2, 3, 3, 2, 3,
    ]);
    expect(Object.keys(seeded.concepts)).toHaveLength(23);
  });

  it("does not seed the employers' liability policy", async () => {
    const { seeded } = await aGuideSeeded();
    const insurance = sectionOf(seeded, "Insurance and financial standing");

    expect(seeded.concepts).not.toHaveProperty("Employers' liability policy");
    expect(insurance.includes.map(({ title }) => title)).toEqual([
      "Public liability policy",
      PROFESSIONAL_INDEMNITY,
      "Filed accounts 2024",
      "Filed accounts 2025",
    ]);
  });

  it("cites the Cyber Essentials Plus certificate from two sections", async () => {
    const { seeded } = await aGuideSeeded();
    const certificate = iriOf(seeded, "Cyber Essentials Plus certificate");

    const citing = seeded.sections.filter(({ includes }) =>
      includes.some(({ iri }) => iri === certificate),
    );

    expect(citing.map(({ prompt }) => prompt)).toEqual(["Certifications", "Information security"]);
  });

  it("writes each Brief as version 2 after an empty version", async () => {
    const { workspace, seeded } = await aGuideSeeded();
    const stored = await app().database.superuser.query<{
      write_up_id: string;
      version: number;
      markdown: string;
    }>(
      `SELECT write_up_id, version, markdown FROM write_up_version
        WHERE workspace_id = $1 ORDER BY write_up_id, version`,
      [workspace.workspaceId],
    );

    const versionsOf = (writeUpId: string) =>
      stored.rows.filter((row) => row.write_up_id === writeUpId);

    for (const { writeUpId, includes } of seeded.sections) {
      const [empty, brief, ...later] = versionsOf(writeUpId);
      expect([empty?.version, empty?.markdown, brief?.version, later]).toEqual([1, "", 2, []]);
      expect(brief?.markdown.match(/\[\^[^\]]+\]/g)).toEqual(includes.map(({ id }) => `[^${id}]`));
      expect(brief?.markdown.split("\n\n")).toHaveLength(includes.length);
    }
  });

  it("writes each concept's body as a paragraph with its footnote", async () => {
    const { workspace, seeded } = await aGuideSeeded();
    const certifications = sectionOf(seeded, "Certifications");
    const [iso, plus] = certifications.includes;

    const brief = await app().database.superuser.query<{ markdown: string }>(
      `SELECT markdown FROM write_up_version
        WHERE workspace_id = $1 AND write_up_id = $2 AND version = 2`,
      [workspace.workspaceId, certifications.writeUpId],
    );

    expect(brief.rows[0]?.markdown).toBe(
      [
        `Northgate is certified to ISO 27001 for its whole service.[^${iso?.id}]`,
        `Northgate holds Cyber Essentials Plus, renewed each year.[^${plus?.id}]`,
      ].join("\n\n"),
    );
  });

  it("limits the professional indemnity policy to the finance group", async () => {
    const { workspace, viewer, financier, seeded } = await aGuideSeeded();
    const iri = iriOf(seeded, PROFESSIONAL_INDEMNITY);
    const group = await app().database.superuser.query<{ name: string; members: string[] }>(
      `SELECT g.name, array_agg(m.user_id ORDER BY m.user_id) AS members
         FROM "group" g JOIN group_member m ON m.group_id = g.id
        WHERE g.workspace_id = $1 AND g.id = $2 GROUP BY g.name`,
      [workspace.workspaceId, seeded.groupId],
    );

    const financiers = (await webSignedIn(app(), financier.email)).api;
    const outsiders = (await webSignedIn(app(), viewer.email)).api;

    expect(group.rows[0]).toEqual({
      name: "finance",
      members: [workspace.admin.id, financier.id].toSorted(),
    });
    expect(await financiers.knowledge.open.query({ iri })).toMatchObject({ found: true });
    expect(await refusalOfCall(outsiders.knowledge.open.query({ iri }))).toMatchObject({
      message: "not-found",
      data: { httpStatus: 404 },
    });
  });

  it("marks four concepts human-reviewed and leaves 19 unverified", async () => {
    const { workspace, seeded } = await aGuideSeeded();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const tiers = await tiersOf(api, seeded);

    const titlesAt = (tier: string) =>
      tiers.filter((each) => each[1] === tier).map(([title]) => title);
    expect(titlesAt("human-reviewed")).toEqual(HUMAN_REVIEWED);
    expect(titlesAt("unverified")).toHaveLength(19);
  });
});

describe("guide seeds the harness refuses before writing anything", () => {
  it("refuses a guide seed from an Editor", async () => {
    const workspace = await app().provision();

    const answered = await askedToSeedAGuide({
      ...(await aMemberAt(workspace, "Editor")),
      financeUserIds: [],
    });

    expect(answered).toEqual(refusedNaming(["userId", "seeded by an Admin"]));
    expect(await guideRowsIn(workspace.workspaceId)).toEqual({
      guides: 0,
      versions: 0,
      concepts: 0,
      groups: 0,
    });
  });

  it("refuses a second guide in one workspace", async () => {
    const { workspace } = await aGuideSeeded();
    const before = await guideRowsIn(workspace.workspaceId);

    const answered = await askedToSeedAGuide({ ...seedingBy(workspace), financeUserIds: [] });

    expect(answered).toEqual(refusedNaming(["workspaceId", "one guide"]));
    expect(await guideRowsIn(workspace.workspaceId)).toEqual(before);
  });

  it("refuses a finance member who is not in the workspace", async () => {
    const workspace = await app().provision();
    const outsider = await app().person();

    const answered = await askedToSeedAGuide({
      ...seedingBy(workspace),
      financeUserIds: [outsider.id],
    });

    expect(answered).toEqual(refusedNaming(["financeUserIds.0", "group_member_member_fk"]));
    expect(await guideRowsIn(workspace.workspaceId)).toMatchObject({ concepts: 0, groups: 0 });
  });

  it("refuses a workspace that already has a finance group", async () => {
    const workspace = await app().provision();
    await harnessPosted("/__harness/groups", { ...seedingBy(workspace), names: ["finance"] });

    const answered = await askedToSeedAGuide({ ...seedingBy(workspace), financeUserIds: [] });

    expect(answered).toEqual(refusedNaming(["workspaceId", "group named finance"]));
    expect(await guideRowsIn(workspace.workspaceId)).toMatchObject({ concepts: 0, groups: 1 });
  });
});

const seededCollectionGuide = z.object({ guideId: z.string(), sections: z.array(seededSection) });

const aWorkspaceWithCorporateConcepts = async () => {
  const workspace = await app().provision();
  const concepts = await conceptsSeeded({
    ...seedingBy(workspace),
    concepts: [
      {
        title: "Registered company number",
        body: "Synthetic Ltd is registered under company number 00000001.",
        collection: "corporate",
        kind: "company fact",
        frontmatter: { tags: ["registration"] },
      },
      {
        title: "Public liability policy",
        body: "Synthetic Ltd holds public liability cover.",
        collection: "corporate",
        kind: "insurance policy",
        frontmatter: { tags: ["public-liability"] },
      },
      {
        title: "Registered office",
        body: "Synthetic Ltd's office is in Leeds.",
        collection: "elsewhere",
        kind: "company fact",
        frontmatter: { tags: ["office"] },
      },
    ],
  });
  return { workspace, concepts };
};

describe("the guide the harness seeds over one collection", () => {
  it("includes the collection's concepts alone and makes no finance group", async () => {
    const { workspace, concepts } = await aWorkspaceWithCorporateConcepts();

    const seeded = seededCollectionGuide.parse(
      await harnessPosted("/__harness/guides", {
        ...seedingBy(workspace),
        collection: "corporate",
      }),
    );

    expect(seeded.sections.map(({ includes }) => includes.map(({ title }) => title))).toEqual([
      ["Registered company number"],
      [],
      ["Public liability policy"],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(await guideRowsIn(workspace.workspaceId)).toMatchObject({ guides: 1, groups: 0 });
    const used = async (title: string) => {
      const opened = await calledBy(workspace.admin, "open", {
        iri: concepts.find((each) => each.title === title)?.iri,
      });
      return rpcOf(rpcOf(opened["concept"])["usedIn"])["guides"];
    };
    expect([await used("Registered company number"), await used("Registered office")]).toEqual([
      1, 0,
    ]);
  });

  it("refuses a collection holding no concept and writes no guide", async () => {
    const { workspace } = await aWorkspaceWithCorporateConcepts();

    const answered = await askedToSeedAGuide({ ...seedingBy(workspace), collection: "nowhere" });

    expect(answered).toEqual(refusedNaming(["collection", "no concept in nowhere"]));
    expect(await guideRowsIn(workspace.workspaceId)).toMatchObject({ guides: 0 });
  });

  it("refuses finance members for a guide over a collection", async () => {
    const { workspace } = await aWorkspaceWithCorporateConcepts();
    const finance = await aMemberAt(workspace, "Editor");

    const answered = await askedToSeedAGuide({
      ...seedingBy(workspace),
      collection: "corporate",
      financeUserIds: [finance.userId],
    });

    expect(answered).toEqual(refusedNaming(["financeUserIds", "no finance group"]));
  });

  it("refuses a guide over a collection from an Editor", async () => {
    const { workspace } = await aWorkspaceWithCorporateConcepts();

    const answered = await askedToSeedAGuide({
      ...(await aMemberAt(workspace, "Editor")),
      collection: "corporate",
    });

    expect(answered).toEqual(refusedNaming(["userId", "seeded by an Admin"]));
  });
});
