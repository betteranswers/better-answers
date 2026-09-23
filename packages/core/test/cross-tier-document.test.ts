import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { find, open, renderFind, renderOpen } from "../src/answering/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { enqueueJob } from "../src/runs/index.ts";
import {
  findingsOf as findingGroupsOf,
  findingsOfInput,
  keepInText,
  keepInTextInput,
  narrowBinding,
  narrowBindingInput,
  previewChunks,
  previewChunksInput,
  publishBinding,
  publishBindingInput,
  reprocessBinding,
  reprocessBindingInput,
} from "../src/sources/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import {
  bankDetailsGroupOf,
  bindTheHandbook,
  locatorOf,
  THE_ACCOUNT_NUMBER,
  THE_BANK_DETAILS,
  THE_HANDBOOK,
  THE_PASSAGE,
  THE_PLACEHOLDER,
  THE_QUERY,
  THE_RESTORED_SPAN,
  THE_SORT_CODE,
  THE_SPAN_AS_FOUND,
  THE_SPAN_AT,
  THE_TITLE,
  THE_WITHHELD_SPAN,
} from "./cross-tier-fixture.ts";
import { groupNamed, seededBy } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { objectStoreForSuite } from "./suite-objects.ts";
import { answered, leaseLetLapse, readingAs, until } from "./suite-postgres.ts";
import { lmdbRootUnder, runWorkerOnce } from "./worker-process.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, bundles, arrange } = suiteWithBundles();
const store = objectStoreForSuite();

const PUBLISHED_AT = new Date("2026-09-23T09:00:00.000Z");

const READ_AT = new Date("2026-09-23T10:00:00.000Z");

const CONFIRMED = {
  lawfulBasisRecorded: true,
  privacyInformationUpdated: true,
  dpiaReferenced: true,
} as const;

const A_CROSS_TIER_ALLOWANCE_MS = 300_000;

const doorsOf = (scenario: Scenario) => ({
  postgres: scenario.postgres,
  objects: store().door,
});

const acting = <T>(who: UserPrincipal, work: (principal: UserPrincipal, tx: Tx) => Promise<T>) =>
  readingAs(db().runtimePool, who, work);

const runTheWorker = (workerId: string): Promise<void> =>
  runWorkerOnce(db().connectionUri, bundles().root, workerId, store());

const boundHandbook = (scenario: Scenario, called?: string) =>
  bindTheHandbook(scenario.admin, doorsOf(scenario), called);

type ChunkRow = {
  readonly id: string;
  readonly content: string;
  readonly locator: string;
  readonly ordinal: number;
  readonly char_start: number;
  readonly char_end: number;
  readonly source_document_id: string;
};

const chunksOf = async (workspaceId: string, bindingId: string): Promise<readonly ChunkRow[]> => {
  const read = await db().pool.query<ChunkRow>(
    `SELECT id, content, locator, ordinal, char_start, char_end, source_document_id
       FROM "index".chunk WHERE workspace_id = $1 AND binding_id = $2 ORDER BY id`,
    [workspaceId, bindingId],
  );
  return read.rows;
};

type ReadableRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly published_at: Date | null;
};

const readableChunksOf = async (
  workspaceId: string,
  bindingId: string,
): Promise<readonly ReadableRow[]> => {
  const read = await db().pool.query<ReadableRow>(
    `SELECT sensitivity, audience, published_at FROM "index".readable_chunk
      WHERE workspace_id = $1 AND binding_id = $2 ORDER BY ordinal`,
    [workspaceId, bindingId],
  );
  return read.rows;
};

type FindingRow = {
  readonly id: string;
  readonly rule_id: string;
  readonly char_start: number;
  readonly char_end: number;
  readonly review_state: string;
};

const findingsOf = async (
  workspaceId: string,
  documentId: string,
): Promise<readonly FindingRow[]> => {
  const read = await db().pool.query<FindingRow>(
    `SELECT id, rule_id, char_start, char_end, review_state FROM finding
      WHERE workspace_id = $1 AND document_id = $2 ORDER BY char_start`,
    [workspaceId, documentId],
  );
  return read.rows;
};

type JobRow = {
  readonly id: string;
  readonly status: string;
  readonly attempts: number;
  readonly outcome: {
    readonly chunks: number;
    readonly lmdb_bytes: number;
    readonly restores_overridden_by_erasure?: readonly unknown[];
  } | null;
};

const indexRunsOf = async (workspaceId: string, bindingId: string): Promise<readonly JobRow[]> => {
  const read = await db().pool.query<JobRow>(
    `SELECT id, status, attempts, outcome FROM job
      WHERE workspace_id = $1 AND kind = 'index' AND subject_id = $2 ORDER BY enqueued_at, id`,
    [workspaceId, bindingId],
  );
  return read.rows;
};

const statusOf = async (workspaceId: string, jobId: string): Promise<string> => {
  const read = await db().pool.query<{ status: string }>(
    "SELECT status FROM job WHERE workspace_id = $1 AND id = $2",
    [workspaceId, jobId],
  );
  return read.rows[0]?.status ?? "no such job";
};

const bytesUnder = (directory: string): Buffer => {
  const held: Buffer[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      const here = path.join(at, entry);
      if (statSync(here).isDirectory()) walk(here);
      else held.push(readFileSync(here));
    }
  };
  walk(directory);
  return Buffer.concat(held);
};

const storeOf = (workspaceId: string, bindingId: string): string =>
  path.join(lmdbRootUnder(bundles().root), workspaceId, bindingId);

// A binding's directory holds two stores at sibling paths: its own, which a wipe
// removes, and the findings memo's, which a wipe spares.
const BINDING_STORE = "binding";
const FINDINGS_STORE = "findings";

const bindingStoreOf = (workspaceId: string, bindingId: string): string =>
  path.join(storeOf(workspaceId, bindingId), BINDING_STORE);

const findingsStoreOf = (workspaceId: string, bindingId: string): string =>
  path.join(storeOf(workspaceId, bindingId), FINDINGS_STORE);

const spanOf = (chunks: readonly ChunkRow[]) => {
  const first = chunks[0];
  if (first === undefined) throw new Error("the run landed no chunk row");
  return { start: first.char_start, end: first.char_end };
};

const publishedHandbook = async (scenario: Scenario, bindingId: string) => {
  const published = await acting(scenario.admin, (admin, tx) =>
    publishBinding(admin, tx, {
      ...inputOf(publishBindingInput, { bindingId, confirmations: CONFIRMED }),
      publishedAt: PUBLISHED_AT,
    }),
  );
  return answered(published);
};

const finding = (who: UserPrincipal, query: string) =>
  acting(who, (principal, tx) => find(principal, tx, { query, limit: 5 }, READ_AT));

const opening = (who: UserPrincipal, locator: string) =>
  acting(who, (principal, tx) => open(principal, tx, { locator }, READ_AT));

describe("one uploaded document, read back through both tiers", () => {
  it(
    "returns the bound document's passage from find and open with the sort code withheld, once the Admin has reviewed and published it and not before",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario);

      await leaseLetLapse(db().pool, { workspaceId: scenario.workspaceId, jobId: bound.jobId });
      await runTheWorker("cross-tier-1");

      const landed = await chunksOf(scenario.workspaceId, bound.bindingId);
      const locator = locatorOf(bound.documentId, THE_WITHHELD_SPAN);

      const previewed = answered(
        await acting(scenario.admin, (admin, tx) =>
          previewChunks(admin, tx, inputOf(previewChunksInput, { bindingId: bound.bindingId })),
        ),
      );
      const blindFind = answered(await finding(scenario.viewer, THE_QUERY));
      const blindOpen = answered(await opening(scenario.viewer, locator));
      const unpublished = await readableChunksOf(scenario.workspaceId, bound.bindingId);

      expect(landed.map((chunk) => chunk.content)).toEqual([THE_PASSAGE]);
      expect(spanOf(landed)).toEqual(THE_WITHHELD_SPAN);
      expect(previewed.map((chunk) => chunk.locator)).toEqual([locator]);
      expect(previewed.map((chunk) => chunk.content)).toEqual([THE_PASSAGE]);
      expect(blindFind.hits).toEqual([]);
      expect(blindOpen).toEqual({ found: false, locator });
      expect(unpublished).toEqual([
        { sensitivity: "Internal", audience: "everyone", published_at: null },
      ]);

      await publishedHandbook(scenario, bound.bindingId);

      const found = answered(await finding(scenario.viewer, THE_QUERY));
      const opened = answered(await opening(scenario.viewer, locator));
      const published = await readableChunksOf(scenario.workspaceId, bound.bindingId);

      expect(found.hits).toEqual([
        {
          layer: "sources",
          kind: "document",
          title: THE_TITLE,
          locator,
          sensitivity: "Internal",
        },
      ]);
      expect(renderFind(found)).toBe(
        `document · ${THE_TITLE} · Not company knowledge · Internal · ${locator}`,
      );
      expect(opened).toEqual({
        found: true,
        passage: {
          locator,
          source: THE_TITLE,
          text: THE_PASSAGE,
          sensitivity: "Internal",
        },
      });
      expect(renderOpen(opened)).toBe(`> ${THE_PASSAGE}\n\n— ${THE_TITLE} (${locator}) · Internal`);
      expect(published).toEqual([
        { sensitivity: "Internal", audience: "everyone", published_at: PUBLISHED_AT },
      ]);

      const runs = await indexRunsOf(scenario.workspaceId, bound.bindingId);
      expect(runs.map((run) => [run.status, run.attempts])).toEqual([["done", 2]]);
      expect(runs[0]?.outcome?.lmdb_bytes).toBeGreaterThan(0);

      const binding = bytesUnder(bindingStoreOf(scenario.workspaceId, bound.bindingId));
      const findings = bytesUnder(findingsStoreOf(scenario.workspaceId, bound.bindingId));
      expect(findings.byteLength).toBeGreaterThan(0);
      for (const held of [binding, findings]) {
        expect(held.includes(THE_PLACEHOLDER)).toBe(false);
        expect(held.includes(THE_BANK_DETAILS)).toBe(false);
        expect(held.includes(THE_SORT_CODE)).toBe(false);
        expect(held.includes(THE_ACCOUNT_NUMBER)).toBe(false);
      }
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );

  it(
    "leaves every chunk row where it was when the same document is indexed a second time, and lands them all again when a rule change empties the binding",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario);
      await runTheWorker("cross-tier-2");
      const landed = await chunksOf(scenario.workspaceId, bound.bindingId);
      const raised = await findingsOf(scenario.workspaceId, bound.documentId);

      answered(
        await enqueueJob(scenario.admin, scenario.postgres, {
          workspaceId: scenario.workspaceId,
          kind: "index",
          subjectId: bound.bindingId,
          reason: "restored",
        }),
      );
      await runTheWorker("cross-tier-2");
      const unchanged = await chunksOf(scenario.workspaceId, bound.bindingId);
      const raisedAgain = await findingsOf(scenario.workspaceId, bound.documentId);

      const reprocessed = answered(
        await acting(scenario.admin, (admin, tx) =>
          reprocessBinding(
            admin,
            tx,
            inputOf(reprocessBindingInput, {
              bindingId: bound.bindingId,
              reason: "rule-change",
            }),
          ),
        ),
      );
      const emptied = await chunksOf(scenario.workspaceId, bound.bindingId);
      await runTheWorker("cross-tier-2");
      const again = await chunksOf(scenario.workspaceId, bound.bindingId);

      expect(landed.map((chunk) => chunk.content)).toEqual([THE_PASSAGE]);
      expect(raised.map(({ id: _id, ...span }) => span)).toEqual([
        {
          rule_id: "UK_BANK_ACCOUNT",
          char_start: THE_SPAN_AT.start,
          char_end: THE_SPAN_AT.end,
          review_state: "unreviewed",
        },
      ]);
      expect(unchanged).toEqual(landed);
      expect(raisedAgain).toEqual(raised);
      expect(reprocessed.chunks).toBe(1);
      expect(emptied).toEqual([]);
      expect(again).toEqual(landed);
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );

  it(
    "returns the span an Admin keeps in the text once the worker has run over the keep, and withholds it again under an erasure that names it",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario, "kept-handbook.md");
      await runTheWorker("cross-tier-5");
      const withheld = await chunksOf(scenario.workspaceId, bound.bindingId);

      answered(
        await acting(scenario.admin, (admin, tx) =>
          keepInText(
            admin,
            tx,
            inputOf(keepInTextInput, {
              bindingId: bound.bindingId,
              findingGroups: [bankDetailsGroupOf(bound.documentId)],
              reason: "The depot's own account, printed on the company's own page.",
            }),
          ),
        ),
      );
      await runTheWorker("cross-tier-5");
      const kept = await chunksOf(scenario.workspaceId, bound.bindingId);
      const restored = locatorOf(bound.documentId, THE_RESTORED_SPAN);
      await publishedHandbook(scenario, bound.bindingId);

      const found = answered(await finding(scenario.viewer, THE_QUERY));
      const opened = answered(await opening(scenario.viewer, restored));

      await seededBy(db(), (seed) =>
        seed.suppression({
          workspaceId: scenario.workspaceId,
          documentId: bound.documentId,
          identifiers: { emails: [], names: [], other: [THE_SPAN_AS_FOUND] },
        }),
      );
      answered(
        await acting(scenario.admin, (admin, tx) =>
          reprocessBinding(
            admin,
            tx,
            inputOf(reprocessBindingInput, { bindingId: bound.bindingId, reason: "wiped" }),
          ),
        ),
      );
      await runTheWorker("cross-tier-5");

      const erased = await chunksOf(scenario.workspaceId, bound.bindingId);
      const runs = await indexRunsOf(scenario.workspaceId, bound.bindingId);
      const reviewed = answered(
        await acting(scenario.admin, (admin, tx) =>
          findingGroupsOf(admin, tx, inputOf(findingsOfInput, { bindingId: bound.bindingId })),
        ),
      );
      const withheldAgain = answered(
        await opening(scenario.viewer, locatorOf(bound.documentId, THE_WITHHELD_SPAN)),
      );

      expect(withheld.map((chunk) => chunk.content)).toEqual([THE_PASSAGE]);
      expect(kept.map((chunk) => chunk.content)).toEqual([THE_HANDBOOK]);
      expect(spanOf(kept)).toEqual(THE_RESTORED_SPAN);
      expect(found.hits.map((hit) => (hit.layer === "sources" ? hit.locator : hit.iri))).toEqual([
        restored,
      ]);
      expect(opened).toEqual({
        found: true,
        passage: {
          locator: restored,
          source: "kept-handbook.md",
          text: THE_HANDBOOK,
          sensitivity: "Internal",
        },
      });
      expect(erased.map((chunk) => chunk.content)).toEqual([THE_PASSAGE]);
      expect(withheldAgain).toEqual({
        found: true,
        passage: {
          locator: locatorOf(bound.documentId, THE_WITHHELD_SPAN),
          source: "kept-handbook.md",
          text: THE_PASSAGE,
          sensitivity: "Internal",
        },
      });
      expect(runs.at(-1)?.outcome?.restores_overridden_by_erasure).toEqual([
        {
          document_id: bound.documentId,
          rule_id: "UK_BANK_ACCOUNT",
          char_start: THE_SPAN_AT.start,
          char_end: THE_SPAN_AT.end,
        },
      ]);
      expect(reviewed.map((group) => group.overriddenByErasure)).toEqual([1]);
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );

  it(
    "keeps the Admin's narrowing whether it lands inside the run or after it, and a binding narrowed to a group is read by that group alone",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario);

      const running = runTheWorker("cross-tier-3");
      await until(async () => (await statusOf(scenario.workspaceId, bound.jobId)) === "claimed");
      answered(
        await acting(scenario.admin, (admin, tx) =>
          narrowBinding(
            admin,
            tx,
            inputOf(narrowBindingInput, {
              bindingId: bound.bindingId,
              sensitivity: "Restricted",
              audience: "everyone",
            }),
          ),
        ),
      );
      const whenTheNarrowingLanded = await statusOf(scenario.workspaceId, bound.jobId);
      await running;

      await publishedHandbook(scenario, bound.bindingId);
      const raced = await chunksOf(scenario.workspaceId, bound.bindingId);
      const racedClass = await readableChunksOf(scenario.workspaceId, bound.bindingId);
      const racedByTheViewer = answered(await finding(scenario.viewer, THE_QUERY));
      const racedByTheAdmin = answered(await finding(scenario.admin, THE_QUERY));

      const later = await boundHandbook(scenario, "second-handbook.md");
      await runTheWorker("cross-tier-3");
      const depot = await groupNamed(db(), scenario, "Depot", [scenario.editor]);
      answered(
        await acting(scenario.admin, (admin, tx) =>
          narrowBinding(
            admin,
            tx,
            inputOf(narrowBindingInput, {
              bindingId: later.bindingId,
              sensitivity: "Internal",
              audience: "groups",
              audienceGroups: [depot],
            }),
          ),
        ),
      );
      await publishedHandbook(scenario, later.bindingId);
      const afterwards = await chunksOf(scenario.workspaceId, later.bindingId);
      const afterwardsClass = await readableChunksOf(scenario.workspaceId, later.bindingId);
      const seenByTheGroup = answered(await finding(scenario.editor, THE_QUERY));
      const seenByTheRest = answered(await finding(scenario.viewer, THE_QUERY));

      expect(whenTheNarrowingLanded).toBe("claimed");
      expect(raced.map((chunk) => chunk.content)).toEqual([THE_PASSAGE]);
      expect(racedClass.map((chunk) => [chunk.sensitivity, chunk.audience])).toEqual([
        ["Restricted", "everyone"],
      ]);
      expect(racedByTheViewer.hits).toEqual([]);
      expect(
        racedByTheAdmin.hits.map((hit) => (hit.layer === "sources" ? hit.locator : hit.iri)),
      ).toEqual([locatorOf(bound.documentId, THE_WITHHELD_SPAN)]);

      expect(afterwards.map((chunk) => chunk.content)).toEqual([THE_PASSAGE]);
      expect(afterwardsClass.map((chunk) => [chunk.sensitivity, chunk.audience])).toEqual([
        ["Internal", "groups"],
      ]);
      expect(
        seenByTheGroup.hits.map((hit) => (hit.layer === "sources" ? hit.locator : hit.iri)),
      ).toEqual([locatorOf(later.documentId, THE_WITHHELD_SPAN)]);
      expect(seenByTheRest.hits).toEqual([]);
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );

  it(
    "leaves one binding's chunk rows and its store standing when the binding beside it is wiped",
    async () => {
      const scenario = await arrange();
      const kept = await boundHandbook(scenario, "the-handbook-that-stays.md");
      const dropped = await boundHandbook(scenario, "the-handbook-that-goes.md");
      await runTheWorker("cross-tier-4");
      await runTheWorker("cross-tier-4");
      const before = await chunksOf(scenario.workspaceId, kept.bindingId);

      answered(
        await acting(scenario.admin, (admin, tx) =>
          reprocessBinding(
            admin,
            tx,
            inputOf(reprocessBindingInput, { bindingId: dropped.bindingId, reason: "wiped" }),
          ),
        ),
      );
      // The act that withdraws a binding's documents is S4's; this is the row state it leaves.
      await db().pool.query(
        "DELETE FROM source_document WHERE workspace_id = $1 AND binding_id = $2",
        [scenario.workspaceId, dropped.bindingId],
      );
      await runTheWorker("cross-tier-4");

      const standing = bytesUnder(findingsStoreOf(scenario.workspaceId, kept.bindingId));

      expect(before.map((chunk) => chunk.content)).toEqual([THE_PASSAGE]);
      expect(await chunksOf(scenario.workspaceId, dropped.bindingId)).toEqual([]);
      expect(await chunksOf(scenario.workspaceId, kept.bindingId)).toEqual(before);
      expect(standing.byteLength).toBeGreaterThan(0);
      expect(standing.includes(THE_PLACEHOLDER)).toBe(false);
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );
});
