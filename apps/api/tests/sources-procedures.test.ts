import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { UPLOAD_BYTE_CAP } from "@better-answers/core/sources";
import { getObject } from "@better-answers/core/store/objects";
import { objectStoreForSuite, textOf } from "@better-answers/core/testing/objects";
import { until } from "@better-answers/core/testing/postgres";
import { ulid } from "@better-answers/schema";

import { POSTGRES_POOL_MAX } from "../src/doors.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { UPLOAD_DESCRIPTOR_HEADERS } from "../src/trpc/upload.ts";
import { actingIn, startApp, type TestApp, type TestClient } from "./harness.ts";
import {
  revocationHeldOpen,
  seededIn,
  someoneWaitsOnALock,
  THE_THREE_CONFIRMATIONS,
} from "./provoke.ts";
import {
  anAdminOnTheWeb,
  refusalOfCall,
  UPLOAD_HEADER_OF_FIELD,
  uploadHeaders,
  uploadOptions,
  type UploadDescriptor,
} from "./web-client.ts";

const store = objectStoreForSuite();

const PINNED_AT = new Date("2026-09-23T09:00:00.000Z");

/** The api's own pool size, so ten uploads each holding two would have found it full. */
const UPLOADS_AT_ONCE = POSTGRES_POOL_MAX;

let app: TestApp;

beforeAll(async () => {
  app = await startApp({
    objectStore: store(),
    clock: { now: () => PINNED_AT },
    poolSize: UPLOADS_AT_ONCE * 2,
  });
}, 180_000);

afterAll(async () => {
  await app.stop();
});

const HANDBOOK = "The handbook says what the company decided.";
const HANDBOOK_BYTES = 43;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const handbookDescribed = (overrides: Partial<UploadDescriptor> = {}): UploadDescriptor => ({
  connectedSourceId: ulid(),
  name: "The staff handbook",
  fileName: "handbook.md",
  mediaType: "text/markdown",
  byteSize: HANDBOOK_BYTES,
  ...overrides,
});

const anAdmin = () => anAdminOnTheWeb(app);

const unpublishedConnectedSource = (workspaceId: string, name = "The staff handbook") =>
  seededIn(app, async (seed) => {
    const connectedSource = await seed.connectedSource({ workspaceId, name, publishedAt: null });
    const document = await seed.sourceDocument({
      workspaceId,
      connectedSourceId: connectedSource.id,
      title: "handbook.md",
    });
    return { connectedSourceId: connectedSource.id, documentId: document.id };
  });

const finishedRun = (
  workspaceId: string,
  connectedSourceId: string,
  outcome: Record<string, unknown>,
) =>
  seededIn(app, (seed) =>
    seed.job({
      workspaceId,
      kind: "index",
      subjectId: connectedSourceId,
      reason: "connected",
      status: "done",
      attempts: 1,
      finishedAt: PINNED_AT,
      outcome,
    }),
  );

const OVERRIDDEN_KEY = "restores_overridden_by_erasure";

type RunOverridingASpan = {
  readonly connectedSourceId: string;
  readonly jobId: string;
  readonly documentId: string;
  readonly ruleId: string;
};

const aRunThatOverrodeAKeptSpan = async (workspaceId: string): Promise<RunOverridingASpan> => {
  const { connectedSourceId, documentId } = await unpublishedConnectedSource(workspaceId);
  const kept = await seededIn(app, (seed) => seed.finding({ workspaceId, documentId }));
  const run = await finishedRun(workspaceId, connectedSourceId, {
    documents: 1,
    chunks: 1,
    [OVERRIDDEN_KEY]: [
      {
        document_id: documentId,
        rule_id: kept.ruleId,
        char_start: kept.charStart,
        char_end: kept.charEnd,
      },
    ],
  });
  return { connectedSourceId, jobId: run.id, documentId, ruleId: kept.ruleId };
};

const addressesIn = (answer: unknown, run: RunOverridingASpan): readonly string[] => {
  const answered = JSON.stringify(answer);
  return [OVERRIDDEN_KEY, run.documentId, run.ruleId, "char_start", "char_end"].filter((part) =>
    answered.includes(part),
  );
};

const rowsFor = async (workspaceId: string, connectedSourceId: string) => {
  const read = await app.database.superuser.query<{
    name: string;
    sensitivity: string;
    audience: string;
    audience_groups: readonly string[] | null;
    title: string;
    media_type: string;
    byte_size: number;
    kind: string;
    reason: string;
  }>(
    `SELECT b.name, b.sensitivity, b.audience, b.audience_groups,
            d.title, d.media_type, d.byte_size, j.kind, j.reason
       FROM connected_source b
       JOIN source_document d ON d.workspace_id = b.workspace_id AND d.connected_source_id = b.id
       JOIN job j ON j.workspace_id = b.workspace_id AND j.subject_id = b.id
      WHERE b.workspace_id = $1 AND b.id = $2`,
    [workspaceId, connectedSourceId],
  );
  return read.rows;
};

const connectedSourcesIn = async (workspaceId: string): Promise<number> => {
  const read = await app.database.superuser.query<{ connectedSources: number }>(
    "SELECT count(*)::int AS connected_sources FROM connected_source WHERE workspace_id = $1",
    [workspaceId],
  );
  return read.rows[0]?.connectedSources ?? 0;
};

const uploadRaw = (
  client: TestClient,
  descriptor: UploadDescriptor,
  body: ReadableStream<Uint8Array>,
): Promise<Response> =>
  client.fetch(`${TRPC_ENDPOINT}/sources.connect`, {
    method: "POST",
    headers: uploadHeaders(descriptor),
    body,
    duplex: "half",
  });

const crossedRefusal = z.object({ error: z.object({ data: z.object({ refusal: z.unknown() }) }) });

const refusalIn = async (response: Response) =>
  crossedRefusal.parse(await response.json()).error.data.refusal;

const FIRST_PART = new TextEncoder().encode("The handbook says ");
const LAST_PART = new TextEncoder().encode("what the company decided.");

/**
 * Each read of this body past its first part waits for the test, so the act can be caught
 * mid-stream.
 */
const heldOpenBody = () => {
  const held = { asked: 0, ended: false };
  const gate = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>(
    {
      start: (controller) => {
        controller.enqueue(FIRST_PART);
      },
      pull: async (controller) => {
        held.asked += 1;
        await gate.promise;
        controller.enqueue(LAST_PART);
        controller.close();
        held.ended = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { held, body, finish: () => gate.resolve() };
};

const A_MEGABYTE = 1024 * 1024;

const pastTheCap = () => {
  const block = new Uint8Array(A_MEGABYTE);
  const total = UPLOAD_BYTE_CAP + 8 * A_MEGABYTE;
  const sent = { bytes: 0 };
  const body = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        if (sent.bytes >= total) {
          controller.close();
          return;
        }
        controller.enqueue(block);
        sent.bytes += block.byteLength;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, sent, total };
};

describe("the upload, one mutation over the split link", () => {
  it("names each descriptor field by one header on both sides", () => {
    expect(Object.entries(UPLOAD_HEADER_OF_FIELD).sort()).toEqual(
      Object.entries(UPLOAD_DESCRIPTOR_HEADERS).sort(),
    );
  });

  it("lands a connected source with its document and index job", async () => {
    const { workspace, api, sent } = await anAdmin();
    const finance = await seededIn(app, (seed) =>
      seed.group({ workspaceId: workspace.workspaceId }),
    );
    const described = handbookDescribed({
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [finance.id],
    });

    const bound = await api.sources.connect.mutate(
      new Blob([HANDBOOK], { type: "text/markdown" }),
      uploadOptions(described),
    );

    expect(bound).toEqual({
      connectedSourceId: described.connectedSourceId,
      documentId: expect.any(String),
      jobId: expect.any(String),
      auditEventId: expect.any(String),
      originalKey: expect.any(String),
    });
    expect(bound.originalKey).toEqual(
      `uploads/${described.connectedSourceId.toLowerCase()}/${bound.documentId.toLowerCase()}/original`,
    );
    expect(await rowsFor(workspace.workspaceId, described.connectedSourceId)).toEqual([
      {
        name: "The staff handbook",
        sensitivity: "Internal",
        audience: "groups",
        audience_groups: [finance.id],
        title: "handbook.md",
        media_type: "text/markdown",
        byte_size: HANDBOOK_BYTES,
        kind: "index",
        reason: "connected",
      },
    ]);
    const stored = await actingIn(
      app,
      { workspaceId: workspace.workspaceId, userId: workspace.admin.id },
      (admin) => getObject(admin, store().door, bound.originalKey),
    );
    expect(await textOf(stored)).toBe(HANDBOOK);
    expect(sent).toEqual([
      {
        path: "/trpc/sources.connect",
        batched: false,
        contentType: "application/octet-stream",
      },
    ]);
  });

  it("keeps a descriptor's non-ASCII name intact through the encoded header", async () => {
    const { workspace, api } = await anAdmin();
    const described = handbookDescribed({ name: "Llawlyfr y staff — ŵ" });

    await api.sources.connect.mutate(new Blob([HANDBOOK]), uploadOptions(described));

    expect((await rowsFor(workspace.workspaceId, described.connectedSourceId))[0]?.name).toBe(
      "Llawlyfr y staff — ŵ",
    );
  });

  it("batches every call that is not bytes, as one request", async () => {
    const { api, sent } = await anAdmin();

    await Promise.all([api.sources.list.query(), api.session.membership.query()]);

    expect(sent).toEqual([
      {
        path: "/trpc/sources.list,session.membership",
        batched: true,
        contentType: null,
      },
    ]);
  });

  it("refuses a declared oversize file before its body is read", async () => {
    const { workspace, client } = await anAdmin();
    const { held, body } = heldOpenBody();

    const response = await uploadRaw(
      client,
      handbookDescribed({ byteSize: UPLOAD_BYTE_CAP + 1 }),
      body,
    );

    expect(response.status).toBe(422);
    expect(await refusalIn(response)).toEqual({ word: "too-large", class: "inapplicable" });
    expect(held.ended).toBe(false);
    expect(await connectedSourcesIn(workspace.workspaceId)).toBe(0);
  });

  it("refuses a body passing the cap mid-stream, before its end", async () => {
    const { workspace, client } = await anAdmin();
    const { body, sent, total } = pastTheCap();

    const response = await uploadRaw(client, handbookDescribed(), body);

    expect(response.status).toBe(422);
    expect(await refusalIn(response)).toEqual({ word: "too-large", class: "inapplicable" });
    expect(sent.bytes).toBeLessThan(total);
    expect(await connectedSourcesIn(workspace.workspaceId)).toBe(0);
  }, 180_000);

  it("refuses missing or unreadable descriptor fields by name alone", async () => {
    const { workspace, client } = await anAdmin();
    const headers = uploadHeaders(handbookDescribed());
    headers.delete("x-upload-file-name");
    headers.set("x-upload-byte-size", "%E0%A4%A");

    const response = await client.fetch(`${TRPC_ENDPOINT}/sources.connect`, {
      method: "POST",
      headers,
      body: new Blob([HANDBOOK]),
    });

    expect(response.status).toBe(400);
    expect(await refusalIn(response)).toEqual({
      word: "malformed",
      class: "malformed",
      fields: { fileName: "missing", byteSize: "bad-format" },
    });
    expect(await connectedSourcesIn(workspace.workspaceId)).toBe(0);
  });
});

describe("ten concurrent uploads, whose act opens its own transaction", () => {
  it("holds at most one pooled connection each, none while streaming", async () => {
    const { client } = await anAdmin();
    const { pool } = app.doors.postgres;
    const watched = { held: 0, peak: 0 };
    const acquired = () => {
      watched.held += 1;
      watched.peak = Math.max(watched.peak, watched.held);
    };
    const released = () => {
      watched.held -= 1;
    };
    pool.on("acquire", acquired);
    pool.on("release", released);
    try {
      const bodies = Array.from({ length: UPLOADS_AT_ONCE }, () => heldOpenBody());
      const answers = bodies.map(({ body }) => uploadRaw(client, handbookDescribed(), body));

      await until(async () => bodies.every(({ held }) => held.asked > 0));
      const heldWhileStreaming = watched.held;
      for (const { finish } of bodies) finish();
      const responses = await Promise.all(answers);

      expect(responses.map((response) => response.status)).toEqual(
        Array(UPLOADS_AT_ONCE).fill(200),
      );
      expect(heldWhileStreaming).toBe(0);
      expect(watched.peak).toBeGreaterThan(0);
      expect(watched.peak).toBeLessThanOrEqual(UPLOADS_AT_ONCE);
    } finally {
      pool.off("acquire", acquired);
      pool.off("release", released);
    }
  });
});

describe("a revocation landed while a mutation runs", () => {
  it("refuses the mutation, whose membership read waits on it", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId } = await unpublishedConnectedSource(workspace.workspaceId);
    const revocation = await revocationHeldOpen(app, workspace.admin.id);
    try {
      const narrowing = api.sources.narrow
        .mutate({ connectedSourceId, sensitivity: "Restricted", audience: "everyone" })
        .then(
          () => undefined,
          (refused: unknown) => refused,
        );
      await until(() => someoneWaitsOnALock(app));
      await revocation.land();

      expect(await narrowing).toMatchObject({
        data: {
          httpStatus: 401,
          refusal: { word: "credentials-revoked", class: "unauthenticated" },
        },
      });
    } finally {
      await revocation.abandon();
    }
    const connectedSource = await app.database.superuser.query<{ sensitivity: string }>(
      "SELECT sensitivity FROM connected_source WHERE workspace_id = $1 AND id = $2",
      [workspace.workspaceId, connectedSourceId],
    );
    expect(connectedSource.rows).toEqual([{ sensitivity: "Internal" }]);
  });

  it("does not hold up a read, which resolves membership unheld", async () => {
    const { workspace, api } = await anAdmin();
    await unpublishedConnectedSource(workspace.workspaceId);
    const revocation = await revocationHeldOpen(app, workspace.admin.id);
    try {
      const listed = await api.sources.list.query();

      expect(listed.map((connectedSource) => connectedSource.name)).toEqual(["The staff handbook"]);
    } finally {
      await revocation.abandon();
    }
  });
});

const A_HEALTH_CUE = { category: "special-category", ruleId: "HEALTH_CUE" } as const;

const anAdminWhoseConnectedSourceHoldsAHealthCue = async () => {
  const { workspace, api } = await anAdmin();
  const { connectedSourceId, documentId } = await unpublishedConnectedSource(workspace.workspaceId);
  await seededIn(app, (seed) =>
    seed.finding({ workspaceId: workspace.workspaceId, documentId, ...A_HEALTH_CUE }),
  );
  return { api, connectedSourceId, documentId };
};

describe("the Sources procedures over the wire", () => {
  it("lists an upload's state, counts, last run and quarantine reason", async () => {
    const { workspace, api } = await anAdmin();
    const described = handbookDescribed();
    const bound = await api.sources.connect.mutate(new Blob([HANDBOOK]), uploadOptions(described));
    const scans = await seededIn(app, async (seed) => {
      const connectedSource = await seed.connectedSource({
        workspaceId: workspace.workspaceId,
        name: "Scans",
        publishedAt: null,
      });
      const document = await seed.sourceDocument({
        workspaceId: workspace.workspaceId,
        connectedSourceId: connectedSource.id,
        title: "Floor plan",
        outcome: "quarantined",
        quarantineError: "NeedsOcrError",
      });
      return { connectedSourceId: connectedSource.id, documentId: document.id };
    });

    const listed = await api.sources.list.query();

    expect(listed).toEqual([
      {
        connectedSourceId: scans.connectedSourceId,
        name: "Scans",
        connector: "upload",
        sensitivity: "Internal",
        audience: "everyone",
        audienceGroups: null,
        destination: ["chunk-index", "bundle"],
        retentionClass: "keep",
        state: "received",
        publishedAt: null,
        documentCount: 1,
        chunkCount: 0,
        lastRun: null,
        quarantined: [
          { documentId: scans.documentId, title: "Floor plan", error: "NeedsOcrError" },
        ],
        quarantinedByError: { NeedsOcrError: 1 },
      },
      {
        connectedSourceId: described.connectedSourceId,
        name: "The staff handbook",
        connector: "upload",
        sensitivity: "Restricted",
        audience: "everyone",
        audienceGroups: null,
        destination: ["chunk-index", "bundle"],
        retentionClass: "keep",
        state: "received",
        publishedAt: null,
        documentCount: 1,
        chunkCount: 0,
        lastRun: {
          jobId: bound.jobId,
          kind: "index",
          reason: "connected",
          status: "queued",
          attempts: 0,
          enqueuedAt: expect.stringMatching(ISO_INSTANT),
          finishedAt: null,
        },
        quarantined: [],
        quarantinedByError: {},
      },
    ]);
  });

  it("answers the runs of a connected source by its subject", async () => {
    const { api } = await anAdmin();
    const described = handbookDescribed();
    const bound = await api.sources.connect.mutate(new Blob([HANDBOOK]), uploadOptions(described));

    const runs = await api.runs.ofSubject.query({ subjectId: described.connectedSourceId });

    expect(runs).toEqual([
      {
        jobId: bound.jobId,
        kind: "index",
        reason: "connected",
        status: "queued",
        attempts: 0,
        enqueuedAt: expect.stringMatching(ISO_INSTANT),
        finishedAt: null,
      },
    ]);
  });

  it("lists a run that overrode spans with no span's address", async () => {
    const { workspace, api } = await anAdmin();
    const run = await aRunThatOverrodeAKeptSpan(workspace.workspaceId);

    const listed = await api.sources.list.query();

    expect(listed.map((connectedSource) => connectedSource.lastRun)).toEqual([
      {
        jobId: run.jobId,
        kind: "index",
        reason: "connected",
        status: "done",
        attempts: 1,
        enqueuedAt: expect.stringMatching(ISO_INSTANT),
        finishedAt: PINNED_AT.toISOString(),
      },
    ]);
    expect(addressesIn(listed, run)).toEqual([]);
  });

  it("answers a subject's runs with no span's address in them", async () => {
    const { workspace, api } = await anAdmin();
    const run = await aRunThatOverrodeAKeptSpan(workspace.workspaceId);

    const runs = await api.runs.ofSubject.query({ subjectId: run.connectedSourceId });

    expect(runs.map((listedRun) => listedRun.jobId)).toEqual([run.jobId]);
    expect(addressesIn(runs, run)).toEqual([]);
  });

  it("reads findings by group, counting kept spans an erasure overrides", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId, documentId } = await unpublishedConnectedSource(
      workspace.workspaceId,
    );
    const kept = await seededIn(app, async (seed) => {
      await seed.finding({ workspaceId: workspace.workspaceId, documentId });
      return seed.finding({
        workspaceId: workspace.workspaceId,
        documentId,
        restoredAt: PINNED_AT,
        restoredBy: `human:${workspace.admin.id}`,
        restoreReason: "The sort code is the company's own.",
      });
    });
    await finishedRun(workspace.workspaceId, connectedSourceId, {
      documents: 1,
      chunks: 1,
      [OVERRIDDEN_KEY]: [
        {
          document_id: documentId,
          rule_id: kept.ruleId,
          char_start: kept.charStart,
          char_end: kept.charEnd,
        },
      ],
    });

    const findings = await api.sources.findings.query({ connectedSourceId });

    expect(findings).toEqual([
      {
        documentId,
        title: "handbook.md",
        sensitivity: "Internal",
        category: "bank-details",
        ruleId: "sort-code-with-account-number",
        tier: "always",
        specialCategory: false,
        found: 2,
        overriddenByErasure: 1,
        dismissed: 0,
      },
    ]);
  });

  it("keeps findings in text, hiding finding ids, queuing a run", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId, documentId } = await unpublishedConnectedSource(
      workspace.workspaceId,
    );
    const { one, other } = await seededIn(app, async (seed) => ({
      one: await seed.finding({ workspaceId: workspace.workspaceId, documentId }),
      other: await seed.finding({
        workspaceId: workspace.workspaceId,
        documentId,
        charStart: 40,
        charEnd: 48,
      }),
    }));

    const kept = await api.sources.keepInText.mutate({
      connectedSourceId,
      findingGroups: [
        {
          documentId,
          category: "bank-details",
          ruleId: "sort-code-with-account-number",
          tier: "always",
        },
      ],
      reason: "The sort code is the company's own.",
    });

    expect(kept).toEqual({
      connectedSourceId,
      documentIds: [documentId],
      batchId: expect.any(String),
      jobId: expect.any(String),
    });
    const answered = JSON.stringify(kept);
    expect(answered).not.toContain(one.id);
    expect(answered).not.toContain(other.id);
    const runs = await api.runs.ofSubject.query({ subjectId: connectedSourceId });
    expect(runs.map((run) => [run.jobId, run.reason, run.status])).toEqual([
      [kept.jobId, "restored", "queued"],
    ]);
  });

  it("dismisses a special-category group and queues the run reading it", async () => {
    const { api, connectedSourceId, documentId } =
      await anAdminWhoseConnectedSourceHoldsAHealthCue();

    const dismissed = await api.sources.dismissAsNotSpecialCategory.mutate({
      connectedSourceId,
      findingGroups: [{ documentId, ...A_HEALTH_CUE, tier: "always" }],
      reason: "Our engineers diagnose faults in pumps, never in people.",
    });

    expect(dismissed).toEqual({
      connectedSourceId,
      documentIds: [documentId],
      jobId: expect.any(String),
    });
    const runs = await api.runs.ofSubject.query({ subjectId: connectedSourceId });
    expect(runs.map((run) => [run.jobId, run.reason, run.status])).toEqual([
      [dismissed.jobId, "dismissed", "queued"],
    ]);
  });

  it("refuses to dismiss a non-special-category group in its own word", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId, documentId } = await unpublishedConnectedSource(
      workspace.workspaceId,
    );

    const refused = await refusalOfCall(
      api.sources.dismissAsNotSpecialCategory.mutate({
        connectedSourceId,
        findingGroups: [
          {
            documentId,
            category: "bank-details",
            ruleId: "sort-code-with-account-number",
            tier: "always",
          },
        ],
        reason: "The sort code is the company's own.",
      }),
    );

    expect(refused).toMatchObject({
      data: {
        httpStatus: 422,
        refusal: { word: "not-special-category", class: "inapplicable" },
      },
    });
  });

  it("narrows the documents a finding group sits in", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId, documentId } = await unpublishedConnectedSource(
      workspace.workspaceId,
    );
    await seededIn(app, (seed) => seed.finding({ workspaceId: workspace.workspaceId, documentId }));

    const narrowed = await api.sources.narrowDocuments.mutate({
      connectedSourceId,
      findingGroups: [
        {
          documentId,
          category: "bank-details",
          ruleId: "sort-code-with-account-number",
          tier: "always",
        },
      ],
    });

    expect(narrowed).toEqual({
      connectedSourceId,
      documentIds: [documentId],
      sensitivity: "Restricted",
      concepts: [],
      compositions: [],
    });
  });

  it("publishes an indexed source at the instant the Clock gives", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId } = await unpublishedConnectedSource(workspace.workspaceId);
    await finishedRun(workspace.workspaceId, connectedSourceId, { documents: 1, chunks: 1 });

    const published = await api.sources.publish.mutate({
      connectedSourceId,
      confirmations: THE_THREE_CONFIRMATIONS,
    });

    expect(published).toEqual({
      connectedSourceId,
      auditEventId: expect.any(String),
      dpiaHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const [listed] = await api.sources.list.query();
    expect([listed?.state, listed?.publishedAt]).toEqual(["published", "2026-09-23T09:00:00.000Z"]);
  });

  it("narrows a connected source's class", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId } = await unpublishedConnectedSource(workspace.workspaceId);

    const narrowed = await api.sources.narrow.mutate({
      connectedSourceId,
      sensitivity: "Restricted",
      audience: "everyone",
    });

    expect(narrowed).toEqual({
      connectedSourceId,
      auditEventId: expect.any(String),
      visibility: { sensitivity: "Restricted", audience: "everyone", audienceGroups: null },
      concepts: [],
      compositions: [],
    });
  });

  it("widens a connected source's class, refusing a non-wider one", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId } = await unpublishedConnectedSource(workspace.workspaceId);

    const widened = await api.sources.widen.mutate({
      connectedSourceId,
      sensitivity: "Public",
      audience: "everyone",
    });
    const refused = await refusalOfCall(
      api.sources.widen.mutate({
        connectedSourceId,
        sensitivity: "Internal",
        audience: "everyone",
      }),
    );

    expect(widened).toEqual({
      connectedSourceId,
      auditEventId: expect.any(String),
      visibility: { sensitivity: "Public", audience: "everyone", audienceGroups: null },
      concepts: [],
      compositions: [],
    });
    expect(refused).toMatchObject({
      data: { httpStatus: 422, refusal: { word: "not-wider", class: "inapplicable" } },
    });
  });

  it("previews an unpublished connected source's chunks to its Admin", async () => {
    const { workspace, api } = await anAdmin();
    const { connectedSourceId, documentId } = await unpublishedConnectedSource(
      workspace.workspaceId,
    );
    const chunk = await seededIn(app, (seed) =>
      seed.chunk({
        workspaceId: workspace.workspaceId,
        connectedSourceId,
        sourceDocumentId: documentId,
        content: HANDBOOK,
        locator: `chars:0-${String(HANDBOOK_BYTES)}`,
        ordinal: 0,
        charStart: 0,
        charEnd: HANDBOOK_BYTES,
      }),
    );

    const previewed = await api.sources.preview.query({ connectedSourceId });

    expect(previewed).toEqual([
      {
        id: chunk.id,
        sourceDocumentId: documentId,
        locator: `${documentId}/chars:0-43`,
        content: HANDBOOK,
      },
    ]);
  });
});
