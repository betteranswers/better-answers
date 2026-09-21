import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  fileFromTheWorkspace,
  IMAGE_PROBE_ALLOWANCE,
  legFor,
  matrixLegs,
  nothingToProbeHere,
  readTheImage,
  repositoryRoot,
} from "./image-probe.ts";
import { workspacePackages } from "./workspaces.ts";

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const manifest = (workspace: string): z.infer<typeof manifestSchema> =>
  manifestSchema.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, workspace, "package.json"), "utf8")),
  );

const workspaceProjects = (): readonly string[] => [".", ...workspacePackages()];

const developmentOnlyPackages = (): readonly string[] => {
  const development = new Set<string>();
  const production = new Set<string>();
  for (const project of workspaceProjects()) {
    const read = manifest(project);
    for (const name of Object.keys(read.devDependencies ?? {})) development.add(name);
    for (const name of Object.keys(read.dependencies ?? {})) production.add(name);
  }
  return [...development].filter((name) => !production.has(name)).sort();
};

const pinnedFilterRepoVersion = (): string => {
  const dockerfile = readFileSync(path.join(repositoryRoot, "apps/api/Dockerfile"), "utf8");
  const version = /^ARG\s+GIT_FILTER_REPO_VERSION=(?<version>\S+)\s*$/m.exec(dockerfile)?.groups?.[
    "version"
  ];
  if (version === undefined) {
    throw new Error(
      "apps/api/Dockerfile no longer pins the rewrite tool in an `ARG GIT_FILTER_REPO_VERSION=` line this can read",
    );
  }
  return version;
};

const contentsSchema = z.object({
  resolvable: z.array(z.string()),
  missing: z.array(z.string()),
  hasContracts: z.boolean(),
  hasSpaBuild: z.boolean(),
  filterRepoVersion: z.string(),
  gitRanFilterRepo: z.boolean(),
});

type ImageContents = z.infer<typeof contentsSchema>;

const probe = `
const { createRequire } = require("node:module");
const { existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const from = createRequire("/app/apps/api/");
const resolves = (name) => { try { from.resolve(name); return true; } catch { return false; } };
const answered = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const resolvable = JSON.parse(process.env.PROBE_NAMES).filter(resolves);
const missing = JSON.parse(process.env.PROBE_REQUIRED).filter((name) => !resolves(name));
process.stdout.write(JSON.stringify({
  resolvable,
  missing,
  hasContracts: existsSync("/app/contracts"),
  hasSpaBuild: existsSync("/app/apps/web/dist/index.html"),
  filterRepoVersion: answered("python3", [
    "-c",
    "import importlib.metadata as m; print(m.version('git-filter-repo'))",
  ]),
  gitRanFilterRepo: answered("git", ["filter-repo", "--version"]) !== "",
}));
`;

describe.skipIf(nothingToProbeHere)("the app tier's runtime image", () => {
  let contents: ImageContents;
  const developmentOnly = developmentOnlyPackages();

  beforeAll(async () => {
    const leg = legFor("api");
    const stdout = await readTheImage(
      { tier: leg.tier, dockerfile: leg.dockerfile, context: leg.context },
      {
        command: ["node", "-e", probe],
        environment: {
          PROBE_NAMES: JSON.stringify(developmentOnly),

          PROBE_REQUIRED: JSON.stringify(["@better-answers/core/kernel", "@better-answers/schema"]),
        },
      },
    );
    contents = contentsSchema.parse(JSON.parse(stdout));
  }, IMAGE_PROBE_ALLOWANCE);

  it("gives the app no development dependency it could load", () => {
    expect(developmentOnly.length).toBeGreaterThan(0);
    expect(contents.resolvable).toEqual([]);
  });

  it("carries the two workspace libraries the app imports", () => {
    expect(contents.missing).toEqual([]);
  });

  it("leaves the tier contract's fixtures out of the runtime", () => {
    expect(contents.hasContracts).toBe(false);
  });

  it("carries the single-page app's build where the app reads it", () => {
    expect(contents.hasSpaBuild).toBe(true);
  });

  it("carries the history-rewrite tool at the version the Dockerfile pins", () => {
    expect(contents.filterRepoVersion).toBe(pinnedFilterRepoVersion());
  });

  it("puts the rewrite tool where git finds it as a subcommand", () => {
    expect(contents.gitRanFilterRepo).toBe(true);
  });
});

describe("the api leg of the image job", () => {
  it("names this file as its probe, so the file cannot move without the workflow", () => {
    const api = legFor("api");

    expect(matrixLegs().length).toBeGreaterThan(1);
    expect(api.probe).toContain("@better-answers/api");
    expect(api.probe).toContain(fileFromTheWorkspace(import.meta.url, "apps/api"));
  });
});
