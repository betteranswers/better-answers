import { z } from "zod";

import { CONCEPT_IRI } from "../knowledge/concept-tables.ts";
import { AUDIENCES, SENSITIVITIES } from "../knowledge/readable-columns.ts";
import { ULID } from "../ulid.ts";

export const workspaceId = (schema: z.ZodString) => schema.regex(ULID).brand<"WorkspaceId">();

export const groupId = (schema: z.ZodString) => schema.regex(ULID).brand<"GroupId">();

export const writeUpId = (schema: z.ZodString) => schema.regex(ULID).brand<"WriteUpId">();

export const readableUnit = {
  sensitivity: (schema: z.ZodString) => schema.pipe(z.enum(SENSITIVITIES)),
  audience: (schema: z.ZodString) => schema.pipe(z.enum(AUDIENCES)),
  audienceGroups: (schema: z.ZodArray<z.ZodString>) => z.array(groupId(schema.element)).min(1),
};

export const conceptIri = (schema: z.ZodString) => schema.pipe(CONCEPT_IRI);
