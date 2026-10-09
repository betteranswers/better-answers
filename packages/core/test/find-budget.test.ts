import { beforeAll, describe, expect, it } from "vitest";

import type { ConceptIri } from "@better-answers/schema";

import { find, open, type FindResult, type OpenResult } from "../src/answering/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { inMs, percentile, recordFigures } from "./figures.ts";
import { landRecallSet, theRecallSet } from "./recall.ts";
import { conceptCiting, connectedSourceHolding, passageUnder } from "./sourced-concept.ts";
import { answered, readingAs } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const NOW = new Date("2026-10-09T12:00:00.000Z");

const IN_FLIGHT = 20;
const ROUNDS = 5;

/**
 * Priced against a one-row read of `concept_index` on the same connection before it: load slows
 * both alike, a dearer read only the one under test.
 */
const FIND_BUDGET_IN_ONE_ROW_READS = 60;
const OPEN_BUDGET_IN_ONE_ROW_READS = 40;

/** Five words, two of them shared by most of the corpus, so every run is read and ranked. */
const BROAD_QUESTION = "how do I export Tallyloom invoicing records to a spreadsheet";
const PAGE = 20;

const HANDBOOK = "Retention follows the schedule the board set in March.";

type Corpus = {
  readonly scenario: Scenario;
  readonly plain: ConceptIri;
  readonly sourced: ConceptIri;
};

/** A passage covering all of `HANDBOOK` in `document`, and the locator that opens it. */
const passageIn = async (
  scenario: Scenario,
  document: { readonly connectedSourceId: string; readonly documentId: string },
): Promise<string> => {
  await passageUnder(db(), scenario.workspaceId, document, {
    content: HANDBOOK,
    ordinal: 0,
    charStart: 0,
    charEnd: HANDBOOK.length,
  });
  return `${document.documentId}/chars:0-${HANDBOOK.length}`;
};

/**
 * An `Answer` naming four sources, a readable passage, a Restricted passage, a corpus `Answer` and
 * a title alone, and linking two corpus `Answer`s.
 */
const sourcedAnswer = async (scenario: Scenario, cited: ConceptIri): Promise<ConceptIri> => {
  const internal = await connectedSourceHolding(db(), scenario.workspaceId);
  const restricted = await connectedSourceHolding(db(), scenario.workspaceId, {
    sensitivity: "Restricted",
  });
  const written = await conceptCiting(scenario, scenario.editor, [internal.documentId], {
    path: "knowledge/security/log-and-backup-retention.md",
    mergeKey: "answer:log-and-backup-retention",
    kind: "Answer",
    title: "Log and Backup Retention",
    frontmatter: {
      title: "Log and Backup Retention",
      type: "Answer",
      sources: [
        {
          id: "S-1",
          title: "Retention handbook",
          resource: "documents/handbook",
          locator: await passageIn(scenario, internal),
        },
        {
          id: "S-2",
          title: "Board minutes",
          resource: "documents/minutes",
          locator: await passageIn(scenario, restricted),
        },
        { id: "S-3", title: "Backup Frequency", resource: cited },
        { id: "S-4", title: "Records schedule", resource: "schedules/records" },
      ],
    },
    body: [
      "Logs follow [Security Log Retention](./security-log-retention.md).",
      "Backups follow [Backup Frequency](./backup-frequency.md).",
      "",
    ].join("\n\n"),
  });
  return written.iri;
};

const landCorpus = async (): Promise<Corpus> => {
  const set = await theRecallSet();
  const scenario = await arrange();
  const landed = await landRecallSet(scenario, set);
  const plain = landed.get("backup-frequency");
  if (plain === undefined) throw new Error("the corpus has no backup-frequency answer");
  return { scenario, plain, sourced: await sourcedAnswer(scenario, plain) };
};

type Timed<T> = {
  readonly waitedMs: number;
  readonly oneRowMs: number;
  readonly readMs: number;
  readonly value: T;
};

/** Times `read` after a one-row read of `iri`, both in one transaction as `reader`. */
const timed = async <T>(
  reader: UserPrincipal,
  iri: ConceptIri,
  read: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Timed<T>> => {
  const started = performance.now();
  const timing = answered(
    await readingAs(db().runtimePool, reader, async (principal, tx) => {
      const oneRowStarted = performance.now();
      await tx.query("SELECT iri FROM concept_index WHERE workspace_id = $1 AND iri = $2", [
        principal.workspaceId,
        iri,
      ]);
      const readStarted = performance.now();
      const value = await read(principal, tx);
      return {
        oneRowMs: readStarted - oneRowStarted,
        readMs: performance.now() - readStarted,
        value,
      };
    }),
  );
  return { ...timing, waitedMs: performance.now() - started };
};

/** `ROUNDS` rounds of `IN_FLIGHT` reads at once, the Viewer and the Admin alternating. */
const underLoad = async <T>(
  scenario: Scenario,
  read: (reader: UserPrincipal) => Promise<Timed<T>>,
): Promise<readonly Timed<T>[]> => {
  const reads: Timed<T>[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const inFlight = Array.from({ length: IN_FLIGHT }, (_unused, at) =>
      read(at % 2 === 0 ? scenario.viewer : scenario.admin),
    );
    reads.push(...(await Promise.all(inFlight)));
  }
  return reads;
};

/** Records the reads' figures under `heading`; the median read, in one-row reads. */
const reported = async (
  heading: string,
  reads: readonly Timed<unknown>[],
  budget: number,
): Promise<number> => {
  const inOneRowReads = percentile(
    reads.map((one) => one.readMs / one.oneRowMs),
    0.5,
  );
  const waitedMs = reads.map((one) => one.waitedMs);
  const readMs = reads.map((one) => one.readMs);
  await recordFigures(heading, [
    [
      "the read, in one-row reads at the median",
      `${inOneRowReads.toFixed(1)}, against a budget of ${budget}`,
    ],
    ["a caller's wait at the median", inMs(percentile(waitedMs, 0.5))],
    ["a caller's wait at p95", inMs(percentile(waitedMs, 0.95))],
    ["a caller's slowest wait", inMs(percentile(waitedMs, 1))],
    ["the slowest read", inMs(percentile(readMs, 1))],
  ]);
  return inOneRowReads;
};

const opened = (reader: UserPrincipal, iri: ConceptIri) =>
  timed(reader, iri, async (principal, tx): Promise<OpenResult> =>
    answered(await open(principal, tx, { iri }, NOW)),
  );

/** The sources the read opens, a passage or a concept, by the file's own label. */
const opensOf = (result: OpenResult): readonly string[] =>
  result.found
    ? (result.concept?.evidence.flatMap(({ source, locator, iri }) =>
        locator === undefined && iri === undefined ? [] : [source],
      ) ?? [])
    : [];

describe("find and open under concurrent read load", () => {
  let corpus: Corpus;

  beforeAll(async () => {
    corpus = await landCorpus();
  }, 300_000);

  it("answers find within budget beside nineteen concurrent finds", async () => {
    const reads = await underLoad(corpus.scenario, (reader) =>
      timed(reader, corpus.plain, async (principal, tx): Promise<FindResult> =>
        answered(await find(principal, tx, { query: BROAD_QUESTION, limit: PAGE }, NOW)),
      ),
    );

    const inOneRowReads = await reported(
      "find under concurrent read load",
      reads,
      FIND_BUDGET_IN_ONE_ROW_READS,
    );

    expect(reads.map(({ value }) => value.matches.length)).toEqual(
      Array.from({ length: IN_FLIGHT * ROUNDS }, () => PAGE),
    );
    expect(inOneRowReads, "find, in one-row reads, at the median").toBeLessThan(
      FIND_BUDGET_IN_ONE_ROW_READS,
    );
  });

  it("answers open within budget beside nineteen concurrent opens", async () => {
    const reads = await underLoad(corpus.scenario, (reader) => opened(reader, corpus.plain));

    const inOneRowReads = await reported(
      "open under concurrent read load",
      reads,
      OPEN_BUDGET_IN_ONE_ROW_READS,
    );

    expect(reads.map(({ value }) => value.found)).toEqual(
      Array.from({ length: IN_FLIGHT * ROUNDS }, () => true),
    );
    expect(inOneRowReads, "open, in one-row reads, at the median").toBeLessThan(
      OPEN_BUDGET_IN_ONE_ROW_READS,
    );
  });

  it("opens a concept of four sources within budget under load", async () => {
    const reads = await underLoad(corpus.scenario, (reader) => opened(reader, corpus.sourced));

    const inOneRowReads = await reported(
      "open of a concept naming four sources, under concurrent read load",
      reads,
      OPEN_BUDGET_IN_ONE_ROW_READS,
    );

    expect(reads.map(({ value }) => opensOf(value))).toEqual(
      Array.from({ length: IN_FLIGHT * ROUNDS }, (_unused, at) =>
        at % 2 === 0
          ? ["Retention handbook", "Backup Frequency"]
          : ["Retention handbook", "Board minutes", "Backup Frequency"],
      ),
    );
    expect(inOneRowReads, "open of four sources, in one-row reads, at the median").toBeLessThan(
      OPEN_BUDGET_IN_ONE_ROW_READS,
    );
  });
});
