import type pg from "pg";
import { describe, expect, it } from "vitest";

import { bindUpload, UPLOAD_BYTE_CAP } from "../src/sources/index.ts";
import { getObject, listObjects } from "../src/store/objects/index.ts";
import { ledgerRowsOf, groupNamed } from "./sourced-concept.ts";
import { objectStoreForSuite, textOf } from "./suite-objects.ts";
import { whileWritesAreRefused } from "./suite-postgres.ts";
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
