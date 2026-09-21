import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");

export const contractFixture = <Schema extends z.ZodType>(
  agreement: string,
  schema: Schema,
): z.output<Schema> =>
  schema.parse(JSON.parse(readFileSync(path.join(contractsDir, agreement, "cases.json"), "utf8")));

export const documentChunkRow = z.object({
  ordinal: z.int().nonnegative(),
  id: z.string().min(1),
  char_start: z.int().nonnegative(),
  char_end: z.int().nonnegative(),
  locator: z.string().min(1),
  content: z.string().min(1),
});

export const mediaTypeOutside = z.object({
  media_type: z.string().min(1),
  why: z.string().min(1),
});
