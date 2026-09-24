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
  quarantineError: z.string().min(1).nullable().default(null),
  chunks: z.array(z.string().min(1)).default([]),
  findings: z.array(aFinding).default([]),
  cited: z.boolean().default(false),
});

const aBinding = z.object({
  name: z.string().min(1),
  sensitivity: z.enum(SENSITIVITIES).default("Restricted"),
  audience: z.enum(AUDIENCES).default("everyone"),
  run: z.enum(["none", "queued", "claimed", "done"]).default("done"),
  published: z.boolean().default(false),
  documents: z.array(aDocument).default([]),
});

export const bindingsSeeding = z.object({
  workspaceId: z.string().min(1),
  bindings: z.array(aBinding).min(1),
});

// By workspace alone: a binding the browser bound carries an id only the page minted.
export const indexRunMoving = z.object({
  workspaceId: z.string().min(1),
  to: z.enum(["claimed", "done"]),
});

type SeededDocument = {
  readonly documentId: string;
  readonly title: string;
  readonly citedBy: { readonly iri: string; readonly compositionId: string } | null;
};

type SeededBinding = {
  readonly bindingId: string;
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

const seedChunks = async (
  seed: TestData,
  workspaceId: string,
  bindingId: string,
  documentId: string,
  chunks: readonly string[],
): Promise<void> => {
  let charStart = 0;
  for (const [ordinal, content] of chunks.entries()) {
    const charEnd = charStart + Array.from(content).length;
    await seed.chunk({
      workspaceId,
      bindingId,
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
  const composition = await seed.composition({ workspaceId });
  await seed.compositionInclude({
    workspaceId,
    compositionId: composition.id,
    iri: concept.iri,
    ordinal: 0,
  });
  return { iri: concept.iri, compositionId: composition.id };
};

const runColumns = (run: "queued" | "claimed" | "done", outcome: Record<string, unknown>) => {
  if (run === "queued") return {};
  const now = new Date();
  const claimed = { attempts: 1, claimedBy: SUITE_WORKER, claimedAt: now, heartbeatAt: now };
  if (run === "claimed") {
    return { ...claimed, status: "claimed", leaseExpiresAt: new Date(now.getTime() + LEASE_MS) };
  }
  return { ...claimed, status: "done", finishedAt: now, outcome };
};

// Rows written as each act and the worker would leave them, so the screen reads what a real
// binding's history leaves behind.
export const seedBindings = async (
  app: TestApp,
  asked: z.output<typeof bindingsSeeding>,
): Promise<readonly SeededBinding[]> =>
  inOneTransaction(app, async (client) => {
    const seed = testData(client);
    const { workspaceId } = asked;
    const seeded: SeededBinding[] = [];

    // A provision's new partition locks the chunk table, then the documents its key references;
    // taking them in that order too leaves no cycle.
    const chunked = asked.bindings.some((binding) =>
      binding.documents.some((document) => document.chunks.length > 0),
    );
    if (chunked) await client.query('LOCK TABLE "index".chunk IN ROW EXCLUSIVE MODE');

    for (const binding of asked.bindings) {
      const row = await seed.sourceBinding({
        workspaceId,
        name: binding.name,
        sensitivity: binding.sensitivity,
        audience: binding.audience,
        publishedAt: binding.published ? new Date() : null,
        state: binding.published ? "published" : "landed",
      });

      const documents: SeededDocument[] = [];
      const overridden: OverriddenSpan[] = [];
      let chunkCount = 0;
      for (const document of binding.documents) {
        const quarantined = document.quarantineError !== null;
        const landed = await seed.sourceDocument({
          workspaceId,
          bindingId: row.id,
          title: document.title,
          sourceSystemId: document.title,
          sensitivity: document.sensitivity,
          ...(quarantined
            ? { outcome: "quarantined", quarantineError: document.quarantineError }
            : {}),
        });
        overridden.push(...(await seedFindings(seed, workspaceId, landed.id, document.findings)));
        await seedChunks(seed, workspaceId, row.id, landed.id, document.chunks);
        chunkCount += document.chunks.length;
        documents.push({
          documentId: landed.id,
          title: document.title,
          citedBy: document.cited ? await citationOf(seed, workspaceId, landed.id) : null,
        });
      }

      if (binding.run !== "none") {
        await seed.job({
          workspaceId,
          kind: "index",
          subjectId: row.id,
          reason: "bound",
          ...runColumns(binding.run, {
            documents: documents.length,
            chunks: chunkCount,
            lmdb_bytes: 0,
            restores_overridden_by_erasure: overridden,
          }),
        });
      }
      seeded.push({ bindingId: row.id, name: binding.name, documents });
    }
    return seeded;
  });

// The suite runs no worker process, so the harness takes its two steps through the queue's own
// functions, under the worker's role.
export const moveTheIndexRun = async (
  app: TestApp,
  asked: z.output<typeof indexRunMoving>,
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
      if (job === undefined) throw new Error(`no index run is queued in ${asked.workspaceId}`);
      return { jobId: job.id };
    }

    const held = await client.query<{ id: string }>(
      `SELECT id FROM job
        WHERE workspace_id = $1 AND kind = 'index' AND status = 'claimed' AND claimed_by = $2`,
      [asked.workspaceId, SUITE_WORKER],
    );
    const jobId = held.rows[0]?.id;
    if (jobId === undefined) throw new Error(`no index run is claimed in ${asked.workspaceId}`);
    const finished = await client.query<{ finished: boolean }>(
      "SELECT finish_job($1, $2, $3::jsonb) AS finished",
      [
        jobId,
        SUITE_WORKER,
        JSON.stringify({
          documents: 1,
          chunks: 0,
          lmdb_bytes: 0,
          restores_overridden_by_erasure: [],
        }),
      ],
    );
    if (finished.rows[0]?.finished !== true) throw new Error(`the run ${jobId} did not finish`);
    return { jobId };
  });
