import { z } from "zod";

import { boundarySchemas, ids, MATCH_STRENGTHS, type CorpusCounts } from "@better-answers/schema";

import type { ConceptBound } from "../concepts/index.ts";
import type { PassageBound } from "../sources/index.ts";

export type FindPosition =
  | { readonly run: "strong" | "weak"; readonly bound: ConceptBound; readonly counts: CorpusCounts }
  | { readonly run: "passages"; readonly bound: PassageBound; readonly counts: CorpusCounts };

export type FindRun = FindPosition["run"];

const ranked = { weight: z.number().nonnegative(), rank: z.number().nonnegative() };

const counts = z
  .strictObject({
    size: z.int().nonnegative(),
    frequencies: z.array(z.int().nonnegative()),
  })
  .refine(
    ({ size, frequencies }) => frequencies.every((held) => held <= size),
    "a word is held by more rows than were counted",
  );

const FIND_POSITION = z.discriminatedUnion("run", [
  z.strictObject({
    run: z.enum(MATCH_STRENGTHS),
    bound: z.strictObject({ ...ranked, key: ids.conceptIri }),
    counts,
  }),
  z.strictObject({
    run: z.literal("passages"),
    bound: z.strictObject({
      ...ranked,
      key: z.strictObject({
        sourceDocumentId: boundarySchemas.sourceDocument.select.shape.id,
        charStart: z.int32().nonnegative(),
      }),
    }),
    counts,
  }),
]);

const CURSOR_LENGTH_AT_MOST = 1024;

const positionOf = (text: string): FindPosition | undefined => {
  try {
    const read = FIND_POSITION.safeParse(
      JSON.parse(Buffer.from(text, "base64url").toString("utf8")),
    );
    return read.success ? read.data : undefined;
  } catch {
    return undefined;
  }
};

export const findCursor = z
  .string()
  .max(CURSOR_LENGTH_AT_MOST)
  .regex(/^[\w-]+$/u)
  .transform((text, context) => {
    const position = positionOf(text);
    if (position === undefined) {
      context.addIssue({ code: "custom", message: "not a cursor find handed out" });
    }
    return position ?? z.NEVER;
  });

export const cursorOf = (position: FindPosition): string =>
  Buffer.from(JSON.stringify(position)).toString("base64url");
