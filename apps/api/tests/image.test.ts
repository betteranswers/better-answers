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
  packageManager: z.string().optional(),
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

const pinnedPnpmVersion = (): string => {
  const packageManager = manifest(".").packageManager ?? "";
  const version = /^pnpm@(?<version>[^+\s]+)/.exec(packageManager)?.groups?.["version"];
  if (version === undefined) {
    throw new Error(
      `the root manifest's packageManager is "${packageManager}", which names no pnpm version this can read`,
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
  commandsOnPath: z.array(z.string()),
  hasNpmPackage: z.boolean(),
  pnpmTarget: z.string(),
  pnpmVersion: z.string(),
  opsAnswer: z.string(),
  storedCount: z.number(),
  unreached: z.array(z.string()),
  broken: z.array(z.string()),
  loaded: z.array(z.string()),
});

type ImageContents = z.infer<typeof contentsSchema>;

/**
 * No peer is followed: pnpm links one from anywhere in the workspace's graph, and a peer the api
 * loads is one it declares.
 */
const probe = `
const { createRequire } = require("node:module");
const { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const from = createRequire("/app/apps/api/");
const resolves = (name) => { try { from.resolve(name); return true; } catch { return false; } };
const answered = (command, args, environment = {}) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, ...environment },
    }).trim();
  } catch {
    return "";
  }
};
// What a failed command said, so a red assertion names its cause rather than "".
const answeredOrWhy = (command, args, environment = {}) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...environment },
    }).trim();
  } catch (error) {
    return String(error.stderr || error.message).trim();
  }
};
// pnpm 12 under corepack fetches its native binary on first run unless the cache holds it;
// with corepack's network refused, a binary the image does not carry is red here, not fetched.
const offline = { COREPACK_ENABLE_NETWORK: "0" };
// lstat, not existsSync: a link left dangling on PATH still counts as a command shipped.
const linkOrFileAt = (file) => { try { lstatSync(file); return true; } catch { return false; } };
const onPath = (name) =>
  (process.env.PATH ?? "").split(":").filter(Boolean).map((dir) => path.join(dir, name)).find(linkOrFileAt);
const realTarget = (file) => { try { return realpathSync(file); } catch { return ""; } };
const resolvable = JSON.parse(process.env.PROBE_NAMES).filter(resolves);
const missing = JSON.parse(process.env.PROBE_REQUIRED).filter((name) => !resolves(name));
const pnpm = onPath("pnpm");
const namesIn = (modules) => readdirSync(modules).flatMap((entry) =>
  entry.startsWith("@") ? readdirSync(path.join(modules, entry)).map((name) => entry + "/" + name) : [entry]);
const store = "/app/node_modules/.pnpm";
const stored = new Map();
for (const entry of readdirSync(store)) {
  const modules = path.join(store, entry, "node_modules");
  if (!existsSync(modules)) continue;
  for (const name of namesIn(modules)) {
    const directory = path.join(modules, name);
    if (!lstatSync(directory).isSymbolicLink()) stored.set(directory, name);
  }
}
const reached = new Set();
const broken = [];
const pending = ["apps/api", "packages/core", "packages/schema"].flatMap((workspace) => {
  const modules = path.join("/app", workspace, "node_modules");
  return namesIn(modules).map((name) => realpathSync(path.join(modules, name)));
});
while (pending.length > 0) {
  const directory = pending.pop();
  if (reached.has(directory) || !stored.has(directory)) continue;
  reached.add(directory);
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  const siblings = directory.slice(0, -stored.get(directory).length);
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
    const link = path.join(siblings, name);
    if (existsSync(link)) pending.push(realpathSync(link));
    else if (!(name in (manifest.optionalDependencies ?? {}))) broken.push(manifest.name + " -> " + name);
  }
}
const refusesItsBootstrap = (entry) => {
  try {
    execFileSync("node", ["/app/apps/api/src/" + entry], {
      encoding: "utf8", env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"], timeout: 20000,
    });
    return false;
  } catch (error) {
    return (String(error.stdout) + String(error.stderr)).includes("bootstrap configuration is invalid");
  }
};
process.stdout.write(JSON.stringify({
  resolvable,
  missing,
  storedCount: stored.size,
  unreached: [...stored].filter(([directory]) => !reached.has(directory)).map(([, name]) => name).sort(),
  broken: broken.sort(),
  loaded: ["main.ts", "migrate.ts", "ops.ts"].filter(refusesItsBootstrap),
  hasContracts: existsSync("/app/contracts"),
  hasSpaBuild: existsSync("/app/apps/web/dist/index.html"),
  filterRepoVersion: answered("python3", [
    "-c",
    "import importlib.metadata as m; print(m.version('git-filter-repo'))",
  ]),
  gitRanFilterRepo: answered("git", ["filter-repo", "--version"]) !== "",
  commandsOnPath: JSON.parse(process.env.PROBE_COMMANDS).filter((name) => onPath(name) !== undefined),
  hasNpmPackage: existsSync("/usr/local/lib/node_modules/npm"),
  pnpmTarget: pnpm === undefined ? "" : realTarget(pnpm),
  pnpmVersion: answeredOrWhy("pnpm", ["--version"], offline),
  // ops.ts will not start without a database URL; help answers before any connection is made.
  opsAnswer: answeredOrWhy("pnpm", ["--silent", "ops", "help"], {
    ...offline,
    DATABASE_URL: "postgres://probe@127.0.0.1:9/probe",
  }),
}));
`;

describe.skipIf(nothingToProbeHere)("the api tier's runtime image", () => {
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
          PROBE_COMMANDS: JSON.stringify(["corepack", "npm", "npx", "pnpm"]),
        },
      },
    );
    contents = contentsSchema.parse(JSON.parse(stdout));
  }, IMAGE_PROBE_ALLOWANCE);

  it("gives the api no development dependency it could load", () => {
    expect(developmentOnly.length).toBeGreaterThan(0);
    expect(contents.resolvable).toEqual([]);
  });

  it("carries the two workspace libraries the api imports", () => {
    expect(contents.missing).toEqual([]);
  });

  it("carries no package the api's own dependencies do not reach", () => {
    expect(contents.storedCount).toBeGreaterThan(0);
    expect(contents.unreached).toEqual([]);
  });

  it("keeps every dependency a package it carries declares", () => {
    expect(contents.broken).toEqual([]);
  });

  it("loads every module `main.ts`, `migrate` and `pnpm ops` import", () => {
    // Each entry reads its bootstrap first, and refuses it only once every static import has
    // resolved.
    expect(contents.loaded).toEqual(["main.ts", "migrate.ts", "ops.ts"]);
  });

  it("leaves the tier contract's fixtures out of the runtime", () => {
    expect(contents.hasContracts).toBe(false);
  });

  it("carries the single-page app's build where the api reads it", () => {
    expect(contents.hasSpaBuild).toBe(true);
  });

  it("carries the history-rewrite tool at the version the Dockerfile pins", () => {
    expect(contents.filterRepoVersion).toBe(pinnedFilterRepoVersion());
  });

  it("installs the rewrite tool as a git subcommand", () => {
    expect(contents.gitRanFilterRepo).toBe(true);
  });

  it("ships no npm or npx, and keeps corepack for pnpm", () => {
    expect(contents.commandsOnPath).toEqual(["corepack", "pnpm"]);
    expect(contents.hasNpmPackage).toBe(false);
  });

  it("runs pnpm through corepack at the root manifest's version", () => {
    expect(contents.pnpmTarget).toBe("/usr/local/lib/node_modules/corepack/dist/pnpm.js");
    expect(contents.pnpmVersion).toBe(pinnedPnpmVersion());
  });

  it("reaches the operator's commands through pnpm", () => {
    expect(contents.opsAnswer).toContain("usage: pnpm ops <command> [options]");
  });
});

describe("the api leg of the image job", () => {
  it("names this file as its probe", () => {
    const api = legFor("api");

    expect(matrixLegs().length).toBeGreaterThan(1);
    expect(api.probe).toContain("@better-answers/api");
    expect(api.probe).toContain(fileFromTheWorkspace(import.meta.url, "apps/api"));
  });
});
