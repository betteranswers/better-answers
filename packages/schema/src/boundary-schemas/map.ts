import { z } from "zod";

import {
  MAP_EDGE_LABELS,
  MAP_NODE_LABELS,
  mapEdge,
  mapGeneration,
  mapNode,
  mapUnresolvedReference,
  SOURCE_ENTITY_LABEL_PREFIX,
  UNRESOLVED_RELATIONS,
} from "../knowledge/map-tables.ts";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "./drizzle-zod.ts";
import { workspaceId, readableUnit, conceptIri } from "./shared.ts";

const mapLabel = (labels: readonly string[]) => (schema: z.ZodString) =>
  schema.refine(
    (label) =>
      labels.some((known) => known === label) || label.startsWith(SOURCE_ENTITY_LABEL_PREFIX),
    { message: "a map label is one of the closed set, or wears the source-entity prefix" },
  );

type MapRowInput = { readonly label: string; readonly gen?: number | null };

const sourceEntityCarriesNoGen = (row: MapRowInput): boolean =>
  !row.label.startsWith(SOURCE_ENTITY_LABEL_PREFIX) || row.gen === null || row.gen === undefined;

const closedNodeLabelCarriesGen = (row: MapRowInput): boolean =>
  row.label.startsWith(SOURCE_ENTITY_LABEL_PREFIX) || (row.gen !== null && row.gen !== undefined);

const generation = (schema: z.ZodNumber) => schema.int().positive();

const mapGenerationRefinements = {
  workspaceId,
  liveGen: generation,
};

const mapGenerationSelect = createSelectSchema(mapGeneration, mapGenerationRefinements);
const mapGenerationInsert = createInsertSchema(mapGeneration, mapGenerationRefinements);
const mapGenerationUpdate = createUpdateSchema(mapGeneration, mapGenerationRefinements);

const mapKey = (schema: z.ZodString) => schema.trim().min(1);

const mapRow = {
  workspaceId,
  gen: generation,
  uid: mapKey,
  ...readableUnit,
};

const mapNodeRefinements = {
  ...mapRow,
  label: mapLabel(MAP_NODE_LABELS),
  kind: mapKey,
};

const mapNodeSelect = createSelectSchema(mapNode, mapNodeRefinements);
const mapNodeInsert = createInsertSchema(mapNode, mapNodeRefinements)
  .refine(sourceEntityCarriesNoGen, {
    message: "a source-entity label carries no generation",
    path: ["gen"],
  })
  .refine(closedNodeLabelCarriesGen, {
    message: "a closed node label is a bundle-and-record row and carries its generation",
    path: ["gen"],
  });
const mapNodeUpdate = createUpdateSchema(mapNode, mapNodeRefinements);

const mapEdgeRefinements = {
  ...mapRow,
  label: mapLabel(MAP_EDGE_LABELS),
  fromUid: mapKey,
  toUid: mapKey,
  fromKind: mapKey,
  toKind: mapKey,
};

const mapEdgeSelect = createSelectSchema(mapEdge, mapEdgeRefinements);
const mapEdgeInsert = createInsertSchema(mapEdge, mapEdgeRefinements).refine(
  sourceEntityCarriesNoGen,
  { message: "a source-entity label carries no generation", path: ["gen"] },
);
const mapEdgeUpdate = createUpdateSchema(mapEdge, mapEdgeRefinements);

const mapUnresolvedReferenceRefinements = {
  workspaceId,
  gen: generation,
  fromUid: conceptIri,
  relation: (schema: z.ZodString) => schema.pipe(z.enum(UNRESOLVED_RELATIONS)),
  ordinal: (schema: z.ZodNumber) => schema.int().nonnegative(),
  targetPath: mapKey,
};

const mapUnresolvedReferenceSelect = createSelectSchema(
  mapUnresolvedReference,
  mapUnresolvedReferenceRefinements,
);
const mapUnresolvedReferenceInsert = createInsertSchema(
  mapUnresolvedReference,
  mapUnresolvedReferenceRefinements,
);
const mapUnresolvedReferenceUpdate = createUpdateSchema(
  mapUnresolvedReference,
  mapUnresolvedReferenceRefinements,
);

export const mapSchemas = {
  mapGeneration: {
    table: mapGeneration,
    select: mapGenerationSelect,
    insert: mapGenerationInsert,
    update: mapGenerationUpdate,
  },
  mapNode: {
    table: mapNode,
    select: mapNodeSelect,
    insert: mapNodeInsert,
    update: mapNodeUpdate,
  },
  mapEdge: {
    table: mapEdge,
    select: mapEdgeSelect,
    insert: mapEdgeInsert,
    update: mapEdgeUpdate,
  },
  mapUnresolvedReference: {
    table: mapUnresolvedReference,
    select: mapUnresolvedReferenceSelect,
    insert: mapUnresolvedReferenceInsert,
    update: mapUnresolvedReferenceUpdate,
  },
} as const;
