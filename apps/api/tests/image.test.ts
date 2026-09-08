import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildWorkflow,
  fileFromTheWorkspace,
  IMAGE_ID_VARIABLE,
  imageJob,
  type ImageStep,
  legFor,
  matrixLegs,
  nothingToProbeHere,
  PROBE_DEFERRAL_VARIABLE,
  readTheImage,
  repositoryRoot,
  readWorkflow,
  workflowStepSchema,
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
 * The daemon rule, the image id and the build-and-remove lifecycle are `image-probe.ts`'s,
 * shared with the worker's and the backup's probes (`T-084`). The second half of this file
 * holds the mechanism those three legs run under, because this is the file `build.yml`'s
 * api leg names.
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
    // A cold build, a container and the removal of an untagged image, in one hook. The
    // allowance is the build's; `apps/api`'s global `hookTimeout` is a runaway guard for
    // hooks that open a database and cannot cover this one.
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
    expect(contents.hasSpaBuild).toBe(true);
  });
});

/**
 * The other half of the agreement, read off `build.yml` (T-043, T-084).
 *
 * The job that pushes carries the mechanism: a matrix leg with a `probe` command is built
 * into the runner's daemon, probed by that command against the id the load printed, and
 * pushed only after the probe passes. A leg declares what its probe needs to run under —
 * `probe-toolchain` — and the job installs that toolchain and no other, so a fourth image
 * joins by carrying two matrix fields rather than by a rewrite.
 *
 * These assertions run everywhere, daemon or no daemon, because what they guard fails at the
 * one moment nobody is watching: a push to `main`, where a leg either probes the bytes it
 * ships or quietly ships bytes nothing read.
 */

const checkWorkflowSchema = z.object({
  on: z.object({
    workflow_call: z.object({
      inputs: z.record(z.string(), z.record(z.string(), z.unknown())),
    }),
  }),
  jobs: z.object({ check: z.object({ steps: z.array(workflowStepSchema) }) }),
});

const checkWorkflow = () => readWorkflow("check.yml", checkWorkflowSchema);

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
    const api = legFor("api");

    expect(matrixLegs().length).toBeGreaterThan(1);
    expect(api.probe).toContain("@better-answers/api");
    expect(api.probe).toContain(fileFromTheWorkspace(import.meta.url, "apps/api"));
  });

  it("reads every image it pushes, so no leg ships bytes nothing looked at", () => {
    // The list is `build.yml`'s own, not one written here: a leg added without a probe
    // fails this rather than quietly joining the two that had none before `T-084`.
    const unprobed = matrixLegs()
      .filter((leg) => leg.probe === undefined)
      .map((leg) => leg.tier);

    expect(matrixLegs().length).toBeGreaterThan(2);
    expect(unprobed).toEqual([]);
  });

  it("installs the toolchain each probe needs, and names no tier to decide it", () => {
    const steps = imageJob().steps;
    // A step belongs to a toolchain by testing for it, so the set of toolchains the job
    // can run is read out of the steps rather than listed here.
    const installed = new Set(
      steps.flatMap(
        (step) => /matrix\.probe-toolchain == '([\w-]+)'/.exec(step.if ?? "")?.[1] ?? [],
      ),
    );
    // [TEST7] both ways: a probe whose runtime nothing installs cannot run, and a
    // toolchain installed for a leg that has no probe is a setup step nobody needs.
    const unserved = matrixLegs().flatMap((leg) => {
      const toolchain = leg["probe-toolchain"];
      if (leg.probe === undefined) return toolchain === undefined ? [] : [`${leg.tier}: no probe`];
      if (toolchain === undefined) return [`${leg.tier}: no toolchain`];
      return installed.has(toolchain) ? [] : [`${leg.tier}: ${toolchain} is never installed`];
    });

    expect(installed.size).toBeGreaterThan(1);
    expect(unserved).toEqual([]);
    // The tier is never the condition. `matrix.tier` in a step's `if` would make the
    // mechanism a list of images instead of a property a leg carries.
    expect(steps.filter((step) => (step.if ?? "").includes("matrix.tier"))).toEqual([]);
  });

  it("hands every probe the id of the build it loaded, under the name every probe reads", () => {
    const steps = imageJob().steps;
    const probed = steps[probeStepAt(steps)];

    // The command comes in through the environment, so the step runs the matrix's probe
    // and nothing else; and it is refused an empty id, because a probe would then build
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

  it("stands the probes down only where the caller of `check.yml` probes the images itself", () => {
    // The deferral is the other half of the same agreement and the half whose failures are
    // both silent: a lost mapping builds every image twice on a push to main, and a
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
