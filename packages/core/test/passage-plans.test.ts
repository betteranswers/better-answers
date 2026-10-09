import { describe, expect, it } from "vitest";

import { MARK_THE_MATCH_LEAKPROOF } from "@better-answers/schema";
import { UNMARK_THE_MATCH } from "@better-answers/schema/testing/probes";

import { ok, type UserPrincipal } from "../src/kernel/index.ts";
import { findPassages, previewPassages, previewPassagesInput } from "../src/sources/index.ts";
import { planned } from "./planned.ts";
import { seededBy, visibilitySuite } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";

const { db, arrange } = visibilitySuite();

const QUERY = "holiday policy";

const PUBLISHED = new Date("2026-09-11T09:00:00.000Z");

const HANDBOOK = {
  title: "The staff handbook",
  text: "The holiday policy grants twenty-eight days.",
  charEnd: 44,
} as const;

/**
 * Any other path reads a partition or connected source whole: cheaper than a GIN probe below about a
 * hundred rows, dearer at this many.
 */
const INVOICE_LINES = 500;

type Arranged = {
  readonly admin: UserPrincipal;
  readonly workspaceId: string;
  readonly handbookConnectedSource: string;
  readonly handbook: string;
};

const arrangedWithInvoices = async (): Promise<Arranged> => {
  const scenario = await arrange();
  const { workspaceId } = scenario;
  const seeded = await seededBy(db(), async (seed) => {
    const handbookConnectedSource = await seed.connectedSource({
      workspaceId,
      publishedAt: PUBLISHED,
      sensitivity: "Internal",
    });
    const handbook = await seed.sourceDocument({
      workspaceId,
      connectedSourceId: handbookConnectedSource.id,
      title: HANDBOOK.title,
    });
    await seed.passage({
      workspaceId,
      connectedSourceId: handbookConnectedSource.id,
      sourceDocumentId: handbook.id,
      content: HANDBOOK.text,
      locator: `${handbook.id}/chars:0-${HANDBOOK.charEnd}`,
      ordinal: 0,
      charStart: 0,
      charEnd: HANDBOOK.charEnd,
    });

    const invoicesConnectedSource = await seed.connectedSource({
      workspaceId,
      publishedAt: PUBLISHED,
      sensitivity: "Internal",
    });
    const invoices = await seed.sourceDocument({
      workspaceId,
      connectedSourceId: invoicesConnectedSource.id,
    });
    for (let line = 0; line < INVOICE_LINES; line += 1) {
      const text = `Invoice ${String(line)} was paid in full.`;
      await seed.passage({
        workspaceId,
        connectedSourceId: invoicesConnectedSource.id,
        sourceDocumentId: invoices.id,
        content: text,
        locator: `${invoices.id}/chars:${String(line * 100)}-${String(line * 100 + text.length)}`,
        ordinal: line,
        charStart: line * 100,
        charEnd: line * 100 + text.length,
      });
    }
    return { handbookConnectedSource: handbookConnectedSource.id, handbook: handbook.id };
  });
  // VACUUM flushes GIN's pending list and ANALYZE counts the rows; the planner prices both, and
  // guesses a few rows without them.
  await db().pool.query("VACUUM ANALYZE");
  return { admin: scenario.admin, workspaceId, ...seeded };
};

const searching = (person: UserPrincipal) =>
  planned(db(), person, async (reader, tx) => {
    const found = await findPassages(reader, tx, { query: QUERY, limit: 10 });
    return found.ok ? ok(found.value.map(({ passage }) => passage)) : found;
  });

const theHandbookFound = (arranged: Arranged) => [
  {
    sourceDocumentId: arranged.handbook,
    title: HANDBOOK.title,
    locator: `${arranged.handbook}/chars:0-${HANDBOOK.charEnd}`,
    sensitivity: "Internal",
  },
];

const partitionCopyOf = async (parentIndex: string, workspaceId: string): Promise<string> => {
  const read = await db().pool.query<{ name: string }>(
    `SELECT child.relname AS name
       FROM pg_catalog.pg_inherits attached
       JOIN pg_catalog.pg_class child ON child.oid = attached.inhrelid
       JOIN pg_catalog.pg_class parent ON parent.oid = attached.inhparent
       JOIN pg_catalog.pg_index copy ON copy.indexrelid = child.oid
      WHERE parent.relname = $1 AND copy.indrelid = $2::regclass`,
    [parentIndex, `"index"."passage_${workspaceId}"`],
  );
  const copy = read.rows[0]?.name;
  if (copy === undefined) throw new Error(`the partition holds no copy of ${parentIndex}`);
  return copy;
};

describe("find's plan, as the api and under the passage's policy", () => {
  it("matches through the partition's GIN index on the full-text column", async () => {
    const arranged = await arrangedWithInvoices();

    const found = await searching(arranged.admin);

    expect(found.answer).toEqual(theHandbookFound(arranged));
    expect(found.indexes).toContain(`passage_${arranged.workspaceId}_search_gin`);
  });

  it("cannot use the GIN index unless the match is leakproof", async () => {
    const arranged = await arrangedWithInvoices();

    await db().pool.query(UNMARK_THE_MATCH);
    const found = await searching(arranged.admin).finally(() =>
      db().pool.query(MARK_THE_MATCH_LEAKPROOF),
    );

    expect(found.answer).toEqual(theHandbookFound(arranged));
    expect(found.indexes).not.toContain(`passage_${arranged.workspaceId}_search_gin`);
  });
});

describe("previewPassages' plan, as the api and under the passage's policy", () => {
  it("lists a connected source's passages through the connected-source-first index", async () => {
    const arranged = await arrangedWithInvoices();

    const previewed = await planned(db(), arranged.admin, (admin, tx) =>
      previewPassages(
        admin,
        tx,
        inputOf(previewPassagesInput, { connectedSourceId: arranged.handbookConnectedSource }),
      ),
    );

    expect(previewed.answer.map((passage) => passage.content)).toEqual([HANDBOOK.text]);
    expect(previewed.indexes).toContain(
      await partitionCopyOf(
        "passage_workspace_connected_source_document_ordinal_idx",
        arranged.workspaceId,
      ),
    );
  });
});
