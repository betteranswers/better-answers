import type pg from "pg";

import { testData } from "@better-answers/schema/testing";

/**
 * One landed document, for any suite that needs a chunk row to read.
 *
 * A binding, the document it yielded and the single chunk holding that document's whole
 * text — the shape an index run lands, with the binding's three visibility columns copied
 * onto the chunk (ADR 0023), because every read of a passage goes at the chunk's copy and
 * never at the binding's row. A suite that set the two apart would be proving something no
 * writer can produce.
 *
 * It lives here rather than in either suite because both tiers' surfaces read the same rows:
 * the slice's own suite (`answering.test.ts`) and the api's (`apps/api/tests/`) arrange
 * identically, and two copies of this would be two chances for one of them to drift into
 * arranging something the other tier's reader would never see.
 *
 * The factory runs inside **one transaction**, which is load-bearing: the chunk partition is
 * made by a lifecycle function that refuses a transaction not scoped to its workspace, and
 * that scoping is `set_config(..., true)` — transaction-local, so outside a transaction it
 * lasts exactly one statement and the call after it is refused. A suite whose workspace came
 * from the factory rather than from provisioning has no partition until the first chunk row
 * makes one.
 */

/** What a landed document is addressed by afterwards. */
export type LandedDocument = {
  readonly bindingId: string;
  readonly documentId: string;
  /** The chunk's own span as a wire address: `<source document id>/chars:<start>-<end>`. */
  readonly locator: string;
};

export type DocumentShape = {
  readonly title: string;
  readonly text: string;
  /** `null` is a binding still under review; absent is published at the instant below. */
  readonly publishedAt?: Date | null;
  readonly sensitivity?: string;
  /** The groups the binding is for; absent is *everyone*, the factory's own default. */
  readonly audienceGroups?: readonly string[];
};

/**
 * The instant a landed binding is published at: written down here, never read from the wall
 * clock, so every suite over these rows compares against a value it can state.
 */
export const PUBLISHED_AT = new Date("2026-09-11T09:00:00.000Z");

/**
 * How many code points a text is, which is what a locator counts (CONTEXT.md, *locator*).
 * `Array.from` and never `.length`, for the reason `spanText` gives: indexing a string yields
 * UTF-16 units, and the two tiers must count the same without a segmenter between them.
 */
export const codePointsOf = (text: string): number => Array.from(text).length;

export const documentLanded = async (
  pool: pg.Pool,
  workspaceId: string,
  shape: DocumentShape,
): Promise<LandedDocument> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seed = testData(client);
    const publishedAt = shape.publishedAt === undefined ? PUBLISHED_AT : shape.publishedAt;
    const sensitivity = shape.sensitivity ?? "Internal";
    const audience =
      shape.audienceGroups === undefined
        ? {}
        : { audience: "groups", audienceGroups: [...shape.audienceGroups] };
    const binding = await seed.sourceBinding({
      workspaceId,
      publishedAt,
      sensitivity,
      ...audience,
    });
    const document = await seed.sourceDocument({
      workspaceId,
      bindingId: binding.id,
      title: shape.title,
    });
    const charEnd = codePointsOf(shape.text);
    await seed.chunk({
      workspaceId,
      bindingId: binding.id,
      sourceDocumentId: document.id,
      content: shape.text,
      // The column holds the span alone; the document half of a wire locator is the row's
      // own `source_document_id` (CONTEXT.md, *locator*).
      locator: `chars:0-${charEnd}`,
      ordinal: 0,
      charStart: 0,
      charEnd,
      publishedAt,
      sensitivity,
      ...audience,
    });
    await client.query("COMMIT");
    return {
      bindingId: binding.id,
      documentId: document.id,
      locator: `${document.id}/chars:0-${charEnd}`,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/** A group of this workspace, for a binding whose audience is that group and nobody else. */
export const groupSeeded = async (pool: pg.Pool, workspaceId: string): Promise<string> => {
  const client = await pool.connect();
  try {
    return (await testData(client).group({ workspaceId })).id;
  } finally {
    client.release();
  }
};
