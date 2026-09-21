import type pg from "pg";

import { testData } from "@better-answers/schema/testing";

export type LandedDocument = {
  readonly bindingId: string;
  readonly documentId: string;

  readonly locator: string;
};

export type DocumentShape = {
  readonly title: string;
  readonly text: string;

  readonly publishedAt?: Date | null;
  readonly sensitivity?: string;

  readonly audienceGroups?: readonly string[];
};

export const PUBLISHED_AT = new Date("2026-09-11T09:00:00.000Z");

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

export const groupSeeded = async (pool: pg.Pool, workspaceId: string): Promise<string> => {
  const client = await pool.connect();
  try {
    return (await testData(client).group({ workspaceId })).id;
  } finally {
    client.release();
  }
};
