import { z } from "zod";

import { CONTRACT_DIGEST_PATTERN } from "../contract-digest.ts";
import { workspace } from "../people/workspace-table.ts";
import {
  INGRESS_SCOPES,
  ingressCounter,
  invitationEmailCounter,
  mcpCallCounter,
} from "../platform/counter-tables.ts";
import { job, JOB_KINDS, JOB_REASONS, JOB_STATUSES } from "../platform/job-tables.ts";
import {
  CALENDAR_DAY,
  DECIMAL_STRING,
  DECISION_THRESHOLD,
  decisionThreshold,
  LLM_CALL_OUTCOMES,
  llmCall,
  MODEL_NAME,
  MODEL_PROVIDERS,
  modelKey,
  modelPrice,
  spendReservation,
} from "../platform/llm-tables.ts";
import {
  backup,
  BACKUP_KINDS,
  BACKUP_OUTCOMES,
  BACKUP_STORES,
  contractStamp,
  sweepPass,
  UPLOAD_SWEEP_MODES,
} from "../platform/platform-tables.ts";
import { modelChoice, workspaceConfig } from "../schema.ts";
import { ULID } from "../ulid.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { workspaceId } from "./shared.ts";

const workspaceRefinements = {
  id: workspaceId,
  name: (schema: z.ZodString) => schema.trim().min(1),
  shortName: (schema: z.ZodString) => schema.trim().min(1),
};

const workspaceSelect = createSelectSchema(workspace, workspaceRefinements);
const workspaceInsert = createInsertSchema(workspace, workspaceRefinements);
const workspaceUpdate = createUpdateSchema(workspace, workspaceRefinements);

const modelChoiceRefinements = {
  id: (schema: z.ZodString) => schema.trim().min(1),
  workspaceId,
  provider: (schema: z.ZodString) => schema.trim().min(1),
  model: (schema: z.ZodString) => schema.trim().min(1),
  dimensions: (schema: z.ZodNumber) => schema.int().positive(),

  retentionTail: (schema: z.ZodString) => schema.trim().min(1),
};

const modelChoiceSelect = createSelectSchema(modelChoice, modelChoiceRefinements);
const modelChoiceInsert = createInsertSchema(modelChoice, modelChoiceRefinements);
const modelChoiceUpdate = createUpdateSchema(modelChoice, modelChoiceRefinements);

/** The driver hands a `bytea` back as bytes, and a frame is written as bytes. */
const sealedFrame = z.instanceof(Uint8Array);

const modelKeyRefinements = {
  workspaceId,
  provider: (schema: z.ZodString) => schema.pipe(z.enum(MODEL_PROVIDERS)),
  sealed: sealedFrame,
};

const modelKeySelect = createSelectSchema(modelKey, modelKeyRefinements);
const modelKeyInsert = createInsertSchema(modelKey, modelKeyRefinements);
const modelKeyUpdate = createUpdateSchema(modelKey, {
  ...modelKeyRefinements,
  sealed: sealedFrame.optional(),
});

/** Money and rates are `numeric`, which the driver hands back as a string and never a float. */
const decimal = (schema: z.ZodString) => schema.regex(DECIMAL_STRING);

const tokenCount = (schema: z.ZodNumber) => schema.int().nonnegative();

const servedBy = {
  modelChoiceId: (schema: z.ZodString) => schema.trim().min(1),
  model: (schema: z.ZodString) => schema.trim().min(1),
  runId: (schema: z.ZodString) => schema.trim().min(1),
  answerId: (schema: z.ZodString) => schema.regex(ULID),
};

const llmCallRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  ...servedBy,
  tokensIn: tokenCount,
  tokensOut: tokenCount,
  seconds: (schema: z.ZodNumber) => schema.nonnegative(),
  costGbp: decimal,
  outcome: (schema: z.ZodString) => schema.pipe(z.enum(LLM_CALL_OUTCOMES)),
};

const llmCallSelect = createSelectSchema(llmCall, llmCallRefinements);
const llmCallInsert = createInsertSchema(llmCall, llmCallRefinements);
const llmCallUpdate = createUpdateSchema(llmCall, llmCallRefinements);

const spendReservationRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  ...servedBy,
  mostTokensIn: tokenCount,
  mostTokensOut: tokenCount,
  gbpPerMillionIn: decimal,
  gbpPerMillionOut: decimal,
  reservedGbp: decimal,
};

const spendReservationSelect = createSelectSchema(spendReservation, spendReservationRefinements);
const spendReservationInsert = createInsertSchema(spendReservation, spendReservationRefinements);
const spendReservationUpdate = createUpdateSchema(spendReservation, spendReservationRefinements);

const modelPriceRefinements = {
  provider: (schema: z.ZodString) => schema.pipe(z.enum(MODEL_PROVIDERS)),
  model: (schema: z.ZodString) => schema.regex(MODEL_NAME),
  effectiveFrom: (schema: z.ZodString) => schema.regex(CALENDAR_DAY),
  gbpPerMillionIn: decimal,
  gbpPerMillionOut: decimal,
};

const modelPriceSelect = createSelectSchema(modelPrice, modelPriceRefinements);
const modelPriceInsert = createInsertSchema(modelPrice, modelPriceRefinements);
const modelPriceUpdate = createUpdateSchema(modelPrice, modelPriceRefinements);

const decisionThresholdRefinements = {
  provider: (schema: z.ZodString) => schema.pipe(z.enum(MODEL_PROVIDERS)),
  model: (schema: z.ZodString) => schema.regex(MODEL_NAME),
  threshold: (schema: z.ZodNumber) => schema.pipe(DECISION_THRESHOLD),
};

const decisionThresholdSelect = createSelectSchema(decisionThreshold, decisionThresholdRefinements);
const decisionThresholdInsert = createInsertSchema(decisionThreshold, decisionThresholdRefinements);
const decisionThresholdUpdate = createUpdateSchema(decisionThreshold, decisionThresholdRefinements);

const workspaceConfigRefinements = {
  workspaceId,
  key: (schema: z.ZodString) => schema.trim().min(1),
};

const workspaceConfigSelect = createSelectSchema(workspaceConfig, workspaceConfigRefinements);
const workspaceConfigInsert = createInsertSchema(workspaceConfig, workspaceConfigRefinements);
const workspaceConfigUpdate = createUpdateSchema(workspaceConfig, workspaceConfigRefinements);

const mcpCallCounterRefinements = {
  workspaceId,
  tokenId: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

const mcpCallCounterSelect = createSelectSchema(mcpCallCounter, mcpCallCounterRefinements);
const mcpCallCounterInsert = createInsertSchema(mcpCallCounter, mcpCallCounterRefinements);
const mcpCallCounterUpdate = createUpdateSchema(mcpCallCounter, mcpCallCounterRefinements);

const invitationEmailCounterRefinements = {
  workspaceId,
  key: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

const invitationEmailCounterSelect = createSelectSchema(
  invitationEmailCounter,
  invitationEmailCounterRefinements,
);
const invitationEmailCounterInsert = createInsertSchema(
  invitationEmailCounter,
  invitationEmailCounterRefinements,
);
const invitationEmailCounterUpdate = createUpdateSchema(
  invitationEmailCounter,
  invitationEmailCounterRefinements,
);

const ingressCounterRefinements = {
  scope: (schema: z.ZodString) => schema.pipe(z.enum(INGRESS_SCOPES)),
  key: (schema: z.ZodString) => schema.trim().min(1),
  count: (schema: z.ZodNumber) => schema.int().nonnegative(),
};

const ingressCounterSelect = createSelectSchema(ingressCounter, ingressCounterRefinements);
const ingressCounterInsert = createInsertSchema(ingressCounter, ingressCounterRefinements);
const ingressCounterUpdate = createUpdateSchema(ingressCounter, ingressCounterRefinements);

const contractStampRefinements = {
  onlyRow: (schema: z.ZodBoolean) => schema.pipe(z.literal(true)),
  digest: (schema: z.ZodString) => schema.regex(CONTRACT_DIGEST_PATTERN),
};

const contractStampSelect = createSelectSchema(contractStamp, contractStampRefinements);
const contractStampInsert = createInsertSchema(contractStamp, contractStampRefinements);
const contractStampUpdate = createUpdateSchema(contractStamp, contractStampRefinements);

const aCount = (schema: z.ZodNumber) => schema.int().nonnegative();

const sweepPassRefinements = {
  id: (schema: z.ZodString) => schema.regex(ULID),
  uploadSweep: (schema: z.ZodString) => schema.pipe(z.enum(UPLOAD_SWEEP_MODES)),
  workspaces: aCount,
  refused: aCount,
  found: aCount,
  removed: aCount,
  generations: aCount,
};

const sweepPassSelect = createSelectSchema(sweepPass, sweepPassRefinements);
const sweepPassInsert = createInsertSchema(sweepPass, sweepPassRefinements);
const sweepPassUpdate = createUpdateSchema(sweepPass, sweepPassRefinements);

const backupRefinements = {
  kind: (schema: z.ZodString) => schema.pipe(z.enum(BACKUP_KINDS)),
  store: (schema: z.ZodString) => schema.pipe(z.enum(BACKUP_STORES)),
  outcome: (schema: z.ZodString) => schema.pipe(z.enum(BACKUP_OUTCOMES)),
  bytes: aCount,
  rtoMinutes: aCount,
};

const backupSelect = createSelectSchema(backup, backupRefinements);
const backupInsert = createInsertSchema(backup, backupRefinements);
const backupUpdate = createUpdateSchema(backup, backupRefinements);

const outcomeScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const outcome = z.union([
  z.record(
    z.string(),
    z.union([outcomeScalar, z.array(outcomeScalar), z.array(z.record(z.string(), outcomeScalar))]),
  ),
  z.null(),
]);

const jobRefinements = {
  workspaceId,
  id: (schema: z.ZodString) => schema.regex(ULID),
  subjectId: (schema: z.ZodString) => schema.trim().min(1),
  kind: (schema: z.ZodString) => schema.pipe(z.enum(JOB_KINDS)),

  reason: (schema: z.ZodString) => schema.pipe(z.enum(JOB_REASONS)),
  status: (schema: z.ZodString) => schema.pipe(z.enum(JOB_STATUSES)),
  attempts: (schema: z.ZodNumber) => schema.int().nonnegative(),
  maxAttempts: (schema: z.ZodNumber) => schema.int().positive(),
  claimedBy: (schema: z.ZodString) => schema.trim().min(1),
  outcome: (schema: z.ZodType) => schema.pipe(outcome),
};

const jobSelect = createSelectSchema(job, jobRefinements);
const jobInsert = createInsertSchema(job, jobRefinements);
const jobUpdate = createUpdateSchema(job, jobRefinements);

export const platformSchemas = {
  workspace: {
    table: workspace,
    select: workspaceSelect,
    insert: workspaceInsert,
    update: workspaceUpdate,
  },
  modelChoice: {
    table: modelChoice,
    select: modelChoiceSelect,
    insert: modelChoiceInsert,
    update: modelChoiceUpdate,
  },
  modelKey: {
    table: modelKey,
    select: modelKeySelect,
    insert: modelKeyInsert,
    update: modelKeyUpdate,
  },
  llmCall: {
    table: llmCall,
    select: llmCallSelect,
    insert: llmCallInsert,
    update: llmCallUpdate,
  },
  spendReservation: {
    table: spendReservation,
    select: spendReservationSelect,
    insert: spendReservationInsert,
    update: spendReservationUpdate,
  },
  modelPrice: {
    table: modelPrice,
    select: modelPriceSelect,
    insert: modelPriceInsert,
    update: modelPriceUpdate,
  },
  decisionThreshold: {
    table: decisionThreshold,
    select: decisionThresholdSelect,
    insert: decisionThresholdInsert,
    update: decisionThresholdUpdate,
  },
  workspaceConfig: {
    table: workspaceConfig,
    select: workspaceConfigSelect,
    insert: workspaceConfigInsert,
    update: workspaceConfigUpdate,
  },
  mcpCallCounter: {
    table: mcpCallCounter,
    select: mcpCallCounterSelect,
    insert: mcpCallCounterInsert,
    update: mcpCallCounterUpdate,
  },
  invitationEmailCounter: {
    table: invitationEmailCounter,
    select: invitationEmailCounterSelect,
    insert: invitationEmailCounterInsert,
    update: invitationEmailCounterUpdate,
  },
  ingressCounter: {
    table: ingressCounter,
    select: ingressCounterSelect,
    insert: ingressCounterInsert,
    update: ingressCounterUpdate,
  },
  contractStamp: {
    table: contractStamp,
    select: contractStampSelect,
    insert: contractStampInsert,
    update: contractStampUpdate,
  },
  sweepPass: {
    table: sweepPass,
    select: sweepPassSelect,
    insert: sweepPassInsert,
    update: sweepPassUpdate,
  },
  backup: {
    table: backup,
    select: backupSelect,
    insert: backupInsert,
    update: backupUpdate,
  },
  job: { table: job, select: jobSelect, insert: jobInsert, update: jobUpdate },
} as const;
