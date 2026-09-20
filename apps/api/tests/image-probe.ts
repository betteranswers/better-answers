import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parse } from "yaml";
import { z } from "zod";

/**
 * What every image contents test in this repository shares: the rule about the Docker
 * daemon, the one name an image id arrives under, and the reading of `build.yml`'s image
 * job.
 *
 * `build.yml` pushes three images and each is now read before it ships (`T-084`), so this
 * apparatus is a module rather than a shape three files repeat. The daemon rule in
 * particular has to be one statement: a copy of it is a second rule that ages alone, and
 * the direction it ages in is a probe that skips on CI while reporting green.
 *
 * A test that uses this holds the facts about its own image and nothing else. What lives
 * here is the part that must be identical across all three, or `check` stops meaning one
 * thing about the images it governs.
 *
 * **This module imports nothing from `apps/api/src`, and that is a constraint rather than
 * a style.** An image probe reads workflows and Dockerfiles as text and drives the image
 * through a subprocess, so it executes no source and covers no mutant. Stryker builds a
 * static mutant's test filter from the tests it knows cover something, so a probe outside
 * that set never re-runs per mutant; `apps/api` had 496 static mutants on the run of
 * 07/09/2026 (`T-009`, confirmed on run 34165612985), and an import from `src/` here — at
 * module scope is enough — would put every one of them through a `docker build`.
 */

const run = promisify(execFile);

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const dockerIsAvailable = async (): Promise<boolean> => {
  try {
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 20_000 });
    return true;
  } catch {
    // Every way of not having a daemon arrives here as one rejection — no binary, no
    // socket, a daemon still starting — and the difference between them changes nothing
    // downstream: the next question is whether `CI` is set, not which of the three it was.
    return false;
  }
};

const dockerAnswers = await dockerIsAvailable();
// A laptop without Docker still runs `check`; CI does not get that latitude. `build.yml`
// gates every push on this workflow, so a CI job that quietly skipped an image's contents
// tests would leave that image ungoverned while reporting green — the one outcome the gate
// exists to prevent. Skipped off CI, failed on it, and never silent on either.
const daemonIsRequired = (process.env["CI"] ?? "") !== "";

/**
 * The name an image id arrives under. It is read here and asserted against `build.yml` by
 * `image.test.ts`, because the two halves are one agreement: an id passed under a name no
 * probe reads would leave every probe building its own image and calling that the shipped
 * one. One name for all three legs is what makes the workflow's probe step generic.
 */
export const IMAGE_ID_VARIABLE = "IMAGE_ID";

/**
 * Set by `check.yml` when the workflow calling it has a job that pushes these images, and
 * by nothing else. That job loads each build and runs that image's contents test against
 * it, so probing here as well would build every image a second time on a second runner to
 * learn what the first already knows. A pull request has no such job, passes nothing, and
 * probes.
 *
 * Exactly `"true"` and nothing looser: a value nobody meant to set leaves the probes
 * running, which is the direction a mistake here has to fail in.
 */
export const PROBE_DEFERRAL_VARIABLE = "IMAGE_PROBE_DEFERRED";
const probeRunsInTheJobThatPushes = process.env[PROBE_DEFERRAL_VARIABLE] === "true";

/**
 * Two reasons to stand down and no third: the run's own pushing job is doing this, or no
 * daemon answered on a machine that is allowed none. A missing daemon on CI is a failure
 * rather than a skip, which is `daemonIsRequired` above and the throw in `readTheImage`.
 */
export const nothingToProbeHere =
  probeRunsInTheJobThatPushes || (!dockerAnswers && !daemonIsRequired);

/** Which image to read, in the terms `build.yml`'s matrix carries for it. */
export interface ImageUnderTest {
  /**
   * The leg's own name, which is also the name its layer cache is kept under. One leg
   * builds one image, so a scope named for the leg cannot fall out of step with what is in
   * it.
   */
  readonly tier: string;
  readonly dockerfile: string;
  readonly context: string;
}

/** The one container a probe starts, and what it is given to read the image with. */
export interface ContainerRun {
  readonly command: readonly string[];
  /**
   * Passed by name rather than by value: `docker run --env NAME` takes the value out of
   * this process's environment, so a derived list never reaches another user's `ps`.
   */
  readonly environment?: Readonly<Record<string, string>>;
}

/** A cold build of the largest image here, with room for a base-image pull. */
const BUILD_ALLOWANCE = 900_000;
/** One container, started and read. */
const CONTAINER_ALLOWANCE = 120_000;

/**
 * What a probe's `beforeAll` needs: a build, a container and the removal of an untagged
 * image. Named here because it is the sum of the two above, and `apps/api`'s global
 * `hookTimeout` is a runaway guard for hooks that open a database — it cannot cover this
 * and a probe that leaned on it would be timed out by somebody else's budget.
 */
export const IMAGE_PROBE_ALLOWANCE = BUILD_ALLOWANCE + CONTAINER_ALLOWANCE;

/**
 * What the `type=gha` build cache reads its credentials out of. The token is the same one
 * on either version of that backend; the endpoint moved from the first name below to the
 * second when the Actions cache service went to v2, so both are read and either will do. A
 * runner hands these to an **action's** own process and to nothing else — which is why
 * `docker/build-push-action` needs nothing extra, a `docker buildx build` run from inside
 * this suite does, and `check.yml` copies them into the job's environment before `check`
 * runs (Docker, *GitHub Actions cache*, 13/09/2026). That the workflow still does so is
 * `image-job.test.ts`'s case, not this comment's word.
 */
const SHARED_CACHE_TOKEN = "ACTIONS_RUNTIME_TOKEN";
const SHARED_CACHE_URLS = ["ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL"] as const;

/**
 * The driver a plain daemon answers with, and the one driver that can export a cache
 * nowhere: it builds straight into the daemon's image store, so a runner's daemon handed
 * `--cache-to` stops with an error rather than ignoring the flag — `build.yml` carries the
 * message it stops with, which is why its own job creates a builder before it builds
 * anything. Every other driver, the container one that step creates above all, can.
 */
const DRIVER_WITHOUT_AN_EXPORT = "docker";

/** One question to the daemon about which builder it would use. */
const INSPECT_ALLOWANCE = 60_000;

/** What the environment a build is chosen from looks like, which is `process.env`'s shape. */
type BuildEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The builder `docker buildx inspect` described, if it can export a cache.
 *
 * `inspect` answers a block of `Name: value` lines for the builder and then a `Nodes:` block
 * that repeats several of those names for each node, so the first reading of a name is the
 * builder's own and the rest are a node's. Nothing here parses further than that: what this
 * has to decide is one thing, and a driver this repository has never seen is treated as able
 * rather than unable, since the only driver that cannot is the default one every machine
 * already has.
 */
export const builderThatCanExport = (inspected: string): string | undefined => {
  const read = new Map<string, string>();
  for (const line of inspected.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1 || line.startsWith(" ") || line.startsWith("\t")) continue;
    const name = line.slice(0, separator).trim();
    if (!read.has(name)) read.set(name, line.slice(separator + 1).trim());
  }
  const named = read.get("Name") ?? "";
  const driver = read.get("Driver") ?? "";
  if (named === "" || driver === "" || driver === DRIVER_WITHOUT_AN_EXPORT) return undefined;
  return named;
};

/**
 * The builder this machine may export a `type=gha` cache to, or nothing.
 *
 * Two questions in this order and both must answer. The credentials are asked for first
 * because they are what a laptop never has and because the answer costs nothing; only then
 * is the daemon asked which builder it would use. Either question coming back empty is the
 * plain build, because both ways of getting the cached arm wrong cost more than never
 * asking for it. With no credentials at all buildx drops both halves and builds uncached
 * without saying so — exit 0 and no cache step in the log, probed by hand on buildx
 * v0.36.1 against Docker 29.7.2 — so the flags would be a claim to a cache nothing wrote
 * to. With credentials it cannot use, the build stops outright: `failed to configure gha
 * cache exporter: token is malformed`, and a runner whose token this suite half-read is a
 * red run rather than a slow one. The daemon is a parameter so that the order can be proved
 * without one.
 */
export const sharedCacheBuilder = async (
  environment: BuildEnvironment,
  inspectTheBuilder: () => Promise<string | undefined>,
): Promise<string | undefined> => {
  if ((environment[SHARED_CACHE_TOKEN] ?? "").trim() === "") return undefined;
  if (!SHARED_CACHE_URLS.some((name) => (environment[name] ?? "").trim() !== "")) return undefined;
  const inspected = await inspectTheBuilder();
  return inspected === undefined ? undefined : builderThatCanExport(inspected);
};

/**
 * The argv that builds this image, with the shared cache or without it.
 *
 * A pure function of the two things that decide it, so that both commands can be read on any
 * machine and neither has to be run to be held. Five flags make the cached arm what it is:
 * the two halves of the cache, `mode=max` so every layer of a multi-stage build is exported
 * and not only the last stage's, `--load`, which the container driver needs before the image
 * is in the daemon at all — the probes start containers from what this returns — and a
 * `scope=` on both halves. The scope is the leg's name because the backend's default is
 * `buildkit` for everyone: one scope holds one manifest, so the two images this workspace
 * builds would each overwrite the other's export, and every run after them would read a
 * cache made for the other image and build cold — a clash no single run can show.
 *
 * `--quiet` is not asked of that arm because it is not the id's source there: buildx writes
 * the id to `--iidfile`, a file this run owns rather than a line to be picked out of a build
 * log.
 */
export const buildCommand = (
  image: ImageUnderTest,
  choice: { readonly builder: string | undefined; readonly iidfile: string },
): readonly [string, ...string[]] => {
  if (choice.builder === undefined) {
    return ["docker", "build", "--quiet", "--file", image.dockerfile, image.context];
  }
  return [
    "docker",
    "buildx",
    "build",
    "--builder",
    choice.builder,
    "--cache-from",
    `type=gha,scope=${image.tier}`,
    "--cache-to",
    `type=gha,mode=max,scope=${image.tier}`,
    "--load",
    "--iidfile",
    choice.iidfile,
    "--file",
    image.dockerfile,
    image.context,
  ];
};

/** What `docker buildx inspect` wrote about the builder this machine would use. */
const inspectTheCurrentBuilder = async (): Promise<string | undefined> => {
  try {
    const { stdout } = await run("docker", ["buildx", "inspect"], { timeout: INSPECT_ALLOWANCE });
    return stdout;
  } catch {
    // No buildx plugin, no daemon, or an inspect that ended non-zero: all three say the one
    // thing the caller asked — this machine has no builder it could export a cache from —
    // and the plain build follows from each, so the difference between them is not carried.
    return undefined;
  }
};

const buildTheImage = async (image: ImageUnderTest): Promise<string> => {
  const builder = await sharedCacheBuilder(process.env, inspectTheCurrentBuilder);
  const scratch = mkdtempSync(path.join(tmpdir(), "image-probe-"));
  const iidfile = path.join(scratch, "image-id");
  try {
    const [program, ...argv] = buildCommand(image, { builder, iidfile });
    const built = await run(program, argv, {
      cwd: repositoryRoot,
      timeout: BUILD_ALLOWANCE,
      maxBuffer: 64 * 1024 * 1024,
    });
    return builder === undefined ? built.stdout.trim() : readFileSync(iidfile, "utf8").trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

/**
 * The image, read through the one interface a deploy unit has on it: a container started
 * from it. Answers what that container wrote to stdout.
 *
 * **Two ways a probe runs.** Given no image id it builds the image and reads what it
 * built, which is what a laptop and a pull request do. Given one it reads that image and
 * builds nothing: `build.yml`'s image job loads its own build, hands the id here and
 * pushes only if the probe passes, so the artefact that ships is the artefact that was
 * read (`T-043`).
 *
 * The image is run by the id its build answered with — printed by `docker build --quiet`, or
 * written to the `--iidfile` a `buildx` build is given — and is never tagged. A tag is a name
 * on the daemon, and the daemon is shared: two worktrees running `check` at once would
 * overwrite each other's tag and one would read the other's image. The id cannot be taken
 * from under a probe. A supplied id is the same kind of thing — the id the workflow's own load
 * printed — for the same reason.
 */
export const readTheImage = async (
  image: ImageUnderTest,
  container: ContainerRun,
): Promise<string> => {
  if (!dockerAnswers) {
    throw new Error(
      "no Docker daemon answered, so the image cannot be read: on CI these tests fail rather than skip, because build.yml gates the image push on this workflow",
    );
  }
  const supplied = (process.env[IMAGE_ID_VARIABLE] ?? "").trim();
  // Only an image this call built is this call's to remove.
  const builtHere = supplied === "" ? await buildTheImage(image) : undefined;
  const environment = container.environment ?? {};
  try {
    const { stdout } = await run(
      "docker",
      [
        "run",
        "--rm",
        ...Object.keys(environment).flatMap((name) => ["--env", name]),
        builtHere ?? supplied,
        ...container.command,
      ],
      { timeout: CONTAINER_ALLOWANCE, env: { ...process.env, ...environment } },
    );
    return stdout;
  } finally {
    // An untagged image left behind is a dangling half-gigabyte on the machine for every
    // run whose source differed from the last. Failure to remove it is not a failure of
    // the suite: another run may hold the same id.
    if (builtHere !== undefined) {
      await run("docker", ["rmi", "--force", builtHere], { timeout: CONTAINER_ALLOWANCE }).catch(
        () => undefined,
      );
    }
  }
};

/** A workflow step, in the fields a probe's wiring is read out of. */
export const workflowStepSchema = z.object({
  if: z.string().optional(),
  /** The action a step runs, at the pin it runs — read by prefix, never by version. */
  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});

export type ImageStep = z.infer<typeof workflowStepSchema>;

/**
 * A leg of the image job's matrix. `probe` and `probe-toolchain` are optional in the shape
 * and paired in the assertions (`image.test.ts`): the mechanism is what a leg declares,
 * never a tier named in a step's condition, so a fourth image joins by carrying the two
 * fields rather than by a rewrite.
 */
const matrixLegSchema = z.object({
  tier: z.string(),
  context: z.string(),
  dockerfile: z.string(),
  probe: z.string().optional(),
  "probe-toolchain": z.string().optional(),
});

export type MatrixLeg = z.infer<typeof matrixLegSchema>;

/** A `permissions:` block, at whichever scope it was written: a scope and what it may do. */
const permissionsSchema = z.record(z.string(), z.string());

const imageJobSchema = z.object({
  permissions: permissionsSchema.optional(),
  strategy: z.object({ matrix: z.object({ include: z.array(matrixLegSchema) }) }),
  steps: z.array(workflowStepSchema),
});

/**
 * A workflow, parsed into the shape its reader asks for. The schema is the caller's
 * because what a workflow means is the caller's question: `build.yml`'s image job is read
 * here, and `check.yml`'s deferral input by the file that asserts against it.
 */
export const readWorkflow = <Shape>(name: string, schema: z.ZodType<Shape>): Shape =>
  schema.parse(parse(readFileSync(path.join(repositoryRoot, ".github/workflows", name), "utf8")));

const buildWorkflowSchema = z.object({
  concurrency: z.object({ group: z.string() }),
  permissions: permissionsSchema.optional(),
  jobs: z.object({
    check: z.object({ with: z.record(z.string(), z.unknown()).optional() }),
    image: imageJobSchema,
  }),
});

/**
 * Parsed once per process. The four readers below are four questions about one file, and
 * `build.yml` cannot change under a single `vitest` run; re-reading it per question made
 * `legFor`'s own failure message parse it a second time to say what the matrix does have.
 */
let parsed: z.infer<typeof buildWorkflowSchema> | undefined;

export const buildWorkflow = (): z.infer<typeof buildWorkflowSchema> =>
  (parsed ??= readWorkflow("build.yml", buildWorkflowSchema));
export const imageJob = () => buildWorkflow().jobs.image;
export const matrixLegs = (): readonly MatrixLeg[] => imageJob().strategy.matrix.include;

/** The leg that builds a tier's image, or a failure naming what the matrix does have. */
export const legFor = (tier: string): MatrixLeg => {
  const leg = matrixLegs().find((candidate) => candidate.tier === tier);
  if (leg === undefined) {
    const tiers = matrixLegs()
      .map((candidate) => candidate.tier)
      .join(", ");
    throw new Error(`build.yml's image job has no \`${tier}\` leg; it builds ${tiers}`);
  }
  return leg;
};

/**
 * Where a test file is, relative to the workspace whose runner its probe command names.
 * Derived rather than spelled: what the workflow must name is wherever the file actually
 * is, so the file cannot move without the workflow.
 */
export const fileFromTheWorkspace = (moduleUrl: string, workspace: string): string =>
  path.relative(path.join(repositoryRoot, workspace), fileURLToPath(moduleUrl));
