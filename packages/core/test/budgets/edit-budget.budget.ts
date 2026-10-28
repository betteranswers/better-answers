import { assert, describe, expect, it } from "vitest";

import { head } from "@better-answers/core/store/git";

import {
  conceptToEdit,
  saveConcept,
  writeConcept,
  type WriteConceptInput,
} from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { passageAt } from "../../src/sources/index.ts";
import type { Tx } from "../../src/store/postgres/index.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "../fixtures/workspace-with-bundle.ts";
import { inMs, percentile, recordFigures } from "../support/figures.ts";
import { answered, readingAs } from "../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

const CONCEPTS = 250;
const EDITS = 20;

const passages = (principal: UserPrincipal, tx: Tx) => (locator: string) =>
  passageAt(principal, tx, locator);

const policyAt = (at: number, body: string): WriteConceptInput => ({
  mergeKey: `policy:rule-${at}`,
  path: `knowledge/policy/rule-${at}.md`,
  kind: "Policy",
  title: `Rule ${at}`,
  frontmatter: { title: `Rule ${at}`, type: "Policy" },
  body,
  message: `Record rule ${at}`,
  author: { name: "Ada Admin", email: "ada@acme.invalid" },
  expects: { base: null },
  status: "stable",
  sensitivity: "Internal",
});

const seeded = async (scenario: Scenario) => {
  const iris: string[] = [];
  for (let at = 0; at < CONCEPTS; at += 1) {
    const landed = await writeConcept(
      scenario.admin,
      doorsOf(scenario),
      policyAt(at, `Rule ${at} holds for every claim.`),
    );
    if (!landed.ok) throw new Error(`the seed was refused: ${String(landed.error)}`);
    iris.push(landed.value.iri);
  }
  return iris;
};

const timed = async (work: () => Promise<void>): Promise<number> => {
  const started = performance.now();
  await work();
  return performance.now() - started;
};

const figuresOf = (name: string, times: readonly number[]) =>
  [
    [`${name} median`, inMs(percentile(times, 0.5))],
    [`${name} p95`, inMs(percentile(times, 0.95))],
  ] as const;

describe("the governed edit at 250 concepts", () => {
  it("times a direct write, a save and its places count", { timeout: 300_000 }, async () => {
    const scenario = await arrange();
    const iris = await seeded(scenario);

    const writes: number[] = [];
    for (let edit = 0; edit < EDITS; edit += 1) {
      const at = edit;
      const input = {
        ...policyAt(at, `Rule ${at} holds for every claim, edit ${edit}.`),
        iri: iris[at],
        expects: { head: await head(scenario.admin, scenario.git) },
      };
      writes.push(
        await timed(async () => {
          answered(await writeConcept(scenario.admin, doorsOf(scenario), input));
        }),
      );
    }

    const saves: number[] = [];
    const counts: number[] = [];
    for (let edit = 0; edit < EDITS; edit += 1) {
      const iri = iris[EDITS + edit];
      assert(iri !== undefined, "a concept was seeded for each edit");
      counts.push(
        await timed(async () => {
          answered(
            await readingAs(db().runtimePool, scenario.admin, (reader, tx) =>
              conceptToEdit(reader, tx, { iri }, passages(reader, tx)),
            ),
          );
        }),
      );
      const seed = answered(
        await readingAs(db().runtimePool, scenario.admin, (reader, tx) =>
          conceptToEdit(reader, tx, { iri }, passages(reader, tx)),
        ),
      );
      saves.push(
        await timed(async () => {
          const saved = await saveConcept(
            scenario.admin,
            { ...doorsOf(scenario), passages },
            {
              iri,
              parts: { ...seed.parts, body: `${seed.parts.body} Saved ${edit}.` },
              sources: seed.sources,
              base: seed.base,
              withheld: seed.withheld.map((source) => source.at),
            },
          );
          expect(saved).toMatchObject({ ok: true, value: { outcome: "committed" } });
        }),
      );
    }

    await recordFigures("the governed edit at 250 concepts", [
      ...figuresOf("writeConcept", writes),
      ...figuresOf("saveConcept", saves),
      ...figuresOf("conceptToEdit with placesUsing", counts),
    ]);
    expect(writes).toHaveLength(EDITS);
  });
});
