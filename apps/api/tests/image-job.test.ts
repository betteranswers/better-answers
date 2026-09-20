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
  concurrency: z.object({ group: z.string() }),
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

/** Whether a step runs an action — asked by the action's name and never by its pin. */
const runs = (step: ImageStep | undefined, action: string): boolean =>
  (step?.uses ?? "").startsWith(`${action}@`);

/** The image job's step that runs an action. */
const stepUsing = (action: string): ImageStep | undefined =>
  imageJob().steps.find((step) => runs(step, action));

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

  it("installs for a node probe the workspace it runs in, and nothing beside it", () => {
    // A leg runs one test file, and a whole-monorepo install to do it brought the web app
    // and the design system along on two legs of every run (`T-211`). The filter is a
    // literal in a step every node leg shares, so what is held is that it names the one
    // workspace every node probe names — a probe in another workspace fails here, where it
    // would otherwise fail on `main` with nothing installed. The trailing `...` is pnpm's
    // "and what it depends on", which is how `@better-answers/schema` still arrives.
    const install = imageJob().steps.find((step) => (step.run ?? "").startsWith("pnpm install"));
    const installed = /--filter (\S+?)\.\.\.(?:\s|$)/.exec(install?.run ?? "")?.[1];
    const probedIn = new Set(
      matrixLegs()
        .filter((leg) => leg["probe-toolchain"] === "node")
        .map((leg) => /--filter (\S+)/.exec(leg.probe ?? "")?.[1]),
    );

    expect(install?.run).toContain("--frozen-lockfile");
    // The name is written down once here, so moving the filter and the probes together to
    // a workspace that cannot run them is a change this case sees.
    expect(installed).toEqual("@better-answers/api");
    expect([...probedIn]).toEqual([installed]);
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

  it("attests the digest it pushed beside the image, never around it", () => {
    // A referrer keyed by the pushed digest, where the inline `provenance` both exports
    // refuse, above, would make the tag an index (`T-219`). The why of each term — last,
    // never swallowed, no storage record — is written beside the step in `build.yml`; what
    // is held here is that the subject is read off the two steps that made it: the name the
    // metadata step tagged, and the digest the push step reported.
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
    // A `type=gha` cache with no `scope=` is written under `buildkit` for everyone, and a
    // scope holds one manifest: three legs exporting `mode=max` to one scope overwrote each
    // other, and the worker leg built cold on 47% of runs (`T-211`, measured 20/09/2026).
    // The scope is the leg's own name out of the matrix — what both tiers' probes pass
    // too — so a bare `type=gha` on either half is refused here rather than measured later.
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
    // `packages: write` is the one token here worth stealing. It is the image job's alone —
    // the caller's narrowing, where it used to be `check.yml`'s own — and that job never
    // pushes git, so its checkout leaves nothing in `.git/config` for three Dockerfiles and
    // two suites to read (`T-211`). The attestation brought two more and they are the same
    // job's for the same reason: `id-token: write` mints the token a signing certificate is
    // asked for with, `attestations: write` stores what was signed, and `check` — which
    // runs the suites — is given neither (`T-219`).
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
    // A group holds one running and one pending run, and a third arrival cancels the
    // pending one: under `build-main` a burst of pushes built its first and its last, and 6
    // of 20 runs were cancelled seconds after they were created (`T-211`). With no group
    // serialising the runs, a tag every run writes ends on whichever finished last — so the
    // only tag is the commit's own, and `release.yml` resolves that one
    // (`deploy-tree.test.ts` holds its half).
    const meta = stepUsing("docker/metadata-action");
    const tags = (meta === undefined ? "" : input(meta, "tags"))
      .split("\n")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");

    expect(buildWorkflow().concurrency.group).toEqual("build-${{ github.sha }}");
    expect(tags).toEqual(["type=sha,prefix=sha-"]);
  });

  it("lets the `check` a commit's build calls neither wait on nor displace another commit's", () => {
    // `check.yml`'s group is evaluated in the caller's context and holds across runs
    // (`T-040`), so a per-commit group on `build.yml` alone moves the cancellation down a
    // level: three pushes inside one `check` and the second run's pending `check` is
    // displaced, taking the images it gates with it. A pull request keeps its ref, which is
    // what lets a newer push cancel the run it supersedes; and the group stays different
    // from the caller's, because a called workflow in its caller's group waits on itself.
    const group = checkWorkflow().concurrency.group;

    expect(group).toEqual(
      "check-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
    );
    expect(group).not.toEqual(buildWorkflow().concurrency.group);
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

  it("gives the job that runs `check` a builder and the cache credentials first", () => {
    // Both image probes build through `docker buildx build` with a `type=gha` cache where
    // one is reachable, and neither half of "reachable" is this repository's to hand
    // itself: the container-driver builder comes from the first step below and the
    // `ACTIONS_*` variables from the second, which a runner gives an action's own process
    // and no `run:` step. Losing either is silent — every image goes back to a cold build
    // on every pull request while the run stays green — so the order is read here rather
    // than trusted to the comment beside each step.
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
