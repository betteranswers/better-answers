import { bindingIdTakenAgain } from "@better-answers/schema/testing/probes";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readableClause, readableParameters } from "../src/access/index.ts";
import { attempt, parse, type UserPrincipal } from "../src/kernel/index.ts";
import {
  bindUpload,
  bindUploadFields,
  dpiaInputFor,
  dpiaReadInput,
  publishBinding,
  publishBindingInput,
  reprocessBinding,
  reprocessBindingInput,
  UPLOAD_BYTE_CAP,
} from "../src/sources/index.ts";
import { getObject, listObjects } from "../src/store/objects/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import { contractFixture, mediaTypeOutside } from "./contract-fixture.ts";
import { chunkUnder, ledgerRowsOf, groupNamed, seededBy } from "./sourced-concept.ts";
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

const HANDBOOK = "The handbook says what the company decided.";
const HANDBOOK_BYTES = 43;

type BindShape = Partial<z.input<typeof bindUploadFields>>;

const handbookAsked = (shape: BindShape = {}) => ({
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
) => {
  const stored = await listObjects(by, store().door, "");
  if (!stored.ok) throw new Error(`the object door refused the listing: ${stored.error}`);
  return { bodyRead: upload.state.read, stored: stored.value };
};

describe("an Admin binds an upload", () => {
  it("the bind lands the binding, the document, the ledger row and the index job together, and the object holds the bytes under the workspace's prefix", async () => {
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
    expect(originalKey).toEqual(`documents/${documentId.toLowerCase()}/original`);

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

  it("the bind lands no row at all when the queue refuses its job, leaving only the object the sweep collects", async () => {
    const scenario = await arrange();
    const { input } = handbookOffered();

    // The job is the transaction's last statement, so refusing it fails the act with three
    // rows written: only that tells one transaction from four statements.
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

  it("refuses an Editor the bind, and puts no bytes for them", async () => {
    const scenario = await arrange();
    const { upload, input } = handbookOffered();

    const bound = await bindUpload(scenario.editor, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "role-forbids" });
    expect(await leftBehindBy(scenario.editor, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it.each([
    ["a binding nobody named", { name: "   " }, { name: "too-small" }],
    ["a file the source system calls nothing", { fileName: "  " }, { fileName: "too-small" }],
    [
      "a class the glossary does not have",
      { sensitivity: "Secret" },
      { sensitivity: "not-in-set" },
    ],
    [
      "an audience the glossary does not have",
      { audience: "the board" },
      { audience: "not-in-set" },
    ],
    [
      "groups named under the audience that takes none",
      { audienceGroups: ["01J6NNNNNNNNNNNNNNNNNNNNN2"] },
      { audience: "refused" },
    ],
    ["a size that is not a whole number of bytes", { byteSize: 12.5 }, { byteSize: "wrong-type" }],
    ["a media type of nothing at all", { mediaType: "   " }, { mediaType: "too-small" }],
  ])("names the field of %s, so the bind is handed no such shape", (_case, override, fields) => {
    expect(parse(bindUploadFields, handbookAsked(override))).toEqual({
      ok: false,
      error: { word: "malformed", fields },
    });
  });

  it("refuses an audience naming a group this workspace does not hold", async () => {
    const scenario = await arrange();
    const { upload, input } = handbookOffered({
      audience: "groups",
      audienceGroups: ["01J6NNNNNNNNNNNNNNNNNNNNN1"],
    });

    const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);

    expect(bound).toEqual({ ok: false, error: "no-such-group" });
    expect(await leftBehindBy(scenario.admin, upload)).toEqual({ bodyRead: false, stored: [] });
  });

  it("binds for a group this workspace does hold, and the binding wears that audience", async () => {
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
    ["a spreadsheet", "application/vnd.ms-excel"],
    ["an image", "image/png"],

    ...typesOutsideTheAgreement.map((outside) => [
      `${outside.media_type}, which the agreement both tiers read places outside the list`,
      outside.media_type,
    ]),
  ])(
    "refuses %s, a media type outside the allow-list, before a byte is read",
    async (_case, mediaType) => {
      const scenario = await arrange();
      const { upload, input } = handbookOffered({ mediaType });

      const bound = await bindUpload(scenario.admin, doorsOf(scenario), input);

      expect(bound).toEqual({ ok: false, error: "media-type-refused" });
      expect(await leftBehindBy(scenario.admin, upload)).toEqual({ bodyRead: false, stored: [] });
    },
  );

  it("refuses a file whose declared size is over the cap, before a byte is read", async () => {
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

  it("caps one upload under the edge's own limit, with room for what the edge wraps it in", () => {
    expect(UPLOAD_BYTE_CAP).toEqual(67108864);
    expect(UPLOAD_BYTE_CAP).toBeLessThan(104857600);
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
    `SELECT published_at FROM "index".chunk
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
        `SELECT c.content FROM "index".chunk c
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

describe("an Admin publishes a binding", () => {
  it("publishes the binding and every one of its chunk copies from the one instant, and its ledger row carries the confirmations, the totals by category and the DPIA hash", async () => {
    const scenario = await arrange();
    const { bindingId, documentId, jobId } = await boundHandbook(scenario);
    await runEndedAt(scenario.workspaceId, bindingId, jobId, "done", RUN_FINISHED_AT);
    await chunksOfTheHandbook(scenario.workspaceId, { bindingId, documentId });

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
    });

    expect(row?.detail["dpiaHash"]).toMatch(SHA256_HEX);
    const input = await asAdmin(scenario, (admin, tx) =>
      dpiaInputFor(admin, tx, inputOf(dpiaReadInput, { bindingId })),
    );
    if (!input.ok) throw new Error(`the DPIA input was refused: ${String(input.error)}`);
    expect(row?.detail["dpiaHash"]).toEqual(input.value.hash);
  });

  it("publishes when the latest run is done even though an earlier run over the same binding failed", async () => {
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
    },
  );

  it("refuses the publish as not-indexed when no run has ever been queued over the binding", async () => {
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

  it("refuses a second publish of a binding that is already published, and leaves the first instant standing", async () => {
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
    ["the lawful basis is not recorded", { lawfulBasisRecorded: false }],
    ["the privacy information has not been updated", { privacyInformationUpdated: false }],
    ["the DPIA is not referenced", { dpiaReferenced: false }],
  ])("refuses the publish when %s, and writes nothing", async (_case, override) => {
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

  it("refuses the publish of a binding this workspace does not hold", async () => {
    const scenario = await arrange();

    const published = await publishing(scenario, {
      bindingId: "01J6NNNNNNNNNNNNNNNNNNNNN3",
      publishedAt: PUBLISHED_AT,
      confirmations: CONFIRMED,
    });

    expect(published).toEqual({ ok: false, error: "no-such-binding" });
  });

  it("names the binding id when it is not one the platform mints", () => {
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
  it("reads nothing of the binding before the publish, and its passages on the next read after it", async () => {
    const scenario = await arrange();
    const { bindingId, documentId, finance } = await financeHandbook(scenario, [scenario.viewer]);

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

    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([]);

    await publishedHandbook(scenario, bindingId);

    expect(await passagesReadableBy(scenario.viewer, documentId)).toEqual([
      "Holiday is twenty-eight days including bank holidays.",
      "Notice is one month either way after probation.",
    ]);
  });

  it("reads nothing of a published binding whose audience names a group they are not in", async () => {
    const scenario = await arrange();
    const { bindingId, documentId, finance } = await financeHandbook(scenario, []);
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
  it("the reprocess takes away every chunk row of the binding and queues one index run carrying the reason it was given", async () => {
    const scenario = await arrange();
    const { bindingId, documentId } = await indexedHandbook(scenario);

    const reprocessed = await asAdmin(scenario, (admin, tx) =>
      reprocessBinding(
        admin,
        tx,
        inputOf(reprocessBindingInput, { bindingId, reason: "rule-change" }),
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

  it("the reprocess takes no chunk row away, and rejects rather than answering a word, when the queue will not hold its run", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    await expect(
      whileWritesAreRefused(db().pool, "job", () =>
        asAdmin(scenario, (admin, tx) =>
          reprocessBinding(
            admin,
            tx,
            inputOf(reprocessBindingInput, { bindingId, reason: "rule-change" }),
          ),
        ),
      ),
    ).rejects.toThrow(/refused a write to job/);

    expect(await bindingHolds(scenario.workspaceId, bindingId)).toEqual(AS_IT_WAS_INDEXED);
  });

  it("the reprocess leaves the chunk rows and queues nothing when the act it rode in fails after it", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    await expect(
      asAdmin(scenario, async (admin, tx) => {
        const reprocessed = await reprocessBinding(
          admin,
          tx,
          inputOf(reprocessBindingInput, { bindingId, reason: "wiped" }),
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

  it("rejects a reason no index run carries, which only a caller past the type can ask for, and takes no chunk row away", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    const asked = { bindingId, reason: "spring-clean" };

    await expect(
      asAdmin(scenario, (admin, tx) =>
        reprocessBinding(admin, tx, asked as Parameters<typeof reprocessBinding>[2]),
      ),
    ).rejects.toThrow(/the index run was refused \(malformed\)/);

    expect(await bindingHolds(scenario.workspaceId, bindingId)).toEqual(AS_IT_WAS_INDEXED);
  });

  it("refuses the reprocess of a Viewer and an Editor and of a binding this workspace does not hold, names the field of an id the platform does not mint and of a reason no index run carries, and leaves the chunk rows standing", async () => {
    const scenario = await arrange();
    const { bindingId } = await indexedHandbook(scenario);

    const byOthers = await Promise.all(
      [scenario.viewer, scenario.editor].map((person) =>
        readingAs(db().runtimePool, person, (reader, tx) =>
          reprocessBinding(
            reader,
            tx,
            inputOf(reprocessBindingInput, { bindingId, reason: "rule-change" }),
          ),
        ),
      ),
    );

    const elsewhere = await asAdmin(scenario, (admin, tx) =>
      reprocessBinding(
        admin,
        tx,
        inputOf(reprocessBindingInput, {
          bindingId: "01J6NNNNNNNNNNNNNNNNNNNNN3",
          reason: "rule-change",
        }),
      ),
    );

    expect({
      byOthers,
      elsewhere,
      shapes: [
        parse(reprocessBindingInput, { bindingId: "  ", reason: "rule-change" }),
        parse(reprocessBindingInput, { bindingId, reason: "spring-clean" }),
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
});
