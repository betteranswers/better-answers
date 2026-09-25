import { describe, expect, it } from "vitest";
import { z } from "zod";

import { canonicalFrontmatter, contentHashOf } from "../src/concepts/index.ts";
import { contractFixture } from "./contract-fixture.ts";

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
  it("writes and hashes every case as the fixture says", () => {
    for (const { why, path, frontmatter, body, canonical, sha256 } of fixture.cases) {
      expect({
        why,
        canonical: canonicalFrontmatter(frontmatter, path),
        sha256: contentHashOf(frontmatter, body, path),
      }).toEqual({ why, canonical, sha256 });
    }
  });

  it("writes each fixture number as the text both tiers write", () => {
    for (const { value, text } of fixture.numbers) {
      expect({ value, canonical: canonicalFrontmatter({ n: value }, "knowledge/x.md") }).toEqual({
        value,
        canonical: `{"n":${text}}`,
      });
    }
  });
});
