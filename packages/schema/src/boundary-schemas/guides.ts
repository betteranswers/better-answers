import { z } from "zod";

import { COLLECTION, CONTENT_HASH, TRUST_TIERS } from "../knowledge/concept-tables.ts";
import {
  GUIDE_LAYERS,
  guideDefinition,
  guideDefinitionVersion,
  guideExpectedFact,
  guideRole,
  guideSection,
  ROLE_LABELS,
} from "../knowledge/guide-tables.ts";
import {
  NEEDS_REVIEW_REASONS,
  WRITE_UP_HOMES,
  writeUp,
  writeUpInclude,
  writeUpVersion,
} from "../knowledge/write-up-tables.ts";
import { ACTOR_ID as ACTOR_ID_REGEX } from "../people/actor-id.ts";
import { ROLES } from "../people/roles.ts";
import { ULID } from "../ulid.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { workspaceId, writeUpId, readableUnit, conceptIri } from "./shared.ts";

const ordinal = (schema: z.ZodNumber) => schema.int().nonnegative();

const guideId = (schema: z.ZodString) => schema.regex(ULID);

const sectionId = (schema: z.ZodString) => schema.trim().min(1);

const expectedFactId = (schema: z.ZodString) => schema.regex(ULID);

const versioned = {
  version: (schema: z.ZodNumber) => schema.int().positive(),
  actor: (schema: z.ZodString) => schema.regex(ACTOR_ID_REGEX),
  note: (schema: z.ZodString) => schema.trim().min(1),
};

const guideDefinitionRefinements = {
  workspaceId,
  id: guideId,
  kind: (schema: z.ZodString) => schema.trim().min(1),
  collection: (schema: z.ZodString) => schema.regex(COLLECTION),
  template: (schema: z.ZodString) => schema.trim().min(1),
  subjectIri: conceptIri,
};

const guideDefinitionSelect = createSelectSchema(guideDefinition, guideDefinitionRefinements);
const guideDefinitionInsert = createInsertSchema(guideDefinition, guideDefinitionRefinements);
const guideDefinitionUpdate = createUpdateSchema(guideDefinition, guideDefinitionRefinements);

const guideRoleRefinements = {
  workspaceId,
  guideId,
  role: (schema: z.ZodString) => schema.pipe(z.enum(ROLES)),
  defaultLayer: (schema: z.ZodString) => schema.pipe(z.enum(GUIDE_LAYERS)),
  actionThreshold: (schema: z.ZodString) => schema.pipe(z.enum(TRUST_TIERS)),
};

const guideRoleSelect = createSelectSchema(guideRole, guideRoleRefinements);
const guideRoleInsert = createInsertSchema(guideRole, guideRoleRefinements);
const guideRoleUpdate = createUpdateSchema(guideRole, guideRoleRefinements);

const guideSectionRefinements = {
  workspaceId,
  guideId,
  id: sectionId,
  parentId: sectionId,
  ordinal,
  prompt: (schema: z.ZodString) => schema.trim().min(1),
  roleLabel: (schema: z.ZodString) => schema.pipe(z.enum(ROLE_LABELS)),
  usageNote: (schema: z.ZodString) => schema.trim().min(1),
  layers: (schema: z.ZodArray<z.ZodString>) =>
    z.array(schema.element.pipe(z.enum(GUIDE_LAYERS))).min(1),
};

const guideSectionSelect = createSelectSchema(guideSection, guideSectionRefinements);
const guideSectionInsert = createInsertSchema(guideSection, guideSectionRefinements);
const guideSectionUpdate = createUpdateSchema(guideSection, guideSectionRefinements);

const guideExpectedFactRefinements = {
  workspaceId,
  id: expectedFactId,
  guideId,
  sectionId,
  ordinal,
  name: (schema: z.ZodString) => schema.trim().min(1),
  kind: (schema: z.ZodString) => schema.trim().min(1),
  tags: (schema: z.ZodArray<z.ZodString>) => z.array(schema.element.trim().min(1)),
  collection: (schema: z.ZodString) => schema.regex(COLLECTION),
  atLeast: (schema: z.ZodNumber) => schema.int().positive(),
};

const guideExpectedFactSelect = createSelectSchema(guideExpectedFact, guideExpectedFactRefinements);
const guideExpectedFactInsert = createInsertSchema(guideExpectedFact, guideExpectedFactRefinements);
const guideExpectedFactUpdate = createUpdateSchema(guideExpectedFact, guideExpectedFactRefinements);

const guideDefinitionVersionRefinements = { workspaceId, guideId, ...versioned };

const guideDefinitionVersionSelect = createSelectSchema(
  guideDefinitionVersion,
  guideDefinitionVersionRefinements,
);
const guideDefinitionVersionInsert = createInsertSchema(
  guideDefinitionVersion,
  guideDefinitionVersionRefinements,
);
const guideDefinitionVersionUpdate = createUpdateSchema(
  guideDefinitionVersion,
  guideDefinitionVersionRefinements,
);

const writeUpRefinements = {
  workspaceId,
  id: writeUpId,
  ...readableUnit,
  home: (schema: z.ZodString) => schema.pipe(z.enum(WRITE_UP_HOMES)),
  guideId,
  sectionId,
  questionId: (schema: z.ZodString) => schema.regex(ULID),
  needsReview: (schema: z.ZodString) => schema.pipe(z.enum(NEEDS_REVIEW_REASONS)),
};

const writeUpSelect = createSelectSchema(writeUp, writeUpRefinements);
const writeUpInsert = createInsertSchema(writeUp, writeUpRefinements);
const writeUpUpdate = createUpdateSchema(writeUp, writeUpRefinements);

const writeUpIncludeRefinements = {
  workspaceId,
  writeUpId,
  id: (schema: z.ZodString) => schema.trim().min(1),
  ordinal,
  iri: conceptIri,
  contentHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
  expectedFactId,
  wordingHeading: (schema: z.ZodString) => schema.trim().min(1),
  wordingHash: (schema: z.ZodString) => schema.regex(CONTENT_HASH),
};

const writeUpIncludeSelect = createSelectSchema(writeUpInclude, writeUpIncludeRefinements);
const writeUpIncludeInsert = createInsertSchema(writeUpInclude, writeUpIncludeRefinements);
const writeUpIncludeUpdate = createUpdateSchema(writeUpInclude, writeUpIncludeRefinements);

const writeUpVersionRefinements = { workspaceId, writeUpId, ...versioned };

const writeUpVersionSelect = createSelectSchema(writeUpVersion, writeUpVersionRefinements);
const writeUpVersionInsert = createInsertSchema(writeUpVersion, writeUpVersionRefinements);
const writeUpVersionUpdate = createUpdateSchema(writeUpVersion, writeUpVersionRefinements);

export const guideSchemas = {
  writeUp: {
    table: writeUp,
    select: writeUpSelect,
    insert: writeUpInsert,
    update: writeUpUpdate,
  },
  writeUpInclude: {
    table: writeUpInclude,
    select: writeUpIncludeSelect,
    insert: writeUpIncludeInsert,
    update: writeUpIncludeUpdate,
  },
  writeUpVersion: {
    table: writeUpVersion,
    select: writeUpVersionSelect,
    insert: writeUpVersionInsert,
    update: writeUpVersionUpdate,
  },
  guideDefinition: {
    table: guideDefinition,
    select: guideDefinitionSelect,
    insert: guideDefinitionInsert,
    update: guideDefinitionUpdate,
  },
  guideRole: {
    table: guideRole,
    select: guideRoleSelect,
    insert: guideRoleInsert,
    update: guideRoleUpdate,
  },
  guideSection: {
    table: guideSection,
    select: guideSectionSelect,
    insert: guideSectionInsert,
    update: guideSectionUpdate,
  },
  guideExpectedFact: {
    table: guideExpectedFact,
    select: guideExpectedFactSelect,
    insert: guideExpectedFactInsert,
    update: guideExpectedFactUpdate,
  },
  guideDefinitionVersion: {
    table: guideDefinitionVersion,
    select: guideDefinitionVersionSelect,
    insert: guideDefinitionVersionInsert,
    update: guideDefinitionVersionUpdate,
  },
} as const;
