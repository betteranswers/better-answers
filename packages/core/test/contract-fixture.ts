import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * One agreement's fixture, read out of `contracts/` and parsed (ADR 0031).
 *
 * The directory is deployed by nothing and imported by nothing — both tiers' suites *read*
 * it — so the path is resolved from this file and stated once here rather than in each
 * agreement's suite. The schema is the caller's, because what a fixture holds is the
 * agreement's business and never this reader's.
 *
 * Beside the reader, one declaration: where an agreement is read by two of this tier's
 * suites, the part of its shape they both parse is stated here once instead of twice.
 */
const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");

export const contractFixture = <Schema extends z.ZodType>(
  agreement: string,
  schema: Schema,
): z.output<Schema> =>
  schema.parse(JSON.parse(readFileSync(path.join(contractsDir, agreement, "cases.json"), "utf8")));

/**
 * One chunk row of the `document-chunk` agreement, as `cases.json` writes it.
 *
 * Two suites parse that file — the pure half, `document-chunk.contract.test.ts`, and the
 * seeded half, `passages.test.ts` — and each states the rest of the fixture's shape for
 * itself, because each reads a different part of it. The row is shared because both read all
 * six of its columns, and a seventh appearing on one side only would be a disagreement about
 * the agreement rather than about the code either half holds.
 *
 * What is shared is the **shape** and never an expected value: each suite asserts against the
 * fixture's own literals and neither holds the other's (`[TEST9]`), which is the rule that
 * keeps the two halves of an agreement able to disagree.
 */
export const documentChunkRow = z.object({
  ordinal: z.int().nonnegative(),
  id: z.string().min(1),
  char_start: z.int().nonnegative(),
  char_end: z.int().nonnegative(),
  locator: z.string().min(1),
  content: z.string().min(1),
});
