import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { gatesUnder, rootScripts, workspacesChecked } from "@better-answers/devtools/root-commands";
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

/** This suite spells the variable too, and reads it in no leg. */
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

/** A value read some other way comes back whole, so the mismatch names it. */
const deferralsRead = (): readonly DeferralRead[] =>
  checkLegs()
    .flatMap(([, steps]) => steps)
    .flatMap((step) => step.env?.[PROBE_DEFERRAL_VARIABLE] ?? [])
    .map((value) => {
      const groups = DEFERRAL.exec(value)?.groups;
      return { input: groups?.["input"] ?? value, answer: groups?.["answer"] ?? value };
    });

/** Tracked files only, which is what a leg would have checked out. */
const workspacesReadingTheDeferral = (): ReadonlySet<string> => {
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

const workspacesUnder = (steps: readonly ImageStep[]): readonly string[] =>
  steps.flatMap((step) =>
    gatesUnder(step.run ?? "").flatMap((gate) => workspacesChecked(rootScripts()[gate] ?? "")),
  );

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
    const { input, answer } = read[0] ?? { input: "", answer: "" };

    expect(read.length).toBeGreaterThan(1);
    expect(
      read,
      "a leg reads the deferral another way, so the caller's input no longer wins or a changed input no longer probes",
    ).toEqual(read.map(() => ({ input, answer })));
    expect(check.on.workflow_call.inputs[input]?.["default"]).toBe(false);
    expect(buildWorkflow().jobs.check.with?.[input]).toBe(true);
    expect(check.jobs["lane"]?.outputs?.[answer]).toEqual("${{ steps.lane.outputs.images }}");
  });

  it("hands the deferral to exactly the legs reading it", () => {
    const reading = workspacesReadingTheDeferral();
    const wanted = checkLegs().flatMap(([job, steps]) =>
      workspacesUnder(steps).some((workspace) => reading.has(workspace)) ? [job] : [],
    );

    expect(reading.size, "the workspaces that read the deferral are apps/api and apps/worker").toBe(
      2,
    );
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
