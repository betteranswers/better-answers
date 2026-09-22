import type { z } from "zod";

import { parse } from "../src/kernel/index.ts";

export const inputOf = <Schema extends z.ZodType>(
  schema: Schema,
  raw: unknown,
): z.output<Schema> => {
  const read = parse(schema, raw);
  if (read.ok) return read.value;
  throw new Error(
    `the arranged input is not the act's shape: ${JSON.stringify(read.error.fields)}`,
  );
};
