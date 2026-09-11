import type pg from "pg";
import { describe, expect, it } from "vitest";

import { readableClause, readableParameters } from "../src/access/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { bindUpload, dpiaInputFor, publishBinding, UPLOAD_BYTE_CAP } from "../src/sources/index.ts";
import { getObject, listObjects } from "../src/store/objects/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { chunkUnder, ledgerRowsOf, groupNamed, seededBy } from "./sourced-concept.ts";
import { objectStoreForSuite, textOf } from "./suite-objects.ts";
import { readingAs, whileWritesAreRefused } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

/**
 * The sources slice's lifecycle acts over a real Postgres and a real Garage — the two stores
 * a bind writes to, neither of them a stand-in, because what this suite is about is the order
 * the two are written in and what survives when the second refuses.
 *
 * **The bind is the one act in this package that takes doors rather than a transaction.** Its
 * bytes go to the object store *before* its transaction opens (blob before row), so a test
 * here can see three things no single-store suite can: that the object holds the bytes under
 * the workspace's prefix and no other's, that the four rows land together or not at all, and
 * that the refusals a caller can be told about are told before a byte is read.
 *
 * The orphan a crash between the put and the row leaves is deliberate and is the S4 sweep's;
 * the fail-together case below names it rather than asserting it away.
 */

const { db, arrange } = suiteWithBundles();
const store = objectStoreForSuite();

/** The two doors the bind takes: Postgres for its rows, the object store for its bytes. */
const doorsOf = (scenario: Scenario) => ({ postgres: scenario.postgres, objects: store().door });

/**
 * One upload's bytes, and a flag saying whether anything has pulled on them yet. The queuing
 * strategy's high-water mark is zero on purpose: at the default of one the stream fills its
 * own queue at construction, and the flag would read as *read* before any caller touched it.
 */
const uploadOf = (text: string) => {
  const state = { read: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        state.read = true;
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { state, body };
};

/** The binding as the store holds it, read as the superuser — every column the bind decides. */
const bindingRowOf = async (pool: pg.Pool, workspaceId: string, bindingId: string) => {
  const read = await pool.query(
    `SELECT name, connector, destination, retention_class, state, rules_in_force,
            published_at, sensitivity, audience, audience_groups
       FROM source_binding WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, bindingId],
  );
  return read.rows[0];
};

/** The one document a bind catalogues, read as the superuser. */
const documentRowOf = async (pool: pg.Pool, workspaceId: string, documentId: string) => {
  const read = await pool.query(
    `SELECT binding_id, source_system_id, title, media_type, byte_size,
            original_key, normalised_key, content_hash, outcome, sensitivity
       FROM source_document WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, documentId],
  );
  return read.rows[0];
};

/** The job the bind queued, read as the superuser: its kind, its reason and its subject. */
const jobRowOf = async (pool: pg.Pool, workspaceId: string, jobId: string) => {
  const read = await pool.query(
    "SELECT kind, reason, status, subject_id FROM job WHERE workspace_id = $1 AND id = $2",
    [workspaceId, jobId],
  );
  return read.rows[0];
};

/** How many bindings and documents this workspace holds — the fail-together case's reading. */
const countsIn = async (pool: pg.Pool, workspaceId: string) => {
  const read = await pool.query<{ bindings: number; documents: number }>(
    `SELECT (SELECT count(*)::int FROM source_binding WHERE workspace_id = $1) AS bindings,
            (SELECT count(*)::int FROM source_document WHERE workspace_id = $1) AS documents`,
    [workspaceId],
  );
  return read.rows[0];
};

/** The handbook every case below uploads, and the byte count its caller declares for it. */
const HANDBOOK = "The handbook says what the company decided.";
const HANDBOOK_BYTES = 43;

describe("an Admin binds an upload", () => {
  it("the bind lands the binding, the document, the ledger row and the index job together, and the object holds the bytes under the workspace's prefix", async () => {
    const scenario = await arrange();
    const upload = uploadOf(HANDBOOK);

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), {
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: HANDBOOK_BYTES,
      body: upload.body,
    });
    if (!bound.ok) throw new Error(`the bind was refused: ${String(bound.error)}`);
    const { bindingId, documentId, jobId, auditEventId, originalKey } = bound.value;

    // The binding is born fail-closed and unpublished, at the connector's own destination
    // set, the *keep* class an upload leaves no source to mirror for, and the safe rule set.
    expect(await bindingRowOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      name: "The staff handbook",
      connector: "upload",
      destination: ["chunk-index", "bundle"],
      retention_class: "keep",
      state: "landed",
      rules_in_force: { default_on: true, default_off: false },
      published_at: null,
      sensitivity: "Restricted",
      audience: "everyone",
      audience_groups: null,
    });

    // Its one document carries the original's key and nothing a run has not been over yet.
    expect(await documentRowOf(db().pool, scenario.workspaceId, documentId)).toEqual({
      binding_id: bindingId,
      source_system_id: "handbook.md",
      title: "handbook.md",
      media_type: "text/markdown",
      byte_size: HANDBOOK_BYTES,
      original_key: originalKey,
      normalised_key: null,
      content_hash: null,
      outcome: null,
      sensitivity: null,
    });
    expect(originalKey).toEqual(`documents/${documentId.toLowerCase()}/original`);

    // `[AUDIT1]`, `[AUDIT5]`: the ledger row is in the same transaction, and its detail is ids
    // and words — never the binding's name and never the file's, either of which can hold a
    // person's name in a row the platform never rewrites.
    expect(await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.bound")).toEqual([
      {
        id: auditEventId,
        actor: `human:${scenario.admin.userId}`,
        subject_id: bindingId,
        detail: {
          bindingId,
          documentId,
          sensitivity: "Restricted",
          audience: "everyone",
        },
      },
    ]);

    // And the job the worker will claim, about this binding, for the reason it happened.
    expect(await jobRowOf(db().pool, scenario.workspaceId, jobId)).toEqual({
      kind: "index",
      reason: "bound",
      status: "queued",
      subject_id: bindingId,
    });

    // The bytes are under this workspace's prefix at the original's key, and nowhere else.
    const got = await getObject(scenario.admin, store().door, originalKey);
    if (!got.ok) throw new Error(`the object door refused the read: ${got.error}`);
    expect(await textOf(got.value)).toEqual("The handbook says what the company decided.");
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({
      ok: true,
      value: [originalKey],
    });

    // And under no other workspace's, asked of a second one that exists at the same moment:
    // the door's prefix is its own and never the caller's, so a bind cannot put a document
    // where another tenant's Admin would find it by naming the same key.
    const elsewhere = await arrange();
    expect(await listObjects(elsewhere.admin, store().door, "")).toEqual({ ok: true, value: [] });
    expect(await getObject(elsewhere.admin, store().door, originalKey)).toEqual({
      ok: false,
      error: "no-such-object",
    });
  });

  it("the bind lands no row at all when the queue refuses its job, leaving only the object the sweep collects", async () => {
    const scenario = await arrange();
    const upload = uploadOf(HANDBOOK);

    // The job is the transaction's last statement, so refusing every write to `job` fails the
    // act after its three rows exist — which is the only way to tell a transaction that
    // landed four things from four statements that happened to succeed.
    const bound = await whileWritesAreRefused(db().pool, "job", () =>
      bindUpload(scenario.admin, doorsOf(scenario), {
        name: "The staff handbook",
        fileName: "handbook.md",
        mediaType: "text/markdown",
        byteSize: HANDBOOK_BYTES,
        body: upload.body,
      }),
    );

    expect(bound.ok).toEqual(false);
    expect(await countsIn(db().pool, scenario.workspaceId)).toEqual({ bindings: 0, documents: 0 });
    expect(await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.bound")).toEqual(
      [],
    );

    // Blob before row: the bytes went first and are still there. The orphan is findable by its
    // key and collected by S4's sweep, which is the trade the discipline was chosen for.
    const left = await listObjects(scenario.admin, store().door, "");
    if (!left.ok) throw new Error(`the object door refused the listing: ${left.error}`);
    expect(left.value.length).toEqual(1);
  });

  it("refuses an Editor the bind, and puts no bytes for them", async () => {
    const scenario = await arrange();
    const upload = uploadOf(HANDBOOK);

    const bound = await bindUpload(scenario.editor, doorsOf(scenario), {
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: HANDBOOK_BYTES,
      body: upload.body,
    });

    expect(bound).toEqual({ ok: false, error: "role-forbids" });
    expect(upload.state.read).toEqual(false);
    expect(await listObjects(scenario.editor, store().door, "")).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["a binding nobody named", { name: "   " }],
    ["a file the source system calls nothing", { fileName: "  " }],
    ["a class the glossary does not have", { sensitivity: "Secret" }],
    ["an audience the glossary does not have", { audience: "the board" }],
    [
      "groups named under the audience that takes none",
      { audienceGroups: ["01J6NNNNNNNNNNNNNNNNNNNNN2"] },
    ],
    ["a size that is not a whole number of bytes", { byteSize: 12.5 }],
    ["a media type of nothing at all", { mediaType: "   " }],
  ])("refuses %s with one word", async (_case, override) => {
    const scenario = await arrange();
    const upload = uploadOf(HANDBOOK);

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), {
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: HANDBOOK_BYTES,
      body: upload.body,
      ...override,
    });

    expect(bound).toEqual({ ok: false, error: "malformed" });
    expect(upload.state.read).toEqual(false);
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({ ok: true, value: [] });
  });

  it("refuses an audience naming a group this workspace does not hold", async () => {
    const scenario = await arrange();
    const upload = uploadOf(HANDBOOK);

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), {
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: HANDBOOK_BYTES,
      body: upload.body,
      audience: "groups",
      audienceGroups: ["01J6NNNNNNNNNNNNNNNNNNNNN1"],
    });

    expect(bound).toEqual({ ok: false, error: "no-such-group" });
    expect(upload.state.read).toEqual(false);
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({ ok: true, value: [] });
  });

  it("binds for a group this workspace does hold, and the binding wears that audience", async () => {
    const scenario = await arrange();
    const groupId = await groupNamed(db(), scenario, "Finance", [scenario.viewer]);
    const upload = uploadOf(HANDBOOK);

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), {
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: HANDBOOK_BYTES,
      body: upload.body,
      audience: "groups",
      audienceGroups: [groupId],
    });
    if (!bound.ok) throw new Error(`the bind was refused: ${String(bound.error)}`);

    const row = await bindingRowOf(db().pool, scenario.workspaceId, bound.value.bindingId);
    expect({
      sensitivity: row?.sensitivity,
      audience: row?.audience,
      audience_groups: row?.audience_groups,
    }).toEqual({ sensitivity: "Restricted", audience: "groups", audience_groups: [groupId] });
  });

  it.each([
    ["a spreadsheet", "application/vnd.ms-excel"],
    ["an image", "image/png"],
    ["Word's older format", "application/msword"],
  ])(
    "refuses %s, a media type outside the allow-list, before a byte is read",
    async (_case, mediaType) => {
      const scenario = await arrange();
      const upload = uploadOf(HANDBOOK);

      const bound = await bindUpload(scenario.admin, doorsOf(scenario), {
        name: "The staff handbook",
        fileName: "handbook.md",
        mediaType,
        byteSize: HANDBOOK_BYTES,
        body: upload.body,
      });

      expect(bound).toEqual({ ok: false, error: "media-type-refused" });
      expect(upload.state.read).toEqual(false);
      expect(await listObjects(scenario.admin, store().door, "")).toEqual({ ok: true, value: [] });
    },
  );

  it("refuses a file whose declared size is over the cap, before a byte is read", async () => {
    const scenario = await arrange();
    const upload = uploadOf(HANDBOOK);

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), {
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: UPLOAD_BYTE_CAP + 1,
      body: upload.body,
    });

    expect(bound).toEqual({ ok: false, error: "too-large" });
    expect(upload.state.read).toEqual(false);
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({ ok: true, value: [] });
  });

  it("takes a file at exactly the cap", async () => {
    const scenario = await arrange();
    const upload = uploadOf(HANDBOOK);

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), {
      name: "The staff handbook",
      fileName: "handbook.md",
      mediaType: "text/markdown",
      byteSize: UPLOAD_BYTE_CAP,
      body: upload.body,
    });

    expect(bound.ok).toEqual(true);
  });

  it("caps one upload under the edge's own limit, with room for what the edge wraps it in", () => {
    // The two figures written down rather than derived: the cap this act enforces, and the
    // 100 MB Cloudflare's Free and Pro plans stop a request body at, which is the ceiling a
    // per-file cap has to sit under (`deploy/platform.compose.yaml`, `AGENT_MAX_FILE_BYTES`).
    expect(UPLOAD_BYTE_CAP).toEqual(67108864);
    expect(UPLOAD_BYTE_CAP).toBeLessThan(104857600);
  });
});

/**
 * The publish, and what it opens up.
 *
 * Three instants, written down rather than read off a clock: when the run the bind queued
 * finished, when the Admin published, and — for the one case that proves *latest* means
 * latest — when an earlier run failed. The publish's instant is handed to the act, because
 * the act takes one and defaults none (ADR 0040).
 */
const RUN_FAILED_AT = new Date("2026-09-11T08:00:00.000Z");
const RUN_FINISHED_AT = new Date("2026-09-11T09:30:00.000Z");
const PUBLISHED_AT = new Date("2026-09-11T10:00:00.000Z");

/** All three confirmations, as a publish dialog would hand them over. */
const CONFIRMED = {
  lawfulBasisRecorded: true,
  privacyInformationUpdated: true,
  dpiaReferenced: true,
} as const;

/** What the seeded chunks hold — the passage a reader asks for once the binding is published. */
const HOLIDAY = "Holiday is twenty-eight days including bank holidays.";
const NOTICE = "Notice is one month either way after probation.";

/** Every count field the published act declares, each at nought — the shape a reading starts from. */
const NO_FINDINGS = {
  findingsSpecialCategory: 0,
  findingsBankDetails: 0,
  findingsGovernmentIdentifier: 0,
  findingsDateOfBirth: 0,
  findingsHomeAddress: 0,
  findingsPersonalContact: 0,
  findingsPersonName: 0,
  findingsJobTitle: 0,
};

/** A 64-character lower-case hex digest — the shape the ledger's content-hash kind admits. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

const asAdmin = <T>(scenario: Scenario, work: (admin: UserPrincipal, tx: Tx) => Promise<T>) =>
  readingAs(db().runtimePool, scenario.admin, work);

/** One bound handbook: the binding, its document and the `index` run the bind queued. */
const boundHandbook = async (scenario: Scenario, shape: Partial<BindShape> = {}) => {
  const bound = await bindUpload(scenario.admin, doorsOf(scenario), {
    name: "The staff handbook",
    fileName: "handbook.md",
    mediaType: "text/markdown",
    byteSize: HANDBOOK_BYTES,
    body: uploadOf(HANDBOOK).body,
    ...shape,
  });
  if (!bound.ok) throw new Error(`the bind was refused: ${String(bound.error)}`);
  return bound.value;
};

type BindShape = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audienceGroups: readonly string[];
};

/** What a job row carries beyond its status, per the claim protocol's own CHECKs. */
const claimColumnsOf = (status: string, at: Date) => {
  if (status === "queued") return {};
  const claimed = { attempts: 1, claimedBy: "worker-1", claimedAt: at, heartbeatAt: at };
  if (status === "claimed") return { ...claimed, leaseExpiresAt: at };
  if (status === "poisoned") return { ...claimed, attempts: 3, finishedAt: at };
  return { ...claimed, finishedAt: at, outcome: { chunks: 2 } };
};

/**
 * One `index` run over this binding, at the status and instant given — the row the worker
 * would have left. No act in this package finishes a job, because finishing one is the
 * worker's; so the arrange stands in for it through the factory, as `runs.test.ts` does for
 * the nightly audit.
 */
const runOver = (workspaceId: string, bindingId: string, status: string, at: Date) =>
  seededBy(db(), (seed) =>
    seed.job({
      workspaceId,
      kind: "index",
      subjectId: bindingId,
      reason: "bound",
      status,
      enqueuedAt: at,
      ...claimColumnsOf(status, at),
    }),
  );

/**
 * The run the bind queued, replaced by one the worker has left at this status: the queued row
 * goes first, because the queue holds one queued run per binding and a second would be the
 * row that index refuses.
 */
const runEndedAt = async (
  workspaceId: string,
  bindingId: string,
  jobId: string,
  status: string,
  at: Date,
) => {
  await db().pool.query("DELETE FROM job WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    jobId,
  ]);
  await runOver(workspaceId, bindingId, status, at);
};

/** The binding's two columns a publish writes, read as the superuser. */
const publishStateOf = async (pool: pg.Pool, workspaceId: string, bindingId: string) => {
  const read = await pool.query<{ published_at: Date | null; state: string }>(
    "SELECT published_at, state FROM source_binding WHERE workspace_id = $1 AND id = $2",
    [workspaceId, bindingId],
  );
  return read.rows[0];
};

/** Every chunk of this binding and the instant it is published at, oldest span first. */
const chunkStampsOf = async (pool: pg.Pool, workspaceId: string, bindingId: string) => {
  const read = await pool.query<{ published_at: Date | null }>(
    `SELECT published_at FROM "index".chunk
      WHERE workspace_id = $1 AND binding_id = $2 ORDER BY ordinal`,
    [workspaceId, bindingId],
  );
  return read.rows.map((row) => row.published_at);
};

/**
 * The chunks of one document this person reaches, under the one predicate every read of a
 * readable unit appends. T-133's `passageAt` lands beside this ticket rather than under it,
 * so the suite renders the predicate itself — the same two functions that read will render —
 * and this row extends rather than moves when it arrives.
 */
const passagesReadableBy = (person: UserPrincipal, sourceDocumentId: string) =>
  readingAs(db().runtimePool, person, async (reader, tx) => {
    const read = await tx.query<{ content: string }>(
      `SELECT c.content FROM "index".chunk c
        WHERE c.workspace_id = $1 AND c.source_document_id = $2 AND ${readableClause("c", 3)}
        ORDER BY c.ordinal`,
      [reader.workspaceId, sourceDocumentId, ...readableParameters(reader)],
    );
    return read.rows.map((row) => row.content);
  });

describe("an Admin publishes a binding", () => {
  it("publishes the binding and every one of its chunk copies from the one instant, and its ledger row carries the confirmations, the totals by category and the DPIA hash", async () => {
    const scenario = await arrange();
    const { bindingId, documentId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);
    await chunkUnder(
      db(),
      scenario.workspaceId,
      { bindingId, documentId },
      {
        content: HOLIDAY,
        ordinal: 0,
        charStart: 0,
        charEnd: 53,
      },
    );
    await chunkUnder(
      db(),
      scenario.workspaceId,
      { bindingId, documentId },
      {
        content: NOTICE,
        ordinal: 1,
        charStart: 54,
        charEnd: 101,
      },
    );

    // What the seam found in this document: two names and one set of bank details, which is
    // what the totals by category on the ledger row have to add up to.
    await seededBy(db(), async (seed) => {
      await seed.finding({
        workspaceId: scenario.workspaceId,
        documentId,
        category: "person-name",
        tier: "default-off",
        charStart: 0,
        charEnd: 7,
      });
      await seed.finding({
        workspaceId: scenario.workspaceId,
        documentId,
        category: "person-name",
        tier: "default-off",
        charStart: 8,
        charEnd: 15,
      });
      await seed.finding({
        workspaceId: scenario.workspaceId,
        documentId,
        category: "bank-details",
        tier: "always",
        charStart: 16,
        charEnd: 24,
      });
    });

    const published = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, { bindingId, publishedAt: PUBLISHED_AT, confirmations: CONFIRMED }),
    );
    if (!published.ok) throw new Error(`the publish was refused: ${String(published.error)}`);

    // The binding wears the instant it was handed and the one state word this act writes.
    expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      published_at: PUBLISHED_AT,
      state: "published",
    });
    // Every chunk copy, from the same instant — not the first, and not most of them.
    expect(await chunkStampsOf(db().pool, scenario.workspaceId, bindingId)).toEqual([
      PUBLISHED_AT,
      PUBLISHED_AT,
    ]);

    // `[AUDIT5]`: ids, flags and counts. No name, no filename, and no category the agreement
    // does not carry — a category with nothing found says nought rather than going missing.
    const rows = await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.published");
    expect(rows.length).toEqual(1);
    const row = rows[0];
    expect(row?.id).toEqual(published.value.auditEventId);
    expect(row?.actor).toEqual(`human:${scenario.admin.userId}`);
    expect(row?.subject_id).toEqual(bindingId);
    expect(row?.detail).toEqual({
      bindingId,
      lawfulBasisRecorded: true,
      privacyInformationUpdated: true,
      dpiaReferenced: true,
      ...NO_FINDINGS,
      findingsPersonName: 2,
      findingsBankDetails: 1,
      dpiaHash: row?.detail["dpiaHash"],
    });

    // The hash is the DPIA input's own, so the assessment a company files and the publication
    // it covers name one document. Its shape is written down; its value cannot be, because
    // the document it is taken over carries a binding id minted a moment ago — so the claim
    // that can be made is that it is *that* function's answer, which is the claim the ADR
    // makes (ADR 0020).
    expect(row?.detail["dpiaHash"]).toMatch(SHA256_HEX);
    const input = await asAdmin(scenario, (admin, tx) => dpiaInputFor(admin, tx, { bindingId }));
    if (!input.ok) throw new Error(`the DPIA input was refused: ${String(input.error)}`);
    expect(row?.detail["dpiaHash"]).toEqual(input.value.hash);
  });

  it("publishes when the latest run is done even though an earlier run over the same binding failed", async () => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "failed", RUN_FAILED_AT);
    await runOver(scenario.workspaceId, bindingId, "done", RUN_FINISHED_AT);

    const published = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, { bindingId, publishedAt: PUBLISHED_AT, confirmations: CONFIRMED }),
    );

    expect(published.ok).toEqual(true);
    expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      published_at: PUBLISHED_AT,
      state: "published",
    });
  });

  it.each([
    ["queued", RUN_FINISHED_AT],
    ["claimed", RUN_FINISHED_AT],
    ["failed", RUN_FINISHED_AT],
    ["poisoned", RUN_FINISHED_AT],
  ])(
    "refuses the publish as not-indexed while the binding's latest run is %s, and writes nothing",
    async (status, at) => {
      const scenario = await arrange();
      const { bindingId, documentId, jobId } = await boundHandbook(scenario);
      await runEndedAt(scenario.workspaceId, bindingId, jobId, status, at);
      await chunkUnder(
        db(),
        scenario.workspaceId,
        { bindingId, documentId },
        {
          content: HOLIDAY,
          ordinal: 0,
          charStart: 0,
          charEnd: 53,
        },
      );

      const published = await asAdmin(scenario, (admin, tx) =>
        publishBinding(admin, tx, {
          bindingId,
          publishedAt: PUBLISHED_AT,
          confirmations: CONFIRMED,
        }),
      );

      expect(published).toEqual({ ok: false, error: "not-indexed" });
      expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
        published_at: null,
        state: "landed",
      });
      expect(await chunkStampsOf(db().pool, scenario.workspaceId, bindingId)).toEqual([null]);
      expect(
        await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.published"),
      ).toEqual([]);
    },
  );

  it("refuses the publish as not-indexed when no run has ever been queued over the binding", async () => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await db().pool.query("DELETE FROM job WHERE workspace_id = $1 AND id = $2", [
      scenario.workspaceId,
      jobId,
    ]);

    const published = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, { bindingId, publishedAt: PUBLISHED_AT, confirmations: CONFIRMED }),
    );

    expect(published).toEqual({ ok: false, error: "not-indexed" });
  });

  it("refuses a second publish of a binding that is already published, and leaves the first instant standing", async () => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);

    const first = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, { bindingId, publishedAt: PUBLISHED_AT, confirmations: CONFIRMED }),
    );
    expect(first.ok).toEqual(true);

    const again = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, {
        bindingId,
        publishedAt: new Date("2026-09-12T10:00:00.000Z"),
        confirmations: CONFIRMED,
      }),
    );

    expect(again).toEqual({ ok: false, error: "already-published" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      published_at: PUBLISHED_AT,
      state: "published",
    });
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.published"),
    ).toHaveLength(1);
  });

  it.each([
    ["the lawful basis is not recorded", { lawfulBasisRecorded: false }],
    ["the privacy information has not been updated", { privacyInformationUpdated: false }],
    ["the DPIA is not referenced", { dpiaReferenced: false }],
  ])("refuses the publish when %s, and writes nothing", async (_case, override) => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);

    const published = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, {
        bindingId,
        publishedAt: PUBLISHED_AT,
        confirmations: { ...CONFIRMED, ...override },
      }),
    );

    expect(published).toEqual({ ok: false, error: "confirmation-missing" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      published_at: null,
      state: "landed",
    });
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.published"),
    ).toEqual([]);
  });

  it("refuses an Editor the publish", async () => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);

    const published = await readingAs(db().runtimePool, scenario.editor, (editor, tx) =>
      publishBinding(editor, tx, {
        bindingId,
        publishedAt: PUBLISHED_AT,
        confirmations: CONFIRMED,
      }),
    );

    expect(published).toEqual({ ok: false, error: "role-forbids" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      published_at: null,
      state: "landed",
    });
  });

  it("refuses the publish of a binding this workspace does not hold", async () => {
    const scenario = await arrange();

    const published = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, {
        bindingId: "01J6NNNNNNNNNNNNNNNNNNNNN3",
        publishedAt: PUBLISHED_AT,
        confirmations: CONFIRMED,
      }),
    );

    expect(published).toEqual({ ok: false, error: "no-such-binding" });
  });

  it("refuses the publish of a binding id that is not one the platform mints", async () => {
    const scenario = await arrange();

    const published = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, {
        bindingId: "  ",
        publishedAt: PUBLISHED_AT,
        confirmations: CONFIRMED,
      }),
    );

    expect(published).toEqual({ ok: false, error: "malformed" });
  });
});

describe("a Viewer inside the audience", () => {
  it("reads nothing of the binding before the publish, and its passages on the next read after it", async () => {
    const scenario = await arrange();
    const finance = await groupNamed(db(), scenario, "Finance", [scenario.viewer]);
    const { bindingId, documentId, jobId } = await boundHandbook(scenario, {
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [finance],
    });
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);

    // The copies a run lands: the binding's class and audience on the chunk's own columns,
    // and no published instant, because the binding has not been published.
    for (const [ordinal, content, charStart, charEnd] of [
      [0, HOLIDAY, 0, 53],
      [1, NOTICE, 54, 101],
    ] as const) {
      await chunkUnder(
        db(),
        scenario.workspaceId,
        { bindingId, documentId },
        {
          content,
          ordinal,
          charStart,
          charEnd,
          sensitivity: "Internal",
          audience: "groups",
          audienceGroups: [finance],
        },
      );
    }

    // Before the publish the predicate's first clause withholds every one of them: a unit
    // with no published instant has not entered the company's knowledge and is nobody's.
    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([]);

    const published = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, { bindingId, publishedAt: PUBLISHED_AT, confirmations: CONFIRMED }),
    );
    if (!published.ok) throw new Error(`the publish was refused: ${String(published.error)}`);

    // And on the next read, both passages, written down here rather than read back off the
    // arrange (`[TEST9]`).
    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([
      "Holiday is twenty-eight days including bank holidays.",
      "Notice is one month either way after probation.",
    ]);
  });

  it("reads nothing of a published binding whose audience names a group they are not in", async () => {
    const scenario = await arrange();
    const finance = await groupNamed(db(), scenario, "Finance", []);
    const { bindingId, documentId, jobId } = await boundHandbook(scenario, {
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [finance],
    });
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);
    await chunkUnder(
      db(),
      scenario.workspaceId,
      { bindingId, documentId },
      {
        content: HOLIDAY,
        ordinal: 0,
        charStart: 0,
        charEnd: 53,
        sensitivity: "Internal",
        audience: "groups",
        audienceGroups: [finance],
      },
    );

    const published = await asAdmin(scenario, (admin, tx) =>
      publishBinding(admin, tx, { bindingId, publishedAt: PUBLISHED_AT, confirmations: CONFIRMED }),
    );
    if (!published.ok) throw new Error(`the publish was refused: ${String(published.error)}`);

    // The publish opens the first clause and no other: the audience still names a group this
    // Viewer is not in, so a publish is not a way in (`[TEST7]`, the pair both ways).
    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([]);
  });
});
