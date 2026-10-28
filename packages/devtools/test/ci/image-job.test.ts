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

  it("gives the called check a group apart from its caller's", () => {
    expect(checkWorkflow().concurrency.group).not.toEqual(buildWorkflow().concurrency.group);
  });

  it("defers probes the caller ran, or whose inputs are unchanged", () => {
    const check = checkWorkflow();
    const read = deferralsRead();
    const [first] = read;
    assert(first !== undefined, "a leg reads the deferral");
    const { input: given, answer } = first;

    expect(read.length, "the image suites run in one leg, which reads the deferral once").toBe(1);
    expect(check.on.workflow_call.inputs[given]?.["default"]).toBe(false);
    expect(buildWorkflow().jobs.check.with?.[given]).toBe(true);
    expect(check.jobs["lane"]?.outputs?.[answer]).toEqual("${{ steps.lane.outputs.images }}");
  });

  it("hands the deferral to exactly the legs reading it", () => {
    const reading = trackedWorkspacesReadingTheDeferral();
    const wanted = checkLegs()
      .filter(([, steps]) => runsImageSuites(steps))
      .map(([job]) => job);

    expect(
      reading.size,
      "the workspaces that read the deferral are apps/api and apps/worker; this suite spells the variable too, and reads it in no leg",
    ).toBe(2);
    expect(
      legsCarryingTheDeferral(),
      "a leg runs an image-contents suite it never tells to stand down, or is told and runs none",
    ).toEqual(wanted);
  });

  it("loads, then probes, then pushes", () => {
    const steps = imageJob().steps;
    const loadedAt = steps.findIndex((step) => input(step, "outputs").includes("type=docker"));
    const probedAt = probeStepAt(steps);
    const pushedAt = steps.findIndex((step) => input(step, "outputs").includes("push=true"));

    expect(loadedAt).toBeGreaterThanOrEqual(0);
    expect(probedAt).toBeGreaterThan(loadedAt);
    expect(pushedAt).toBeGreaterThan(probedAt);
  });
});
