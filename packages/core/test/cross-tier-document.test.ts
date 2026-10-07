import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { find, open, renderFind, renderOpen } from "../src/answering/index.ts";
import { ERASURE, recordSubjectRequest, runErasure } from "../src/erasure/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { enqueueJob } from "../src/runs/index.ts";
import {
  findingsOf as findingGroupsOf,
  findingsOfInput,
  keepInText,
  keepInTextInput,
  narrowConnectedSource,
  narrowConnectedSourceInput,
  previewPassages,
  previewPassagesInput,
  publishConnectedSource,
  publishConnectedSourceInput,
  reprocessConnectedSource,
  reprocessConnectedSourceInput,
} from "../src/sources/index.ts";
import { getObject } from "../src/store/objects/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import {
  bankDetailsGroupOf,
  connectTheHandbook,
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
import { objectStoreForSuite, textOf } from "./suite-objects.ts";
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

const boundHandbook = (scenario: Scenario, called?: string, text?: string) =>
  connectTheHandbook(scenario.admin, doorsOf(scenario), called, text);

type PassageRow = {
  readonly id: string;
  readonly content: string;
  readonly locator: string;
  readonly ordinal: number;
  readonly char_start: number;
  readonly char_end: number;
  readonly source_document_id: string;
};

const passagesOf = async (
  workspaceId: string,
  connectedSourceId: string,
): Promise<readonly PassageRow[]> => {
  const read = await db().pool.query<PassageRow>(
    `SELECT id, content, locator, ordinal, char_start, char_end, source_document_id
       FROM "index".passage WHERE workspace_id = $1 AND connected_source_id = $2 ORDER BY id`,
    [workspaceId, connectedSourceId],
  );
  return read.rows;
};

type ReadableRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly published_at: Date | null;
};

const readablePassagesOf = async (
  workspaceId: string,
  connectedSourceId: string,
): Promise<readonly ReadableRow[]> => {
  const read = await db().pool.query<ReadableRow>(
    `SELECT sensitivity, audience, published_at FROM "index".readable_passage
      WHERE workspace_id = $1 AND connected_source_id = $2 ORDER BY ordinal`,
    [workspaceId, connectedSourceId],
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
    readonly passages: number;
    readonly lmdb_bytes: number;
    readonly restores_overridden_by_erasure?: readonly unknown[];
  } | null;
};

const syncsOf = async (
  workspaceId: string,
  connectedSourceId: string,
): Promise<readonly JobRow[]> => {
  const read = await db().pool.query<JobRow>(
    `SELECT id, status, attempts, outcome FROM job
      WHERE workspace_id = $1 AND kind = 'index' AND subject_id = $2 ORDER BY enqueued_at, id`,
    [workspaceId, connectedSourceId],
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

const storeOf = (workspaceId: string, connectedSourceId: string): string =>
  path.join(lmdbRootUnder(bundles().root), workspaceId, connectedSourceId);

/** A connected source's own store, which a wipe removes; the findings memo's sits beside it. */
const CONNECTED_SOURCE_STORE = "connected_source";
/** The findings memo's store, beside the connected source's own, which a wipe spares. */
const FINDINGS_STORE = "findings";

const connectedSourceStoreOf = (workspaceId: string, connectedSourceId: string): string =>
  path.join(storeOf(workspaceId, connectedSourceId), CONNECTED_SOURCE_STORE);

const findingsStoreOf = (workspaceId: string, connectedSourceId: string): string =>
  path.join(storeOf(workspaceId, connectedSourceId), FINDINGS_STORE);

const spanOf = (passages: readonly PassageRow[]) => {
  const first = passages[0];
  if (first === undefined) throw new Error("the sync landed no passage row");
  return { start: first.char_start, end: first.char_end };
};

const publishedHandbook = async (scenario: Scenario, connectedSourceId: string) => {
  const published = await acting(scenario.admin, (admin, tx) =>
    publishConnectedSource(admin, tx, {
      ...inputOf(publishConnectedSourceInput, { connectedSourceId, confirmations: CONFIRMED }),
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
    "finds and opens the passage, sort code withheld, once published",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario);

      await leaseLetLapse(db().pool, { workspaceId: scenario.workspaceId, jobId: bound.jobId });
      await runTheWorker("cross-tier-1");

      const landed = await passagesOf(scenario.workspaceId, bound.connectedSourceId);
      const locator = locatorOf(bound.documentId, THE_WITHHELD_SPAN);

      const previewed = answered(
        await acting(scenario.admin, (admin, tx) =>
          previewPassages(
            admin,
            tx,
            inputOf(previewPassagesInput, { connectedSourceId: bound.connectedSourceId }),
          ),
        ),
      );
      const blindFind = answered(await finding(scenario.viewer, THE_QUERY));
      const blindOpen = answered(await opening(scenario.viewer, locator));
      const unpublished = await readablePassagesOf(scenario.workspaceId, bound.connectedSourceId);

      expect(landed.map((passage) => passage.content)).toEqual([THE_PASSAGE]);
      expect(spanOf(landed)).toEqual(THE_WITHHELD_SPAN);
      expect(previewed.map((passage) => passage.locator)).toEqual([locator]);
      expect(previewed.map((passage) => passage.content)).toEqual([THE_PASSAGE]);
      expect(blindFind.hits).toEqual([]);
      expect(blindOpen).toEqual({ found: false, locator });
      expect(unpublished).toEqual([
        { sensitivity: "Internal", audience: "everyone", published_at: null },
      ]);

      await publishedHandbook(scenario, bound.connectedSourceId);

      const found = answered(await finding(scenario.viewer, THE_QUERY));
      const opened = answered(await opening(scenario.viewer, locator));
      const published = await readablePassagesOf(scenario.workspaceId, bound.connectedSourceId);

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

      const runs = await syncsOf(scenario.workspaceId, bound.connectedSourceId);
      expect(runs.map((run) => [run.status, run.attempts])).toEqual([["done", 2]]);
      expect(runs[0]?.outcome?.lmdb_bytes).toBeGreaterThan(0);

      const connectedSource = bytesUnder(
        connectedSourceStoreOf(scenario.workspaceId, bound.connectedSourceId),
      );
      const findings = bytesUnder(findingsStoreOf(scenario.workspaceId, bound.connectedSourceId));
      expect(findings.byteLength).toBeGreaterThan(0);
      for (const held of [connectedSource, findings]) {
        expect(held.includes(THE_PLACEHOLDER)).toBe(false);
        expect(held.includes(THE_BANK_DETAILS)).toBe(false);
        expect(held.includes(THE_SORT_CODE)).toBe(false);
        expect(held.includes(THE_ACCOUNT_NUMBER)).toBe(false);
      }
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );

  it(
    "keeps passage rows when reindexed, landing them anew once emptied",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario);
      await runTheWorker("cross-tier-2");
      const landed = await passagesOf(scenario.workspaceId, bound.connectedSourceId);
      const raised = await findingsOf(scenario.workspaceId, bound.documentId);

      answered(
        await enqueueJob(scenario.admin, scenario.postgres, {
          workspaceId: scenario.workspaceId,
          kind: "index",
          subjectId: bound.connectedSourceId,
          reason: "restored",
        }),
      );
      await runTheWorker("cross-tier-2");
      const unchanged = await passagesOf(scenario.workspaceId, bound.connectedSourceId);
      const raisedAgain = await findingsOf(scenario.workspaceId, bound.documentId);

      const reprocessed = answered(
        await acting(scenario.admin, (admin, tx) =>
          reprocessConnectedSource(
            admin,
            tx,
            inputOf(reprocessConnectedSourceInput, {
              workspaceId: scenario.workspaceId,
              connectedSourceId: bound.connectedSourceId,
              reason: "rule-change",
            }),
          ),
        ),
      );
      const emptied = await passagesOf(scenario.workspaceId, bound.connectedSourceId);
      await runTheWorker("cross-tier-2");
      const again = await passagesOf(scenario.workspaceId, bound.connectedSourceId);

      expect(landed.map((passage) => passage.content)).toEqual([THE_PASSAGE]);
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
      expect(reprocessed.passages).toBe(1);
      expect(emptied).toEqual([]);
      expect(again).toEqual(landed);
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );

  it(
    "serves a kept span until an erasure names it",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario, "kept-handbook.md");
      await runTheWorker("cross-tier-5");
      const withheld = await passagesOf(scenario.workspaceId, bound.connectedSourceId);

      answered(
        await acting(scenario.admin, (admin, tx) =>
          keepInText(
            admin,
            tx,
            inputOf(keepInTextInput, {
              connectedSourceId: bound.connectedSourceId,
              findingGroups: [bankDetailsGroupOf(bound.documentId)],
              reason: "The depot's own account, printed on the company's own page.",
            }),
          ),
        ),
      );
      await runTheWorker("cross-tier-5");
      const kept = await passagesOf(scenario.workspaceId, bound.connectedSourceId);
      const restored = locatorOf(bound.documentId, THE_RESTORED_SPAN);
      await publishedHandbook(scenario, bound.connectedSourceId);

      const found = answered(await finding(scenario.viewer, THE_QUERY));
      const opened = answered(await opening(scenario.viewer, restored));

      await seededBy(db(), (seed) =>
        seed.suppression({
          workspaceId: scenario.workspaceId,
          identifiers: { emails: [], names: [], other: [THE_SPAN_AS_FOUND] },
        }),
      );
      answered(
        await acting(scenario.admin, (admin, tx) =>
          reprocessConnectedSource(
            admin,
            tx,
            inputOf(reprocessConnectedSourceInput, {
              workspaceId: scenario.workspaceId,
              connectedSourceId: bound.connectedSourceId,
              reason: "wiped",
            }),
          ),
        ),
      );
      await runTheWorker("cross-tier-5");

      const erased = await passagesOf(scenario.workspaceId, bound.connectedSourceId);
      const runs = await syncsOf(scenario.workspaceId, bound.connectedSourceId);
      const reviewed = answered(
        await acting(scenario.admin, (admin, tx) =>
          findingGroupsOf(
            admin,
            tx,
            inputOf(findingsOfInput, { connectedSourceId: bound.connectedSourceId }),
          ),
        ),
      );
      const withheldAgain = answered(
        await opening(scenario.viewer, locatorOf(bound.documentId, THE_WITHHELD_SPAN)),
      );

      expect(withheld.map((passage) => passage.content)).toEqual([THE_PASSAGE]);
      expect(kept.map((passage) => passage.content)).toEqual([THE_HANDBOOK]);
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
      expect(erased.map((passage) => passage.content)).toEqual([THE_PASSAGE]);
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
    "keeps a mid-sync narrowing, and a later one to groups",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario);

      const running = runTheWorker("cross-tier-3");
      await until(async () => (await statusOf(scenario.workspaceId, bound.jobId)) === "claimed");
      answered(
        await acting(scenario.admin, (admin, tx) =>
          narrowConnectedSource(
            admin,
            tx,
            inputOf(narrowConnectedSourceInput, {
              connectedSourceId: bound.connectedSourceId,
              sensitivity: "Restricted",
              audience: "everyone",
            }),
          ),
        ),
      );
      const whenTheNarrowingLanded = await statusOf(scenario.workspaceId, bound.jobId);
      await running;

      await publishedHandbook(scenario, bound.connectedSourceId);
      const raced = await passagesOf(scenario.workspaceId, bound.connectedSourceId);
      const racedClass = await readablePassagesOf(scenario.workspaceId, bound.connectedSourceId);
      const racedByTheViewer = answered(await finding(scenario.viewer, THE_QUERY));
      const racedByTheAdmin = answered(await finding(scenario.admin, THE_QUERY));

      const later = await boundHandbook(scenario, "second-handbook.md");
      await runTheWorker("cross-tier-3");
      const depot = await groupNamed(db(), scenario, "Depot", [scenario.editor]);
      answered(
        await acting(scenario.admin, (admin, tx) =>
          narrowConnectedSource(
            admin,
            tx,
            inputOf(narrowConnectedSourceInput, {
              connectedSourceId: later.connectedSourceId,
              sensitivity: "Internal",
              audience: "groups",
              audienceGroups: [depot],
            }),
          ),
        ),
      );
      await publishedHandbook(scenario, later.connectedSourceId);
      const afterwards = await passagesOf(scenario.workspaceId, later.connectedSourceId);
      const afterwardsClass = await readablePassagesOf(
        scenario.workspaceId,
        later.connectedSourceId,
      );
      const seenByTheGroup = answered(await finding(scenario.editor, THE_QUERY));
      const seenByTheRest = answered(await finding(scenario.viewer, THE_QUERY));

      expect(whenTheNarrowingLanded).toBe("claimed");
      expect(raced.map((passage) => passage.content)).toEqual([THE_PASSAGE]);
      expect(racedClass.map((passage) => [passage.sensitivity, passage.audience])).toEqual([
        ["Restricted", "everyone"],
      ]);
      expect(racedByTheViewer.hits).toEqual([]);
      expect(
        racedByTheAdmin.hits.map((hit) => (hit.layer === "sources" ? hit.locator : hit.iri)),
      ).toEqual([locatorOf(bound.documentId, THE_WITHHELD_SPAN)]);

      expect(afterwards.map((passage) => passage.content)).toEqual([THE_PASSAGE]);
      expect(afterwardsClass.map((passage) => [passage.sensitivity, passage.audience])).toEqual([
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
    "spares one source's passages and store when another is wiped",
    async () => {
      const scenario = await arrange();
      const kept = await boundHandbook(scenario, "the-handbook-that-stays.md");
      const dropped = await boundHandbook(scenario, "the-handbook-that-goes.md");
      await runTheWorker("cross-tier-4");
      await runTheWorker("cross-tier-4");
      const before = await passagesOf(scenario.workspaceId, kept.connectedSourceId);

      answered(
        await acting(scenario.admin, (admin, tx) =>
          reprocessConnectedSource(
            admin,
            tx,
            inputOf(reprocessConnectedSourceInput, {
              workspaceId: scenario.workspaceId,
              connectedSourceId: dropped.connectedSourceId,
              reason: "wiped",
            }),
          ),
        ),
      );
      // This delete stands in for withdrawing the connected source's documents, and leaves the same rows.
      await db().pool.query(
        "DELETE FROM source_document WHERE workspace_id = $1 AND connected_source_id = $2",
        [scenario.workspaceId, dropped.connectedSourceId],
      );
      await runTheWorker("cross-tier-4");

      const standing = bytesUnder(findingsStoreOf(scenario.workspaceId, kept.connectedSourceId));

      expect(before.map((passage) => passage.content)).toEqual([THE_PASSAGE]);
      expect(await passagesOf(scenario.workspaceId, dropped.connectedSourceId)).toEqual([]);
      expect(await passagesOf(scenario.workspaceId, kept.connectedSourceId)).toEqual(before);
      expect(standing.byteLength).toBeGreaterThan(0);
      expect(standing.includes(THE_PLACEHOLDER)).toBe(false);
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );
});

/** A work address no detector rule raises, so only the erasure withholds it. */
const THE_WORK_ADDRESS = "ann.raman@meridianfenland.co.uk";
const THE_NAME = "Ann Raman";
const THE_SURNAME = "Raman";

const THE_HANDBOOK_NAMING_ANN =
  "# The depot handbook\n\n" +
  "Overtime is paid at time and a quarter after the fortieth hour.\n\n" +
  `Overtime claims go to ${THE_NAME} at ${THE_WORK_ADDRESS} by Friday.\n`;

const THE_PASSAGE_ANN_ERASED_FROM =
  "# The depot handbook\n\n" +
  "Overtime is paid at time and a quarter after the fortieth hour.\n\n" +
  "Overtime claims go to [withheld] at [withheld] by Friday.\n";

const ASKED_AT = new Date("2026-09-24T09:00:00.000Z");
const ERASED_AT = new Date("2026-09-24T10:00:00.000Z");
const ERASED_AGAIN_AT = new Date("2026-09-24T11:00:00.000Z");

const erasureRecordedAbout = async (scenario: Scenario): Promise<string> => {
  const recorded = answered(
    await acting(scenario.admin, (admin, tx) =>
      recordSubjectRequest(admin, tx, {
        kind: "erasure",
        identifiers: { emails: [THE_WORK_ADDRESS], names: [THE_NAME], other: [] },
        personId: null,
        receivedAt: ASKED_AT,
        clockStartedAt: ASKED_AT,
      }),
    ),
  );
  return recorded.requestId;
};

const erasing = async (scenario: Scenario, subjectRequestId: string, at: Date) => {
  const run = await runErasure(
    ERASURE,
    {
      git: scenario.git,
      postgres: scenario.postgres,
      objects: store().door,
      clock: { now: () => at },
      log: { info: () => undefined },
    },
    { workspaceId: scenario.workspaceId, subjectRequestId },
  );
  if (!run.ok) throw new Error(`the routine refused: ${String(run.error)}`);
  return run.value;
};

const documentsTheMapFound = (run: Awaited<ReturnType<typeof erasing>>) =>
  run.map.find((entry) => entry.family === "source-document")?.locations;

const passagesFoundBy = async (who: UserPrincipal, query: string) => {
  const found = answered(await finding(who, query));
  const passages: string[] = [];
  for (const hit of found.hits) {
    if (hit.layer !== "sources") continue;
    const opened = answered(await opening(who, hit.locator));
    if (opened.found && opened.passage !== undefined) passages.push(opened.passage.text);
  }
  return passages;
};

const normalisedCopyOf = async (scenario: Scenario, documentId: string): Promise<string> => {
  const read = await db().pool.query<{ normalised_key: string | null }>(
    "SELECT normalised_key FROM source_document WHERE workspace_id = $1 AND id = $2",
    [scenario.workspaceId, documentId],
  );
  const key = read.rows[0]?.normalised_key;
  if (key == null) throw new Error("the sync wrote no normalised copy");
  const copy = await getObject(scenario.admin, store().door, key);
  if (!copy.ok) throw new Error(`the normalised copy was not readable: ${copy.error}`);
  return textOf(copy.value);
};

describe("an erasure over a bound document, read through both tiers", () => {
  it(
    "erases the subject everywhere, and a second sync changes nothing",
    async () => {
      const scenario = await arrange();
      const bound = await boundHandbook(scenario, "claims-handbook.md", THE_HANDBOOK_NAMING_ANN);
      await runTheWorker("cross-tier-6");
      await publishedHandbook(scenario, bound.connectedSourceId);
      const namedBefore = await passagesFoundBy(scenario.viewer, THE_SURNAME);
      const addressedBefore = await passagesFoundBy(scenario.viewer, THE_WORK_ADDRESS);
      const copiedBefore = await normalisedCopyOf(scenario, bound.documentId);
      const subjectRequestId = await erasureRecordedAbout(scenario);

      const erased = await erasing(scenario, subjectRequestId, ERASED_AT);
      await runTheWorker("cross-tier-6");

      const namedBySurname = await passagesFoundBy(scenario.viewer, THE_SURNAME);
      const namedByAddress = await passagesFoundBy(scenario.viewer, THE_WORK_ADDRESS);
      const onTheTopic = await passagesFoundBy(scenario.viewer, THE_QUERY);
      const copied = await normalisedCopyOf(scenario, bound.documentId);
      const landed = await passagesOf(scenario.workspaceId, bound.connectedSourceId);
      const runs = await syncsOf(scenario.workspaceId, bound.connectedSourceId);

      const again = await erasing(scenario, subjectRequestId, ERASED_AGAIN_AT);

      expect(namedBefore).toEqual([THE_HANDBOOK_NAMING_ANN]);
      expect(addressedBefore).toEqual([THE_HANDBOOK_NAMING_ANN]);
      expect(copiedBefore).toBe(THE_HANDBOOK_NAMING_ANN);
      expect(documentsTheMapFound(erased)).toEqual([bound.documentId]);

      expect(namedBySurname).toEqual([]);
      expect(namedByAddress).toEqual([]);
      expect(onTheTopic).toEqual([THE_PASSAGE_ANN_ERASED_FROM]);
      expect(copied).toBe(THE_PASSAGE_ANN_ERASED_FROM);
      expect(runs.map((run) => run.status)).toEqual(["done", "done"]);

      expect(documentsTheMapFound(again)).toEqual([]);
      expect(await passagesOf(scenario.workspaceId, bound.connectedSourceId)).toEqual(landed);
      expect(await syncsOf(scenario.workspaceId, bound.connectedSourceId)).toEqual(runs);
    },
    A_CROSS_TIER_ALLOWANCE_MS,
  );
});
