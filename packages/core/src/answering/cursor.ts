import { z } from "zod";

import { boundarySchemas, ids, MATCH_STRENGTHS } from "@better-answers/schema";

import type { ConceptBound } from "../concepts/index.ts";
import type { PassageBound } from "../sources/index.ts";

export type FindPosition =
  | { readonly run: "strong" | "weak"; readonly bound: ConceptBound }
  | { readonly run: "passages"; readonly bound: PassageBound };

export type FindRun = FindPosition["run"];

const ranked = { matched: z.int().nonnegative(), rank: z.number().nonnegative() };

const FIND_POSITION = z.discriminatedUnion("run", [
  z.strictObject({
    run: z.enum(MATCH_STRENGTHS),
    bound: z.strictObject({ ...ranked, key: ids.conceptIri }),
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
  }),
]);

const CURSOR_LENGTH_AT_MOST = 512;

const positionOf = (text: string): FindPosition | undefined => {
  try {
    const read = FIND_POSITION.safeParse(
      JSON.parse(Buffer.from(text, "base64url").toString("utf8")),
    );
    return read.success ? read.data : undefined;
  } catch {
    // JSON.parse throws on a cursor that is not JSON: refused as any other malformed cursor.
    return undefined;
  }
};

/** Where the last page ended, as `find` handed it out. The server compares it and looks nothing up. */
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
  Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
