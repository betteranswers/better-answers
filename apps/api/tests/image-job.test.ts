/**
 * The mechanism `build.yml`'s image job runs every leg under, read off the workflow
 * (T-043, T-084).
 *
 * The job that pushes carries the mechanism: a matrix leg with a `probe` command is built
 * into the runner's daemon, probed by that command against the id the load printed, and
 * pushed only after the probe passes. A leg declares what its probe needs to run under —
 * `probe-toolchain` — and the job installs that toolchain and no other, so a fourth image
 * joins by carrying two matrix fields rather than by a rewrite.
 *
 * These assertions run everywhere, daemon or no daemon, because what they guard fails at
 * the one moment nobody is watching: a push to `main`, where a leg either probes the bytes
 * it ships or quietly ships bytes nothing read.
 *
 * It is a file of its own rather than the back half of `image.test.ts` because it changes
 * for a different reason: that file changes when the api image does, and this one when the
 * job changes — which is now a thing the worker's or the backup's leg can do. Each leg's
 * own "the workflow names my file" assertion stays with the file being named.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildWorkflow,
  IMAGE_ID_VARIABLE,
  imageJob,
  type ImageStep,
  matrixLegs,
  PROBE_DEFERRAL_VARIABLE,
  readWorkflow,
  workflowStepSchema,
} from "./image-probe.ts";

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

describe("the job that probes every image it pushes", () => {
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
