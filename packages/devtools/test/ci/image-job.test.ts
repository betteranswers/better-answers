import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { gatesUnder, rootScripts } from "@better-answers/devtools/root-commands";
import {
  buildWorkflow,
  imageJob,
  type ImageStep,
  matrixLegs,
  readWorkflow,
  workflowStepSchema,
} from "@better-answers/devtools/workflows";

const IMAGE_ID_VARIABLE = "IMAGE_ID";
const PROBE_DEFERRAL_VARIABLE = "IMAGE_PROBE_DEFERRED";

const thisSuite = path.relative(repositoryRoot, fileURLToPath(import.meta.url));

const checkWorkflowSchema = z.object({
  concurrency: z.object({ group: z.string() }),
  on: z.object({
    workflow_call: z.object({
      inputs: z.record(z.string(), z.record(z.string(), z.unknown())),
    }),
  }),
  jobs: z.record(
    z.string(),
    z.object({
      outputs: z.record(z.string(), z.string()).optional(),
      steps: z.array(workflowStepSchema).optional(),
    }),
  ),
});

const checkWorkflow = () => readWorkflow("check.yml", checkWorkflowSchema);

const checkLegs = (): readonly (readonly [string, readonly ImageStep[]])[] =>
  Object.entries(checkWorkflow().jobs).map(([job, leg]) => [job, leg.steps ?? []] as const);

const deferralAt = (steps: readonly ImageStep[]): number =>
  steps.findIndex((step) => step.env?.[PROBE_DEFERRAL_VARIABLE] !== undefined);

const legsCarryingTheDeferral = (): readonly string[] =>
  checkLegs().flatMap(([job, steps]) => (deferralAt(steps) === -1 ? [] : [job]));

const DEFERRAL =
  /^\$\{\{ inputs\.(?<input>[\w-]+) \|\| needs\.lane\.outputs\.(?<answer>[\w-]+) == 'no' \}\}$/;

type DeferralRead = { readonly input: string; readonly answer: string };

const deferralsRead = (): readonly DeferralRead[] =>
  checkLegs()
    .flatMap(([, steps]) => steps)
    .flatMap((step) => step.env?.[PROBE_DEFERRAL_VARIABLE] ?? [])
    .map((value) => {
      const groups = DEFERRAL.exec(value)?.groups;
      return { input: groups?.["input"] ?? value, answer: groups?.["answer"] ?? value };
    });

const trackedWorkspacesReadingTheDeferral = (): ReadonlySet<string> => {
  const found = spawnSync(
    "git",
    ["grep", "-l", "-F", PROBE_DEFERRAL_VARIABLE, "--", "apps", "packages", `:!${thisSuite}`],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  expect(found.status, `git grep ended non-zero: ${found.stderr}`).toBe(0);
  return new Set(
    found.stdout
      .split("\n")
      .filter((file) => file !== "")
      .map((file) => file.split("/").slice(0, 2).join("/")),
  );
};

const RUNS_AN_IMAGES_SCRIPT = /\bimages$/u;

const runsImageSuites = (steps: readonly ImageStep[]): boolean =>
  steps
    .flatMap((step) => gatesUnder(step.run ?? ""))
    .some((gate) => RUNS_AN_IMAGES_SCRIPT.test(rootScripts()[gate] ?? ""));

const input = (step: ImageStep, name: string): string => {
  const value = step.with?.[name];
  return typeof value === "string" ? value : "";
};

const runs = (step: ImageStep): string => step.run ?? "";

const builds = (step: ImageStep): boolean =>
  (step.uses ?? "").startsWith("docker/build-push-action@");

const MAIN_REF = "refs/heads/main";

const MAIN_ONLY_EXPORT = new RegExp(
  `^\\$\\{\\{ github\\.ref == '${MAIN_REF}' && (?<export>.+) \\|\\| '' \\}\\}$`,
  "u",
);

const probeStepAt = (steps: readonly ImageStep[]): number =>
  steps.findIndex((step) => step.env?.[IMAGE_ID_VARIABLE] !== undefined);

describe("the job that probes every image it pushes", () => {
  it("probes every image it pushes", () => {
    const unprobed = matrixLegs()
      .filter((leg) => leg.probe === undefined)
      .map((leg) => leg.tier);

    expect(matrixLegs().length).toBeGreaterThan(2);
    expect(unprobed).toEqual([]);
  });

  it("gives the called check its own concurrency group", () => {
    expect(checkWorkflow().concurrency.group).not.toEqual(buildWorkflow().concurrency.group);
  });

  it("defers probes the caller ran or whose inputs are unchanged", () => {
    const check = checkWorkflow();
    const read = deferralsRead();
    const [first] = read;
    assert(first !== undefined, "no leg of check.yml reads IMAGE_PROBE_DEFERRED");
    const { input: given, answer } = first;

    expect(
      read.length,
      "more than one leg of check.yml reads IMAGE_PROBE_DEFERRED. The image suites run in one leg, so exactly one step reads it.",
    ).toBe(1);
    expect(check.on.workflow_call.inputs[given]?.["default"]).toBe(false);
    expect(buildWorkflow().jobs.check.with?.[given]).toBe(true);
    expect(check.jobs["lane"]?.outputs?.[answer]).toEqual("${{ steps.lane.outputs.images }}");
  });

  it("sets IMAGE_PROBE_DEFERRED on exactly the legs that run image suites", () => {
    const reading = trackedWorkspacesReadingTheDeferral();
    const wanted = checkLegs()
      .filter(([, steps]) => runsImageSuites(steps))
      .map(([job]) => job);

    expect(
      reading.size,
      "IMAGE_PROBE_DEFERRED is read outside apps/api and apps/worker, or one of them stopped reading it. Only those two workspaces read it. This suite also names the variable, but no leg runs it.",
    ).toBe(2);
    expect(
      legsCarryingTheDeferral(),
      "a leg runs an image suite without setting IMAGE_PROBE_DEFERRED, or sets it and runs no image suite. Set it on exactly the legs that run an image suite.",
    ).toEqual(wanted);
  });

  it("loads, then probes, then pushes", () => {
    const steps = imageJob().steps;
    const loadedAt = steps.findIndex((step) => input(step, "outputs").includes("type=docker"));
    const probedAt = probeStepAt(steps);
    const pushedAt = steps.findIndex((step) => runs(step).includes("docker push"));

    expect(loadedAt).toBeGreaterThanOrEqual(0);
    expect(probedAt).toBeGreaterThan(loadedAt);
    expect(pushedAt).toBeGreaterThan(probedAt);
  });

  it("builds each image once and pushes the bytes it probed", () => {
    const built = imageJob().steps.filter(builds);
    const [build] = built;
    assert(build !== undefined, "the image job has no docker/build-push-action step");

    expect(
      built.length,
      "the image job builds its image more than once. A second build can rerun a step and push bytes the probe never read, so build once.",
    ).toBe(1);
    expect(input(build, "outputs")).toContain("type=docker");
  });

  it("writes the layer cache only on a run of main", () => {
    const [build] = imageJob().steps.filter(builds);
    assert(build !== undefined, "the image job has no docker/build-push-action step");

    const exported = MAIN_ONLY_EXPORT.exec(input(build, "cache-to"))?.groups?.["export"];

    expect(
      exported,
      `the cache-to export is not guarded by ${MAIN_REF}. Without the guard, a branch or dispatch run moves the cache tag that main reads and ships.`,
    ).toBeDefined();
    expect(
      exported,
      "a run on main does not export to :buildcache. Export it so the layer cache stays current.",
    ).toContain(":buildcache");
  });
});
