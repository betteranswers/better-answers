import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parse } from "yaml";
import { z } from "zod";

const run = promisify(execFile);

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const dockerIsAvailable = async (): Promise<boolean> => {
  try {
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
};

const dockerAnswers = await dockerIsAvailable();

const daemonIsRequired = (process.env["CI"] ?? "") !== "";

export const IMAGE_ID_VARIABLE = "IMAGE_ID";

export const PROBE_DEFERRAL_VARIABLE = "IMAGE_PROBE_DEFERRED";
const probeRunsInTheJobThatPushes = process.env[PROBE_DEFERRAL_VARIABLE] === "true";

export const nothingToProbeHere =
  probeRunsInTheJobThatPushes || (!dockerAnswers && !daemonIsRequired);

export interface ImageUnderTest {
  readonly tier: string;
  readonly dockerfile: string;
  readonly context: string;
}

export interface ContainerRun {
  readonly command: readonly string[];

  readonly environment?: Readonly<Record<string, string>>;
}

const BUILD_ALLOWANCE = 900_000;

const CONTAINER_ALLOWANCE = 120_000;

export const IMAGE_PROBE_ALLOWANCE = BUILD_ALLOWANCE + CONTAINER_ALLOWANCE;

const SHARED_CACHE_TOKEN = "ACTIONS_RUNTIME_TOKEN";
const SHARED_CACHE_URLS = ["ACTIONS_RESULTS_URL", "ACTIONS_CACHE_URL"] as const;

const DRIVER_WITHOUT_AN_EXPORT = "docker";

const INSPECT_ALLOWANCE = 60_000;

type BuildEnvironment = Readonly<Record<string, string | undefined>>;

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

export const sharedCacheBuilder = async (
  environment: BuildEnvironment,
  inspectTheBuilder: () => Promise<string | undefined>,
): Promise<string | undefined> => {
  if ((environment[SHARED_CACHE_TOKEN] ?? "").trim() === "") return undefined;
  if (!SHARED_CACHE_URLS.some((name) => (environment[name] ?? "").trim() !== "")) return undefined;
  const inspected = await inspectTheBuilder();
  return inspected === undefined ? undefined : builderThatCanExport(inspected);
};

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
    "--load",
    "--iidfile",
    choice.iidfile,
    "--file",
    image.dockerfile,
    image.context,
  ];
};

const inspectTheCurrentBuilder = async (): Promise<string | undefined> => {
  try {
    const { stdout } = await run("docker", ["buildx", "inspect"], { timeout: INSPECT_ALLOWANCE });
    return stdout;
  } catch {
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
    if (builtHere !== undefined) {
      await run("docker", ["rmi", "--force", builtHere], { timeout: CONTAINER_ALLOWANCE }).catch(
        () => undefined,
      );
    }
  }
};

export const workflowStepSchema = z.object({
  id: z.string().optional(),
  if: z.string().optional(),

  "continue-on-error": z.union([z.boolean(), z.string()]).optional(),

  uses: z.string().optional(),
  run: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});

export type ImageStep = z.infer<typeof workflowStepSchema>;

const matrixLegSchema = z.object({
  tier: z.string(),
  context: z.string(),
  dockerfile: z.string(),
  probe: z.string().optional(),
  "probe-toolchain": z.string().optional(),
});

export type MatrixLeg = z.infer<typeof matrixLegSchema>;

const permissionsSchema = z.record(z.string(), z.string());

const imageJobSchema = z.object({
  permissions: permissionsSchema.optional(),
  strategy: z.object({ matrix: z.object({ include: z.array(matrixLegSchema) }) }),
  steps: z.array(workflowStepSchema),
});

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

let parsed: z.infer<typeof buildWorkflowSchema> | undefined;

export const buildWorkflow = (): z.infer<typeof buildWorkflowSchema> =>
  (parsed ??= readWorkflow("build.yml", buildWorkflowSchema));
export const imageJob = () => buildWorkflow().jobs.image;
export const matrixLegs = (): readonly MatrixLeg[] => imageJob().strategy.matrix.include;

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

export const fileFromTheWorkspace = (moduleUrl: string, workspace: string): string =>
  path.relative(path.join(repositoryRoot, workspace), fileURLToPath(moduleUrl));
