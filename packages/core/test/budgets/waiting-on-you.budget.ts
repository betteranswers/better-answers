import { describe, expect, it } from "vitest";

import { waitingOnYou } from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { nameOwnerAs, suiteWithBundles } from "../fixtures/workspace-with-bundle.ts";
import { inMs, percentile, recordFigures } from "../support/figures.ts";
import {
  conceptProposedBy,
  conceptWritten,
  nextConcept,
  proposedBy,
} from "../support/suggested-concept.ts";
import { answered, readingAs } from "../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

const BUDGET_COLLECTIONS = ["company", "payroll", "policies", "product", "security"] as const;
const WAITING_SETS = 50;
const WARMING_RUNS = 5;
const RUNS = 40;
const WAITING_BUDGET_MS = 100;
const ONE_STATEMENT_BUDGET_IN_ONE_ITEM_LISTS = 3;

type Listed = { readonly readMs: number; readonly items: number };

type PairedRead = { readonly oneItem: Listed; readonly fifty: Listed };

const listedFor = async (reader: UserPrincipal): Promise<Listed> =>
  answered(
    await readingAs(db().runtimePool, reader, async (principal, tx) => {
      const started = performance.now();
      const list = answered(await waitingOnYou(principal, tx));
      return { readMs: performance.now() - started, items: list.items.length };
    }),
  );

describe("Waiting on you at volume", () => {
  it("answers 50 waiting suggestions within its budget", async () => {
    const scenario = await arrange();
    const standing = [];
    for (const collection of BUDGET_COLLECTIONS) {
      const n = nextConcept();
      standing.push(
        await conceptWritten(scenario, {
          path: `knowledge/${collection}/expenses-${n}.md`,
          mergeKey: `policy:${collection}-expenses-${n}`,
        }),
      );
    }
    for (let round = 0; round < WAITING_SETS / BUDGET_COLLECTIONS.length; round += 1) {
      for (const concept of standing) await proposedBy(scenario, scenario.viewer, concept);
    }
    const theirs = await conceptProposedBy(scenario, scenario.unowned);
    await nameOwnerAs(scenario.admin, scenario.postgres, {
      iri: theirs.written.iri,
      personId: scenario.viewer.userId,
    });

    const pairedRead = async (): Promise<PairedRead> => ({
      oneItem: await listedFor(scenario.viewer),
      fifty: await listedFor(scenario.editor),
    });
    for (let run = 0; run < WARMING_RUNS; run += 1) await pairedRead();
    const reads: PairedRead[] = [];
    for (let run = 0; run < RUNS; run += 1) reads.push(await pairedRead());
    const fiftyMs = reads.map((read) => read.fifty.readMs);
    const inOneItemLists = percentile(
      reads.map((read) => read.fifty.readMs / read.oneItem.readMs),
      0.5,
    );
    await recordFigures("Waiting on you over 50 waiting suggestions in five collections", [
      [
        "the list of 50, in one-item lists read just before it, at the median",
        `${inOneItemLists.toFixed(1)}, against a budget of ${ONE_STATEMENT_BUDGET_IN_ONE_ITEM_LISTS}`,
      ],
      [
        "the list of 50 at the median",
        `${inMs(percentile(fiftyMs, 0.5))}, against ${WAITING_BUDGET_MS} ms`,
      ],
      ["the list of 50 at p95", inMs(percentile(fiftyMs, 0.95))],
      [
        "the one-item list at the median",
        inMs(
          percentile(
            reads.map((read) => read.oneItem.readMs),
            0.5,
          ),
        ),
      ],
    ]);

    expect(
      reads.map((read) => [read.oneItem.items, read.fifty.items]),
      "the suggestions each owner's list holds",
    ).toEqual(Array.from({ length: RUNS }, () => [1, WAITING_SETS]));
    expect(inOneItemLists, "the list of 50, in one-item lists, at the median").toBeLessThan(
      ONE_STATEMENT_BUDGET_IN_ONE_ITEM_LISTS,
    );
    expect(percentile(fiftyMs, 0.5), "the list of 50 at the median, in ms").toBeLessThan(
      WAITING_BUDGET_MS,
    );
  }, 120_000);
});
