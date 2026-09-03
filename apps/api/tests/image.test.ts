import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

const run = promisify(execFile);

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The runtime image's contents, asserted through the one interface a deploy unit has on
 * them: a container started from the image.
 *
 * What is being guarded is the shape of `apps/api/Dockerfile`'s last stage, and the two
 * ways it silently goes wrong. A `COPY` written a little too wide, or a production install
 * that stopped being one, puts development tooling into a production image — bytes that
 * nothing runs, that nobody patches, and that a person reading the manifest would swear
 * were not there. And `contracts/` is the tier contract's fixtures (ADR 0031), read by both
 * suites and imported by nothing; it is test material, and a runtime that carries it has a
 * `COPY` nobody meant.
 *
 * The list of what must not be there is read off the workspace manifests rather than
 * written down here, so a dependency moved between `dependencies` and `devDependencies`
 * changes what this test demands without anyone remembering to edit it.
 */

const dockerIsAvailable = async (): Promise<boolean> => {
  try {
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
};

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const manifest = (workspace: string): z.infer<typeof manifestSchema> =>
  manifestSchema.parse(
    JSON.parse(readFileSync(path.join(repositoryRoot, workspace, "package.json"), "utf8")),
  );

const WORKSPACES = [".", "apps/api", "apps/web", "packages/core", "packages/schema"];

/**
 * A name is a development dependency of this repository when some workspace has it under
 * `devDependencies` and no workspace has it under `dependencies`. The second half matters:
 * `zod` and `pg` are both — a development dependency of one workspace and a production
 * dependency of another — and they belong in the image.
 */
const developmentOnlyPackages = (): readonly string[] => {
  const development = new Set<string>();
  const production = new Set<string>();
  for (const workspace of WORKSPACES) {
    const read = manifest(workspace);
    for (const name of Object.keys(read.devDependencies ?? {})) development.add(name);
    for (const name of Object.keys(read.dependencies ?? {})) production.add(name);
  }
  return [...development].filter((name) => !production.has(name)).sort();
};

const contentsSchema = z.object({
  resolvable: z.array(z.string()),
  missing: z.array(z.string()),
  hasContracts: z.boolean(),
  hasShell: z.boolean(),
});

type ImageContents = z.infer<typeof contentsSchema>;

// Read inside the container by the image's own node, from the api's own directory, so
// "resolvable" means what it means to the process the deploy unit starts.
const probe = `
const { createRequire } = require("node:module");
const { existsSync } = require("node:fs");
const from = createRequire("/app/apps/api/");
const resolves = (name) => { try { from.resolve(name); return true; } catch { return false; } };
const resolvable = JSON.parse(process.env.PROBE_NAMES).filter(resolves);
const missing = JSON.parse(process.env.PROBE_REQUIRED).filter((name) => !resolves(name));
process.stdout.write(JSON.stringify({
  resolvable,
  missing,
  hasContracts: existsSync("/app/contracts"),
  hasShell: existsSync("/app/apps/web/dist/index.html"),
}));
`;

describe.skipIf(!(await dockerIsAvailable()))("the app tier's runtime image", () => {
  // Skipped whole when no Docker daemon answers, so a machine or a CI job without one stays
  // green: the image is built and pushed by .github/workflows/build.yml, which has one.
  let contents: ImageContents;
  const developmentOnly = developmentOnlyPackages();

  beforeAll(async () => {
    // The image is run by the id the build prints, and is never tagged. A tag is a name on
    // the daemon, and the daemon is shared: two worktrees running `check` at once would
    // overwrite each other's tag and one would read the other's image. The id cannot be
    // taken from under this test.
    const built = await run("docker", ["build", "--quiet", "--file", "apps/api/Dockerfile", "."], {
      cwd: repositoryRoot,
      timeout: 900_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const image = built.stdout.trim();
    const { stdout } = await run(
      "docker",
      [
        "run",
        "--rm",
        "--env",
        "PROBE_NAMES",
        "--env",
        "PROBE_REQUIRED",
        image,
        "node",
        "-e",
        probe,
      ],
      {
        timeout: 120_000,
        env: {
          ...process.env,
          PROBE_NAMES: JSON.stringify(developmentOnly),
          // Entry points from each library's `exports` map, because that is the only way
          // in: `packages/core` publishes capability slices and no root entry at all.
          PROBE_REQUIRED: JSON.stringify(["@better-answers/core/kernel", "@better-answers/schema"]),
        },
      },
    );
    contents = contentsSchema.parse(JSON.parse(stdout));
  }, 1_020_000);

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
    expect(contents.hasShell).toBe(true);
  });
});
