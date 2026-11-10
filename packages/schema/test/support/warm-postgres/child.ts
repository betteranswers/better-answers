import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import { rootsOf } from "@better-answers/schema/testing/roots";

import type { WarmPostgres } from "../warm-postgres.ts";

const { workspaceRoot } = rootsOf(import.meta.url);

export const run = promisify(execFile);

export const warmPostgresModule = fileURLToPath(new URL("../warm-postgres.ts", import.meta.url));

const startedInChildSchema = z.object({
  connectionUri: z.string().exactOptional(),
  templateDatabase: z.string().exactOptional(),
  runId: z.number().exactOptional(),
  source: z.union([z.literal("shared"), z.literal("container")]).exactOptional(),
  failure: z.string().exactOptional(),
});

type StartedInChild = Partial<WarmPostgres> & { readonly failure?: string };

const START_IN_CHILD = [
  `import startWarmPostgres from ${JSON.stringify(warmPostgresModule)};`,
  "const provided = {};",
  "try {",
  "  const teardown = await startWarmPostgres({ provide: (key, value) => { provided[key] = value; } });",
  "  await teardown();",
  "  process.stdout.write(JSON.stringify(provided.warmPostgres));",
  "} catch (error) {",
  "  process.stdout.write(JSON.stringify({ failure: error.message }));",
  "}",
].join("\n");

export const startInChild = async (
  locator: string,
  env: Readonly<Record<string, string>> = {},
): Promise<StartedInChild> => {
  const child = await run(process.execPath, ["--input-type=module", "--eval", START_IN_CHILD], {
    cwd: workspaceRoot,
    env: { ...process.env, TEST_POSTGRES_URI: locator, ...env },
  });
  return startedInChildSchema.parse(JSON.parse(child.stdout));
};

export const pointsTheWayUp = (started: StartedInChild) => ({
  oneLine: started.failure !== undefined && !started.failure.includes("\n"),
  namesTheLocator: started.failure?.includes("TEST_POSTGRES_URI"),
  namesTheUpCommand: started.failure?.includes("deploy/test-postgres.sh up"),
});

export const POINTS_THE_WAY_UP = { oneLine: true, namesTheLocator: true, namesTheUpCommand: true };
