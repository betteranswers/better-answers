import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { openModelClient } from "../../src/llm/index.ts";
import { postgresForSuite } from "../suite-postgres.ts";
import {
  poundsOf,
  readReuse,
  recordReuseReading,
  theReuseSet,
  withEffort,
  type Effort,
  type ReuseSet,
} from "./reuse-set.ts";

/** List prices in US dollars per million tokens, and each model's own effort; check the price page before a run. */
const MODELS = [
  { name: "Claude Sonnet 5.5", model: "claude-sonnet-5-5", usdIn: 2, usdOut: 10, effort: "high" },
  {
    name: "Claude Haiku 5.5",
    model: "claude-haiku-5-5",
    usdIn: 0.1,
    usdOut: 0.5,
    effort: "medium",
  },
] as const;

const EFFORTS: readonly Effort[] = [undefined, "low"];

const KEY_NEEDED = "set READING_ANTHROPIC_KEY to the key the reading spends";
const RATE_NEEDED = "set READING_GBP_PER_USD to the day's pounds per US dollar, such as 0.75";

const owner = z.object({
  READING_ANTHROPIC_KEY: z.string({ error: KEY_NEEDED }).min(1, KEY_NEEDED),
  READING_GBP_PER_USD: z
    .string({ error: RATE_NEEDED })
    .regex(/^\d+(\.\d+)?$/, RATE_NEEDED)
    .transform(Number),
});

const db = postgresForSuite();

describe("the owner's reuse reading", () => {
  let set: ReuseSet;
  let told: z.infer<typeof owner>;

  beforeAll(async () => {
    const read = owner.safeParse(process.env);
    if (!read.success) throw new Error(z.prettifyError(read.error));
    told = read.data;
    set = await theReuseSet();
  });

  for (const { name, model, usdIn, usdOut, effort: byDefault } of MODELS) {
    for (const effort of EFFORTS) {
      const asked = effort ?? `${byDefault}, its default`;
      it(`reads ${name} at effort ${asked}`, async () => {
        const rate = told.READING_GBP_PER_USD;
        const client = openModelClient({
          fetch: withEffort(fetch, effort),
          clock: { now: () => new Date() },
          log: { info: () => {} },
        });
        const reading = await readReuse(db(), set, {
          model,
          gbpPerMillionIn: poundsOf(usdIn, rate),
          gbpPerMillionOut: poundsOf(usdOut, rate),
          key: told.READING_ANTHROPIC_KEY,
          callModel: client.callModel,
        });
        const priced = `$${usdIn} in and $${usdOut} out per million tokens, at £${rate} to the dollar`;
        await recordReuseReading(`Reuse reading, ${name} at effort ${asked}`, reading, priced);

        // A refused key fails every call, and a run that judged nothing has no figures to record.
        expect(reading.judged).toBeGreaterThan(0);
      });
    }
  }
});
