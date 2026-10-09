import { describe, expect, it } from "vitest";

import { conceptCiting, visibilitySuite } from "./sourced-concept.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = visibilitySuite();

type Weighed = { readonly lexeme: string; readonly weights: readonly string[] };

/** Each lexeme of the concept's search column, with the distinct weights it carries. */
const weighed = async (scenario: Scenario, iri: string): Promise<readonly Weighed[]> => {
  const read = await db().pool.query<Weighed>(
    `SELECT word.lexeme, array(SELECT DISTINCT w FROM unnest(word.weights) w ORDER BY w) AS weights
       FROM concept_index, unnest(search) AS word
      WHERE workspace_id = $1 AND iri = $2
      ORDER BY word.lexeme`,
    [scenario.workspaceId, iri],
  );
  return read.rows;
};

const RETENTION = {
  path: "knowledge/retention-schedule.md",
  mergeKey: "policy:retention-schedule",
  title: "Retention Schedule",
  kind: "Policy",
  frontmatter: { title: "Retention Schedule", type: "Policy", tags: ["compliance"] },
} as const;

describe("the search column writeConcept lands", () => {
  it("weighs title A, tags and Also-known-as B, body C", async () => {
    const scenario = await arrange();

    const written = await conceptCiting(scenario, scenario.admin, [], {
      ...RETENTION,
      body: "Archives stay seven years.\n\nAlso known as: Records Policy\n\nShredding follows.",
    });

    expect(await weighed(scenario, written.iri)).toEqual([
      { lexeme: "also", weights: ["C"] },
      { lexeme: "archiv", weights: ["C"] },
      { lexeme: "complianc", weights: ["B"] },
      { lexeme: "follow", weights: ["C"] },
      { lexeme: "known", weights: ["C"] },
      { lexeme: "polici", weights: ["B", "C"] },
      { lexeme: "record", weights: ["B", "C"] },
      { lexeme: "retent", weights: ["A"] },
      { lexeme: "schedul", weights: ["A"] },
      { lexeme: "seven", weights: ["C"] },
      { lexeme: "shred", weights: ["C"] },
      { lexeme: "stay", weights: ["C"] },
      { lexeme: "year", weights: ["C"] },
    ]);
  });

  it("moves the vector with a rewritten body", async () => {
    const scenario = await arrange();
    const first = await conceptCiting(scenario, scenario.admin, [], {
      ...RETENTION,
      body: "Archives stay seven years.",
    });

    await conceptCiting(scenario, scenario.admin, [], {
      ...RETENTION,
      iri: first.iri,
      body: "Invoices stay six years.",
    });

    expect(await weighed(scenario, first.iri)).toEqual([
      { lexeme: "complianc", weights: ["B"] },
      { lexeme: "invoic", weights: ["C"] },
      { lexeme: "retent", weights: ["A"] },
      { lexeme: "schedul", weights: ["A"] },
      { lexeme: "six", weights: ["C"] },
      { lexeme: "stay", weights: ["C"] },
      { lexeme: "year", weights: ["C"] },
    ]);
  });
});
