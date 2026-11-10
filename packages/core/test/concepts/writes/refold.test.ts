import { inspect } from "node:util";

import { assert, describe, expect, it } from "vitest";

import { RECONCILER, refoldConceptTypes, writeConcept } from "../../../src/concepts/index.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "../../fixtures/workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

type Stored = { readonly written: string; readonly title: string; readonly path: string };

const storedAs = async (
  scenario: Scenario,
  stored: Stored,
  held: { readonly conceptType: string; readonly mergeKey: string },
): Promise<string> => {
  const wrote = await writeConcept(scenario.admin, doorsOf(scenario), {
    mergeKey: `${stored.path}:arranged`,
    path: stored.path,
    conceptType: stored.written,
    title: stored.title,
    frontmatter: { title: stored.title, type: stored.written },
    body: "A concept written before the fold changed.",
    message: `Record ${stored.path}`,
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { base: null },
  });
  assert(wrote.ok, `the concept was refused: ${inspect(wrote)}`);
  await db().pool.query(
    "UPDATE concept_index SET concept_type = $3 WHERE workspace_id = $1 AND iri = $2",
    [scenario.workspaceId, wrote.value.iri, held.conceptType],
  );
  await db().pool.query(
    "UPDATE concept_identity SET merge_key = $3 WHERE workspace_id = $1 AND iri = $2",
    [scenario.workspaceId, wrote.value.iri, held.mergeKey],
  );
  return wrote.value.iri;
};

const heldOf = async (scenario: Scenario, iri: string) => {
  const found = await db().pool.query<{ concept_type: string; merge_key: string }>(
    `SELECT c.concept_type, i.merge_key
       FROM concept_index c
       JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
      WHERE c.workspace_id = $1 AND c.iri = $2`,
    [scenario.workspaceId, iri],
  );
  return found.rows[0];
};

const refolding = async (scenario: Scenario) => {
  const run = await refoldConceptTypes(RECONCILER, doorsOf(scenario).postgres, {
    workspaceId: scenario.workspaceId,
  });
  assert(run.ok, `the refold was refused: ${inspect(run)}`);
  return run.value;
};

const refoldedEvents = async (scenario: Scenario) => {
  const found = await db().pool.query<{ subject_id: string }>(
    `SELECT subject_id FROM audit_event
      WHERE workspace_id = $1 AND action = 'platform.concept.refolded' ORDER BY subject_id`,
    [scenario.workspaceId],
  );
  return found.rows.map((row) => row.subject_id);
};

const MARGINS = {
  written: "Analyses",
  title: "Quarterly margins",
  path: "knowledge/company/margins.md",
};

describe("refolding the stored concept types", () => {
  it("moves an old fold's type and merge key together", async () => {
    const scenario = await arrange();
    const margins = await storedAs(scenario, MARGINS, {
      conceptType: "Analys",
      mergeKey: "Analys:quarterly margins",
    });
    const gas = await storedAs(
      scenario,
      { written: "Gas", title: "Natural gas", path: "knowledge/company/gas.md" },
      { conceptType: "Ga", mergeKey: "Ga:natural gas" },
    );

    const run = await refolding(scenario);

    expect(run.clashed).toEqual([]);
    expect(run.refolded.map((each) => each.iri).toSorted()).toEqual([margins, gas].toSorted());
    expect(await heldOf(scenario, margins)).toEqual({
      concept_type: "Analyse",
      merge_key: "Analyse:quarterly margins",
    });
    expect(await heldOf(scenario, gas)).toEqual({
      concept_type: "Gas",
      merge_key: "Gas:natural gas",
    });
    expect(await refoldedEvents(scenario)).toEqual([margins, gas].toSorted());
  });

  it("changes nothing when run a second time", async () => {
    const scenario = await arrange();
    const margins = await storedAs(scenario, MARGINS, {
      conceptType: "Analys",
      mergeKey: "Analys:quarterly margins",
    });
    await refolding(scenario);

    const again = await refolding(scenario);

    expect(again).toEqual({ refolded: [], clashed: [] });
    expect(await heldOf(scenario, margins)).toEqual({
      concept_type: "Analyse",
      merge_key: "Analyse:quarterly margins",
    });
    expect(await refoldedEvents(scenario)).toEqual([margins]);
  });

  it("moves a key that lags its type to that type", async () => {
    const scenario = await arrange();
    const margins = await storedAs(scenario, MARGINS, {
      conceptType: "Analyse",
      mergeKey: "Analys:quarterly margins",
    });

    await refolding(scenario);

    expect(await heldOf(scenario, margins)).toEqual({
      concept_type: "Analyse",
      merge_key: "Analyse:quarterly margins",
    });
  });

  it("keeps a merge key that names no type", async () => {
    const scenario = await arrange();
    const margins = await storedAs(scenario, MARGINS, {
      conceptType: "Analys",
      mergeKey: "an-imported-entry",
    });

    await refolding(scenario);

    expect(await heldOf(scenario, margins)).toEqual({
      concept_type: "Analyse",
      merge_key: "an-imported-entry",
    });
  });

  it("leaves a concept alone when another holds its key", async () => {
    const scenario = await arrange();
    const stale = await storedAs(scenario, MARGINS, {
      conceptType: "Analys",
      mergeKey: "Analys:quarterly margins",
    });
    const current = await storedAs(
      scenario,
      { ...MARGINS, path: "knowledge/company/margins-2026.md" },
      { conceptType: "Analyse", mergeKey: "Analyse:quarterly margins" },
    );

    const run = await refolding(scenario);

    expect(run).toEqual({
      refolded: [],
      clashed: [{ iri: stale, conceptType: "Analyse", mergeKey: "Analyse:quarterly margins" }],
    });
    expect(await heldOf(scenario, stale)).toEqual({
      concept_type: "Analys",
      merge_key: "Analys:quarterly margins",
    });
    expect(await heldOf(scenario, current)).toEqual({
      concept_type: "Analyse",
      merge_key: "Analyse:quarterly margins",
    });
  });

  it("refuses a workspace id that is not one", async () => {
    const scenario = await arrange();

    const run = await refoldConceptTypes(RECONCILER, doorsOf(scenario).postgres, {
      workspaceId: "not-a-workspace",
    });

    expect(run).toEqual({ ok: false, error: "malformed" });
  });
});
