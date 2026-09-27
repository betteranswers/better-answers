import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { repositoryRoot } from "./paths.ts";

export const workflowStepSchema = z.object({
  id: z.string().optional(),
  if: z.string().optional(),
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

const imageJobSchema = z.object({
  strategy: z.object({ matrix: z.object({ include: z.array(matrixLegSchema) }) }),
  steps: z.array(workflowStepSchema),
});

export const readWorkflow = <Shape>(name: string, schema: z.ZodType<Shape>): Shape =>
  schema.parse(parse(readFileSync(path.join(repositoryRoot, ".github/workflows", name), "utf8")));

const buildWorkflowSchema = z.object({
  concurrency: z.object({ group: z.string() }),
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

/** @throws when build.yml's image job builds no leg for the tier. */
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
