import type pg from "pg";
import { describe, expect, it } from "vitest";

import { writeConceptDelta } from "@better-answers/core/store/map";
import { citedSourcesOf } from "@better-answers/schema";
import { testData, type TestData } from "@better-answers/schema/testing";

import {
  writeConcept,
  type ConceptWritten,
  type WriteConceptInput,
} from "../../src/concepts/index.ts";
import type { Tx } from "../../src/store/postgres/index.ts";
import { doorsOf, suiteWithBundles, type Scenario } from "../fixtures/workspace-with-bundle.ts";
import { percentile, recordFigures } from "../support/figures.ts";
import { answered, readingAs, seedingWith } from "../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

const CONCEPTS = 3_000;
const LINKING = 300;
const CITERS_EACH = 3;
const PENDING = LINKING / CITERS_EACH;
const WRITES = 20;
const CITING_WRITE_UPS = 8;
const BACKFILLS = 20;

const WRITE_BUDGET_TIMEOUT_MS = 600_000;

const inTenthsOfMs = (value: number): string => `${value.toFixed(1)} ms`;

const pendingPath = (target: number): string => `knowledge/pending/target-${target}.md`;

const PROSE = [
  "Expenses under this rule are claimed within thirty days of the cost being paid.",
  "A claim carries its receipt, the cost centre it is charged to and the approver who signed it.",
  "Travel is booked through the company's agent unless a cheaper fare is shown in writing.",
  "Mileage is paid at the published rate per mile, and fuel receipts are kept for six years.",
  "A claim over the approver's limit goes to the finance director before it is paid.",
  "Gifts and hospitality over the threshold are entered in the register within a week.",
].join(" ");

const seededBody = (at: number): string =>
  [
    `# Rule ${at}`,
    "",
    PROSE,
    "",
    at < LINKING
      ? `Rule ${at} rests on [the pending rule](/${pendingPath(at % PENDING)}).`
      : `Rule ${at} rests on no other rule.`,
    "",
    PROSE,
  ].join("\n");

type IndexRow = Awaited<ReturnType<TestData["conceptIndex"]>>;

const deltaOf = (row: IndexRow) => ({
  workspaceId: row.workspaceId,
  iri: row.iri,
  kind: row.kind,
  path: row.path,
  body: row.body,
  sources: citedSourcesOf(row.frontmatter?.["sources"]),
  publishedAt: row.publishedAt,
  sensitivity: row.sensitivity,
  audience: row.audience,
  audienceGroups: row.audienceGroups,
  status: row.status,
});

const seedTheWorkspace = async (scenario: Scenario): Promise<string> => {
  const workspaceId = scenario.workspaceId;
  const { commitSha, rows } = await seedingWith(db().pool, async (seed) => {
    const sha = (await seed.bundleCommit({ workspaceId })).sha;
    const seeded: IndexRow[] = [];
    for (let at = 0; at < CONCEPTS; at += 1) {
      seeded.push(
        await seed.conceptIndex({
          workspaceId,
          commitSha: sha,
          path: `knowledge/seeded/rule-${at}.md`,
          body: seededBody(at),
        }),
      );
    }
    return { commitSha: sha, rows: seeded };
  });
  for (const row of rows) {
    answered(
      await readingAs(db().runtimePool, scenario.admin, (principal, tx) =>
        writeConceptDelta(principal, tx, deltaOf(row)),
      ),
    );
  }
  await db().pool.query("ANALYZE");
  return commitSha;
};

const INBOUND_LINKS = `SELECT count(*)::int AS inbound
    FROM map_edge e
    JOIN map_generation g ON g.workspace_id = e.workspace_id AND e.gen = g.live_gen
   WHERE e.workspace_id = $1 AND e.to_uid = $2 AND e.label = 'LINKS_TO'`;

const inboundLinks = async (tx: Tx, workspaceId: string, iri: string): Promise<number> => {
  const found = await tx.query<{ inbound: number }>(INBOUND_LINKS, [workspaceId, iri]);
  return found.rows[0]?.inbound ?? 0;
};

const writeOf = (target: number, head: string | null): WriteConceptInput => ({
  mergeKey: `policy:pending-${target}`,
  path: pendingPath(target),
  kind: "Policy",
  title: `Pending ${target}`,
  frontmatter: { title: `Pending ${target}`, type: "Policy" },
  body: `The rule ${target} the seeded rules were waiting for.`,
  message: `Record pending rule ${target}`,
  author: { name: "Ada Admin", email: "ada@acme.invalid" },
  expects: { head },
  status: "stable",
  sensitivity: "Internal",
});

const timedWrites = async (scenario: Scenario): Promise<readonly number[]> => {
  const writeMs: number[] = [];
  let head: string | null = null;
  for (let target = 0; target < WRITES; target += 1) {
    const started = performance.now();
    const written = await writeConcept(scenario.admin, doorsOf(scenario), writeOf(target, head));
    writeMs.push(performance.now() - started);
    if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
    head = written.value.sha;
    expect(
      await inboundLinks(db().pool, scenario.workspaceId, written.value.iri),
      `the links waiting for ${pendingPath(target)}`,
    ).toBe(CITERS_EACH);
  }
  return writeMs;
};

const rolledBack = async <T>(
  workspaceId: string,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await db().runtimePool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    return await work(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
};

const timedBackfills = async (
  scenario: Scenario,
  commitSha: string,
): Promise<readonly number[]> => {
  const workspaceId = scenario.workspaceId;
  const backfillMs: number[] = [];
  for (let target = WRITES; target < WRITES + BACKFILLS; target += 1) {
    await rolledBack(workspaceId, async (tx) => {
      const landed = await testData(tx).conceptIndex({
        workspaceId,
        commitSha,
        path: pendingPath(target),
      });
      const started = performance.now();
      await writeConceptDelta(scenario.admin, tx, deltaOf(landed));
      backfillMs.push(performance.now() - started);
      expect(
        await inboundLinks(tx, workspaceId, landed.iri),
        `the links waiting for ${pendingPath(target)}`,
      ).toBe(CITERS_EACH);
    });
  }
  return backfillMs;
};

const citedOf = (target: number, head: string | null): WriteConceptInput => ({
  mergeKey: `policy:cited-${target}`,
  path: `knowledge/policy/cited-${target}.md`,
  kind: "Policy",
  title: `Cited ${target}`,
  frontmatter: { title: `Cited ${target}`, type: "Policy" },
  body: `Rule ${target} is the rule eight sections of the bid library draw on.`,
  message: `Record cited rule ${target}`,
  author: { name: "Ada Editor", email: "ada@acme.invalid" },
  expects: { head },
  status: "stable",
  sensitivity: "Internal",
});

const rewriteOf = (target: number, landed: ConceptWritten, head: string): WriteConceptInput => {
  const cited = citedOf(target, head);
  return {
    ...cited,
    iri: landed.iri,
    body: `${cited.body} Receipts are kept for six years.`,
    message: `Rewrite cited rule ${target}`,
    reuse: "confirmed",
  };
};

const writtenBy = async (scenario: Scenario, input: WriteConceptInput): Promise<ConceptWritten> => {
  const written = await writeConcept(scenario.editor, doorsOf(scenario), input);
  if (!written.ok) throw new Error(`the write was refused: ${String(written.error)}`);
  return written.value;
};

const storedHashOf = async (workspaceId: string, iri: string): Promise<string> => {
  const found = await db().pool.query<{ content_hash: string }>(
    "SELECT content_hash FROM concept_index WHERE workspace_id = $1 AND iri = $2",
    [workspaceId, iri],
  );
  const hash = found.rows[0]?.content_hash;
  if (hash === undefined) throw new Error(`${iri} has no row in concept_index`);
  return hash;
};

const landTheCitedConcepts = async (scenario: Scenario) => {
  const { workspaceId } = scenario;
  const cited: ConceptWritten[] = [];
  let head: string | null = null;
  for (let target = 0; target < WRITES; target += 1) {
    const landed = await writtenBy(scenario, citedOf(target, head));
    cited.push(landed);
    head = landed.sha;
  }
  await seedingWith(db().pool, async (seed) => {
    const guideId = (await seed.guideDefinition({ workspaceId })).id;
    for (const landed of cited) {
      const contentHash = await storedHashOf(workspaceId, landed.iri);
      for (let at = 0; at < CITING_WRITE_UPS; at += 1) {
        const writeUp = await seed.writeUp({ workspaceId, guideId });
        await seed.writeUpInclude({
          workspaceId,
          writeUpId: writeUp.id,
          iri: landed.iri,
          contentHash,
        });
      }
    }
  });
  return { cited, head };
};

const writeUpsIncluding = async (workspaceId: string, iri: string): Promise<number> => {
  const found = await db().pool.query<{ including: number }>(
    `SELECT count(DISTINCT write_up_id)::int AS including
       FROM write_up_include WHERE workspace_id = $1 AND iri = $2`,
    [workspaceId, iri],
  );
  return found.rows[0]?.including ?? 0;
};

const timedRewrites = async (
  scenario: Scenario,
  cited: readonly ConceptWritten[],
  from: string | null,
): Promise<readonly number[]> => {
  if (from === null) throw new Error("the cited concepts left no head");
  const writeMs: number[] = [];
  let head = from;
  for (const [target, landed] of cited.entries()) {
    const started = performance.now();
    const written = await writeConcept(
      scenario.editor,
      doorsOf(scenario),
      rewriteOf(target, landed, head),
    );
    writeMs.push(performance.now() - started);
    if (!written.ok) throw new Error(`the rewrite was refused: ${String(written.error)}`);
    head = written.value.sha;
    expect(
      await writeUpsIncluding(scenario.workspaceId, written.value.iri),
      `the write-ups including cited rule ${target}`,
    ).toBe(CITING_WRITE_UPS);
  }
  return writeMs;
};

describe("the governed write over a workspace of 3,000 concepts", () => {
  it(
    "records the governed write at 3,000 concepts",
    async () => {
      const scenario = await arrange();
      const commitSha = await seedTheWorkspace(scenario);

      const writeMs = await timedWrites(scenario);
      const backfillMs = await timedBackfills(scenario, commitSha);

      await recordFigures("The governed write at 3,000 concepts", [
        ["the whole write at the median", inTenthsOfMs(percentile(writeMs, 0.5))],
        ["the whole write at p95", inTenthsOfMs(percentile(writeMs, 0.95))],
        ["the backfill at the median", inTenthsOfMs(percentile(backfillMs, 0.5))],
      ]);
      expect([writeMs.length, backfillMs.length]).toEqual([WRITES, BACKFILLS]);
    },
    WRITE_BUDGET_TIMEOUT_MS,
  );
  it(
    "records the governed write over citing write-ups",
    async () => {
      const scenario = await arrange();
      await seedTheWorkspace(scenario);
      const { cited, head } = await landTheCitedConcepts(scenario);
      await db().pool.query("ANALYZE");

      const writeMs = await timedRewrites(scenario, cited, head);

      await recordFigures("The governed write over citing write-ups at 3,000 concepts", [
        ["the whole write at the median", inTenthsOfMs(percentile(writeMs, 0.5))],
        ["the whole write at p95", inTenthsOfMs(percentile(writeMs, 0.95))],
      ]);
      expect(writeMs).toHaveLength(WRITES);
    },
    WRITE_BUDGET_TIMEOUT_MS,
  );
});
