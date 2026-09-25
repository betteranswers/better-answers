import { spawnSync } from "node:child_process";

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
  repositoryRoot,
  workflowStepSchema,
} from "./image-probe.ts";
import { gatesUnder, rootScripts, workspacesChecked } from "./workspaces.ts";

const checkWorkflowSchema = z.object({
  concurrency: z.object({ group: z.string() }),
  on: z.object({
    workflow_call: z.object({
      inputs: z.record(z.string(), z.record(z.string(), z.unknown())),
    }),
  }),
  jobs: z.record(z.string(), z.object({ steps: z.array(workflowStepSchema).optional() })),
});

const checkWorkflow = () => readWorkflow("check.yml", checkWorkflowSchema);

const checkLegs = (): readonly (readonly [string, readonly ImageStep[]])[] =>
  Object.entries(checkWorkflow().jobs).map(([job, leg]) => [job, leg.steps ?? []] as const);

const deferralAt = (steps: readonly ImageStep[]): number =>
  steps.findIndex((step) => step.env?.[PROBE_DEFERRAL_VARIABLE] !== undefined);

const legsCarryingTheDeferral = (): readonly string[] =>
  checkLegs().flatMap(([job, steps]) => (deferralAt(steps) === -1 ? [] : [job]));

/** Tracked files only, which is what a leg would have checked out. */
const workspacesReadingTheDeferral = (): ReadonlySet<string> => {
  const found = spawnSync(
    "git",
    ["grep", "-l", "-F", PROBE_DEFERRAL_VARIABLE, "--", "apps", "packages"],
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

const runs = (step: ImageStep | undefined, action: string): boolean =>
  (step?.uses ?? "").startsWith(`${action}@`);

const stepUsing = (action: string): ImageStep | undefined =>
  imageJob().steps.find((step) => runs(step, action));

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

  it("installs each probe's toolchain without deciding by tier", () => {
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

  it("installs only the workspace a node probe runs in", () => {
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

  it("hands every probe the loaded build's id under one name", () => {
    const steps = imageJob().steps;
    const probed = steps[probeStepAt(steps)];

    expect(probed?.env?.["PROBE"]).toEqual("${{ matrix.probe }}");
    expect(probed?.run).toContain("${PROBE}");
    expect(probed?.run).toContain(`-z "\${${IMAGE_ID_VARIABLE}}"`);
    expect(probed?.run).toContain("exit 1");
    expect(probed?.env?.[IMAGE_ID_VARIABLE]).toContain("outputs.imageid");
  });

  it("exports the probed and pushed builds on the same terms", () => {
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

  it("attests the pushed digest beside the image, never around it", () => {
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

  it("caches each leg's layers under a scope of its own", () => {
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

  it("writes packages from its job alone, keeping no git credential", () => {
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

  it("gives each commit's build its own group and tag", () => {
    const meta = stepUsing("docker/metadata-action");
    const tags = (meta === undefined ? "" : input(meta, "tags"))
      .split("\n")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");

    expect(buildWorkflow().concurrency.group).toEqual("build-${{ github.sha }}");
    expect(tags).toEqual(["type=sha,prefix=sha-"]);
  });

  it("keeps each build's `check` apart from other commits' runs", () => {
    const group = checkWorkflow().concurrency.group;

    expect(group).toEqual(
      "check-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
    );
    expect(group).not.toEqual(buildWorkflow().concurrency.group);
  });

  it("defers the probes only when `check.yml`'s caller probes the images", () => {
    const check = checkWorkflow();
    const named = new Set(
      checkLegs()
        .flatMap(([, steps]) => steps)
        .flatMap(
          (step) =>
            /^\$\{\{\s*inputs\.([\w-]+)\s*\}\}$/.exec(
              step.env?.[PROBE_DEFERRAL_VARIABLE] ?? "",
            )?.[1] ?? [],
        ),
    );
    const [only] = named;

    expect(named.size, "the legs read the deferral out of two different inputs").toBe(1);
    expect(check.on.workflow_call.inputs[only ?? ""]?.["default"]).toBe(false);
    expect(buildWorkflow().jobs.check.with?.[only ?? ""]).toBe(true);
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

  it("readies a builder and the cache credentials before building images", () => {
    const building = checkLegs().filter(([job]) => legsCarryingTheDeferral().includes(job));

    expect(
      building.length,
      "the legs of check.yml that build an image are the full lane's api and worker, and the affected lane's two",
    ).toBe(4);
    for (const [job, steps] of building) {
      const at = (action: string): number => steps.findIndex((step) => runs(step, action));

      expect(
        at("docker/setup-buildx-action"),
        `${job} builds cold: no container builder`,
      ).toBeGreaterThan(-1);
      expect(
        at("crazy-max/ghaction-github-runtime"),
        `${job} builds cold: a run: step cannot reach the cache without the runtime variables`,
      ).toBeGreaterThan(-1);
      expect(deferralAt(steps)).toBeGreaterThan(at("docker/setup-buildx-action"));
      expect(deferralAt(steps)).toBeGreaterThan(at("crazy-max/ghaction-github-runtime"));
    }
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
