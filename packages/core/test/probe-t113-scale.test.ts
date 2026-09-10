import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { beforeAll, describe, expect, it } from "vitest";

import { readableClause, readableParameters } from "@better-answers/core/access";
import { head } from "@better-answers/core/store/git";
import {
  GRAPH_WALK_DEPTH,
  GRAPH_WALK_ROW_LIMIT,
  walkFrom,
  type WalkStep,
} from "@better-answers/core/store/graph";

import { writeConcept, type WriteConceptInput } from "../src/concepts/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { narrowBinding } from "../src/sources/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { bindingHolding } from "./sourced-concept.ts";
import { readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * PROBE — THROWAWAY (T-113, probe 3 of 4; route spec, Further Notes). Never merged.
 *
 * A seeded map of `PROBE_CONCEPTS` concepts (3,000 by default — the first client's size)
 * through seam 1, timing:
 *
 *   (1) **the creation** — every write of the seed is a creation over what is already there,
 *       so the per-write cost at N is the curve write-path F3 reasons about (the regex
 *       backfill scan inside the lock); the scan is also timed alone;
 *   (2) **an N-entry walk** — forty entries as `ask` does it today (one `walkFrom` per hit in
 *       one transaction) against one set-seeded walk (`= ANY($2::text[])`, write-path F1)
 *       under one shared cap (owner D1);
 *   (3) **a narrowing over a binding backing hundreds of concepts** — `narrowBinding`
 *       through the interface, the cascade's first and second level (write-path F6).
 *
 * Nothing here is a budget: the file records and prints. The numbers land in
 * `.scratch/v01-route/probes/results/probe-3.json` for the S0 + S1 spec to read.
 */

const CONCEPTS = Number(process.env["PROBE_CONCEPTS"] ?? 3_000);
const LINKS_EACH = 6;
const CITING = Number(process.env["PROBE_CITING"] ?? 300);
const ENTRIES = 40;
const SAMPLE_EVERY = 250;
const RESULTS_DIR = new URL("../../../.scratch/v01-route/probes/results/", import.meta.url);

const { db, arrange } = suiteWithBundles();

/** About a kilobyte of prose plus links to the six concepts before it — a body a client writes. */
const bodyOf = (at: number): string => {
  const links: string[] = [];
  for (let target = Math.max(0, at - LINKS_EACH); target < at; target += 1) {
    links.push(`Rule ${at} rests on [rule ${target}](./expenses-${target}.md).`);
  }
  const prose = Array.from(
    { length: 6 },
    (_u, p) =>
      `Paragraph ${p} of rule ${at}: a claim is made within thirty days of the spend, carries its receipt, names the cost centre it is charged to, and is approved by the budget holder before finance settles it. Mileage is claimed at the published rate; subsistence follows the day-rate table; anything outside policy is a written exception.`,
  ).join("\n\n");
  return `## Details\n\n${prose}\n\n${links.join("\n\n")}\n`;
};

const writeOf = (
  at: number,
  headSha: string | null,
  documentId: string | undefined,
): WriteConceptInput => ({
  mergeKey: `policy:expenses-${at}`,
  path: `knowledge/expenses-${at}.md`,
  kind: "Policy",
  title: `Expenses ${at}`,
  frontmatter: { title: `Expenses ${at}`, type: "Policy", tags: [`rule-${at % 17}`, "expenses"] },
  body: bodyOf(at),
  message: `Record expenses rule ${at}`,
  author: { name: "Ada Editor", email: "ada@acme.invalid" },
  expects: { head: headSha },
  status: "stable",
  sensitivity: "Internal",
  ...(documentId === undefined
    ? {}
    : {
        evidence: [
          { sourceDocumentId: documentId, locator: `p.${at}`, resource: `Handbook p.${at}` },
        ],
      }),
});

type Seeded = {
  readonly scenario: Scenario;
  readonly iris: readonly string[];
  readonly bindingId: string;
  readonly writeSamples: readonly { at: number; ms: number }[];
  readonly seedMs: number;
};

const percentile = (sorted: readonly number[], fraction: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;

const landMap = async (scenario: Scenario): Promise<Seeded> => {
  const binding = await bindingHolding(db(), scenario.workspaceId);
  const iris: string[] = [];
  const writeSamples: { at: number; ms: number }[] = [];
  let headSha: string | null = null;
  const started = performance.now();
  let window: number[] = [];
  for (let at = 0; at < CONCEPTS; at += 1) {
    const cites = at < CITING ? binding.documentId : undefined;
    const t0 = performance.now();
    const written = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      writeOf(at, headSha, cites),
    );
    const ms = performance.now() - t0;
    if (!written.ok) throw new Error(`write ${at} refused: ${String(written.error)}`);
    headSha = written.value.sha;
    iris.push(written.value.iri);
    window.push(ms);
    if ((at + 1) % SAMPLE_EVERY === 0 || at === CONCEPTS - 1) {
      const sorted = window.toSorted((a, b) => a - b);
      const sample = { at: at + 1, ms: Number(percentile(sorted, 0.5).toFixed(1)) };
      writeSamples.push(sample);
      console.log(
        `[probe-3] seeded ${at + 1}/${CONCEPTS} — p50 write over last ${window.length}: ${sample.ms} ms (max ${sorted.at(-1)?.toFixed(0)} ms)`,
      );
      window = [];
    }
  }
  return {
    scenario,
    iris,
    bindingId: binding.bindingId,
    writeSamples,
    seedMs: performance.now() - started,
  };
};

/** The set-seeded walk: `walkStatement(true)` with its entry widened to `= ANY($2::text[])`. */
const SET_WALK = `WITH RECURSIVE live AS (
    SELECT live_gen FROM graph_generation WHERE workspace_id = $1
  ),
  walk AS (
    SELECT n.uid, n.label, n.kind, 0 AS depth, ARRAY[n.uid] AS path
      FROM graph_node n
      JOIN live ON n.gen IS NULL OR n.gen = live.live_gen
     WHERE n.workspace_id = $1 AND n.uid = ANY($2::text[])
       AND ${readableClause("n", 3)}
    UNION ALL
    SELECT m.uid, m.label, m.kind, w.depth + 1, w.path || m.uid
      FROM walk w
      JOIN graph_edge e ON e.workspace_id = $1 AND e.from_uid = w.uid
      JOIN live edge_live ON e.gen IS NULL OR e.gen = edge_live.live_gen
      JOIN graph_node m ON m.workspace_id = $1 AND m.uid = e.to_uid
      JOIN live node_live ON m.gen IS NULL OR m.gen = node_live.live_gen
     WHERE w.depth < ${GRAPH_WALK_DEPTH}
       AND m.uid <> ALL(w.path)
       AND ${readableClause("e", 3)}
       AND ${readableClause("m", 3)}
  )
  SELECT uid, label, kind, depth, path
    FROM (SELECT uid, label, kind, depth, path FROM walk LIMIT ${GRAPH_WALK_ROW_LIMIT}) reached
   ORDER BY depth, uid`;

const walkSet = async (
  principal: UserPrincipal,
  tx: Tx,
  uids: readonly string[],
): Promise<readonly WalkStep[]> => {
  const found = await tx.query<WalkStep>(SET_WALK, [
    principal.workspaceId,
    uids,
    ...readableParameters(principal),
  ]);
  return found.rows;
};

const timed = async <T>(work: () => Promise<T>): Promise<{ ms: number; value: T }> => {
  const t0 = performance.now();
  const value = await work();
  return { ms: performance.now() - t0, value };
};

describe("probe 3: a seeded map at the first client's size, through seam 1", () => {
  let seeded: Seeded;
  const results: Record<string, unknown> = {
    concepts: CONCEPTS,
    citing: CITING,
    entries: ENTRIES,
    machine: `${process.platform} ${process.arch} node ${process.version}`,
    at: new Date().toISOString(),
  };

  beforeAll(async () => {
    seeded = await landMap(await arrange());
    results["seed"] = {
      totalMs: Math.round(seeded.seedMs),
      p50WriteMsByCount: seeded.writeSamples,
    };
  }, 3_600_000);

  it("(1) times one creation at N and the backfill scan alone", async () => {
    const { scenario, iris } = seeded;
    const headSha = await head(scenario.editor, scenario.git);
    const creation = await timed(() =>
      writeConcept(scenario.editor, doorsOf(scenario), writeOf(CONCEPTS, headSha, undefined)),
    );
    if (!creation.value.ok) throw new Error(String(creation.value.error));

    // The scan `writeConceptDelta` runs for a new concept, alone, as the superuser.
    const pattern = `(^|[\\s"'(<:/[])expenses-${CONCEPTS}\\.md`;
    const scans: number[] = [];
    for (let round = 0; round < 5; round += 1) {
      const scan = await timed(() =>
        db().pool.query(
          `SELECT iri FROM concept_index WHERE workspace_id = $1 AND iri <> $2 AND (body ~ $3 OR frontmatter::text ~ $3)`,
          [scenario.workspaceId, creation.value.ok ? creation.value.value.iri : "", pattern],
        ),
      );
      scans.push(scan.ms);
    }
    const rows = await db().pool.query<{ n: string; bytes: string }>(
      "SELECT count(*) AS n, pg_size_pretty(pg_total_relation_size('concept_index')) AS bytes FROM concept_index WHERE workspace_id = $1",
      [scenario.workspaceId],
    );
    results["creation"] = {
      atN: CONCEPTS,
      wholeWriteMs: Math.round(creation.ms),
      backfillScanMs: scans.map((ms) => Number(ms.toFixed(1))),
      conceptIndexRows: Number(rows.rows[0]?.n),
      conceptIndexSize: rows.rows[0]?.bytes,
    };
    console.log("[probe-3] creation:", results["creation"]);
    expect(iris.length).toBe(CONCEPTS);
  }, 600_000);

  it("(2) times a forty-entry walk: forty walks in one transaction against one set-seeded walk", async () => {
    const { scenario, iris } = seeded;
    const stride = Math.floor(iris.length / ENTRIES);
    const entries = Array.from(
      { length: ENTRIES },
      (_u, i) => iris[iris.length - 1 - i * stride] ?? "",
    );
    const readers = [scenario.viewer, scenario.admin];

    const perEntry: number[] = [];
    const perEntryRows: number[] = [];
    const asSet: number[] = [];
    const asSetRows: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      const reader = readers[round % 2] ?? scenario.viewer;
      const many = await timed(() =>
        readingAs(db().runtimePool, reader, async (principal, tx) => {
          let rows = 0;
          for (const uid of entries) rows += (await walkFrom(principal, tx, uid)).length;
          return rows;
        }),
      );
      perEntry.push(many.ms);
      perEntryRows.push(many.value);
      const once = await timed(() =>
        readingAs(db().runtimePool, reader, (principal, tx) => walkSet(principal, tx, entries)),
      );
      asSet.push(once.ms);
      asSetRows.push(once.value.length);
    }
    const p50 = (xs: number[]) =>
      Number(
        percentile(
          xs.toSorted((a, b) => a - b),
          0.5,
        ).toFixed(1),
      );
    results["walk"] = {
      entries: ENTRIES,
      fortyWalksOneTx: {
        p50Ms: p50(perEntry),
        maxMs: Math.round(Math.max(...perEntry)),
        rows: perEntryRows,
      },
      oneSetWalk: { p50Ms: p50(asSet), maxMs: Math.round(Math.max(...asSet)), rows: asSetRows },
      oneWalkP50Ms: p50(
        await Promise.all(
          entries
            .slice(0, 5)
            .map(
              async (uid) =>
                (
                  await timed(() =>
                    readingAs(db().runtimePool, scenario.viewer, (p, tx) => walkFrom(p, tx, uid)),
                  )
                ).ms,
            ),
        ),
      ),
    };
    console.log("[probe-3] walk:", JSON.stringify(results["walk"]));
    expect(asSetRows.every((n) => n > 0)).toBe(true);
  }, 600_000);

  it("(3) times a narrowing over a binding backing hundreds of concepts", async () => {
    const { scenario, bindingId } = seeded;
    const cited = await db().pool.query<{ n: string }>(
      `SELECT count(DISTINCT ce.iri) AS n FROM concept_evidence ce
         JOIN source_document d ON d.workspace_id = ce.workspace_id AND d.id = ce.source_document_id
        WHERE ce.workspace_id = $1 AND d.binding_id = $2`,
      [scenario.workspaceId, bindingId],
    );
    const narrowed = await timed(() =>
      readingAs(db().runtimePool, scenario.admin, (admin, tx) =>
        narrowBinding(admin, tx, { bindingId, sensitivity: "Restricted", audience: "everyone" }),
      ),
    );
    if (!narrowed.value.ok) throw new Error(String(narrowed.value.error));
    // A second narrowing (Confidential → still narrower) so the cost is read twice.
    const again = await timed(() =>
      readingAs(db().runtimePool, scenario.admin, (admin, tx) =>
        narrowBinding(admin, tx, {
          bindingId,
          sensitivity: "Restricted",
          audience: "groups",
          audienceGroups: [],
        }),
      ),
    );
    results["narrowing"] = {
      conceptsCitingTheBinding: Number(cited.rows[0]?.n),
      conceptsMoved: narrowed.value.value.concepts.length,
      compositionsMoved: narrowed.value.value.compositions.length,
      firstMs: Math.round(narrowed.ms),
      secondMs: Math.round(again.ms),
      secondOutcome: again.value.ok ? "ok" : String(again.value.error),
      msPerConcept: Number(
        (narrowed.ms / Math.max(1, narrowed.value.value.concepts.length)).toFixed(2),
      ),
    };
    console.log("[probe-3] narrowing:", results["narrowing"]);

    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(new URL("probe-3.json", RESULTS_DIR), JSON.stringify(results, null, 2));
    console.log("[probe-3] RESULTS\n" + JSON.stringify(results, null, 2));
    expect(narrowed.value.value.concepts.length).toBe(CITING);
  }, 600_000);
});
