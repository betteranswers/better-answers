import { describe, expect, it } from "vitest";
import { z } from "zod";

import { canonicalFrontmatter, contentHashOf } from "../src/concepts/file.ts";
import { contractFixture } from "./contract-fixture.ts";

/**
 * The concept-file agreement's TypeScript half (ADR 0031, ADR 0014, ADR 0019): the fixture
 * in `contracts/concept-file/` is the contract, and this suite proves this tier's
 * canonicaliser and hash produce exactly the text and the number it says — for the cases
 * the two languages disagree on by default: an object's integer-like keys, every number
 * shape, the `sources[]` reduction and the trust keys left out. The Python half runs the
 * same cases in `apps/worker/tests/test_tier_contract.py`.
 *
 * Both tiers hash: the app at every write and replay, the worker on every nightly audit,
 * which reports a concept *mismatched* when its number differs. That is what makes this an
 * agreement rather than one tier's helper, and why neither suite holds the other's literal.
 */

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const fixtureSchema = z.object({
  description: z.string(),
  cases: z.array(
    z.object({
      why: z.string(),
      path: z.string(),
      frontmatter: z.record(
        z.string(),
        z.union([scalar, z.array(z.string()), z.array(z.record(z.string(), scalar))]),
      ),
      body: z.string(),
      canonical: z.string(),
      sha256: z.string(),
    }),
  ),
  numbers: z.array(z.object({ value: z.number(), text: z.string() })),
});

const fixture = contractFixture("concept-file", fixtureSchema);

describe("the concept-file agreement", () => {
  it("writes the canonical text the fixture says for every case, and hashes it to the fixture's number", () => {
    // The reason travels with the assertion, so a failure names the case rather than two
    // strings that differ somewhere.
    for (const { why, path, frontmatter, body, canonical, sha256 } of fixture.cases) {
      expect({
        why,
        canonical: canonicalFrontmatter(frontmatter, path),
        sha256: contentHashOf(frontmatter, body, path),
      }).toEqual({ why, canonical, sha256 });
    }
  });

  it("writes every number the fixture names as the one text both tiers write for it", () => {
    for (const { value, text } of fixture.numbers) {
      expect({ value, canonical: canonicalFrontmatter({ n: value }, "knowledge/x.md") }).toEqual({
        value,
        canonical: `{"n":${text}}`,
      });
    }
  });
});
