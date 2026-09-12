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

/**
 * The app tier's runtime image's contents, asserted through the one interface a deploy unit
 * has on them: a container started from the image.
 *
 * What is being guarded is the shape of `apps/api/Dockerfile`'s last stage, and the two
 * ways it silently goes wrong. A `COPY` written a little too wide, or a production install
 * that stopped being one, puts development tooling into a production image — bytes that
 * nothing runs, that nobody patches, and that a person reading the manifest would swear
 * were not there. And `contracts/` is the tier contract's fixtures (ADR 0031), read by both
 * suites and imported by nothing; it is test material, and a runtime that carries it has a
 * `COPY` nobody meant.
 *
 * The list of what must not be there is derived — the workspace list from
 * `pnpm-workspace.yaml`, the dependency lists from each manifest — so a project added to
 * the workspace or a dependency moved between `dependencies` and `devDependencies` changes
 * what this test demands without anyone remembering to edit it.
 *
 * The third thing asserted here is the opposite failure: a tool the running app needs that
 * the image does not carry. The erasure routine's git step runs `git filter-repo` inside this
 * image (ADR 0020), and nothing else in the suite would notice its absence — the routine's
 * own tests run against the tool on the machine that runs them, never against this image.
 *
 * The daemon rule, the image id and the build-and-remove lifecycle are `image-probe.ts`'s,
 * shared with the worker's and the backup's probes (`T-084`). The mechanism all three legs
 * run under is `image-job.test.ts`'s; what stays here is this image and this file's own
 * link to the workflow leg that names it.
 */

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const manifest = (workspace: string): z.infer<typeof manifestSchema> =>
  manifestSchema.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, workspace, "package.json"), "utf8")),
  );

/**
 * Every project pnpm installs: the workspaces, plus the root, which is not in
 * `pnpm-workspace.yaml` and is an importer all the same.
 */
const workspaceProjects = (): readonly string[] => [".", ...workspacePackages()];

/**
 * A name is a development dependency of this repository when some workspace has it under
 * `devDependencies` and no workspace has it under `dependencies`. The second half matters:
 * `zod` and `pg` are both — a development dependency of one workspace and a production
 * dependency of another — and they belong in the image.
 */
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

/**
 * The version `apps/api/Dockerfile` pins `git-filter-repo` at, read out of the Dockerfile
 * rather than restated here: a version written down twice is a second pin that ages alone
 * (`[DEPS2]`). What a person cannot see by reading the Dockerfile is whether the image it
 * builds actually ends up carrying what the file asks for, and that is this test's half.
 */
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

// Read inside the container by the image's own node, from the api's own directory, so
// "resolvable" means what it means to the process the deploy unit starts — and, for the
// rewrite tool, run as the user the image runs as, because a file root can execute and
// `node` cannot is a tool this app does not have.
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
      { dockerfile: leg.dockerfile, context: leg.context },
      {
        command: ["node", "-e", probe],
        environment: {
          PROBE_NAMES: JSON.stringify(developmentOnly),
          // Entry points from each library's `exports` map, because that is the only way
          // in: `packages/core` publishes capability slices and no root entry at all.
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
    // The production install keeps `packages/core` and `packages/schema` where they are, as
    // real directories the api reaches by symlink, because Node will not strip types inside
    // `node_modules` — which is why `apps/api/Dockerfile` filters an install rather than
    // deploying a bundle. If that ever changes, this fails before the container does.
    expect(contents.missing).toEqual([]);
  });

  it("leaves the tier contract's fixtures out of the runtime", () => {
    expect(contents.hasContracts).toBe(false);
  });

  it("carries the single-page app's build where the app reads it", () => {
    expect(contents.hasSpaBuild).toBe(true);
  });

  it("carries the history-rewrite tool at the version the Dockerfile pins", () => {
    // Read from the installed distribution's own metadata, because `git filter-repo
    // --version` answers the commit the release was cut from — `a40bce548d2c` for 2.47.0 —
    // and a test asserting on that would be asserting a string nobody can trace back to a
    // pin. The metadata is the requirement pip was given, which is the pin itself.
    expect(contents.filterRepoVersion).toBe(pinnedFilterRepoVersion());
  });

  it("puts the rewrite tool where git finds it as a subcommand", () => {
    // The routine shells out to `git filter-repo` (ADR 0020), so the tool being installed
    // somewhere is not the question — git resolving it as a subcommand, for this user, is.
    // The version above already says which tool answered here.
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
