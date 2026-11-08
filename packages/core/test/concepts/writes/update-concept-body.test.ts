import { assert, expect, it } from "vitest";

import { head } from "@better-answers/core/store/git";
import type { ConceptIri } from "@better-answers/schema";

import { updateConceptBody, writeConcept } from "../../../src/concepts/index.ts";
import { doorsOf, suiteWithBundles } from "../../fixtures/workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const kindOf = async (iri: ConceptIri): Promise<string | undefined> => {
  const found = await db().pool.query<{ kind: string }>(
    "SELECT kind FROM concept_index WHERE iri = $1",
    [iri],
  );
  return found.rows[0]?.kind;
};

it("keeps an Analyses concept's stored kind through a body update", async () => {
  const scenario = await arrange();
  const title = "Quarterly Margins";
  const landed = await writeConcept(scenario.admin, doorsOf(scenario), {
    mergeKey: "analysis:quarterly-margins",
    path: "knowledge/analysis/quarterly-margins.md",
    conceptType: "Analyses",
    title,
    frontmatter: { title, type: "Analyses" },
    body: "Margins held steady this quarter.",
    message: "Record the quarterly margins",
    author: { name: "Ada Admin", email: "ada@acme.invalid" },
    expects: { head: await head(scenario.admin, scenario.git) },
    status: "stable",
    sensitivity: "Internal",
  });
  assert(landed.ok, "the write landed");
  const { iri, contentHash } = landed.value;
  const stored = await kindOf(iri);

  const updated = await updateConceptBody(scenario.admin, doorsOf(scenario), {
    iri,
    body: "Margins fell two points this quarter.",
    dryRun: false,
    base: contentHash,
  });

  expect(updated).toMatchObject({ ok: true, value: { written: { iri } } });
  expect(await kindOf(iri)).toBe(stored);
});
