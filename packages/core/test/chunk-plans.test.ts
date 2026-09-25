import pg from "pg";
import { describe, expect, it } from "vitest";

import { MARK_THE_MATCH_LEAKPROOF } from "@better-answers/schema";
import { UNMARK_THE_MATCH } from "@better-answers/schema/testing/probes";

import type { UserPrincipal } from "../src/kernel/index.ts";
import { findPassages, previewChunks, previewChunksInput } from "../src/sources/index.ts";
import type { Answered, Tx } from "../src/store/postgres/index.ts";
import { seededBy, visibilitySuite } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { answered, readingAs } from "./suite-postgres.ts";

const { db, arrange } = visibilitySuite();

/**
 * auto_explain plans the statement the call itself ran; at test size a sequential scan beats
 * every index, so it is switched off.
 */
const PLANNED_AS_THE_APP = [
  "-c role=app_rt",
  "-c session_preload_libraries=auto_explain",
  "-c auto_explain.log_min_duration=0",
  "-c auto_explain.log_level=notice",
  "-c auto_explain.log_format=json",
  "-c enable_seqscan=off",
].join(" ");

const INDEX_NAMED = /"Index Name": "(?<index>[^"]+)"/gu;

type Planned<T> = { readonly answer: Answered<T>; readonly indexes: readonly string[] };

const planned = async <T>(
  person: UserPrincipal,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Planned<T>> => {
  const pool = new pg.Pool({ connectionString: db().connectionUri, options: PLANNED_AS_THE_APP });
  const plans: string[] = [];
  pool.on("connect", (client) => {
    client.on("notice", (notice) => {
      plans.push(notice.message ?? "");
    });
  });
  try {
    const answer = answered(await readingAs(pool, person, work));
    const indexes = plans.flatMap((plan) =>
      [...plan.matchAll(INDEX_NAMED)].flatMap((named) => named.groups?.["index"] ?? []),
    );
    return { answer, indexes };
  } finally {
    await pool.end();
  }
};

const QUERY = "holiday policy";

const PUBLISHED = new Date("2026-09-11T09:00:00.000Z");

const HANDBOOK = {
  title: "The staff handbook",
  text: "The holiday policy grants twenty-eight days.",
  charEnd: 44,
} as const;

/**
 * Any other path reads a partition or binding whole: cheaper than a GIN probe below about a
 * hundred rows, dearer at this many.
 */
const INVOICE_LINES = 500;

type Arranged = {
  readonly admin: UserPrincipal;
  readonly workspaceId: string;
  readonly handbookBinding: string;
  readonly handbook: string;
};

const arrangedWithInvoices = async (): Promise<Arranged> => {
  const scenario = await arrange();
  const { workspaceId } = scenario;
  const seeded = await seededBy(db(), async (seed) => {
    const handbookBinding = await seed.sourceBinding({
      workspaceId,
      publishedAt: PUBLISHED,
      sensitivity: "Internal",
    });
    const handbook = await seed.sourceDocument({
      workspaceId,
      bindingId: handbookBinding.id,
      title: HANDBOOK.title,
    });
    await seed.chunk({
      workspaceId,
      bindingId: handbookBinding.id,
      sourceDocumentId: handbook.id,
      content: HANDBOOK.text,
      locator: `${handbook.id}/chars:0-${HANDBOOK.charEnd}`,
      ordinal: 0,
      charStart: 0,
      charEnd: HANDBOOK.charEnd,
    });

    const invoicesBinding = await seed.sourceBinding({
      workspaceId,
      publishedAt: PUBLISHED,
      sensitivity: "Internal",
    });
    const invoices = await seed.sourceDocument({ workspaceId, bindingId: invoicesBinding.id });
    for (let line = 0; line < INVOICE_LINES; line += 1) {
      const text = `Invoice ${String(line)} was paid in full.`;
      await seed.chunk({
        workspaceId,
        bindingId: invoicesBinding.id,
        sourceDocumentId: invoices.id,
        content: text,
        locator: `${invoices.id}/chars:${String(line * 100)}-${String(line * 100 + text.length)}`,
        ordinal: line,
        charStart: line * 100,
        charEnd: line * 100 + text.length,
      });
    }
    return { handbookBinding: handbookBinding.id, handbook: handbook.id };
  });
  // VACUUM flushes GIN's pending list and ANALYZE counts the rows; the planner prices both, and
  // guesses a few rows without them.
  await db().pool.query("VACUUM ANALYZE");
  return { admin: scenario.admin, workspaceId, ...seeded };
};

const searching = (person: UserPrincipal) =>
  planned(person, (reader, tx) => findPassages(reader, tx, QUERY, 10));

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
    [parentIndex, `"index"."chunk_${workspaceId}"`],
  );
  const copy = read.rows[0]?.name;
  if (copy === undefined) throw new Error(`the partition holds no copy of ${parentIndex}`);
  return copy;
};

describe("find's plan, as the api and under the chunk's policy", () => {
  it("matches through the partition's GIN index on the full-text column", async () => {
    const arranged = await arrangedWithInvoices();

    const found = await searching(arranged.admin);

    expect(found.answer).toEqual(theHandbookFound(arranged));
    expect(found.indexes).toContain(`chunk_${arranged.workspaceId}_search_gin`);
  });

  it("cannot use the GIN index unless the match is leakproof", async () => {
    const arranged = await arrangedWithInvoices();

    await db().pool.query(UNMARK_THE_MATCH);
    const found = await searching(arranged.admin).finally(() =>
      db().pool.query(MARK_THE_MATCH_LEAKPROOF),
    );

    expect(found.answer).toEqual(theHandbookFound(arranged));
    expect(found.indexes).not.toContain(`chunk_${arranged.workspaceId}_search_gin`);
  });
});

describe("previewChunks' plan, as the api and under the chunk's policy", () => {
  it("lists a binding's chunks through the binding-first index", async () => {
    const arranged = await arrangedWithInvoices();

    const previewed = await planned(arranged.admin, (admin, tx) =>
      previewChunks(
        admin,
        tx,
        inputOf(previewChunksInput, { bindingId: arranged.handbookBinding }),
      ),
    );

    expect(previewed.answer.map((chunk) => chunk.content)).toEqual([HANDBOOK.text]);
    expect(previewed.indexes).toContain(
      await partitionCopyOf(
        "chunk_workspace_id_binding_id_source_document_id_ordinal_idx",
        arranged.workspaceId,
      ),
    );
  });
});
