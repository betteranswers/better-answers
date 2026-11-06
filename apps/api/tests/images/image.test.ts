import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { workspacePackages } from "@better-answers/devtools/paths";
import { legFor, matrixLegs } from "@better-answers/devtools/workflows";

import { repositoryRoot } from "../support/roots/roots.ts";
import {
  fileFromTheWorkspace,
  IMAGE_PROBE_ALLOWANCE,
  nothingToProbeHere,
  readTheImage,
} from "./image-probe.ts";

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
    throw new Error("apps/api/Dockerfile has no `ARG GIT_FILTER_REPO_VERSION=<version>` line");
  }
  return version;
};

const pinnedPnpmVersion = (): string => {
  const packageManager = manifest(".").packageManager ?? "";
  const version = /^pnpm@(?<version>[^+\s]+)/.exec(packageManager)?.groups?.["version"];
  if (version === undefined) {
    throw new Error(`the root manifest's packageManager "${packageManager}" names no pnpm version`);
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
 * The probe does not follow peer dependencies. pnpm links a peer from anywhere in the workspace graph,
 * and the api declares every peer it loads.
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
// Returns stderr on failure, so a failed assertion shows the cause instead of an empty string.
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
// Under corepack, pnpm 12 downloads its native binary on first run unless it is cached. With the
// network off, a binary missing from the image fails here instead of downloading.
const offline = { COREPACK_ENABLE_NETWORK: "0" };
// lstat, because existsSync follows links and a dangling link on PATH still counts as shipped.
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
const carried = ["apps/api", "packages/core", "packages/schema"];
const pending = carried.flatMap((workspace) => {
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
  // ops.ts needs a database URL to start, but help answers before it connects.
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

          PROBE_REQUIRED: JSON.stringify([
            "@better-answers/core/kernel",
            "@better-answers/schema",
            "@better-answers/web/styles/logo.svg",
            "@better-answers/web/styles/styles.css",
          ]),
          PROBE_COMMANDS: JSON.stringify(["corepack", "npm", "npx", "pnpm"]),
        },
      },
    );
    contents = contentsSchema.parse(JSON.parse(stdout));
  }, IMAGE_PROBE_ALLOWANCE);

  it("contains no development-only dependency the api can resolve", () => {
    expect(developmentOnly.length).toBeGreaterThan(0);
    expect(contents.resolvable).toEqual([]);
  });

  it("contains the three workspace libraries the api imports", () => {
    expect(contents.missing).toEqual([]);
  });

  it("contains only packages reachable from the api's dependencies", () => {
    expect(contents.storedCount).toBeGreaterThan(0);
    expect(contents.unreached).toEqual([]);
  });

  it("contains every dependency that each installed package declares", () => {
    expect(contents.broken).toEqual([]);
  });

  it("resolves every static import of main.ts, migrate.ts, and ops.ts", () => {
    // An entry rejects its bootstrap configuration only after every static import resolves, so that
    // rejection proves the imports loaded.
    expect(contents.loaded).toEqual(["main.ts", "migrate.ts", "ops.ts"]);
  });

  it("leaves out the tier contract fixtures in /app/contracts", () => {
    expect(contents.hasContracts).toBe(false);
  });

  it("contains the web build at the path the api serves", () => {
    expect(contents.hasSpaBuild).toBe(true);
  });

  it("contains git-filter-repo at the version the Dockerfile pins", () => {
    expect(contents.filterRepoVersion).toBe(pinnedFilterRepoVersion());
  });

  it("runs git-filter-repo as `git filter-repo`", () => {
    expect(contents.gitRanFilterRepo).toBe(true);
  });

  it("has corepack and pnpm on PATH, not npm or npx", () => {
    expect(contents.commandsOnPath).toEqual(["corepack", "pnpm"]);
    expect(contents.hasNpmPackage).toBe(false);
  });

  it("runs pnpm through corepack at the root manifest's version", () => {
    expect(contents.pnpmTarget).toBe("/usr/local/lib/node_modules/corepack/dist/pnpm.js");
    expect(contents.pnpmVersion).toBe(pinnedPnpmVersion());
  });

  it("answers `pnpm ops help` with the usage text", () => {
    expect(contents.opsAnswer).toContain("usage: pnpm ops <command> [options]");
  });
});

/** Runs before each entry the gate starts. Reports what it and PID 1 hold, and null for an unreadable environment. */
const pidOneSpy = `
import { readFileSync } from "node:fs";
if (!process.argv[1].endsWith("environment-gate.ts")) {
  const readable = (file) => { try { return readFileSync(file, "utf8"); } catch { return null; } };
  const keysOf = (environ) => environ.split("\\0").filter(Boolean).map((line) => line.split("=")[0]).sort();
  const initEnviron = readable("/proc/1/environ");
  process.stdout.write(JSON.stringify({
    init: readFileSync("/proc/1/cmdline", "utf8").split("\\0")[0],
    initUid: Number(/^Uid:\\s+(\\d+)/m.exec(readFileSync("/proc/1/status", "utf8"))[1]),
    initKeys: initEnviron === null ? null : keysOf(initEnviron),
    ownKeys: Object.keys(process.env).sort(),
    uid: process.getuid(),
    gid: process.getgid(),
    groups: process.getgroups(),
  }));
  process.exit(0);
}
`;

const spiedSchema = z.object({
  init: z.string(),
  initUid: z.number(),
  initKeys: z.array(z.string()).nullable(),
  ownKeys: z.array(z.string()),
  uid: z.number(),
  gid: z.number(),
  groups: z.array(z.number()),
});

type Spied = z.infer<typeof spiedSchema>;

const RESOURCE_KEYS = {
  DATABASE_URL: "postgres://app@db:5432/ba",
  KEK: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  MIGRATE_DATABASE_URL: "postgres://owner@db:5432/ba",
  WORKER_DATABASE_URL: "postgres://worker@db:5432/ba",
};

const SPY_OPTIONS = `--import=data:text/javascript,${encodeURIComponent(pidOneSpy)}`;

const spiedIn = async (command: readonly string[], spy: string): Promise<Spied> => {
  const leg = legFor("api");
  const stdout = await readTheImage(
    { tier: leg.tier, dockerfile: leg.dockerfile, context: leg.context },
    { command, environment: { ...RESOURCE_KEYS, [spy]: SPY_OPTIONS } },
  );
  return spiedSchema.parse(JSON.parse(stdout));
};

/** The volume owner in `deploy/stores.compose.yaml`, and the gate's `APP_UID`. */
const APP_UID = 1000;

describe.skipIf(nothingToProbeHere)("the api image's CMD started with every resource key", () => {
  let seen: Spied;

  beforeAll(async () => {
    seen = await spiedIn(["node", "apps/api/src/environment-gate.ts", "api"], "NODE_OPTIONS");
  }, IMAGE_PROBE_ALLOWANCE);

  it("puts tini at PID 1 in place of Docker's init", () => {
    expect(seen.init).toBe("/usr/bin/tini");
  });

  it("drops root before it starts tini and the api", () => {
    expect(seen).toMatchObject({ initUid: APP_UID, uid: APP_UID, gid: APP_UID, groups: [APP_UID] });
  });

  it("leaves PID 1 holding only the keys the api reads", () => {
    expect(seen.initKeys).toEqual([
      "DATABASE_URL",
      "HOME",
      "HOSTNAME",
      "KEK",
      "NODE_ENV",
      "NODE_OPTIONS",
      "PATH",
      "PORT",
    ]);
    expect(seen.ownKeys).toEqual(seen.initKeys);
  });
});

/** Starts the gate as a child of a root PID 1, as `docker exec api pnpm ops` does. */
const opsUnderRoot = `require("node:child_process").execFileSync(
  process.execPath,
  ["apps/api/src/environment-gate.ts", "ops", "help"],
  { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: process.env.SPY } },
);`;

describe.skipIf(nothingToProbeHere)("the api gate started as root, not as PID 1", () => {
  let seen: Spied;

  beforeAll(async () => {
    seen = await spiedIn(["node", "-e", opsUnderRoot], "SPY");
  }, IMAGE_PROBE_ALLOWANCE);

  it("drops root before it starts ops", () => {
    expect(seen).toMatchObject({ initUid: 0, uid: APP_UID, gid: APP_UID, groups: [APP_UID] });
  });

  it("leaves ops unable to read the root process's environment", () => {
    expect(seen.initKeys).toBeNull();
    expect(seen.ownKeys).not.toContain("MIGRATE_DATABASE_URL");
  });
});

describe("the api leg of the image job", () => {
  it("lists this file as its probe", () => {
    const api = legFor("api");

    expect(matrixLegs().length).toBeGreaterThan(1);
    expect(api.probe).toContain("@better-answers/api");
    expect(api.probe).toContain(fileFromTheWorkspace(import.meta.url, "apps/api"));
  });
});
