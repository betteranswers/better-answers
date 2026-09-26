import { createHash } from "node:crypto";

import { bindingIdTakenAgain } from "@better-answers/schema/testing/probes";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readableClause, readableParameters } from "../src/access/index.ts";
import { ERASURE } from "../src/erasure/index.ts";
import {
  attempt,
  parse,
  ulid,
  type PlatformPrincipal,
  type UserPrincipal,
} from "../src/kernel/index.ts";
import {
  bindUpload,
  bindUploadFields,
  ORPHANED_UPLOAD_GRACE_HOURS,
  publishBinding,
  publishBindingInput,
  reprocessBinding,
  reprocessBindingInput,
  sweepOrphanedUploads,
  UPLOAD_BYTE_CAP,
  UPLOAD_SWEEP,
} from "../src/sources/index.ts";
import { getObject, listObjects, putObject } from "../src/store/objects/index.ts";
import { withScope, type Tx } from "../src/store/postgres/index.ts";
import { contractFixture, mediaTypeOutside } from "./contract-fixture.ts";
import {
  chunkUnder,
  chunkVersionsOf,
  ledgerRowsOf,
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

const bindingRowOf = async (pool: pg.Pool, workspaceId: string, bindingId: string) => {
  const read = await pool.query(
    `SELECT name, connector, destination, retention_class, state, rules_in_force,
            published_at, sensitivity, audience, audience_groups
       FROM source_binding WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, bindingId],
  );
  return read.rows[0];
};

const documentRowOf = async (pool: pg.Pool, workspaceId: string, documentId: string) => {
  const read = await pool.query(
    `SELECT binding_id, source_system_id, title, media_type, byte_size,
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
  const read = await pool.query<{ bindings: number; documents: number }>(
    `SELECT (SELECT count(*)::int FROM source_binding WHERE workspace_id = $1) AS bindings,
            (SELECT count(*)::int FROM source_document WHERE workspace_id = $1) AS documents`,
    [workspaceId],
  );
  return read.rows[0];
};

const oneOfEachIn = async (pool: pg.Pool, workspaceId: string) => {
  const read = await pool.query<{
    bindings: number;
    documents: number;
    ledger: number;
    jobs: number;
  }>(
    `SELECT (SELECT count(*)::int FROM source_binding WHERE workspace_id = $1) AS bindings,
            (SELECT count(*)::int FROM source_document WHERE workspace_id = $1) AS documents,
            (SELECT count(*)::int FROM audit_event
               WHERE workspace_id = $1 AND act = 'sources.binding.bound') AS ledger,
            (SELECT count(*)::int FROM job
               WHERE workspace_id = $1 AND kind = 'index') AS jobs`,
    [workspaceId],
  );
  return read.rows[0];
};

const HANDBOOK = "The handbook says what the company decided.";
const HANDBOOK_BYTES = 43;

type BindShape = Partial<z.input<typeof bindUploadFields>>;

const handbookAsked = (shape: BindShape = {}) => ({
  bindingId: ulid(),
  name: "The staff handbook",
  fileName: "handbook.md",
  mediaType: "text/markdown",
  byteSize: HANDBOOK_BYTES,
  ...shape,
});

const handbookOffered = (shape: BindShape = {}) => {
  const upload = uploadOf(HANDBOOK);
  return {
    upload,
    input: { ...inputOf(bindUploadFields, handbookAsked(shape)), body: upload.body },
  };
};

const leftBehindBy = async (
  by: UserPrincipal,
  upload: { readonly state: { readonly read: boolean } },
) => ({ bodyRead: upload.state.read, stored: await storedFor(by) });

describe("an Admin binds an upload", () => {
  it("lands the binding, document, ledger row, job and object together", async () => {
    const scenario = await arrange();
    const { input } = handbookOffered();

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);
    if (!bound.ok) throw new Error(`the bind was refused: ${String(bound.error)}`);
    const { bindingId, documentId, jobId, auditEventId, originalKey } = bound.value;

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
    expect(originalKey).toEqual(`uploads/${bindingId.toLowerCase()}/original`);

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

    expect(await jobRowOf(db().pool, scenario.workspaceId, jobId)).toEqual({
      kind: "index",
      reason: "bound",
      status: "queued",
      subject_id: bindingId,
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
     * The job is the transaction's last statement, so refusing it fails the act with three rows
     * written: only that tells one transaction from four statements.
     */
    const bound = await whileWritesAreRefused(db().pool, "job", () =>
      bindUpload(scenario.admin, doorsOf(scenario), input),
    );

    expect(bound.ok).toEqual(false);
    expect(await countsIn(db().pool, scenario.workspaceId)).toEqual({ bindings: 0, documents: 0 });
    expect(await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.bound")).toEqual(
      [],
    );

    const left = await listObjects(scenario.admin, store().door, "");
    if (!left.ok) throw new Error(`the object door refused the listing: ${left.error}`);
    expect(left.value.length).toEqual(1);
  });

  it("refuses an Editor the bind and stores no bytes", async () => {
    const scenario = await arrange();
    const { upload, input } = handbookOffered();

    const bound = await bindUpload(scenario.editor, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "role-forbids" });
    expect(await leftBehindBy(scenario.editor, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it.each([
    ["a malformed binding id", { bindingId: "ws_handbook" }, { bindingId: "bad-format" }],
    ["a binding nobody named", { name: "   " }, { name: "too-small" }],
    ["a blank file name", { fileName: "  " }, { fileName: "too-small" }],
    ["a class outside the glossary", { sensitivity: "Secret" }, { sensitivity: "not-in-set" }],
    ["an audience outside the glossary", { audience: "the board" }, { audience: "not-in-set" }],
    [
      "groups under an audience taking none",
      { audienceGroups: ["01J6NNNNNNNNNNNNNNNNNNNNN2"] },
      { audience: "refused" },
    ],
    ["a fractional byte size", { byteSize: 12.5 }, { byteSize: "wrong-type" }],
    ["a blank media type", { mediaType: "   " }, { mediaType: "too-small" }],
  ])("names the field of %s", (_case, override, fields) => {
    expect(parse(bindUploadFields, handbookAsked(override))).toEqual({
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

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "no-such-group" });
    expect(await leftBehindBy(scenario.admin, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it("binds for a held group, the binding wearing that audience", async () => {
    const scenario = await arrange();
    const groupId = await groupNamed(db(), scenario, "Finance", [scenario.viewer]);
    const { input } = handbookOffered({ audience: "groups", audienceGroups: [groupId] });

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);
    if (!bound.ok) throw new Error(`the bind was refused: ${String(bound.error)}`);

    const row = await bindingRowOf(db().pool, scenario.workspaceId, bound.value.bindingId);
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

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "media-type-refused" });
    expect(await leftBehindBy(scenario.admin, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it("refuses a declared size over the cap, reading no byte", async () => {
    const scenario = await arrange();
    const { upload, input } = handbookOffered({ byteSize: UPLOAD_BYTE_CAP + 1 });

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "too-large" });
    expect(await leftBehindBy(scenario.admin, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it("takes a file at exactly the cap", async () => {
    const scenario = await arrange();
    const { input } = handbookOffered({ byteSize: UPLOAD_BYTE_CAP });

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound.ok).toEqual(true);
  });

  it("refuses a body past the cap, whatever its declared size", async () => {
    const scenario = await arrange();
    const asked = handbookAsked();
    const input = { ...inputOf(bindUploadFields, asked), body: pastTheCap() };

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "too-large" });
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({ ok: true, value: [] });
    expect(await countsIn(db().pool, scenario.workspaceId)).toEqual({ bindings: 0, documents: 0 });
  });

  it("answers a repeated binding id with the first outcome", async () => {
    const scenario = await arrange();
    const bindingId = ulid();

    const first = await bindUpload(
      scenario.admin,
      doorsOf(scenario),
      handbookOffered({ bindingId }).input,
    );
    if (!first.ok) throw new Error(`the bind was refused: ${String(first.error)}`);
    const repeat = handbookOffered({ bindingId });
    const again = await bindUpload(scenario.admin, doorsOf(scenario), repeat.input);

    expect(again).toEqual(first);
    expect(await leftBehindBy(scenario.admin, repeat.upload)).toEqual({
      bodyRead: false,
      stored: [first.value.originalKey],
    });
    expect(await oneOfEachIn(db().pool, scenario.workspaceId)).toEqual({
      bindings: 1,
      documents: 1,
      ledger: 1,
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

const aFailedBind = async (scenario: Scenario) => {
  const standing = await storedFor(scenario.admin);
  const bound = await whileWritesAreRefused(db().pool, "job", () =>
    bindUpload(scenario.admin, doorsOf(scenario), handbookOffered().input),
  );
  if (bound.ok) throw new Error("the bind landed where the queue was refused");
  const left = (await storedFor(scenario.admin)).filter((key) => !standing.includes(key));
  if (left.length !== 1 || left[0] === undefined) {
    throw new Error(`the refused bind left ${String(left.length)} objects, not one`);
  }
  return left[0];
};

describe("the sweep collects the originals a failed bind left", () => {
  it("leaves every original standing while the grace holds", async () => {
    const scenario = await arrange();
    const named = await boundHandbook(scenario);
    const orphaned = await aFailedBind(scenario);

    const swept = await sweptAt(scenario, new Date());

    expect(swept).toEqual({ ok: true, value: { found: 0, removed: 0 } });
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({
      ok: true,
      value: [named.originalKey, orphaned].sort(),
    });
  });

  it("removes an unnamed original after the grace, keeping named ones", async () => {
    const scenario = await arrange();
    const named = await boundHandbook(scenario);
    await aFailedBind(scenario);

    const past = new Date(Date.now() + (ORPHANED_UPLOAD_GRACE_HOURS + 1) * 60 * 60 * 1000);
    const swept = await sweptAt(scenario, past);

    expect(swept).toEqual({ ok: true, value: { found: 1, removed: 1 } });
    expect(await listObjects(scenario.admin, store().door, "")).toEqual({
      ok: true,
      value: [named.originalKey],
    });
  });

  it("records each removed original's bind, but never its key", async () => {
    const scenario = await arrange();
    const orphaned = await aFailedBind(scenario);

    const past = new Date(Date.now() + A_DAY_MS * 2);
    await sweptAt(scenario, past);

    const bindingId = orphaned.slice("uploads/".length, -"/original".length).toUpperCase();
    const rows = await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.upload.swept");
    expect(rows).toEqual([
      {
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        actor: "process:better-answers-uploads",
        subject_id: bindingId,
        detail: { bindingId },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("uploads/");
  });

  it("leaves a key under the prefix no bind writes", async () => {
    const scenario = await arrange();
    const stray = "uploads/a-note-from-somewhere-else/original";
    await putObject(scenario.admin, store().door, stray, uploadOf("not an original").body);

    const swept = await sweptAt(scenario, new Date(Date.now() + A_DAY_MS * 2));

    expect(swept).toEqual({ ok: true, value: { found: 0, removed: 0 } });
    expect(await storedFor(scenario.admin)).toContain(stray);
  });

  it("counts what a list-only sweep would remove, removing none", async () => {
    const scenario = await arrange();
    await boundHandbook(scenario);
    const orphaned = await aFailedBind(scenario);

    const past = new Date(Date.now() + A_DAY_MS * 2);
    const looked = await sweptAt(scenario, past, true);

    expect(looked).toEqual({ ok: true, value: { found: 1, removed: 0 } });
    expect(await storedFor(scenario.admin)).toContain(orphaned);
  });

  it("refuses a malformed workspace id before removing anything", async () => {
    const scenario = await arrange();
    const orphaned = await aFailedBind(scenario);

    const swept = await sweepOrphanedUploads(
      UPLOAD_SWEEP,
      { postgres: scenario.postgres, objects: store().door },
      { workspaceId: "ws_synthetic", now: new Date(Date.now() + A_DAY_MS * 2) },
    );

    expect(swept).toEqual({ ok: false, error: "malformed" });
    expect(await storedFor(scenario.admin)).toContain(orphaned);
  });
});

const RUN_FAILED_AT = new Date("2026-09-11T08:00:00.000Z");
const RUN_FINISHED_AT = new Date("2026-09-11T09:30:00.000Z");
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

const boundHandbook = async (scenario: Scenario, shape: BindShape = {}) => {
  const bound = await bindUpload(scenario.admin, doorsOf(scenario), handbookOffered(shape).input);
  if (!bound.ok) throw new Error(`the bind was refused: ${String(bound.error)}`);
  return bound.value;
};

const claimColumnsOf = (status: string, at: Date) => {
  if (status === "queued") return {};
  const claimed = { attempts: 1, claimedBy: "worker-1", claimedAt: at, heartbeatAt: at };
  if (status === "claimed") return { ...claimed, leaseExpiresAt: at };
  if (status === "poisoned") return { ...claimed, attempts: 3, finishedAt: at };
  return { ...claimed, finishedAt: at, outcome: { chunks: 2 } };
};

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

const reconciledUnder = async (workspaceId: string, documentId: string, version: string) => {
  await db().pool.query(
    "UPDATE source_document SET redaction_version = $3 WHERE workspace_id = $1 AND id = $2",
    [workspaceId, documentId, version],
  );
};

const publishStateOf = async (pool: pg.Pool, workspaceId: string, bindingId: string) => {
  const read = await pool.query<{ published_at: Date | null; state: string }>(
    "SELECT published_at, state FROM source_binding WHERE workspace_id = $1 AND id = $2",
    [workspaceId, bindingId],
  );
  return read.rows[0];
};

const chunkStampsOf = async (pool: pg.Pool, workspaceId: string, bindingId: string) => {
  const read = await pool.query<{ published_at: Date | null }>(
    `SELECT published_at FROM "index".readable_chunk
      WHERE workspace_id = $1 AND binding_id = $2 ORDER BY ordinal`,
    [workspaceId, bindingId],
  );
  return read.rows.map((row) => row.published_at);
};

const runsOver = async (pool: pg.Pool, workspaceId: string, bindingId: string) => {
  const read = await pool.query<{ kind: string; reason: string | null; status: string }>(
    `SELECT kind, reason, status FROM job
      WHERE workspace_id = $1 AND subject_id = $2 ORDER BY enqueued_at DESC, id DESC`,
    [workspaceId, bindingId],
  );
  return read.rows;
};

const passagesReadableBy = async (person: UserPrincipal, sourceDocumentId: string) =>
  answered(
    await readingAs(db().runtimePool, person, async (reader, tx) => {
      const read = await tx.query<{ content: string }>(
        `SELECT c.content FROM "index".readable_chunk c
        WHERE c.workspace_id = $1 AND c.source_document_id = $2 AND ${readableClause("c", 3)}
        ORDER BY c.ordinal`,
        [reader.workspaceId, sourceDocumentId, ...readableParameters(reader)],
      );
      return read.rows.map((row) => row.content);
    }),
  );

const chunksOfTheHandbook = async (
  workspaceId: string,
  document: { readonly bindingId: string; readonly documentId: string },
) => {
  for (const [ordinal, content, charStart, charEnd] of [
    [0, HOLIDAY, 0, 53],
    [1, NOTICE, 54, 101],
  ] as const) {
    await chunkUnder(db(), workspaceId, document, { content, ordinal, charStart, charEnd });
  }
};

const indexedHandbook = async (scenario: Scenario) => {
  const bound = await boundHandbook(scenario);
  await runEndedAt(scenario.workspaceId, bound.bindingId, bound.jobId, "done", RUN_FINISHED_AT);
  await chunksOfTheHandbook(scenario.workspaceId, bound);
  return bound;
};

type PublishAsked = z.input<typeof publishBindingInput> & { readonly publishedAt: Date };

const publishedAsked = ({ publishedAt, ...asked }: PublishAsked) => ({
  ...inputOf(publishBindingInput, asked),
  publishedAt,
});

const publishing = (scenario: Scenario, asked: PublishAsked) =>
  asAdmin(scenario, (admin, tx) => publishBinding(admin, tx, publishedAsked(asked)));

const publishedHandbook = async (scenario: Scenario, bindingId: string) => {
  const published = await publishing(scenario, {
    bindingId,
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
const dpiaHashOfTheHandbook = (bindingId: string): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        audience: "everyone",
        bindingId,
        class: "Internal",
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
          "the per-binding LMDB",
          "authored concept bodies",
        ],
        retentionClass: "not recorded",
        routes: [],
        rulesInForce: { default_off: false, default_on: true },
        scope: "not recorded",
        specialCategory: {
          category: "special-category",
          condition: "none until a health-sector client",
        },
      }),
    )
    .digest("hex");

describe("an Admin publishes a binding", () => {
  it("publishes, recording confirmations, counts, DPIA hash, class and audience", async () => {
    const scenario = await arrange();
    const { bindingId, documentId, jobId } = await boundHandbook(scenario, {
      sensitivity: "Internal",
    });
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);
    await chunksOfTheHandbook(scenario.workspaceId, { bindingId, documentId });
    const stoodAt = await chunkVersionsOf(db(), scenario.workspaceId, bindingId);

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

    const published = await publishedHandbook(scenario, bindingId);

    expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      published_at: PUBLISHED_AT,
      state: "published",
    });

    expect(await chunkVersionsOf(db(), scenario.workspaceId, bindingId)).toEqual(stoodAt);
    expect(await chunkStampsOf(db().pool, scenario.workspaceId, bindingId)).toEqual([
      PUBLISHED_AT,
      PUBLISHED_AT,
    ]);

    const rows = await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.published");
    expect(rows.length).toEqual(1);
    const row = rows[0];
    expect(row?.id).toEqual(published.auditEventId);
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
      sensitivity: "Internal",
      audience: "everyone",
    });

    expect(row?.detail["dpiaHash"]).toMatch(SHA256_HEX);
    expect(row?.detail["dpiaHash"]).toEqual(dpiaHashOfTheHandbook(bindingId));
  });

  it("publishes once the latest run is done, despite earlier failures", async () => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "failed", RUN_FAILED_AT);
    await runOver(scenario.workspaceId, bindingId, "done", RUN_FINISHED_AT);

    const published = await publishing(scenario, {
      bindingId,
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

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
  ])("refuses as not-indexed while the latest run is %s", async (status, at) => {
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

    const published = await publishing(scenario, {
      bindingId,
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

    expect(published).toEqual({ ok: false, error: "not-indexed" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      published_at: null,
      state: "landed",
    });
    expect(await chunkStampsOf(db().pool, scenario.workspaceId, bindingId)).toEqual([null]);
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.published"),
    ).toEqual([]);
  });

  it("refuses as not-indexed when no run was ever queued", async () => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await db().pool.query("DELETE FROM job WHERE workspace_id = $1 AND id = $2", [
      scenario.workspaceId,
      jobId,
    ]);

    const published = await publishing(scenario, {
      bindingId,
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

    expect(published).toEqual({ ok: false, error: "not-indexed" });
  });

  it("refuses a second publish, keeping the first instant", async () => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);

    const first = await publishing(scenario, {
      bindingId,
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });
    expect(first.ok).toEqual(true);

    const again = await publishing(scenario, {
      bindingId,
      publishedAt: new Date("2026-09-12T10:00:00.000Z"),
      confirmations: CONFIRMED,
    });

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
    ["lawful basis is recorded", { lawfulBasisRecorded: false }],
    ["privacy information is updated", { privacyInformationUpdated: false }],
    ["the DPIA is referenced", { dpiaReferenced: false }],
  ])("refuses a publish unless %s, writing nothing", async (_case, override) => {
    const scenario = await arrange();
    const { bindingId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);

    const published = await publishing(scenario, {
      bindingId,
      publishedAt: PUBLISHED_AT,
      confirmations: { ...CONFIRMED, ...override },
    });

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
      publishBinding(
        editor,
        tx,
        publishedAsked({ bindingId, publishedAt: PUBLISHED_AT, confirmations: CONFIRMED }),
      ),
    );

    expect(published).toEqual({ ok: false, error: "role-forbids" });
    expect(await publishStateOf(db().pool, scenario.workspaceId, bindingId)).toEqual({
      published_at: null,
      state: "landed",
    });
  });

  it("refuses to publish a binding the workspace does not hold", async () => {
    const scenario = await arrange();

    const published = await publishing(scenario, {
      bindingId: "01J6NNNNNNNNNNNNNNNNNNNNN3",
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

    expect(published).toEqual({ ok: false, error: "no-such-binding" });
  });

  it("names a binding id the platform does not mint", () => {
    expect(parse(publishBindingInput, { bindingId: "  ", confirmations: CONFIRMED })).toEqual({
      ok: false,
      error: { word: "malformed", fields: { bindingId: "bad-format" } },
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
  await runEndedAt(scenario.workspaceId, bound.bindingId, bound.jobId, "done", RUN_FINISHED_AT);
  return { ...bound, finance };
};

describe("a Viewer inside the audience", () => {
  it("reads the binding's passages only after the publish", async () => {
    const scenario = await arrange();
    const { bindingId, documentId } = await financeHandbook(scenario, [scenario.viewer]);
    await chunksOfTheHandbook(scenario.workspaceId, { bindingId, documentId });

    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([]);

    await publishedHandbook(scenario, bindingId);

    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([
      "Holiday is twenty-eight days including bank holidays.",
      "Notice is one month either way after probation.",
    ]);
  });

  it("reads nothing published to a group they are not in", async () => {
    const scenario = await arrange();
    const { bindingId, documentId } = await financeHandbook(scenario, []);
    await chunkUnder(
      db(),
      scenario.workspaceId,
      { bindingId, documentId },
      { content: HOLIDAY, ordinal: 0, charStart: 0, charEnd: 53 },
    );

    await publishedHandbook(scenario, bindingId);

    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([]);
  });
});

const bindingHolds = async (workspaceId: string, bindingId: string) => ({
  chunks: await chunkStampsOf(db().pool, workspaceId, bindingId),
  runs: await runsOver(db().pool, workspaceId, bindingId),
});

const AS_IT_WAS_INDEXED = {
  chunks: [null, null],
  runs: [{ kind: "index", reason: "bound", status: "done" }],
};

describe("an Admin reprocesses a binding", () => {
  it("empties the binding and queues one run carrying the reason", async () => {
    const scenario = await arrange();
    const { bindingId, documentId } = await indexedHandbook(scenario);

    const reprocessed = await asAdmin(scenario, (admin, tx) =>
      reprocessBinding(
        admin,
        tx,
        inputOf(reprocessBindingInput, {
          workspaceId: scenario.workspaceId,
          bindingId,
          reason: "rule-change",
        }),
      ),
    );
    if (!reprocessed.ok) throw new Error(`the reprocess was refused: ${String(reprocessed.error)}`);

    expect(reprocessed.value.chunks).toEqual(2);
    expect(await chunkStampsOf(db().pool, scenario.workspaceId, bindingId)).toEqual([]);
    expect(await passagesReadableBy(scenario.admin, documentId)).toEqual([]);

    expect(await runsOver(db().pool, scenario.workspaceId, bindingId)).toEqual([
      { kind: "index", reason: "rule-change", status: "queued" },
      { kind: "index", reason: "bound", status: "done" },
    ]);
    expect(await jobRowOf(db().pool, scenario.workspaceId, reprocessed.value.jobId)).toEqual({
      kind: "index",
      reason: "rule-change",
      status: "queued",
      subject_id: bindingId,
    });
  });

  it("rejects, keeping the chunks, when the queue refuses its run", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    await expect(
      whileWritesAreRefused(db().pool, "job", () =>
        asAdmin(scenario, (admin, tx) =>
          reprocessBinding(
            admin,
            tx,
            inputOf(reprocessBindingInput, {
              workspaceId: scenario.workspaceId,
              bindingId,
              reason: "rule-change",
            }),
          ),
        ),
      ),
    ).rejects.toThrow(/refused a write to job/);

    expect(await bindingHolds(scenario.workspaceId, bindingId)).toEqual(AS_IT_WAS_INDEXED);
  });

  it("keeps chunks and queues nothing when its act later fails", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    await expect(
      asAdmin(scenario, async (admin, tx) => {
        const reprocessed = await reprocessBinding(
          admin,
          tx,
          inputOf(reprocessBindingInput, {
            workspaceId: scenario.workspaceId,
            bindingId,
            reason: "wiped",
          }),
        );
        expect(reprocessed.ok).toBe(true);
        await attempt(() =>
          bindingIdTakenAgain(tx, scenario.workspaceId, {
            bindingId,
            name: "The staff handbook",
            sensitivity: "Restricted",
          }),
        );
      }),
    ).rejects.toThrow(/did not commit/);

    expect(await bindingHolds(scenario.workspaceId, bindingId)).toEqual(AS_IT_WAS_INDEXED);
  });

  it("rejects a reason no index run carries, keeping the chunks", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    await expect(
      asAdmin(scenario, (admin, tx) =>
        reprocessBinding(admin, tx, {
          ...inputOf(reprocessBindingInput, {
            workspaceId: scenario.workspaceId,
            bindingId,
            reason: "rule-change",
          }),
          // @ts-expect-error a reason no index run carries, to reach the run's own refusal
          reason: "spring-clean",
        }),
      ),
    ).rejects.toThrow(/the index run was refused \(malformed\)/);

    expect(await bindingHolds(scenario.workspaceId, bindingId)).toEqual(AS_IT_WAS_INDEXED);
  });

  it("refuses Viewers, Editors, foreign bindings and bad input, keeping chunks", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    const byOthers = await Promise.all(
      [scenario.viewer, scenario.editor].map((person) =>
        readingAs(db().runtimePool, person, (reader, tx) =>
          reprocessBinding(
            reader,
            tx,
            inputOf(reprocessBindingInput, {
              workspaceId: scenario.workspaceId,
              bindingId,
              reason: "rule-change",
            }),
          ),
        ),
      ),
    );

    const elsewhere = await asAdmin(scenario, (admin, tx) =>
      reprocessBinding(
        admin,
        tx,
        inputOf(reprocessBindingInput, {
          workspaceId: scenario.workspaceId,
          bindingId: "01J6NNNNNNNNNNNNNNNNNNNNN3",
          reason: "rule-change",
        }),
      ),
    );

    expect({
      byOthers,
      elsewhere,
      shapes: [
        parse(reprocessBindingInput, {
          workspaceId: scenario.workspaceId,
          bindingId: "  ",
          reason: "rule-change",
        }),
        parse(reprocessBindingInput, {
          workspaceId: scenario.workspaceId,
          bindingId,
          reason: "spring-clean",
        }),
      ],
      held: await bindingHolds(scenario.workspaceId, bindingId),
    }).toEqual({
      byOthers: [
        { ok: false, error: "role-forbids" },
        { ok: false, error: "role-forbids" },
      ],
      elsewhere: { ok: false, error: "no-such-binding" },
      shapes: [
        { ok: false, error: { word: "malformed", fields: { bindingId: "bad-format" } } },
        { ok: false, error: { word: "malformed", fields: { reason: "not-in-set" } } },
      ],
      held: AS_IT_WAS_INDEXED,
    });
  });

  it("refuses an Admin naming another workspace, reaching no binding", async () => {
    const scenario = await arrange();
    const other = await arrange();
    const ours = await indexedHandbook(scenario);
    const theirs = await indexedHandbook(other);

    const [named, underTheirName] = await Promise.all(
      [theirs.bindingId, ours.bindingId].map((bindingId) =>
        asAdmin(scenario, (admin, tx) =>
          reprocessBinding(
            admin,
            tx,
            inputOf(reprocessBindingInput, {
              workspaceId: other.workspaceId,
              bindingId,
              reason: "rule-change",
            }),
          ),
        ),
      ),
    );

    expect({
      named,
      underTheirName,
      theirs: await bindingHolds(other.workspaceId, theirs.bindingId),
      ours: await bindingHolds(scenario.workspaceId, ours.bindingId),
    }).toEqual({
      named: { ok: false, error: "no-such-binding" },
      underTheirName: { ok: false, error: "no-such-binding" },
      theirs: AS_IT_WAS_INDEXED,
      ours: AS_IT_WAS_INDEXED,
    });
  });
});

const reprocessingAs = (
  scenario: Scenario,
  platform: PlatformPrincipal,
  asked: z.input<typeof reprocessBindingInput>,
) =>
  withScope(platform, scenario.postgres, asked.workspaceId, (tx) =>
    reprocessBinding(platform, tx, inputOf(reprocessBindingInput, asked)),
  );

describe("the erasure reprocesses a binding as the platform", () => {
  it("empties the binding and queues its run for the wipe", async () => {
    const scenario = await arrange();
    const { bindingId, documentId } = await indexedHandbook(scenario);

    const wiped = await reprocessingAs(scenario, ERASURE, {
      workspaceId: scenario.workspaceId,
      bindingId,
      reason: "wiped",
    });
    if (!wiped.ok) throw new Error(`the erasure's reprocess was refused: ${String(wiped.error)}`);

    expect(wiped.value.chunks).toEqual(2);
    expect(await passagesReadableBy(scenario.admin, documentId)).toEqual([]);
    expect(await bindingHolds(scenario.workspaceId, bindingId)).toEqual({
      chunks: [],
      runs: [
        { kind: "index", reason: "wiped", status: "queued" },
        { kind: "index", reason: "bound", status: "done" },
      ],
    });
  });

  it("refuses the platform any purpose but erasure, keeping the chunks", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    const refused = await reprocessingAs(scenario, UPLOAD_SWEEP, {
      workspaceId: scenario.workspaceId,
      bindingId,
      reason: "wiped",
    });

    expect({ refused, held: await bindingHolds(scenario.workspaceId, bindingId) }).toEqual({
      refused: { ok: false, error: "role-forbids" },
      held: AS_IT_WAS_INDEXED,
    });
  });

  it("refuses an erasure naming the wrong workspace, touching neither", async () => {
    const scenario = await arrange();
    const other = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    const refused = await reprocessingAs(scenario, ERASURE, {
      workspaceId: other.workspaceId,
      bindingId,
      reason: "wiped",
    });

    expect({
      refused,
      held: await bindingHolds(scenario.workspaceId, bindingId),
      queuedThere: await runsOver(db().pool, other.workspaceId, bindingId),
    }).toEqual({
      refused: { ok: false, error: "no-such-binding" },
      held: AS_IT_WAS_INDEXED,
      queuedThere: [],
    });
  });
});
