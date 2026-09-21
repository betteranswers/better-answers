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
  concurrency: z.object({ group: z.string() }),
  on: z.object({
    workflow_call: z.object({
      inputs: z.record(z.string(), z.record(z.string(), z.unknown())),
    }),
  }),
  jobs: z.object({ check: z.object({ steps: z.array(workflowStepSchema) }) }),
});

const checkWorkflow = () => readWorkflow("check.yml", checkWorkflowSchema);

const input = (step: ImageStep, name: string): string => {
  const value = step.with?.[name];
  return typeof value === "string" ? value : "";
};

const runs = (step: ImageStep | undefined, action: string): boolean =>
  (step?.uses ?? "").startsWith(`${action}@`);

const stepUsing = (action: string): ImageStep | undefined =>
  imageJob().steps.find((step) => runs(step, action));

const probeStepAt = (steps: readonly ImageStep[]): number =>
  steps.findIndex((step) => step.env?.[IMAGE_ID_VARIABLE] !== undefined);

describe("the job that probes every image it pushes", () => {
  it("reads every image it pushes, so no leg ships bytes nothing looked at", () => {
    const unprobed = matrixLegs()
      .filter((leg) => leg.probe === undefined)
      .map((leg) => leg.tier);

    expect(matrixLegs().length).toBeGreaterThan(2);
    expect(unprobed).toEqual([]);
  });

  it("installs the toolchain each probe needs, and names no tier to decide it", () => {
    const steps = imageJob().steps;

    const installed = new Set(
      steps.flatMap(
        (step) => /matrix\.probe-toolchain == '([\w-]+)'/.exec(step.if ?? "")?.[1] ?? [],
      ),
    );

    const unserved = matrixLegs().flatMap((leg) => {
      const toolchain = leg["probe-toolchain"];
      if (leg.probe === undefined) return toolchain === undefined ? [] : [`${leg.tier}: no probe`];
      if (toolchain === undefined) return [`${leg.tier}: no toolchain`];
      return installed.has(toolchain) ? [] : [`${leg.tier}: ${toolchain} is never installed`];
    });

    expect(installed.size).toBeGreaterThan(1);
    expect(unserved).toEqual([]);

    expect(steps.filter((step) => (step.if ?? "").includes("matrix.tier"))).toEqual([]);
  });

  it("installs for a node probe the workspace it runs in, and nothing beside it", () => {
    const install = imageJob().steps.find((step) => (step.run ?? "").startsWith("pnpm install"));
    const installed = /--filter (\S+?)\.\.\.(?:\s|$)/.exec(install?.run ?? "")?.[1];
    const probedIn = new Set(
      matrixLegs()
        .filter((leg) => leg["probe-toolchain"] === "node")
        .map((leg) => /--filter (\S+)/.exec(leg.probe ?? "")?.[1]),
    );

    expect(install?.run).toContain("--frozen-lockfile");

    expect(installed).toEqual("@better-answers/api");
    expect([...probedIn]).toEqual([installed]);
  });

  it("hands every probe the id of the build it loaded, under the name every probe reads", () => {
    const steps = imageJob().steps;
    const probed = steps[probeStepAt(steps)];

    expect(probed?.env?.["PROBE"]).toEqual("${{ matrix.probe }}");
    expect(probed?.run).toContain("${PROBE}");
    expect(probed?.run).toContain(`-z "\${${IMAGE_ID_VARIABLE}}"`);
    expect(probed?.run).toContain("exit 1");
    expect(probed?.env?.[IMAGE_ID_VARIABLE]).toContain("outputs.imageid");
  });

  it("exports the build twice on the same terms, so the digest probed is the digest pushed", () => {
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

  it("attests the digest it pushed beside the image, never around it", () => {
    const steps = imageJob().steps;
    const pushed = steps.find((step) => input(step, "outputs").includes("push=true"));
    const attested = steps.at(-1);
    const meta = stepUsing("docker/metadata-action");

    expect(runs(attested, "actions/attest-build-provenance")).toBe(true);
    expect(pushed?.id).toEqual("build");
    expect(meta === undefined ? "" : input(meta, "images")).toEqual(
      "ghcr.io/${{ github.repository_owner }}/${{ matrix.tier }}",
    );
    expect(attested?.with).toEqual({
      "subject-name": "ghcr.io/${{ github.repository_owner }}/${{ matrix.tier }}",
      "subject-digest": "${{ steps.build.outputs.digest }}",
      "push-to-registry": true,
      "create-storage-record": false,
    });
    expect(attested?.["continue-on-error"]).toBeUndefined();
    expect(attested?.if).toBeUndefined();
  });

  it("keeps each leg's layers under a scope of its own, so no leg evicts another", () => {
    const halves = imageJob().steps.flatMap((step) =>
      ["cache-from", "cache-to"].flatMap((name) => {
        const value = input(step, name);
        return value === "" ? [] : [{ name, value }];
      }),
    );
    const unscoped = halves.filter(
      (half) => !half.value.split(",").includes("scope=${{ matrix.tier }}"),
    );

    expect(halves.map((half) => half.name)).toContain("cache-to");
    expect(halves.length).toBeGreaterThan(2);
    expect(unscoped).toEqual([]);
  });

  it("gives the registry token to the job that pushes, and leaves no git credential beside it", () => {
    const checkout = stepUsing("actions/checkout");

    expect(buildWorkflow().permissions).toEqual({ contents: "read" });
    expect(imageJob().permissions).toEqual({
      contents: "read",
      packages: "write",
      attestations: "write",
      "id-token": "write",
    });
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("builds every commit in a group of its own, under the one tag no other run writes", () => {
    const meta = stepUsing("docker/metadata-action");
    const tags = (meta === undefined ? "" : input(meta, "tags"))
      .split("\n")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");

    expect(buildWorkflow().concurrency.group).toEqual("build-${{ github.sha }}");
    expect(tags).toEqual(["type=sha,prefix=sha-"]);
  });

  it("lets the `check` a commit's build calls neither wait on nor displace another commit's", () => {
    const group = checkWorkflow().concurrency.group;

    expect(group).toEqual(
      "check-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
    );
    expect(group).not.toEqual(buildWorkflow().concurrency.group);
  });

  it("stands the probes down only where the caller of `check.yml` probes the images itself", () => {
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

  it("gives the job that runs `check` a builder and the cache credentials first", () => {
    const steps = checkWorkflow().jobs.check.steps;
    const at = (action: string): number => steps.findIndex((step) => runs(step, action));
    const builderAt = at("docker/setup-buildx-action");
    const credentialsAt = at("crazy-max/ghaction-github-runtime");
    const checkedAt = steps.findIndex((step) => (step.run ?? "").includes("pnpm check"));

    expect(checkedAt).toBeGreaterThan(-1);
    expect(builderAt).toBeGreaterThan(-1);
    expect(credentialsAt).toBeGreaterThan(-1);
    expect(checkedAt).toBeGreaterThan(builderAt);
    expect(checkedAt).toBeGreaterThan(credentialsAt);
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
