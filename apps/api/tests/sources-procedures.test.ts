import { ulid } from "@better-answers/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { UPLOAD_BYTE_CAP } from "@better-answers/core/sources";
import { getObject } from "@better-answers/core/store/objects";
import { objectStoreForSuite, textOf } from "@better-answers/core/testing/objects";
import { until } from "@better-answers/core/testing/postgres";

import { POSTGRES_POOL_MAX } from "../src/doors.ts";
import { TRPC_ENDPOINT } from "../src/trpc/mount.ts";
import { actingIn, startApp, type TestApp, type TestClient } from "./harness.ts";
import { UPLOAD_DESCRIPTOR_HEADERS } from "../src/trpc/upload.ts";
import {
  revocationHeldOpen,
  seededIn,
  someoneWaitsOnALock,
  THE_THREE_CONFIRMATIONS,
} from "./provoke.ts";
import {
  anAdminOnTheWeb,
  UPLOAD_HEADER_OF_FIELD,
  uploadHeaders,
  uploadOptions,
  type UploadDescriptor,
} from "./web-client.ts";

const store = objectStoreForSuite();

const PINNED_AT = new Date("2026-09-23T09:00:00.000Z");

// The api's own pool size, so ten uploads each holding two would have found it full.
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
  bindingId: ulid(),
  name: "The staff handbook",
  fileName: "handbook.md",
  mediaType: "text/markdown",
  byteSize: HANDBOOK_BYTES,
  ...overrides,
});

const anAdmin = () => anAdminOnTheWeb(app);

const unpublishedBinding = (workspaceId: string, name = "The staff handbook") =>
  seededIn(app, async (seed) => {
    const binding = await seed.sourceBinding({ workspaceId, name, publishedAt: null });
    const document = await seed.sourceDocument({
      workspaceId,
      bindingId: binding.id,
      title: "handbook.md",
    });
    return { bindingId: binding.id, documentId: document.id };
  });

const finishedRun = (workspaceId: string, bindingId: string, outcome: Record<string, unknown>) =>
  seededIn(app, (seed) =>
    seed.job({
      workspaceId,
      kind: "index",
      subjectId: bindingId,
      reason: "bound",
      status: "done",
      attempts: 1,
      finishedAt: PINNED_AT,
      outcome,
    }),
  );

const rowsFor = async (workspaceId: string, bindingId: string) => {
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
       FROM source_binding b
       JOIN source_document d ON d.workspace_id = b.workspace_id AND d.binding_id = b.id
       JOIN job j ON j.workspace_id = b.workspace_id AND j.subject_id = b.id
      WHERE b.workspace_id = $1 AND b.id = $2`,
    [workspaceId, bindingId],
  );
  return read.rows;
};

const bindingsIn = async (workspaceId: string): Promise<number> => {
  const read = await app.database.superuser.query<{ bindings: number }>(
    "SELECT count(*)::int AS bindings FROM source_binding WHERE workspace_id = $1",
    [workspaceId],
  );
  return read.rows[0]?.bindings ?? 0;
};

const uploadRaw = (
  client: TestClient,
  descriptor: UploadDescriptor,
  body: ReadableStream<Uint8Array>,
): Promise<Response> =>
  client.fetch(`${TRPC_ENDPOINT}/sources.bind`, {
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

// Each read of this body past its first part waits for the test, so the act can be caught
// mid-stream.
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
  it("names each descriptor field by the same header on the web's side and the api's", () => {
    expect(Object.entries(UPLOAD_HEADER_OF_FIELD).sort()).toEqual(
      Object.entries(UPLOAD_DESCRIPTOR_HEADERS).sort(),
    );
  });

  it("lands a binding, its document and its index job from the web's own link and descriptor", async () => {
    const { workspace, api, sent } = await anAdmin();
    const finance = await seededIn(app, (seed) =>
      seed.group({ workspaceId: workspace.workspaceId }),
    );
    const described = handbookDescribed({
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [finance.id],
    });

    const bound = await api.sources.bind.mutate(
      new Blob([HANDBOOK], { type: "text/markdown" }),
      uploadOptions(described),
    );

    expect(bound).toEqual({
      bindingId: described.bindingId,
      documentId: expect.any(String),
      jobId: expect.any(String),
      auditEventId: expect.any(String),
      originalKey: `uploads/${described.bindingId.toLowerCase()}/original`,
    });
    expect(await rowsFor(workspace.workspaceId, described.bindingId)).toEqual([
      {
        name: "The staff handbook",
        sensitivity: "Internal",
        audience: "groups",
        audience_groups: [finance.id],
        title: "handbook.md",
        media_type: "text/markdown",
        byte_size: HANDBOOK_BYTES,
        kind: "index",
        reason: "bound",
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
        path: "/trpc/sources.bind",
        batched: false,
        contentType: "application/octet-stream",
      },
    ]);
  });

  it("sends a descriptor's non-ASCII name intact, as the header carries it encoded", async () => {
    const { workspace, api } = await anAdmin();
    const described = handbookDescribed({ name: "Llawlyfr y staff — ŵ" });

    await api.sources.bind.mutate(new Blob([HANDBOOK]), uploadOptions(described));

    expect((await rowsFor(workspace.workspaceId, described.bindingId))[0]?.name).toBe(
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

  it("refuses a file declared over the cap while its body is still open, so no one read it first", async () => {
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
    expect(await bindingsIn(workspace.workspaceId)).toBe(0);
  });

  it("refuses a body that passes the cap as it streams, before the body is read to its end", async () => {
    const { workspace, client } = await anAdmin();
    const { body, sent, total } = pastTheCap();

    const response = await uploadRaw(client, handbookDescribed(), body);

    expect(response.status).toBe(422);
    expect(await refusalIn(response)).toEqual({ word: "too-large", class: "inapplicable" });
    expect(sent.bytes).toBeLessThan(total);
    expect(await bindingsIn(workspace.workspaceId)).toBe(0);
  }, 180_000);

  it("refuses a descriptor a field is missing from or unreadable in, naming each and no value", async () => {
    const { workspace, client } = await anAdmin();
    const headers = uploadHeaders(handbookDescribed());
    headers.delete("x-upload-file-name");
    headers.set("x-upload-byte-size", "%E0%A4%A");

    const response = await client.fetch(`${TRPC_ENDPOINT}/sources.bind`, {
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
    expect(await bindingsIn(workspace.workspaceId)).toBe(0);
  });
});

describe("ten uploads at once, through the procedure whose act opens its own transaction", () => {
  it("never holds more than one pooled connection each, and none while the bodies stream", async () => {
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
  it("is refused by the mutation, whose membership read waits for it and reads it", async () => {
    const { workspace, api } = await anAdmin();
    const { bindingId } = await unpublishedBinding(workspace.workspaceId);
    const revocation = await revocationHeldOpen(app, workspace.admin.id);
    try {
      const narrowing = api.sources.narrow
        .mutate({ bindingId, sensitivity: "Restricted", audience: "everyone" })
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
    const binding = await app.database.superuser.query<{ sensitivity: string }>(
      "SELECT sensitivity FROM source_binding WHERE workspace_id = $1 AND id = $2",
      [workspace.workspaceId, bindingId],
    );
    expect(binding.rows).toEqual([{ sensitivity: "Internal" }]);
  });

  it("is not waited for by a read, which resolves its membership unheld", async () => {
    const { workspace, api } = await anAdmin();
    await unpublishedBinding(workspace.workspaceId);
    const revocation = await revocationHeldOpen(app, workspace.admin.id);
    try {
      const listed = await api.sources.list.query();

      expect(listed.map((binding) => binding.name)).toEqual(["The staff handbook"]);
    } finally {
      await revocation.abandon();
    }
  });
});

describe("the Sources procedures over the wire", () => {
  it("lists an upload with its state, counts and last run, and says why a document was quarantined", async () => {
    const { workspace, api } = await anAdmin();
    const described = handbookDescribed();
    const bound = await api.sources.bind.mutate(new Blob([HANDBOOK]), uploadOptions(described));
    const scans = await seededIn(app, async (seed) => {
      const binding = await seed.sourceBinding({
        workspaceId: workspace.workspaceId,
        name: "Scans",
        publishedAt: null,
      });
      const document = await seed.sourceDocument({
        workspaceId: workspace.workspaceId,
        bindingId: binding.id,
        title: "Floor plan",
        outcome: "quarantined",
        quarantineError: "NeedsOcrError",
      });
      return { bindingId: binding.id, documentId: document.id };
    });

    const listed = await api.sources.list.query();

    expect(listed).toEqual([
      {
        bindingId: scans.bindingId,
        name: "Scans",
        connector: "upload",
        sensitivity: "Internal",
        audience: "everyone",
        audienceGroups: null,
        destination: ["chunk-index", "bundle"],
        retentionClass: "keep",
        state: "landed",
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
        bindingId: described.bindingId,
        name: "The staff handbook",
        connector: "upload",
        sensitivity: "Restricted",
        audience: "everyone",
        audienceGroups: null,
        destination: ["chunk-index", "bundle"],
        retentionClass: "keep",
        state: "landed",
        publishedAt: null,
        documentCount: 1,
        chunkCount: 0,
        lastRun: {
          jobId: bound.jobId,
          kind: "index",
          reason: "bound",
          status: "queued",
          attempts: 0,
          enqueuedAt: expect.stringMatching(ISO_INSTANT),
          finishedAt: null,
          outcome: null,
        },
        quarantined: [],
        quarantinedByError: {},
      },
    ]);
  });

  it("answers the runs of a binding by its subject", async () => {
    const { api } = await anAdmin();
    const described = handbookDescribed();
    const bound = await api.sources.bind.mutate(new Blob([HANDBOOK]), uploadOptions(described));

    const runs = await api.runs.ofSubject.query({ subjectId: described.bindingId });

    expect(runs).toEqual([
      {
        jobId: bound.jobId,
        kind: "index",
        reason: "bound",
        status: "queued",
        attempts: 0,
        enqueuedAt: expect.stringMatching(ISO_INSTANT),
        finishedAt: null,
        outcome: null,
      },
    ]);
  });

  it("reads a binding's findings by group, saying how many kept spans an erasure overrides", async () => {
    const { workspace, api } = await anAdmin();
    const { bindingId, documentId } = await unpublishedBinding(workspace.workspaceId);
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
    await finishedRun(workspace.workspaceId, bindingId, {
      documents: 1,
      chunks: 1,
      restores_overridden_by_erasure: [
        {
          document_id: documentId,
          rule_id: kept.ruleId,
          char_start: kept.charStart,
          char_end: kept.charEnd,
        },
      ],
    });

    const findings = await api.sources.findings.query({ bindingId });

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
      },
    ]);
  });

  it("keeps a finding group in text and queues the run that lets it back in", async () => {
    const { workspace, api } = await anAdmin();
    const { bindingId, documentId } = await unpublishedBinding(workspace.workspaceId);
    const finding = await seededIn(app, (seed) =>
      seed.finding({ workspaceId: workspace.workspaceId, documentId }),
    );

    const kept = await api.sources.keepInText.mutate({
      bindingId,
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

    expect(kept).toEqual({ bindingId, findingIds: [finding.id], jobId: expect.any(String) });
    const runs = await api.runs.ofSubject.query({ subjectId: bindingId });
    expect(runs.map((run) => [run.jobId, run.reason, run.status])).toEqual([
      [kept.jobId, "restored", "queued"],
    ]);
  });

  it("narrows the documents a finding group sits in", async () => {
    const { workspace, api } = await anAdmin();
    const { bindingId, documentId } = await unpublishedBinding(workspace.workspaceId);
    await seededIn(app, (seed) => seed.finding({ workspaceId: workspace.workspaceId, documentId }));

    const narrowed = await api.sources.narrowDocuments.mutate({
      bindingId,
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
      bindingId,
      documentIds: [documentId],
      sensitivity: "Restricted",
      concepts: [],
      compositions: [],
    });
  });

  it("publishes an indexed binding at the instant the api's Clock gives", async () => {
    const { workspace, api } = await anAdmin();
    const { bindingId } = await unpublishedBinding(workspace.workspaceId);
    await finishedRun(workspace.workspaceId, bindingId, { documents: 1, chunks: 1 });

    const published = await api.sources.publish.mutate({
      bindingId,
      confirmations: THE_THREE_CONFIRMATIONS,
    });

    expect(published).toEqual({
      bindingId,
      auditEventId: expect.any(String),
      dpiaHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const [listed] = await api.sources.list.query();
    expect([listed?.state, listed?.publishedAt]).toEqual(["published", "2026-09-23T09:00:00.000Z"]);
  });

  it("narrows a binding's class", async () => {
    const { workspace, api } = await anAdmin();
    const { bindingId } = await unpublishedBinding(workspace.workspaceId);

    const narrowed = await api.sources.narrow.mutate({
      bindingId,
      sensitivity: "Restricted",
      audience: "everyone",
    });

    expect(narrowed).toEqual({
      bindingId,
      auditEventId: expect.any(String),
      visibility: { sensitivity: "Restricted", audience: "everyone", audienceGroups: null },
      concepts: [],
      compositions: [],
    });
  });

  it("previews an unpublished binding's chunks to its Admin", async () => {
    const { workspace, api } = await anAdmin();
    const { bindingId, documentId } = await unpublishedBinding(workspace.workspaceId);
    const chunk = await seededIn(app, (seed) =>
      seed.chunk({
        workspaceId: workspace.workspaceId,
        bindingId,
        sourceDocumentId: documentId,
        content: HANDBOOK,
        locator: `chars:0-${String(HANDBOOK_BYTES)}`,
        ordinal: 0,
        charStart: 0,
        charEnd: HANDBOOK_BYTES,
      }),
    );

    const previewed = await api.sources.preview.query({ bindingId });

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
