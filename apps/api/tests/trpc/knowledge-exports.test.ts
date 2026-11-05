import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  guideSeeding,
  seedGuide,
  seedManifest,
  usageOf,
} from "../support/harness/harness-knowledge.ts";
import { ROLE_FORBIDS_ANSWERED, refusalToAMemberAt } from "../support/people-refusals.ts";
import { appForSuite } from "../support/suite-app.ts";
import { webSignedIn } from "../support/web-client.ts";

const app = appForSuite();

const scratch: string[] = [];

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const entriesOf = (base64: string): readonly string[] => {
  const directory = mkdtempSync(path.join(tmpdir(), "ba-export-"));
  scratch.push(directory);
  const file = path.join(directory, "export.zip");
  writeFileSync(file, Buffer.from(base64, "base64"));
  return execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n");
};

const aWorkspaceHoldingAGuide = async () => {
  const workspace = await app().provision();
  const seeded = await seedGuide(
    app(),
    guideSeeding.parse({
      workspaceId: workspace.workspaceId,
      userId: workspace.admin.id,
      financeUserIds: [],
    }),
  );
  return { workspace, seeded };
};

describe("the knowledge exports over tRPC", () => {
  it.each(["Editor", "Viewer"] as const)(
    "refuses every export to a %s with role-forbids",
    async (role) => {
      const calls = [
        (api: Api) => api.knowledge.exportBundle.mutate({}),
        (api: Api) => api.knowledge.exportRecords.mutate({}),
        (api: Api) => api.knowledge.exportGuide.mutate({ guideId: "01J6ZZZZZZZZZZZZZZZZZZZZZZ" }),
      ];

      for (const call of calls) {
        expect(await refusalToAMemberAt(app(), role, call)).toMatchObject(ROLE_FORBIDS_ANSWERED);
      }
    },
  );

  it("exports the knowledge base to an Admin as a zip", async () => {
    const { workspace } = await aWorkspaceHoldingAGuide();
    await seedManifest(app(), { workspaceId: workspace.workspaceId, userId: workspace.admin.id });
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const file = await api.knowledge.exportBundle.mutate({});

    expect(file.name).toMatch(/^knowledge-base-\d{4}-\d{2}-\d{2}\.zip$/u);
    const entries = entriesOf(file.base64);
    expect(entries).toContain("knowledge/manifest.yaml");
    expect(entries).toHaveLength(file.files);
    expect(entries.filter((entry) => !entry.startsWith("knowledge/"))).toEqual([]);
  });

  it("exports the records to an Admin as three CSV files", async () => {
    const { workspace } = await aWorkspaceHoldingAGuide();
    const { api } = await webSignedIn(app(), workspace.admin.email);

    const file = await api.knowledge.exportRecords.mutate({});

    expect(entriesOf(file.base64).toSorted()).toEqual([
      "owners.csv",
      "usage.csv",
      "verifications.csv",
    ]);
    expect(file.families).toEqual(["owners", "verifications", "usage"]);
  });

  it("exports a guide to an Admin and records its usage", async () => {
    const { workspace, seeded } = await aWorkspaceHoldingAGuide();
    const { workspaceId } = workspace;
    const { api } = await webSignedIn(app(), workspace.admin.email);
    const taken = async () =>
      (
        await Promise.all(
          seeded.sections.map(({ writeUpId }) => usageOf(app(), { workspaceId, writeUpId })),
        )
      )
        .flatMap(({ usage }) => usage)
        .filter((use) => use.act === "exported");

    const before = await taken();
    const file = await api.knowledge.exportGuide.mutate({ guideId: seeded.guideId });
    const after = await taken();

    expect(before).toEqual([]);
    expect(file.markdown).toContain("Not maintained");
    expect(after).toHaveLength(file.sections);
    expect(file.sections).toBeGreaterThan(0);
  });
});

type Api = Awaited<ReturnType<typeof webSignedIn>>["api"];
