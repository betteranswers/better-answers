import { createHash } from "node:crypto";

import type pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { connectedSourceIdTakenAgain } from "@better-answers/schema/testing/probes";

import { readableClause, readableParameters } from "../src/access/index.ts";
import { STORED_DETAIL_KEYS } from "../src/audit/index.ts";
import { ERASURE } from "../src/erasure/index.ts";
import {
  attempt,
  parse,
  ulid,
  type PlatformPrincipal,
  type UserPrincipal,
} from "../src/kernel/index.ts";
import {
  connectUpload,
  connectUploadFields,
  ORPHANED_UPLOAD_GRACE_HOURS,
  publishConnectedSource,
  publishConnectedSourceInput,
  reprocessConnectedSource,
  reprocessConnectedSourceInput,
  REINDEX,
  reindexEveryConnectedSource,
  sweepOrphanedUploads,
  UPLOAD_BYTE_CAP,
  UPLOAD_SWEEP,
} from "../src/sources/index.ts";
import { getObject, listObjects, putObject } from "../src/store/objects/index.ts";
import { withScope, type Tx } from "../src/store/postgres/index.ts";
import { contractFixture, mediaTypeOutside } from "./contract-fixture.ts";
import {
  passageUnder,
  passageVersionsOf,
  auditEventRowsOf,
  groupNamed,
  seededBy,
} from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { objectStoreForSuite, textOf } from "./suite-objects.ts";
import { answered, readingAs, whileWritesAreRefused } from "./suite-postgres.ts";
import { suiteWithBundles, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();
const store = objectStoreForSuite();

const typesOutsideTheAgreement = contractFixture(
  "upload-media-types",
  z.object({ outside: z.array(mediaTypeOutside).min(1) }),
).outside;

const doorsOf = (scenario: Scenario) => ({ postgres: scenario.postgres, objects: store().door });

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

/** Holds its bytes until released, so a test can say which of two binds streams first. */
const heldUploadOf = (text: string) => {
  const reached = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        reached.resolve();
        await gate.promise;
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { body, streaming: reached.promise, release: () => gate.resolve() };
};

const A_MEGABYTE = 1024 * 1024;

const pastTheCap = () => {
  const block = new Uint8Array(A_MEGABYTE);
  let sent = 0;
  return new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        const left = UPLOAD_BYTE_CAP + 1 - sent;
        if (left <= 0) {
          controller.close();
          return;
        }
        const size = Math.min(block.byteLength, left);
        controller.enqueue(size === block.byteLength ? block : block.subarray(0, size));
        sent += size;
      },
    },
    { highWaterMark: 0 },
  );
};

const storedFor = async (by: UserPrincipal) => {
  const stored = await listObjects(by, store().door, "");
  if (!stored.ok) throw new Error(`the object door refused the listing: ${stored.error}`);
  return stored.value;
};

const connectedSourceRowOf = async (
  pool: pg.Pool,
  workspaceId: string,
  connectedSourceId: string,
) => {
  const read = await pool.query(
    `SELECT name, connector, destination, retention_class, state, rules_in_force,
            published_at, sensitivity, audience, audience_groups
       FROM connected_source WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, connectedSourceId],
  );
  return read.rows[0];
};

const documentRowOf = async (pool: pg.Pool, workspaceId: string, documentId: string) => {
  const read = await pool.query(
    `SELECT connected_source_id, source_system_id, title, media_type, byte_size,
            original_key, normalised_key, content_hash, outcome, sensitivity
       FROM source_document WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, documentId],
  );
  return read.rows[0];
};

const jobRowOf = async (pool: pg.Pool, workspaceId: string, jobId: string) => {
  const read = await pool.query(
    "SELECT kind, reason, status, subject_id FROM job WHERE workspace_id = $1 AND id = $2",
    [workspaceId, jobId],
  );
  return read.rows[0];
};

const countsIn = async (pool: pg.Pool, workspaceId: string) => {
  const read = await pool.query<{ connectedSources: number; documents: number }>(
    `SELECT (SELECT count(*)::int FROM connected_source WHERE workspace_id = $1) AS "connectedSources",
            (SELECT count(*)::int FROM source_document WHERE workspace_id = $1) AS documents`,
    [workspaceId],
  );
  return read.rows[0];
};

const oneOfEachIn = async (pool: pg.Pool, workspaceId: string) => {
  const read = await pool.query<{
    connectedSources: number;
    documents: number;
    auditEvents: number;
    jobs: number;
  }>(
    `SELECT (SELECT count(*)::int FROM connected_source WHERE workspace_id = $1)
              AS "connectedSources",
            (SELECT count(*)::int FROM source_document WHERE workspace_id = $1) AS documents,
            (SELECT count(*)::int FROM audit_event
               WHERE workspace_id = $1 AND action = 'sources.binding.bound') AS "auditEvents",
            (SELECT count(*)::int FROM job
               WHERE workspace_id = $1 AND kind = 'index') AS jobs`,
    [workspaceId],
  );
  return read.rows[0];
};

const HANDBOOK = "The handbook says what the company decided.";
const HANDBOOK_BYTES = 43;

type ConnectShape = Partial<z.input<typeof connectUploadFields>>;

const handbookAsked = (shape: ConnectShape = {}) => ({
  connectedSourceId: ulid(),
  name: "The staff handbook",
  fileName: "handbook.md",
  mediaType: "text/markdown",
  byteSize: HANDBOOK_BYTES,
  ...shape,
});

const handbookOffered = (shape: ConnectShape = {}) => {
  const upload = uploadOf(HANDBOOK);
  return {
    upload,
    input: { ...inputOf(connectUploadFields, handbookAsked(shape)), body: upload.body },
  };
};

const leftBehindBy = async (
  by: UserPrincipal,
  upload: { readonly state: { readonly read: boolean } },
) => ({ bodyRead: upload.state.read, stored: await storedFor(by) });

describe("an Admin connects an upload", () => {
  it("lands the source, document, audit event, job and object together", async () => {
    const scenario = await arrange();
    const { input } = handbookOffered();

    const bound = await connectUpload(scenario.admin, doorsOf(scenario), input);
    if (!bound.ok) throw new Error(`the connect was refused: ${String(bound.error)}`);
    const { connectedSourceId, documentId, jobId, auditEventId, originalKey } = bound.value;

    expect(await connectedSourceRowOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual({
      name: "The staff handbook",
      connector: "upload",
      destination: ["passage-index", "bundle"],
      retention_class: "keep",
      state: "received",
      rules_in_force: { default_on: true, default_off: false },
      published_at: null,
      sensitivity: "Restricted",
      audience: "everyone",
      audience_groups: null,
    });

    expect(await documentRowOf(db().pool, scenario.workspaceId, documentId)).toEqual({
      connected_source_id: connectedSourceId,
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
    expect(originalKey).toEqual(
      `uploads/${connectedSourceId.toLowerCase()}/${documentId.toLowerCase()}/original`,
    );

    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.bound"),
    ).toEqual([
      {
        id: auditEventId,
        actor: `human:${scenario.admin.userId}`,
        subject_id: connectedSourceId,
        detail: {
          [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
          documentId,
          sensitivity: "Restricted",
          audience: "everyone",
        },
      },
    ]);

    expect(await jobRowOf(db().pool, scenario.workspaceId, jobId)).toEqual({
      kind: "index",
      reason: "connected",
      status: "queued",
      subject_id: connectedSourceId,
    });

    const got = await getObject(scenario.admin, store().door, originalKey);
    if (!got.ok) throw new Error(`the object door refused the read: ${got.error}`);
    expect(await textOf(got.value)).toEqual("The handbook says what the company decided.");
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({
      ok: true,
      value: [originalKey],
    });

    const elsewhere = await arrange();
    expect(await listObjects(elsewhere.admin, store().door, "")).toEqual({ ok: true, value: [] });
    expect(await getObject(elsewhere.admin, store().door, originalKey)).toEqual({
      ok: false,
      error: "no-such-object",
    });
  });

  it("leaves only the object when the queue refuses its job", async () => {
    const scenario = await arrange();
    const { input } = handbookOffered();

    /**
     * The job is the transaction's last statement, so refusing it fails the action with three rows
     * written: only that tells one transaction from four statements.
     */
    const bound = await whileWritesAreRefused(db().pool, "job", () =>
      connectUpload(scenario.admin, doorsOf(scenario), input),
    );

    expect(bound.ok).toEqual(false);
    expect(await countsIn(db().pool, scenario.workspaceId)).toEqual({
      connectedSources: 0,
      documents: 0,
    });
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.bound"),
    ).toEqual([]);

    const left = await listObjects(scenario.admin, store().door, "");
    if (!left.ok) throw new Error(`the object door refused the listing: ${left.error}`);
    expect(left.value.length).toEqual(1);
  });

  it("refuses an Editor the connect and stores no bytes", async () => {
    const scenario = await arrange();
    const { upload, input } = handbookOffered();

    const bound = await connectUpload(scenario.editor, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "role-forbids" });
    expect(await leftBehindBy(scenario.editor, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it.each([
    [
      "a malformed connected source id",
      { connectedSourceId: "ws_handbook" },
      { connectedSourceId: "bad-format" },
    ],
    ["a connected source nobody named", { name: "   " }, { name: "too-small" }],
    ["a blank file name", { fileName: "  " }, { fileName: "too-small" }],
    [
      "a sensitivity outside the glossary",
      { sensitivity: "Secret" },
      { sensitivity: "not-in-set" },
    ],
    ["an audience outside the glossary", { audience: "the board" }, { audience: "not-in-set" }],
    [
      "groups under an audience taking none",
      { audienceGroups: ["01J6NNNNNNNNNNNNNNNNNNNNN2"] },
      { audience: "refused" },
    ],
    ["a fractional byte size", { byteSize: 12.5 }, { byteSize: "wrong-type" }],
    ["a blank media type", { mediaType: "   " }, { mediaType: "too-small" }],
  ])("names the field of %s", (_case, override, fields) => {
    expect(parse(connectUploadFields, handbookAsked(override))).toEqual({
      ok: false,
      error: { word: "malformed", fields },
    });
  });

  it("refuses an audience naming a group the workspace lacks", async () => {
    const scenario = await arrange();
    const { upload, input } = handbookOffered({
      audience: "groups",
      audienceGroups: ["01J6NNNNNNNNNNNNNNNNNNNNN1"],
    });

    const bound = await connectUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "no-such-group" });
    expect(await leftBehindBy(scenario.admin, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it("connects for a held group, the source wearing that audience", async () => {
    const scenario = await arrange();
    const groupId = await groupNamed(db(), scenario, "Finance", [scenario.viewer]);
    const { input } = handbookOffered({ audience: "groups", audienceGroups: [groupId] });

    const bound = await connectUpload(scenario.admin, doorsOf(scenario), input);
    if (!bound.ok) throw new Error(`the connect was refused: ${String(bound.error)}`);

    const row = await connectedSourceRowOf(
      db().pool,
      scenario.workspaceId,
      bound.value.connectedSourceId,
    );
    expect({
      sensitivity: row?.sensitivity,
      audience: row?.audience,
      audience_groups: row?.audience_groups,
    }).toEqual({ sensitivity: "Restricted", audience: "groups", audience_groups: [groupId] });
  });

  it.each([
    ["a spreadsheet, outside the allow-list", "application/vnd.ms-excel"],
    ["an image, outside the allow-list", "image/png"],

    ...typesOutsideTheAgreement.map((outside) => [
      `${outside.media_type}, outside the tiers' agreement`,
      outside.media_type,
    ]),
  ])("refuses %s, before reading a byte", async (_case, mediaType) => {
    const scenario = await arrange();
    const { upload, input } = handbookOffered({ mediaType });

    const bound = await connectUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "media-type-refused" });
    expect(await leftBehindBy(scenario.admin, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it("refuses a declared size over the cap, reading no byte", async () => {
    const scenario = await arrange();
    const { upload, input } = handbookOffered({ byteSize: UPLOAD_BYTE_CAP + 1 });

    const bound = await connectUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "too-large" });
    expect(await leftBehindBy(scenario.admin, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it("takes a file at exactly the cap", async () => {
    const scenario = await arrange();
    const { input } = handbookOffered({ byteSize: UPLOAD_BYTE_CAP });

    const bound = await connectUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound.ok).toEqual(true);
  });

  it.each([
    ["more", HANDBOOK_BYTES * 1000],
    ["fewer", 1],
  ])("records the size streamed, not %s bytes declared", async (_case, byteSize) => {
    const scenario = await arrange();
    const { input } = handbookOffered({ byteSize });

    const bound = await connectUpload(scenario.admin, doorsOf(scenario), input);
    if (!bound.ok) throw new Error(`the connect was refused: ${String(bound.error)}`);

    const row = await documentRowOf(db().pool, scenario.workspaceId, bound.value.documentId);
    expect(row?.byte_size).toEqual(HANDBOOK_BYTES);
  });

  it("refuses a body past the cap, whatever its declared size", async () => {
    const scenario = await arrange();
    const asked = handbookAsked();
    const input = { ...inputOf(connectUploadFields, asked), body: pastTheCap() };

    const bound = await connectUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "too-large" });
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({ ok: true, value: [] });
    expect(await countsIn(db().pool, scenario.workspaceId)).toEqual({
      connectedSources: 0,
      documents: 0,
    });
  });

  it("answers a repeated connected source id with the first outcome", async () => {
    const scenario = await arrange();
    const connectedSourceId = ulid();

    const first = await connectUpload(
      scenario.admin,
      doorsOf(scenario),
      handbookOffered({ connectedSourceId }).input,
    );
    if (!first.ok) throw new Error(`the connect was refused: ${String(first.error)}`);
    const repeat = handbookOffered({ connectedSourceId });
    const again = await connectUpload(scenario.admin, doorsOf(scenario), repeat.input);

    expect(again).toEqual(first);
    expect(await leftBehindBy(scenario.admin, repeat.upload)).toEqual({
      bodyRead: false,
      stored: [first.value.originalKey],
    });
    expect(await oneOfEachIn(db().pool, scenario.workspaceId)).toEqual({
      connectedSources: 1,
      documents: 1,
      auditEvents: 1,
      jobs: 1,
    });
  });

  it("keeps the first body when a concurrent repeat loses", async () => {
    const scenario = await arrange();
    const connectedSourceId = ulid();
    const asked = inputOf(connectUploadFields, handbookAsked({ connectedSourceId }));
    const winner = heldUploadOf(HANDBOOK);
    const loser = heldUploadOf("A body no row describes.");

    const first = connectUpload(scenario.admin, doorsOf(scenario), { ...asked, body: winner.body });
    const second = connectUpload(scenario.admin, doorsOf(scenario), { ...asked, body: loser.body });
    await Promise.all([winner.streaming, loser.streaming]);
    winner.release();
    const won = await first;
    loser.release();
    const lost = await second;

    if (!won.ok) throw new Error(`the first connect was refused: ${String(won.error)}`);
    expect(lost).toEqual(won);
    const { documentId, originalKey } = won.value;
    const row = await documentRowOf(db().pool, scenario.workspaceId, documentId);
    expect(row?.original_key).toEqual(originalKey);
    const got = await getObject(scenario.admin, store().door, originalKey);
    if (!got.ok) throw new Error(`the object door refused the read: ${got.error}`);
    expect(await textOf(got.value)).toEqual(HANDBOOK);
    expect((await storedFor(scenario.admin)).filter((key) => key !== originalKey)).toEqual([
      expect.stringMatching(
        new RegExp(`^uploads/${connectedSourceId.toLowerCase()}/[0-9a-z]{26}/original$`),
      ),
    ]);
    expect(await oneOfEachIn(db().pool, scenario.workspaceId)).toEqual({
      connectedSources: 1,
      documents: 1,
      auditEvents: 1,
      jobs: 1,
    });
  });

  it("caps one upload below the edge's own limit", () => {
    expect(UPLOAD_BYTE_CAP).toEqual(67108864);
    expect(UPLOAD_BYTE_CAP).toBeLessThan(104857600);
  });
});

const A_DAY_MS = 24 * 60 * 60 * 1000;

const sweptAt = (scenario: Scenario, now: Date, dryRun = false) =>
  sweepOrphanedUploads(
    UPLOAD_SWEEP,
    { postgres: scenario.postgres, objects: store().door },
    { workspaceId: scenario.workspaceId, now, dryRun },
  );

const aFailedConnect = async (scenario: Scenario) => {
  const standing = await storedFor(scenario.admin);
  const bound = await whileWritesAreRefused(db().pool, "job", () =>
    connectUpload(scenario.admin, doorsOf(scenario), handbookOffered().input),
  );
  if (bound.ok) throw new Error("the connect landed where the queue was refused");
  const left = (await storedFor(scenario.admin)).filter((key) => !standing.includes(key));
  if (left.length !== 1 || left[0] === undefined) {
    throw new Error(`the refused connect left ${String(left.length)} objects, not one`);
  }
  return left[0];
};

/** An original under `uploads/<connected source>/original`, the shape keys already in the store still have. */
const anOlderOriginal = async (scenario: Scenario, connectedSourceId: string) => {
  const key = `uploads/${connectedSourceId.toLowerCase()}/original`;
  await putObject(scenario.admin, store().door, key, uploadOf(HANDBOOK).body);
  return key;
};

describe("the sweep collects what failed connects and lost races left", () => {
  it("leaves every original standing while the grace holds", async () => {
    const scenario = await arrange();
    const named = await boundHandbook(scenario);
    const orphaned = await aFailedConnect(scenario);

    const swept = await sweptAt(scenario, new Date());

    expect(swept).toEqual({ ok: true, value: { found: 0, removed: 0 } });
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({
      ok: true,
      value: [named.originalKey, orphaned].sort(),
    });
  });

  it("keeps an unnamed original an hour inside the grace", async () => {
    const scenario = await arrange();
    const orphaned = await aFailedConnect(scenario);

    const almost = new Date(Date.now() + (ORPHANED_UPLOAD_GRACE_HOURS - 1) * 60 * 60 * 1000);
    const swept = await sweptAt(scenario, almost);

    expect(swept).toEqual({ ok: true, value: { found: 0, removed: 0 } });
    expect(await storedFor(scenario.admin)).toContain(orphaned);
  });

  it("removes an unnamed original after the grace, keeping named ones", async () => {
    const scenario = await arrange();
    const named = await boundHandbook(scenario);
    await aFailedConnect(scenario);

    const past = new Date(Date.now() + (ORPHANED_UPLOAD_GRACE_HOURS + 1) * 60 * 60 * 1000);
    const swept = await sweptAt(scenario, past);

    expect(swept).toEqual({ ok: true, value: { found: 1, removed: 1 } });
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({
      ok: true,
      value: [named.originalKey],
    });
  });

  it("records each removed original's connect, but never its key", async () => {
    const scenario = await arrange();
    const orphaned = await aFailedConnect(scenario);

    const past = new Date(Date.now() + A_DAY_MS * 2);
    await sweptAt(scenario, past);

    const [connectedSourceId, documentId] = orphaned
      .split("/")
      .slice(1, 3)
      .map((id) => id.toUpperCase());
    const rows = await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.upload.swept");
    expect(rows).toEqual([
      {
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        actor: "process:better-answers-uploads",
        subject_id: connectedSourceId,
        detail: { [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId, documentId },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("uploads/");
  });

  it("sweeps an unnamed older original, keeping a named one", async () => {
    const scenario = await arrange();
    const named = await boundHandbook(scenario);
    const kept = await anOlderOriginal(scenario, named.connectedSourceId);
    await db().pool.query(
      "UPDATE source_document SET original_key = $3 WHERE workspace_id = $1 AND id = $2",
      [scenario.workspaceId, named.documentId, kept],
    );
    const connectedSourceId = ulid();
    await anOlderOriginal(scenario, connectedSourceId);

    const swept = await sweptAt(scenario, new Date(Date.now() + A_DAY_MS * 2));

    expect(swept).toEqual({ ok: true, value: { found: 2, removed: 2 } });
    expect(await storedFor(scenario.admin)).toEqual([kept]);
    const rows = await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.upload.swept");
    expect(rows.map((row) => row.detail)).toEqual(
      expect.arrayContaining([
        {
          [STORED_DETAIL_KEYS.connectedSourceId]: named.connectedSourceId,
          documentId: named.documentId,
        },
        { [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it.each([
    ["an older key whose connected source is no id", "uploads/a-note-from-somewhere-else/original"],
    ["a key whose document is no id", `uploads/${ulid().toLowerCase()}/a-draft/original`],
    ["a key whose connected source is no id", `uploads/a-draft/${ulid().toLowerCase()}/original`],
    [
      "a key a segment too long",
      `uploads/${ulid().toLowerCase()}/${ulid().toLowerCase()}/x/original`,
    ],
    ["a key ending past its original", `uploads/${ulid().toLowerCase()}/original-draft`],
    ["a key nesting an older original", `uploads/a-draft/uploads/${ulid().toLowerCase()}/original`],
  ])("leaves %s", async (_case, stray) => {
    const scenario = await arrange();
    await putObject(scenario.admin, store().door, stray, uploadOf("not an original").body);

    const swept = await sweptAt(scenario, new Date(Date.now() + A_DAY_MS * 2));

    expect(swept).toEqual({ ok: true, value: { found: 0, removed: 0 } });
    expect(await storedFor(scenario.admin)).toContain(stray);
  });

  it("counts what a list-only sweep would remove, removing none", async () => {
    const scenario = await arrange();
    await boundHandbook(scenario);
    const orphaned = await aFailedConnect(scenario);

    const past = new Date(Date.now() + A_DAY_MS * 2);
    const looked = await sweptAt(scenario, past, true);

    expect(looked).toEqual({ ok: true, value: { found: 1, removed: 0 } });
    expect(await storedFor(scenario.admin)).toContain(orphaned);
  });

  it("refuses a malformed workspace id before removing anything", async () => {
    const scenario = await arrange();
    const orphaned = await aFailedConnect(scenario);

    const swept = await sweepOrphanedUploads(
      UPLOAD_SWEEP,
      { postgres: scenario.postgres, objects: store().door },
      { workspaceId: "ws_synthetic", now: new Date(Date.now() + A_DAY_MS * 2) },
    );

    expect(swept).toEqual({ ok: false, error: "malformed" });
    expect(await storedFor(scenario.admin)).toContain(orphaned);
  });
});

const SYNC_FAILED_AT = new Date("2026-09-11T08:00:00.000Z");
const SYNC_FINISHED_AT = new Date("2026-09-11T09:30:00.000Z");
const PUBLISHED_AT = new Date("2026-09-11T10:00:00.000Z");

const CONFIRMED = {
  lawfulBasisRecorded: true,
  privacyInformationUpdated: true,
  dpiaReferenced: true,
} as const;

const HOLIDAY = "Holiday is twenty-eight days including bank holidays.";
const NOTICE = "Notice is one month either way after probation.";

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

const SHA256_HEX = /^[0-9a-f]{64}$/;

const asAdmin = <T>(scenario: Scenario, work: (admin: UserPrincipal, tx: Tx) => Promise<T>) =>
  readingAs(db().runtimePool, scenario.admin, work);

const boundHandbook = async (scenario: Scenario, shape: ConnectShape = {}) => {
  const bound = await connectUpload(
    scenario.admin,
    doorsOf(scenario),
    handbookOffered(shape).input,
  );
  if (!bound.ok) throw new Error(`the connect was refused: ${String(bound.error)}`);
  return bound.value;
};

const claimColumnsOf = (status: string, at: Date) => {
  if (status === "queued") return {};
  const claimed = { attempts: 1, claimedBy: "worker-1", claimedAt: at, heartbeatAt: at };
  if (status === "claimed") return { ...claimed, leaseExpiresAt: at };
  if (status === "poisoned") return { ...claimed, attempts: 3, finishedAt: at };
  return { ...claimed, finishedAt: at, outcome: { passages: 2 } };
};

const syncOver = (workspaceId: string, connectedSourceId: string, status: string, at: Date) =>
  seededBy(db(), (seed) =>
    seed.job({
      workspaceId,
      kind: "index",
      subjectId: connectedSourceId,
      reason: "connected",
      status,
      enqueuedAt: at,
      ...claimColumnsOf(status, at),
    }),
  );

const syncEndedAt = async (
  workspaceId: string,
  connectedSourceId: string,
  jobId: string,
  status: string,
  at: Date,
) => {
  await db().pool.query("DELETE FROM job WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    jobId,
  ]);
  await syncOver(workspaceId, connectedSourceId, status, at);
};

const reconciledUnder = async (workspaceId: string, documentId: string, version: string) => {
  await db().pool.query(
    "UPDATE source_document SET redaction_version = $3 WHERE workspace_id = $1 AND id = $2",
    [workspaceId, documentId, version],
  );
};

const publishStateOf = async (pool: pg.Pool, workspaceId: string, connectedSourceId: string) => {
  const read = await pool.query<{ published_at: Date | null; state: string }>(
    "SELECT published_at, state FROM connected_source WHERE workspace_id = $1 AND id = $2",
    [workspaceId, connectedSourceId],
  );
  return read.rows[0];
};

const passageStampsOf = async (pool: pg.Pool, workspaceId: string, connectedSourceId: string) => {
  const read = await pool.query<{ published_at: Date | null }>(
    `SELECT published_at FROM "index".readable_passage
      WHERE workspace_id = $1 AND connected_source_id = $2 ORDER BY ordinal`,
    [workspaceId, connectedSourceId],
  );
  return read.rows.map((row) => row.published_at);
};

const runsOver = async (pool: pg.Pool, workspaceId: string, connectedSourceId: string) => {
  const read = await pool.query<{ kind: string; reason: string | null; status: string }>(
    `SELECT kind, reason, status FROM job
      WHERE workspace_id = $1 AND subject_id = $2 ORDER BY enqueued_at DESC, id DESC`,
    [workspaceId, connectedSourceId],
  );
  return read.rows;
};

const passagesReadableBy = async (person: UserPrincipal, sourceDocumentId: string) =>
  answered(
    await readingAs(db().runtimePool, person, async (reader, tx) => {
      const read = await tx.query<{ content: string }>(
        `SELECT c.content FROM "index".readable_passage c
        WHERE c.workspace_id = $1 AND c.source_document_id = $2 AND ${readableClause("c", 3)}
        ORDER BY c.ordinal`,
        [reader.workspaceId, sourceDocumentId, ...readableParameters(reader)],
      );
      return read.rows.map((row) => row.content);
    }),
  );

const passagesOfTheHandbook = async (
  workspaceId: string,
  document: { readonly connectedSourceId: string; readonly documentId: string },
) => {
  for (const [ordinal, content, charStart, charEnd] of [
    [0, HOLIDAY, 0, 53],
    [1, NOTICE, 54, 101],
  ] as const) {
    await passageUnder(db(), workspaceId, document, { content, ordinal, charStart, charEnd });
  }
};

const indexedHandbook = async (scenario: Scenario) => {
  const bound = await boundHandbook(scenario);
  await syncEndedAt(
    scenario.workspaceId,
    bound.connectedSourceId,
    bound.jobId,
    "done",
    SYNC_FINISHED_AT,
  );
  await passagesOfTheHandbook(scenario.workspaceId, bound);
  return bound;
};

type PublishAsked = z.input<typeof publishConnectedSourceInput> & { readonly publishedAt: Date };

const publishedAsked = ({ publishedAt, ...asked }: PublishAsked) => ({
  ...inputOf(publishConnectedSourceInput, asked),
  publishedAt,
});

const publishing = (scenario: Scenario, asked: PublishAsked) =>
  asAdmin(scenario, (admin, tx) => publishConnectedSource(admin, tx, publishedAsked(asked)));

const publishedHandbook = async (scenario: Scenario, connectedSourceId: string) => {
  const published = await publishing(scenario, {
    connectedSourceId,
    publishedAt: PUBLISHED_AT,
    confirmations: CONFIRMED,
  });
  if (!published.ok) throw new Error(`the publish was refused: ${String(published.error)}`);
  return published.value;
};

/**
 * Keys written sorted at every depth, the canonical form the hash covers, so the expected hash owes
 * nothing to the code under test.
 */
const dpiaHashOfTheHandbook = (connectedSourceId: string): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        audience: "everyone",
        class: "Internal",
        connectedSourceId,
        modelChoices: [],
        personalDataCategories: [
          "special-category",
          "bank-details",
          "government-identifier",
          "date-of-birth",
          "home-address",
          "personal-contact",
        ],
        platformHeldCategories: [
          "human:<email> in concept files",
          "the Person concept",
          "the per-connected-source LMDB",
          "authored concept bodies",
        ],
        retentionClass: "not recorded",
        rulesInForce: { default_off: false, default_on: true },
        scope: "not recorded",
        specialCategory: {
          category: "special-category",
          condition: "none until a health-sector client",
        },
      }),
    )
    .digest("hex");

describe("an Admin publishes a connected source", () => {
  it("publishes, recording confirmations, counts, DPIA hash, sensitivity and audience", async () => {
    const scenario = await arrange();
    const { connectedSourceId, documentId, jobId } = await boundHandbook(scenario, {
      sensitivity: "Internal",
    });
    await syncEndedAt(scenario.workspaceId, connectedSourceId, jobId, "done", SYNC_FINISHED_AT);
    await passagesOfTheHandbook(scenario.workspaceId, { connectedSourceId, documentId });
    const stoodAt = await passageVersionsOf(db(), scenario.workspaceId, connectedSourceId);

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

      await seed.finding({
        workspaceId: scenario.workspaceId,
        documentId,
        category: "bank-details",
        tier: "always",
        charStart: 30,
        charEnd: 38,
        ruleVersion: "0",
      });
    });
    await reconciledUnder(scenario.workspaceId, documentId, "1:presidio-test");

    const published = await publishedHandbook(scenario, connectedSourceId);

    expect(await publishStateOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual({
      published_at: PUBLISHED_AT,
      state: "published",
    });

    expect(await passageVersionsOf(db(), scenario.workspaceId, connectedSourceId)).toEqual(stoodAt);
    expect(await passageStampsOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual([
      PUBLISHED_AT,
      PUBLISHED_AT,
    ]);

    const rows = await auditEventRowsOf(
      db().pool,
      scenario.workspaceId,
      "sources.binding.published",
    );
    expect(rows.length).toEqual(1);
    const row = rows[0];
    expect(row?.id).toEqual(published.auditEventId);
    expect(row?.actor).toEqual(`human:${scenario.admin.userId}`);
    expect(row?.subject_id).toEqual(connectedSourceId);
    expect(row?.detail).toEqual({
      [STORED_DETAIL_KEYS.connectedSourceId]: connectedSourceId,
      lawfulBasisRecorded: true,
      privacyInformationUpdated: true,
      dpiaReferenced: true,
      ...NO_FINDINGS,
      findingsPersonName: 2,
      findingsBankDetails: 1,
      dpiaHash: row?.detail["dpiaHash"],
      sensitivity: "Internal",
      audience: "everyone",
    });

    expect(row?.detail["dpiaHash"]).toMatch(SHA256_HEX);
    expect(row?.detail["dpiaHash"]).toEqual(dpiaHashOfTheHandbook(connectedSourceId));
  });

  it("publishes once the latest sync is done, despite earlier failures", async () => {
    const scenario = await arrange();
    const { connectedSourceId, jobId } = await boundHandbook(scenario);
    await syncEndedAt(scenario.workspaceId, connectedSourceId, jobId, "failed", SYNC_FAILED_AT);
    await syncOver(scenario.workspaceId, connectedSourceId, "done", SYNC_FINISHED_AT);

    const published = await publishing(scenario, {
      connectedSourceId,
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

    expect(published.ok).toEqual(true);
    expect(await publishStateOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual({
      published_at: PUBLISHED_AT,
      state: "published",
    });
  });

  it.each([
    ["queued", SYNC_FINISHED_AT],
    ["claimed", SYNC_FINISHED_AT],
    ["failed", SYNC_FINISHED_AT],
    ["poisoned", SYNC_FINISHED_AT],
  ])("refuses as not-indexed while the latest sync is %s", async (status, at) => {
    const scenario = await arrange();
    const { connectedSourceId, documentId, jobId } = await boundHandbook(scenario);
    await syncEndedAt(scenario.workspaceId, connectedSourceId, jobId, status, at);
    await passageUnder(
      db(),
      scenario.workspaceId,
      { connectedSourceId, documentId },
      {
        content: HOLIDAY,
        ordinal: 0,
        charStart: 0,
        charEnd: 53,
      },
    );

    const published = await publishing(scenario, {
      connectedSourceId,
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

    expect(published).toEqual({ ok: false, error: "not-indexed" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual({
      published_at: null,
      state: "received",
    });
    expect(await passageStampsOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual([
      null,
    ]);
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.published"),
    ).toEqual([]);
  });

  it("refuses as not-indexed when no sync was ever queued", async () => {
    const scenario = await arrange();
    const { connectedSourceId, jobId } = await boundHandbook(scenario);
    await db().pool.query("DELETE FROM job WHERE workspace_id = $1 AND id = $2", [
      scenario.workspaceId,
      jobId,
    ]);

    const published = await publishing(scenario, {
      connectedSourceId,
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

    expect(published).toEqual({ ok: false, error: "not-indexed" });
  });

  it("refuses a second publish, keeping the first instant", async () => {
    const scenario = await arrange();
    const { connectedSourceId, jobId } = await boundHandbook(scenario);
    await syncEndedAt(scenario.workspaceId, connectedSourceId, jobId, "done", SYNC_FINISHED_AT);

    const first = await publishing(scenario, {
      connectedSourceId,
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });
    expect(first.ok).toEqual(true);

    const again = await publishing(scenario, {
      connectedSourceId,
      publishedAt: new Date("2026-09-12T10:00:00.000Z"),
      confirmations: CONFIRMED,
    });

    expect(again).toEqual({ ok: false, error: "already-published" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual({
      published_at: PUBLISHED_AT,
      state: "published",
    });
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.published"),
    ).toHaveLength(1);
  });

  it.each([
    ["lawful basis is recorded", { lawfulBasisRecorded: false }],
    ["privacy information is updated", { privacyInformationUpdated: false }],
    ["the DPIA is referenced", { dpiaReferenced: false }],
  ])("refuses a publish unless %s, writing nothing", async (_case, override) => {
    const scenario = await arrange();
    const { connectedSourceId, jobId } = await boundHandbook(scenario);
    await syncEndedAt(scenario.workspaceId, connectedSourceId, jobId, "done", SYNC_FINISHED_AT);

    const published = await publishing(scenario, {
      connectedSourceId,
      publishedAt: PUBLISHED_AT,
      confirmations: { ...CONFIRMED, ...override },
    });

    expect(published).toEqual({ ok: false, error: "confirmation-missing" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual({
      published_at: null,
      state: "received",
    });
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.published"),
    ).toEqual([]);
  });

  it("refuses an Editor the publish", async () => {
    const scenario = await arrange();
    const { connectedSourceId, jobId } = await boundHandbook(scenario);
    await syncEndedAt(scenario.workspaceId, connectedSourceId, jobId, "done", SYNC_FINISHED_AT);

    const published = await readingAs(db().runtimePool, scenario.editor, (editor, tx) =>
      publishConnectedSource(
        editor,
        tx,
        publishedAsked({ connectedSourceId, publishedAt: PUBLISHED_AT, confirmations: CONFIRMED }),
      ),
    );

    expect(published).toEqual({ ok: false, error: "role-forbids" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual({
      published_at: null,
      state: "received",
    });
  });

  it("refuses to publish a source the workspace does not hold", async () => {
    const scenario = await arrange();

    const published = await publishing(scenario, {
      connectedSourceId: "01J6NNNNNNNNNNNNNNNNNNNNN3",
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

    expect(published).toEqual({ ok: false, error: "no-such-binding" });
  });

  it("names a connected source id the platform does not mint", () => {
    expect(
      parse(publishConnectedSourceInput, { connectedSourceId: "  ", confirmations: CONFIRMED }),
    ).toEqual({
      ok: false,
      error: { word: "malformed", fields: { connectedSourceId: "bad-format" } },
    });
  });
});

const financeHandbook = async (scenario: Scenario, inTheGroup: readonly UserPrincipal[]) => {
  const finance = await groupNamed(db(), scenario, "Finance", inTheGroup);
  const bound = await boundHandbook(scenario, {
    sensitivity: "Internal",
    audience: "groups",
    audienceGroups: [finance],
  });
  await syncEndedAt(
    scenario.workspaceId,
    bound.connectedSourceId,
    bound.jobId,
    "done",
    SYNC_FINISHED_AT,
  );
  return { ...bound, finance };
};

describe("a Viewer inside the audience", () => {
  it("reads the connected source's passages only after the publish", async () => {
    const scenario = await arrange();
    const { connectedSourceId, documentId } = await financeHandbook(scenario, [scenario.viewer]);
    await passagesOfTheHandbook(scenario.workspaceId, { connectedSourceId, documentId });

    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([]);

    await publishedHandbook(scenario, connectedSourceId);

    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([
      "Holiday is twenty-eight days including bank holidays.",
      "Notice is one month either way after probation.",
    ]);
  });

  it("reads nothing published to a group they are not in", async () => {
    const scenario = await arrange();
    const { connectedSourceId, documentId } = await financeHandbook(scenario, []);
    await passageUnder(
      db(),
      scenario.workspaceId,
      { connectedSourceId, documentId },
      { content: HOLIDAY, ordinal: 0, charStart: 0, charEnd: 53 },
    );

    await publishedHandbook(scenario, connectedSourceId);

    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([]);
  });
});

const connectedSourceHolds = async (workspaceId: string, connectedSourceId: string) => ({
  passages: await passageStampsOf(db().pool, workspaceId, connectedSourceId),
  runs: await runsOver(db().pool, workspaceId, connectedSourceId),
});

const AS_IT_WAS_INDEXED = {
  passages: [null, null],
  runs: [{ kind: "index", reason: "connected", status: "done" }],
};

describe("an Admin reprocesses a connected source", () => {
  it("empties the source and queues one sync carrying the reason", async () => {
    const scenario = await arrange();
    const { connectedSourceId, documentId } = await indexedHandbook(scenario);

    const reprocessed = await asAdmin(scenario, (admin, tx) =>
      reprocessConnectedSource(
        admin,
        tx,
        inputOf(reprocessConnectedSourceInput, {
          workspaceId: scenario.workspaceId,
          connectedSourceId,
          reason: "rule-change",
        }),
      ),
    );
    if (!reprocessed.ok) throw new Error(`the reprocess was refused: ${String(reprocessed.error)}`);

    expect(reprocessed.value.passages).toEqual(2);
    expect(await passageStampsOf(db().pool, scenario.workspaceId, connectedSourceId)).toEqual([]);
    expect(await passagesReadableBy(scenario.admin, documentId)).toEqual([]);

    expect(await runsOver(db().pool, scenario.workspaceId, connectedSourceId)).toEqual([
      { kind: "index", reason: "rule-change", status: "queued" },
      { kind: "index", reason: "connected", status: "done" },
    ]);
    expect(await jobRowOf(db().pool, scenario.workspaceId, reprocessed.value.jobId)).toEqual({
      kind: "index",
      reason: "rule-change",
      status: "queued",
      subject_id: connectedSourceId,
    });
  });

  it("rejects, keeping the passages, when the queue refuses its sync", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await indexedHandbook(scenario);

    await expect(
      whileWritesAreRefused(db().pool, "job", () =>
        asAdmin(scenario, (admin, tx) =>
          reprocessConnectedSource(
            admin,
            tx,
            inputOf(reprocessConnectedSourceInput, {
              workspaceId: scenario.workspaceId,
              connectedSourceId,
              reason: "rule-change",
            }),
          ),
        ),
      ),
    ).rejects.toThrow(/refused a write to job/);

    expect(await connectedSourceHolds(scenario.workspaceId, connectedSourceId)).toEqual(
      AS_IT_WAS_INDEXED,
    );
  });

  it("keeps passages and queues nothing when its action later fails", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await indexedHandbook(scenario);

    await expect(
      asAdmin(scenario, async (admin, tx) => {
        const reprocessed = await reprocessConnectedSource(
          admin,
          tx,
          inputOf(reprocessConnectedSourceInput, {
            workspaceId: scenario.workspaceId,
            connectedSourceId,
            reason: "wiped",
          }),
        );
        expect(reprocessed.ok).toBe(true);
        await attempt(() =>
          connectedSourceIdTakenAgain(tx, scenario.workspaceId, {
            connectedSourceId,
            name: "The staff handbook",
            sensitivity: "Restricted",
          }),
        );
      }),
    ).rejects.toThrow(/did not commit/);

    expect(await connectedSourceHolds(scenario.workspaceId, connectedSourceId)).toEqual(
      AS_IT_WAS_INDEXED,
    );
  });

  it("rejects a reason no sync carries, keeping the passages", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await indexedHandbook(scenario);

    await expect(
      asAdmin(scenario, (admin, tx) =>
        reprocessConnectedSource(admin, tx, {
          ...inputOf(reprocessConnectedSourceInput, {
            workspaceId: scenario.workspaceId,
            connectedSourceId,
            reason: "rule-change",
          }),
          // @ts-expect-error a reason no sync carries, to reach the sync's own refusal
          reason: "spring-clean",
        }),
      ),
    ).rejects.toThrow(/the sync was refused \(malformed\)/);

    expect(await connectedSourceHolds(scenario.workspaceId, connectedSourceId)).toEqual(
      AS_IT_WAS_INDEXED,
    );
  });

  it("refuses Viewers, Editors, foreign sources and bad input, keeping passages", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await indexedHandbook(scenario);

    const byOthers = await Promise.all(
      [scenario.viewer, scenario.editor].map((person) =>
        readingAs(db().runtimePool, person, (reader, tx) =>
          reprocessConnectedSource(
            reader,
            tx,
            inputOf(reprocessConnectedSourceInput, {
              workspaceId: scenario.workspaceId,
              connectedSourceId,
              reason: "rule-change",
            }),
          ),
        ),
      ),
    );

    const elsewhere = await asAdmin(scenario, (admin, tx) =>
      reprocessConnectedSource(
        admin,
        tx,
        inputOf(reprocessConnectedSourceInput, {
          workspaceId: scenario.workspaceId,
          connectedSourceId: "01J6NNNNNNNNNNNNNNNNNNNNN3",
          reason: "rule-change",
        }),
      ),
    );

    expect({
      byOthers,
      elsewhere,
      shapes: [
        parse(reprocessConnectedSourceInput, {
          workspaceId: scenario.workspaceId,
          connectedSourceId: "  ",
          reason: "rule-change",
        }),
        parse(reprocessConnectedSourceInput, {
          workspaceId: scenario.workspaceId,
          connectedSourceId,
          reason: "spring-clean",
        }),
      ],
      held: await connectedSourceHolds(scenario.workspaceId, connectedSourceId),
    }).toEqual({
      byOthers: [
        { ok: false, error: "role-forbids" },
        { ok: false, error: "role-forbids" },
      ],
      elsewhere: { ok: false, error: "no-such-binding" },
      shapes: [
        { ok: false, error: { word: "malformed", fields: { connectedSourceId: "bad-format" } } },
        { ok: false, error: { word: "malformed", fields: { reason: "not-in-set" } } },
      ],
      held: AS_IT_WAS_INDEXED,
    });
  });

  it("refuses an Admin naming another workspace, reaching no connected source", async () => {
    const scenario = await arrange();
    const other = await arrange();
    const ours = await indexedHandbook(scenario);
    const theirs = await indexedHandbook(other);

    const [named, underTheirName] = await Promise.all(
      [theirs.connectedSourceId, ours.connectedSourceId].map((connectedSourceId) =>
        asAdmin(scenario, (admin, tx) =>
          reprocessConnectedSource(
            admin,
            tx,
            inputOf(reprocessConnectedSourceInput, {
              workspaceId: other.workspaceId,
              connectedSourceId,
              reason: "rule-change",
            }),
          ),
        ),
      ),
    );

    expect({
      named,
      underTheirName,
      theirs: await connectedSourceHolds(other.workspaceId, theirs.connectedSourceId),
      ours: await connectedSourceHolds(scenario.workspaceId, ours.connectedSourceId),
    }).toEqual({
      named: { ok: false, error: "no-such-binding" },
      underTheirName: { ok: false, error: "no-such-binding" },
      theirs: AS_IT_WAS_INDEXED,
      ours: AS_IT_WAS_INDEXED,
    });
  });
});

/** A source a wipe emptied, its `wiped` sync queued behind the sync that first indexed it. */
const WIPED_AND_QUEUED = {
  passages: [],
  runs: [
    { kind: "index", reason: "wiped", status: "queued" },
    { kind: "index", reason: "connected", status: "done" },
  ],
};

describe("the operator's reindex of a workspace's connected sources", () => {
  it("wipes every source and queues its sync, deleting its passages", async () => {
    const scenario = await arrange();
    const { connectedSourceId, documentId } = await indexedHandbook(scenario);

    const reindexed = await reindexEveryConnectedSource(REINDEX, scenario.postgres, {
      workspaceId: scenario.workspaceId,
    });
    if (!reindexed.ok) throw new Error(`the reindex was refused: ${String(reindexed.error)}`);

    expect(reindexed.value.map((source) => [source.connectedSourceId, source.passages])).toEqual([
      [connectedSourceId, 2],
    ]);
    expect(await passagesReadableBy(scenario.admin, documentId)).toEqual([]);
    expect(await connectedSourceHolds(scenario.workspaceId, connectedSourceId)).toEqual(
      WIPED_AND_QUEUED,
    );
  });

  it("refuses a workspace id of the wrong shape", async () => {
    const scenario = await arrange();

    expect(
      await reindexEveryConnectedSource(REINDEX, scenario.postgres, {
        workspaceId: "ws_synthetic",
      }),
    ).toEqual({ ok: false, error: "malformed" });
  });
});

const reprocessingAs = (
  scenario: Scenario,
  platform: PlatformPrincipal,
  asked: z.input<typeof reprocessConnectedSourceInput>,
) =>
  withScope(platform, scenario.postgres, asked.workspaceId, (tx) =>
    reprocessConnectedSource(platform, tx, inputOf(reprocessConnectedSourceInput, asked)),
  );

describe("the erasure reprocesses a connected source as the platform", () => {
  it("empties the source and queues its sync for the wipe", async () => {
    const scenario = await arrange();
    const { connectedSourceId, documentId } = await indexedHandbook(scenario);

    const wiped = await reprocessingAs(scenario, ERASURE, {
      workspaceId: scenario.workspaceId,
      connectedSourceId,
      reason: "wiped",
    });
    if (!wiped.ok) throw new Error(`the erasure's reprocess was refused: ${String(wiped.error)}`);

    expect(wiped.value.passages).toEqual(2);
    expect(await passagesReadableBy(scenario.admin, documentId)).toEqual([]);
    expect(await connectedSourceHolds(scenario.workspaceId, connectedSourceId)).toEqual(
      WIPED_AND_QUEUED,
    );
  });

  it("refuses a platform purpose it does not admit, keeping passages", async () => {
    const scenario = await arrange();
    const { connectedSourceId } = await indexedHandbook(scenario);

    const refused = await reprocessingAs(scenario, UPLOAD_SWEEP, {
      workspaceId: scenario.workspaceId,
      connectedSourceId,
      reason: "wiped",
    });

    expect({
      refused,
      held: await connectedSourceHolds(scenario.workspaceId, connectedSourceId),
    }).toEqual({
      refused: { ok: false, error: "role-forbids" },
      held: AS_IT_WAS_INDEXED,
    });
  });

  it("refuses an erasure naming the wrong workspace, touching neither", async () => {
    const scenario = await arrange();
    const other = await arrange();
    const { connectedSourceId } = await indexedHandbook(scenario);

    const refused = await reprocessingAs(scenario, ERASURE, {
      workspaceId: other.workspaceId,
      connectedSourceId,
      reason: "wiped",
    });

    expect({
      refused,
      held: await connectedSourceHolds(scenario.workspaceId, connectedSourceId),
      queuedThere: await runsOver(db().pool, other.workspaceId, connectedSourceId),
    }).toEqual({
      refused: { ok: false, error: "no-such-binding" },
      held: AS_IT_WAS_INDEXED,
      queuedThere: [],
    });
  });
});
