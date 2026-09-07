import { readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";

/**
 * One agreement's fixture, read out of `contracts/` and parsed (ADR 0031).
 *
 * The directory is deployed by nothing and imported by nothing — both tiers' suites *read*
 * it — so the path is resolved from this file and stated once here rather than in each
 * agreement's suite. The schema is the caller's, because what a fixture holds is the
 * agreement's business and never this reader's.
 */
const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");

export const contractFixture = <Schema extends z.ZodType>(
  agreement: string,
  schema: Schema,
): z.output<Schema> =>
  schema.parse(JSON.parse(readFileSync(path.join(contractsDir, agreement, "cases.json"), "utf8")));
