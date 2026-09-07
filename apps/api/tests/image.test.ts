import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { workspacePackages } from "./workspaces.ts";

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
 * The list of what must not be there is derived — the workspace list from
 * `pnpm-workspace.yaml`, the dependency lists from each manifest — so a project added to
 * the workspace or a dependency moved between `dependencies` and `devDependencies` changes
 * what this test demands without anyone remembering to edit it.
 *
 * **Two ways this file runs.** Given no image id it builds the image and probes what it
 * built, which is what a laptop and a pull request do. Given one it probes that image and
 * builds nothing: `build.yml`'s image job loads its own build, hands the id here and pushes
 * only if these four tests pass, so the artefact that ships is the artefact that was read
 * (T-043). A push to `main` runs the second alone — `check.yml` is told by its caller that
 * the job which pushes does the probing — because two builds of one Dockerfile in one run
 * prove the same thing twice and only one of them is the thing that ships.
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

const contentsSchema = z.object({
  resolvable: z.array(z.string()),
  missing: z.array(z.string()),
  hasContracts: z.boolean(),
  hasSpaBuild: z.boolean(),
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
  hasSpaBuild: existsSync("/app/apps/web/dist/index.html"),
}));
`;

/** The api image built from the repository root, answering with the id the build printed. */
const buildTheImage = async (): Promise<string> => {
  const built = await run("docker", ["build", "--quiet", "--file", "apps/api/Dockerfile", "."], {
    cwd: repositoryRoot,
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return built.stdout.trim();
};

const dockerAnswers = await dockerIsAvailable();
// A laptop without Docker still runs `check`; CI does not get that latitude. `build.yml`
// gates the push on this workflow, so a CI job that quietly skipped these four tests would
// leave the image ungoverned while reporting green — the one outcome the gate exists to
// prevent. Skipped off CI, failed on it, and never silent on either.
const daemonIsRequired = (process.env["CI"] ?? "") !== "";

/**
 * The name the image id arrives under. It is read here and asserted against `build.yml`
 * below, because the two halves are one agreement: an id passed under a name this file
 * does not read would leave it building its own image and calling that the shipped one.
 */
const IMAGE_ID_VARIABLE = "IMAGE_ID";
const suppliedImage = (process.env[IMAGE_ID_VARIABLE] ?? "").trim();

/**
 * Set by `check.yml` when the workflow calling it has a job that pushes these images, and
 * by nothing else. That job loads each build and runs this file against it, so probing
 * here as well would build the api image a second time on a second runner to learn what
 * the first already knows. A pull request has no such job, passes nothing, and probes.
 *
 * Exactly `"true"` and nothing looser: a value nobody meant to set leaves the probe
 * running, which is the direction a mistake here has to fail in.
 */
const PROBE_DEFERRAL_VARIABLE = "IMAGE_PROBE_DEFERRED";
const probeRunsInTheJobThatPushes = process.env[PROBE_DEFERRAL_VARIABLE] === "true";

// Two reasons to stand down and no third: the run's own pushing job is doing this, or no
// daemon answered on a machine that is allowed none. A missing daemon on CI is a failure
// rather than a skip, which is the `daemonIsRequired` half above.
const nothingToProbeHere = probeRunsInTheJobThatPushes || (!dockerAnswers && !daemonIsRequired);

describe.skipIf(nothingToProbeHere)("the app tier's runtime image", () => {
  let contents: ImageContents;
  let builtHere: string | undefined;
  const developmentOnly = developmentOnlyPackages();

  beforeAll(async () => {
    if (!dockerAnswers) {
      throw new Error(
        "no Docker daemon answered, so the runtime image cannot be read: on CI these tests fail rather than skip, because build.yml gates the image push on this workflow",
      );
    }
    // The image is run by the id the build prints, and is never tagged. A tag is a name on
    // the daemon, and the daemon is shared: two worktrees running `check` at once would
    // overwrite each other's tag and one would read the other's image. The id cannot be
    // taken from under this test. A supplied id is the same kind of thing — the id the
    // workflow's own load printed — for the same reason.
    const image = suppliedImage === "" ? await buildTheImage() : suppliedImage;
    // Only an image this file built is this file's to remove.
    if (suppliedImage === "") builtHere = image;
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

  afterAll(async () => {
    // The image is untagged, so leaving it behind leaves a dangling half-gigabyte on the
    // machine for every run whose source differed from the last. Failure to remove it is not
    // a failure of the suite: another run may hold the same id.
    if (builtHere === undefined) return;
    await run("docker", ["rmi", "--force", builtHere], { timeout: 120_000 }).catch(() => undefined);
  }, 130_000);

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
});

/**
 * The other half of the agreement, read off `build.yml` (T-043).
 *
 * The job that pushes carries the mechanism: a matrix leg with a `probe` command is built
 * into the runner's daemon, probed by that command against the id the load printed, and
 * pushed only after the probe passes. A leg without one is built and pushed as before, and
 * `T-084` — which writes the worker's and the backup's contents tests — turns the mechanism
 * on for them by giving those legs a command.
 *
 * These assertions run everywhere, daemon or no daemon, because what they guard fails at the
 * one moment nobody is watching: a push to `main`, where the leg either probes the bytes it
 * ships or quietly ships bytes nothing read.
 */

const workflowStepSchema = z.object({
  run: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});

const buildWorkflowSchema = z.object({
  jobs: z.object({
    check: z.object({ with: z.record(z.string(), z.unknown()).optional() }),
    image: z.object({
      strategy: z.object({
        matrix: z.object({
          include: z.array(z.object({ tier: z.string(), probe: z.string().optional() })),
        }),
      }),
      steps: z.array(workflowStepSchema),
    }),
  }),
});

const checkWorkflowSchema = z.object({
  on: z.object({
    workflow_call: z.object({
      inputs: z.record(z.string(), z.record(z.string(), z.unknown())),
    }),
  }),
  jobs: z.object({ check: z.object({ steps: z.array(workflowStepSchema) }) }),
});

type ImageStep = z.infer<typeof workflowStepSchema>;

const workflowFile = (name: string): unknown =>
  parse(readFileSync(path.join(repositoryRoot, ".github/workflows", name), "utf8"));

const buildWorkflow = () => buildWorkflowSchema.parse(workflowFile("build.yml"));
const checkWorkflow = () => checkWorkflowSchema.parse(workflowFile("check.yml"));
const imageJob = () => buildWorkflow().jobs.image;

/** A step's input as the string it is, or `""` — an action's inputs are also booleans. */
const input = (step: ImageStep, name: string): string => {
  const value = step.with?.[name];
  return typeof value === "string" ? value : "";
};

/** The step handed an image id is the step that runs a leg's probe against it. */
const probeStepAt = (steps: readonly ImageStep[]): number =>
  steps.findIndex((step) => step.env?.[IMAGE_ID_VARIABLE] !== undefined);

describe("the job that probes the image it pushes", () => {
  it("gives the api leg this file as its probe, so the file cannot move without the workflow", () => {
    const legs = imageJob().strategy.matrix.include;
    const api = legs.find((leg) => leg.tier === "api");
    // Derived, not spelled: what the workflow must name is wherever this file actually is,
    // relative to the workspace whose runner the probe command names.
    const hereFromTheWorkspace = path.relative(
      path.join(repositoryRoot, "apps/api"),
      fileURLToPath(import.meta.url),
    );

    expect(legs.length).toBeGreaterThan(1);
    expect(api?.probe).toContain("@better-answers/api");
    expect(api?.probe).toContain(hereFromTheWorkspace);
  });

  it("hands every probe the id of the build it loaded, under the name this file reads", () => {
    const steps = imageJob().steps;
    const probed = steps[probeStepAt(steps)];

    // The command comes in through the environment, so the step runs the matrix's probe
    // and nothing else; and it is refused an empty id, because this file would then build
    // an image of its own and let an unread one ship.
    expect(probed?.env?.["PROBE"]).toEqual("${{ matrix.probe }}");
    expect(probed?.run).toContain("${PROBE}");
    expect(probed?.run).toContain(`-z "\${${IMAGE_ID_VARIABLE}}"`);
    expect(probed?.run).toContain("exit 1");
    expect(probed?.env?.[IMAGE_ID_VARIABLE]).toContain("outputs.imageid");
  });

  it("exports the build twice on the same terms, so the digest probed is the digest pushed", () => {
    // The two exports are what make the run summary's claim true: the loaded manifest and
    // the pushed one are the same bytes only while both are written with the same media
    // types and neither carries an attestation the other has no room for.
    const exported = imageJob().steps.filter((step) => input(step, "outputs") !== "");
    const mediaTypes = new Set(
      exported.map((step) => /oci-mediatypes=\w+/.exec(input(step, "outputs"))?.[0]),
    );

    expect(exported.length).toEqual(2);
    expect([...mediaTypes]).toEqual([expect.stringContaining("oci-mediatypes=")]);
    expect(exported.map((step) => [step.with?.["provenance"], step.with?.["sbom"]])).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  it("stands this file down only where the caller of `check.yml` probes the image itself", () => {
    // The deferral is the other half of the same agreement and the half whose failures are
    // both silent: a lost mapping builds the api image twice on a push to main, and a
    // default that flipped to true would skip the contents tests on every pull request. The
    // input's name is read out of the wiring rather than spelled here, so the only thing
    // this can catch is the wiring itself.
    const check = checkWorkflow();
    const deferring = check.jobs.check.steps.find(
      (step) => step.env?.[PROBE_DEFERRAL_VARIABLE] !== undefined,
    );
    const named = /^\$\{\{\s*inputs\.([\w-]+)\s*\}\}$/.exec(
      deferring?.env?.[PROBE_DEFERRAL_VARIABLE] ?? "",
    )?.[1];

    expect(named).toBeDefined();
    expect(check.on.workflow_call.inputs[named ?? ""]?.["default"]).toBe(false);
    expect(buildWorkflow().jobs.check.with?.[named ?? ""]).toBe(true);
  });

  it("loads before it probes and pushes after, never the other way round", () => {
    const steps = imageJob().steps;
    const loadedAt = steps.findIndex((step) => input(step, "outputs").includes("type=docker"));
    const probedAt = probeStepAt(steps);
    const pushedAt = steps.findIndex((step) => input(step, "outputs").includes("push=true"));

    expect(loadedAt).toBeGreaterThanOrEqual(0);
    expect(probedAt).toBeGreaterThan(loadedAt);
    expect(pushedAt).toBeGreaterThan(probedAt);
  });
});
