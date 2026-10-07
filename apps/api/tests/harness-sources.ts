import type { PoolClient } from "pg";
import { z } from "zod";

import { AUDIENCES, REDACTION_TIERS, SENSITIVITIES } from "@better-answers/schema";
import { testData, type TestData } from "@better-answers/schema/testing";

import type { TestApp } from "./harness.ts";

const SUITE_ACTOR = "process:better-answers-browser-suite";

const SUITE_WORKER = "browser-suite-worker";

const LEASE_MS = 5 * 60 * 1000;

const KEPT_BECAUSE = "The company's own business fact";

const DISMISSED_BECAUSE = "The cue caught engineering prose, not health data";

const aFinding = z
  .object({
    category: z.string().min(1),
    ruleId: z.string().min(1),
    tier: z.enum(REDACTION_TIERS),
    spans: z.int().positive(),
    kept: z.boolean().default(false),
    overriddenByErasure: z.boolean().default(false),
    dismissed: z.int().nonnegative().default(0),
  })
  .refine((finding) => finding.dismissed <= finding.spans, {
    message: "a group has no more dismissed spans than it has spans",
  });

const aDocument = z.object({
  title: z.string().min(1),
  sensitivity: z.enum(SENSITIVITIES).nullable().default(null),
  unreadableReason: z.string().min(1).nullable().default(null),
  passages: z.array(z.string().min(1)).default([]),
  findings: z.array(aFinding).default([]),
  cited: z.boolean().default(false),
});

const SEEDED_SYNCS = ["none", "queued", "claimed", "done"] as const;

const MOVED_RUNS = ["claimed", "done"] as const;

const aConnectedSource = z.object({
  name: z.string().min(1),
  sensitivity: z.enum(SENSITIVITIES).default("Restricted"),
  audience: z.enum(AUDIENCES).default("everyone"),
  sync: z.enum(SEEDED_SYNCS).default("done"),
  published: z.boolean().default(false),
  documents: z.array(aDocument).default([]),
});

export const connectedSourcesSeeding = z.object({
  workspaceId: z.string().min(1),
  connectedSources: z.array(aConnectedSource).min(1),
});

/** By workspace alone: a connected source the browser connected carries an id only the page minted. */
export const syncMoving = z.object({
  workspaceId: z.string().min(1),
  to: z.enum(MOVED_RUNS),
});

type SeededDocument = {
  readonly documentId: string;
  readonly title: string;
  readonly citedBy: { readonly iri: string; readonly writeUpId: string } | null;
};

type SeededConnectedSource = {
  readonly connectedSourceId: string;
  readonly name: string;
  readonly documents: readonly SeededDocument[];
};

type OverriddenSpan = {
  readonly document_id: string;
  readonly rule_id: string;
  readonly char_start: number;
  readonly char_end: number;
};

const inOneTransaction = async <T>(
  app: TestApp,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await app.database.superuser.connect();
  try {
    await client.query("BEGIN");
    const done = await work(client);
    await client.query("COMMIT");
    return done;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const reviewOf = (finding: z.output<typeof aFinding>, span: number) => {
  const now = new Date();
  if (span < finding.dismissed) {
    return {
      reviewState: "dismissed",
      reviewedAt: now,
      reviewedBy: SUITE_ACTOR,
      reviewReason: DISMISSED_BECAUSE,
    };
  }
  if (!finding.kept && !finding.overriddenByErasure) return {};
  return {
    reviewState: "kept-in-text",
    reviewedAt: now,
    reviewedBy: SUITE_ACTOR,
    restoredAt: now,
    restoredBy: SUITE_ACTOR,
    restoreReason: KEPT_BECAUSE,
  };
};

const seedFindings = async (
  seed: TestData,
  workspaceId: string,
  documentId: string,
  findings: z.output<typeof aFinding>[],
): Promise<OverriddenSpan[]> => {
  const overridden: OverriddenSpan[] = [];
  for (const finding of findings) {
    for (let span = 0; span < finding.spans; span += 1) {
      const row = await seed.finding({
        workspaceId,
        documentId,
        category: finding.category,
        ruleId: finding.ruleId,
        tier: finding.tier,
        ...reviewOf(finding, span),
      });
      if (finding.overriddenByErasure) {
        overridden.push({
          document_id: documentId,
          rule_id: row.ruleId,
          char_start: row.charStart,
          char_end: row.charEnd,
        });
      }
    }
  }
  return overridden;
};

const seedPassages = async (
  seed: TestData,
  workspaceId: string,
  connectedSourceId: string,
  documentId: string,
  passages: readonly string[],
): Promise<void> => {
  let charStart = 0;
  for (const [ordinal, content] of passages.entries()) {
    const charEnd = charStart + Array.from(content).length;
    await seed.passage({
      workspaceId,
      connectedSourceId,
      sourceDocumentId: documentId,
      content,
      ordinal,
      charStart,
      charEnd,
      locator: `chars:${charStart}-${charEnd}`,
    });
    charStart = charEnd;
  }
};

const citationOf = async (seed: TestData, workspaceId: string, documentId: string) => {
  const concept = await seed.conceptIndex({ workspaceId, title: "Supplier payments" });
  await seed.conceptEvidence({ workspaceId, iri: concept.iri, sourceDocumentId: documentId });
  const writeUp = await seed.writeUp({ workspaceId });
  await seed.writeUpInclude({
    workspaceId,
    writeUpId: writeUp.id,
    iri: concept.iri,
    ordinal: 0,
  });
  return { iri: concept.iri, writeUpId: writeUp.id };
};

const syncColumns = (
  sync: Exclude<(typeof SEEDED_SYNCS)[number], "none">,
  outcome: Record<string, unknown>,
) => {
  if (sync === "queued") return {};
  const now = new Date();
  const claimed = { attempts: 1, claimedBy: SUITE_WORKER, claimedAt: now, heartbeatAt: now };
  if (sync === "claimed") {
    return { ...claimed, status: "claimed", leaseExpiresAt: new Date(now.getTime() + LEASE_MS) };
  }
  return { ...claimed, status: "done", finishedAt: now, outcome };
};

type DocumentsOfAConnectedSource = {
  readonly documents: readonly SeededDocument[];
  readonly overridden: readonly OverriddenSpan[];
  readonly passageCount: number;
};

const seedDocuments = async (
  seed: TestData,
  workspaceId: string,
  connectedSourceId: string,
  asked: readonly z.output<typeof aDocument>[],
): Promise<DocumentsOfAConnectedSource> => {
  const documents: SeededDocument[] = [];
  const overridden: OverriddenSpan[] = [];
  let passageCount = 0;
  for (const document of asked) {
    const unreadable = document.unreadableReason !== null;
    const landed = await seed.sourceDocument({
      workspaceId,
      connectedSourceId,
      title: document.title,
      sourceSystemId: document.title,
      sensitivity: document.sensitivity,
      ...(unreadable ? { outcome: "unreadable", unreadableReason: document.unreadableReason } : {}),
    });
    overridden.push(...(await seedFindings(seed, workspaceId, landed.id, document.findings)));
    await seedPassages(seed, workspaceId, connectedSourceId, landed.id, document.passages);
    passageCount += document.passages.length;
    documents.push({
      documentId: landed.id,
      title: document.title,
      citedBy: document.cited ? await citationOf(seed, workspaceId, landed.id) : null,
    });
  }
  return { documents, overridden, passageCount };
};

/**
 * Rows written as each action and the worker would leave them, so the page reads what a real
 * connected source's history leaves behind.
 */
export const seedConnectedSources = async (
  app: TestApp,
  asked: z.output<typeof connectedSourcesSeeding>,
): Promise<readonly SeededConnectedSource[]> =>
  inOneTransaction(app, async (client) => {
    const seed = testData(client);
    const { workspaceId } = asked;
    const seeded: SeededConnectedSource[] = [];

    for (const connectedSource of asked.connectedSources) {
      /** The audience CHECK wants a named group beside the word; the page names none. */
      const readers =
        connectedSource.audience === "groups"
          ? [(await seed.group({ workspaceId, name: `${connectedSource.name} readers` })).id]
          : null;
      const row = await seed.connectedSource({
        workspaceId,
        name: connectedSource.name,
        sensitivity: connectedSource.sensitivity,
        audience: connectedSource.audience,
        audienceGroups: readers,
        publishedAt: connectedSource.published ? new Date() : null,
        state: connectedSource.published ? "published" : "received",
      });

      const { documents, overridden, passageCount } = await seedDocuments(
        seed,
        workspaceId,
        row.id,
        connectedSource.documents,
      );

      if (connectedSource.sync !== "none") {
        await seed.job({
          workspaceId,
          kind: "index",
          subjectId: row.id,
          reason: "connected",
          ...syncColumns(connectedSource.sync, {
            documents: documents.length,
            passages: passageCount,
            lmdb_bytes: 0,
            restores_overridden_by_erasure: overridden,
          }),
        });
      }
      seeded.push({ connectedSourceId: row.id, name: connectedSource.name, documents });
    }
    return seeded;
  });

/**
 * The suite runs no worker process, so the harness takes its two steps through the queue's own
 * functions, under the worker's role.
 */
export const moveTheSync = async (
  app: TestApp,
  asked: z.output<typeof syncMoving>,
): Promise<{ readonly jobId: string }> =>
  inOneTransaction(app, async (client) => {
    await client.query("SET LOCAL ROLE worker_rt");
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [asked.workspaceId]);

    if (asked.to === "claimed") {
      const claimed = await client.query<{ id: string }>(
        "SELECT id FROM claim_job($1, make_interval(secs => $2), ARRAY['index'])",
        [SUITE_WORKER, LEASE_MS / 1000],
      );
      const job = claimed.rows[0];
      if (job === undefined) throw new Error(`no sync is queued in ${asked.workspaceId}`);
      return { jobId: job.id };
    }

    const held = await client.query<{ id: string }>(
      `SELECT id FROM job
        WHERE workspace_id = $1 AND kind = 'index' AND status = 'claimed' AND claimed_by = $2`,
      [asked.workspaceId, SUITE_WORKER],
    );
    const jobId = held.rows[0]?.id;
    if (jobId === undefined) throw new Error(`no sync is claimed in ${asked.workspaceId}`);
    const finished = await client.query<{ finished: boolean }>(
      "SELECT finish_job($1, $2, $3::jsonb) AS finished",
      [
        jobId,
        SUITE_WORKER,
        JSON.stringify({
          documents: 1,
          passages: 0,
          lmdb_bytes: 0,
          restores_overridden_by_erasure: [],
        }),
      ],
    );
    if (finished.rows[0]?.finished !== true) throw new Error(`the sync ${jobId} did not finish`);
    return { jobId };
  });
