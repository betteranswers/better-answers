import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { repositoryRoot } from "@better-answers/devtools/paths";

const run = promisify(execFile);

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

const IMAGE_ID_VARIABLE = "IMAGE_ID";

const PROBE_DEFERRAL_VARIABLE = "IMAGE_PROBE_DEFERRED";
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

const OUTPUT_CEILING_BYTES = 64 * 1024 * 1024;

export const IMAGE_PROBE_ALLOWANCE = BUILD_ALLOWANCE + CONTAINER_ALLOWANCE;

const CACHE_REGISTRY_VARIABLE = "IMAGE_CACHE_REGISTRY";

const CACHE_TAG = "buildcache";

const DRIVER_WITHOUT_AN_EXPORT = "docker";

const INSPECT_ALLOWANCE = 60_000;

type BuildEnvironment = Readonly<Record<string, string | undefined>>;

/** An indented line belongs to one of the builder's nodes, not to the builder. */
const topLevelFieldsOf = (inspected: string): ReadonlyMap<string, string> => {
  const read = new Map<string, string>();
  for (const line of inspected.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1 || line.startsWith(" ") || line.startsWith("\t")) continue;
    const name = line.slice(0, separator).trim();
    if (!read.has(name)) read.set(name, line.slice(separator + 1).trim());
  }
  return read;
};

/** The builder `docker buildx inspect` names, or undefined unless it names one that can export. */
export const builderThatCanExport = (inspected: string): string | undefined => {
  const read = topLevelFieldsOf(inspected);
  const named = read.get("Name") ?? "";
  const driver = read.get("Driver") ?? "";
  if (named === "" || driver === "" || driver === DRIVER_WITHOUT_AN_EXPORT) return undefined;
  return named;
};

interface SharedCache {
  readonly builder: string;
  readonly registry: string;
}

/** Undefined, and the daemon never asked, unless the environment names the cache's registry. */
export const sharedCache = async (
  environment: BuildEnvironment,
  inspectTheBuilder: () => Promise<string | undefined>,
): Promise<SharedCache | undefined> => {
  const registry = (environment[CACHE_REGISTRY_VARIABLE] ?? "").trim();
  if (registry === "") return undefined;
  const inspected = await inspectTheBuilder();
  const builder = inspected === undefined ? undefined : builderThatCanExport(inspected);
  return builder === undefined ? undefined : { builder, registry };
};

/** Without a shared cache the plain build prints the image's id, and `iidfile` goes unused. */
export const buildCommand = (
  image: ImageUnderTest,
  choice: { readonly cache: SharedCache | undefined; readonly iidfile: string },
): readonly [string, ...string[]] => {
  if (choice.cache === undefined) {
    return ["docker", "build", "--quiet", "--file", image.dockerfile, image.context];
  }
  return [
    "docker",
    "buildx",
    "build",
    "--builder",
    choice.cache.builder,
    "--cache-from",
    `type=registry,ref=${choice.cache.registry}/${image.tier}:${CACHE_TAG}`,
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
  const cache = await sharedCache(process.env, inspectTheCurrentBuilder);
  const scratch = mkdtempSync(path.join(tmpdir(), "image-probe-"));
  const iidfile = path.join(scratch, "image-id");
  try {
    const [program, ...argv] = buildCommand(image, { cache, iidfile });
    const built = await run(program, argv, {
      cwd: repositoryRoot,
      timeout: BUILD_ALLOWANCE,
      maxBuffer: OUTPUT_CEILING_BYTES,
    });
    return cache === undefined ? built.stdout.trim() : readFileSync(iidfile, "utf8").trim();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

interface ImageToRun {
  readonly id: string;
  readonly builtHere: boolean;
}

const theImageToRun = async (image: ImageUnderTest): Promise<ImageToRun> => {
  if (!dockerAnswers) {
    throw new Error(
      "no Docker daemon answered, so the image cannot be read: on CI these tests fail rather than skip, because build.yml gates the image push on this workflow",
    );
  }
  const supplied = (process.env[IMAGE_ID_VARIABLE] ?? "").trim();
  if (supplied !== "") return { id: supplied, builtHere: false };
  return { id: await buildTheImage(image), builtHere: true };
};

const discardIfBuiltHere = async (image: ImageToRun): Promise<void> => {
  if (image.builtHere) {
    // An image left behind costs disk alone, and the next build reuses its layers.
    await run("docker", ["rmi", "--force", image.id], { timeout: CONTAINER_ALLOWANCE }).catch(
      () => undefined,
    );
  }
};

type Environment = Readonly<Record<string, string>>;

/**
 * Names on the command line and values through the client's environment, so no value is in the
 * argv a process listing shows.
 */
const docker = async (
  subcommand: "run" | "exec",
  argv: readonly string[],
  environment: Environment = {},
): Promise<string> => {
  const { stdout } = await run(
    "docker",
    [subcommand, ...Object.keys(environment).flatMap((name) => ["--env", name]), ...argv],
    {
      timeout: CONTAINER_ALLOWANCE,
      env: { ...process.env, ...environment },
      maxBuffer: OUTPUT_CEILING_BYTES,
    },
  );
  return stdout;
};

/**
 * Runs the image built here, or the one `IMAGE_ID` names; an image built here is removed after.
 * @throws when no Docker daemon answers.
 */
export const readTheImage = async (
  image: ImageUnderTest,
  container: ContainerRun,
): Promise<string> => {
  const toRun = await theImageToRun(image);
  try {
    return await docker("run", ["--rm", toRun.id, ...container.command], container.environment);
  } finally {
    await discardIfBuiltHere(toRun);
  }
};

export interface StartedContainer {
  readonly exec: (command: readonly string[], environment?: Environment) => Promise<string>;
  readonly logs: () => Promise<string>;
  readonly stop: () => Promise<void>;
}

/** As `readTheImage`, detached; `stop` removes the container, and the image when built here. */
export const startTheImage = async (
  image: ImageUnderTest,
  environment: Environment,
): Promise<StartedContainer> => {
  const toRun = await theImageToRun(image);
  const started = await docker("run", ["--detach", toRun.id], environment).catch(
    async (error: unknown) => {
      await discardIfBuiltHere(toRun);
      throw error;
    },
  );
  const container = started.trim();
  return {
    exec: (command, execEnvironment) => docker("exec", [container, ...command], execEnvironment),
    logs: async () => {
      const { stdout, stderr } = await run("docker", ["logs", container], {
        timeout: CONTAINER_ALLOWANCE,
        maxBuffer: OUTPUT_CEILING_BYTES,
      });
      return stdout + stderr;
    },
    stop: async () => {
      try {
        await run("docker", ["rm", "--force", container], { timeout: CONTAINER_ALLOWANCE });
      } finally {
        await discardIfBuiltHere(toRun);
      }
    },
  };
};

export const fileFromTheWorkspace = (moduleUrl: string, workspace: string): string =>
  path.relative(path.join(repositoryRoot, workspace), fileURLToPath(moduleUrl));
