import {
  AUDIENCE_EVERYONE,
  BINDING_PUBLISHED_STATE,
  boundarySchemas,
  CONNECTOR_UPLOAD,
  INDEX_KIND,
  JOB_DONE_STATUS,
  SENSITIVITY_DEFAULT,
} from "@better-answers/schema";

import { visibilityFrom } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import {
  attempt,
  err,
  ok,
  requireAdmin,
  ulid,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { holdsEveryGroup } from "../members/index.ts";
import { enqueueJobIn, type IndexReason } from "../runs/index.ts";
import { putObject, type ObjectDoor } from "../store/objects/index.ts";
import { withMembership, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { adminOnBinding, bindingNamed } from "./admin-binding.ts";
import { dpiaInputFor, REDACTION_CATEGORIES } from "./dpia.ts";

/**
 * The **bind**: an Admin's own file becomes a source binding, a catalogued document, a ledger
 * row and the run that will index it (ADR 0013; the S1 spec, *The sources slice's acts*).
 *
 * It sits beside the slice's face rather than in it because it is the one act here that takes
 * **doors and not a transaction**. The bytes go to the object store *before* any row exists —
 * blob before row — and a transaction held open across an upload would be a transaction
 * waiting on a network stream. So this act opens its own, after the put.
 *
 * What that trade costs is named rather than hidden: a crash between the put and the rows
 * leaves an object no row points at. The key is derived from the document's own id, so the
 * orphan is findable by the sweep that collects it (S4), and nothing here compensates for it —
 * a delete on the way out of a failed act is one more thing to fail.
 */

/** Where a document's two landed copies live, under the workspace's own prefix. */
const originalKeyOf = (documentId: string): string =>
  `documents/${documentId.toLowerCase()}/original`;

/**
 * What the platform will take an upload of: Markdown, plain text, Word's `.docx` and PDF —
 * the four the converter can read (the S1 spec, *The worker as a host*). A media type outside
 * this list is refused at the bind rather than discovered by a run that cannot convert it,
 * because a binding whose one document can never be converted is a source that will never
 * answer anything and an Admin should hear so while they still have the file.
 */
export const UPLOAD_MEDIA_TYPES = [
  "text/markdown",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
] as const;

/**
 * The largest single upload this platform accepts, in bytes: 64 MiB.
 *
 * It has to sit **under the edge's own limit**, which is the 100 MB Cloudflare stops a request
 * body at on the Free and Pro plans (`deploy/platform.compose.yaml`). A cap at the edge's
 * figure would be a cap that never fires — the edge would cut the request off first, and the
 * Admin would see a proxy error where they should see the platform's own word. The gap is room
 * for what a multipart request wraps the file in.
 */
export const UPLOAD_BYTE_CAP = 64 * 1024 * 1024;

/**
 * The bind act. Its subject is the binding; its detail is the two ids the act minted and the
 * class and audience the binding was born at.
 *
 * **Neither the binding's name nor the file's name is on it.** Either can hold a person's
 * name — *Priya's appraisal.docx* is an ordinary thing for somebody to upload — and a ledger
 * row is never rewritten, so a name here would be a personal datum the erasure routine cannot
 * reach. The two ids lead to the rows that do carry those names, which is where a reader with
 * a reason to see them goes.
 */

/**
 * The three things an Admin confirms before a binding's evidence enters the company's
 * knowledge (ADR 0020): that a lawful basis for holding this source is on record, that the
 * privacy information people were given covers it, and that the DPIA names it. They are the
 * act's input and three fields of its ledger row, because the row is what an assessment is
 * read back from and a confirmation nobody wrote down is a confirmation nobody made.
 */
const CONFIRMATIONS = [
  "lawfulBasisRecorded",
  "privacyInformationUpdated",
  "dpiaReferenced",
] as const;

/** Every redaction category's word, as the agreement spells it. */
type RedactionCategoryWord = (typeof REDACTION_CATEGORIES)[number]["category"];

/** `date-of-birth` → `DateOfBirth` — the type's half of `countFieldOf`. */
type Pascal<Word extends string> = Word extends `${infer head}-${infer tail}`
  ? `${Capitalize<head>}${Pascal<tail>}`
  : Capitalize<Word>;

/** `bank-details` → `findingsBankDetails`: one detail field per category. */
type CountField<Word extends string> = `findings${Pascal<Word>}`;

/**
 * How many spans of each category this binding's documents hold, as the ledger carries them.
 *
 * The ledger's detail is flat — a value there is a string, a number or a boolean, and there
 * is no nested object to put a map in — so the totals are one field per category rather than
 * one field holding a map. The **fields are derived from the category list**, so a ninth
 * category is a change to that list alone and never a change there and a second one here that
 * somebody has to remember; a category with nothing found says nought, because *none of these
 * were found* is a statement the assessment needs and an absent field is not one.
 */
type FindingCounts = { readonly [Word in RedactionCategoryWord as CountField<Word>]: number };
type FindingCountShape = { readonly [Word in RedactionCategoryWord as CountField<Word>]: "count" };

const countFieldOf = (category: string): string =>
  `findings${category
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")}`;

// SAFETY: the entries are built by mapping `REDACTION_CATEGORIES` itself, so the keys are
// exactly `countFieldOf` over that list's categories and every value is the one kind;
// `Object.fromEntries` is what loses that on the way out, not the code that feeds it.
const FINDING_COUNT_SHAPE = Object.fromEntries(
  REDACTION_CATEGORIES.map(({ category }) => [countFieldOf(category), "count"]),
) as FindingCountShape;

/** The same derivation over what a read of `finding` counted, nought where it found none. */
const countsOf = (found: ReadonlyMap<string, number>): FindingCounts =>
  // SAFETY: as above — one entry per category, and the value of each is a whole number.
  Object.fromEntries(
    REDACTION_CATEGORIES.map(({ category }) => [countFieldOf(category), found.get(category) ?? 0]),
  ) as FindingCounts;

const BINDING_ACTS = declareActs("sources", {
  bound: act("sources.binding.bound", {
    bindingId: "id",
    documentId: "id",
    sensitivity: "sensitivity",
    audience: "audience",
  }),
  /**
   * The publish. Its subject is the binding; its detail is the three confirmations, the
   * totals by category and the hash of the DPIA input this publication is covered by — and
   * no name, no filename and no span's text, because none of those has a place on a row that
   * is never rewritten.
   */
  published: act("sources.binding.published", {
    bindingId: "id",
    lawfulBasisRecorded: "flag",
    privacyInformationUpdated: "flag",
    dpiaReferenced: "flag",
    ...FINDING_COUNT_SHAPE,
    dpiaHash: "contentHash",
  }),
});

export type BindUploadInput = {
  /** What the Sources screen will list this binding by — the Admin's own words. */
  readonly name: string;
  /**
   * What the source system calls this item, which for an upload is the file's name. It is both
   * the catalogue's source-system id — the key a second run reconciles against — and the
   * document's title, because an upload's title is what the person called the file.
   */
  readonly fileName: string;
  /** What the bytes are, as the caller declares them, before any of them are read. */
  readonly mediaType: string;
  /** How big the file is, as the caller declares it, before any of it is read. */
  readonly byteSize: number;
  readonly body: ReadableStream<Uint8Array>;
  /**
   * The class and audience the binding is born at. Left out, it is born fail-closed —
   * Restricted, and readable by everyone the class admits, which for Restricted is the
   * workspace's Admins (ADR 0013). Named, they are held to the glossary's words and to groups
   * this workspace actually holds; a binding cannot be born *wider* than the safe default,
   * because Restricted is already the narrowest class there is.
   */
  readonly sensitivity?: string;
  readonly audience?: string;
  readonly audienceGroups?: readonly string[] | null | undefined;
};

/**
 * Why a bind was refused, each in one word a caller can act on. `media-type-refused` and
 * `too-large` are the two decided against what the caller *declared* about the file, which is
 * what makes them answerable before a byte is read.
 */
export type BindUploadRefusal =
  | RoleRefusal
  | PrincipalRefusal
  | "malformed"
  | "no-such-group"
  | "media-type-refused"
  | "too-large"
  | Error;

export type UploadBound = {
  readonly bindingId: string;
  readonly documentId: string;
  /** The `index` run this bind queued, so a caller can wait for the binding it just made. */
  readonly jobId: string;
  readonly auditEventId: string;
  /** Where the original's bytes went, under this workspace's prefix. */
  readonly originalKey: string;
};

const INSERT_BINDING = `INSERT INTO source_binding
    (workspace_id, id, name, connector, sensitivity, audience, audience_groups)
  VALUES ($1, $2, $3, $4, $5, $6, $7)`;

const INSERT_DOCUMENT = `INSERT INTO source_document
    (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

/**
 * One transaction for a Principal this act already holds, with the door's two layers of
 * refusal read as one: a store failure and the membership door's own word.
 */
const inTransaction = async <T>(
  principal: UserPrincipal,
  door: PostgresDoor,
  work: (principal: UserPrincipal, tx: Tx) => Promise<T>,
): Promise<Result<T, PrincipalRefusal | Error>> => {
  const opened = await attempt(() => withMembership(principal, door, work));
  if (!opened.ok) return err(opened.error);
  if (!opened.value.ok) return err(opened.value.error);
  return ok(opened.value.value);
};

/**
 * Bind one uploaded file to this workspace: put the bytes, then land the binding, its one
 * document, its ledger row and its `index` run in a single transaction.
 *
 * **Every refusal a caller can be told about is decided before the put**, so a refused bind
 * leaves nothing anywhere: the role, the shape of the name and the file name, the class and
 * audience, the groups an audience names, the media type and the declared size. The last two
 * are decided against what the caller *declared* rather than against the bytes, which is what
 * lets a 2 GB file be refused without being uploaded first — the request's own headers say
 * enough, and a file that lies about itself is a run's problem and not a bind's.
 *
 * The binding is born at the column defaults the schema states — the *keep* retention class,
 * because an upload leaves no source to mirror; the connector's own destination set; the safe
 * rule set; and the state *landed*, meaning the bytes are in the object store and no run has
 * claimed them. The only state word this act writes is that one; *indexing* and *indexed* are
 * the job's business and are rendered from it, and *published* is the publish act's.
 *
 * Inside the transaction the order is rows, then ledger, then job. The audit door is called
 * **bare** (ADR 0014 rule 4): its rejection is what aborts this transaction, and a `Result`
 * handed back could be one this act forgot to read. The job is last because it is the
 * statement the worker races for, and a refusal from it is thrown rather than answered —
 * the kind, the subject and the reason are this act's own, so a refusal there is this act and
 * the queue disagreeing about a descriptor, and the rows have to go back with it.
 */
export const bindUpload = async (
  principal: UserPrincipal,
  doors: { readonly postgres: PostgresDoor; readonly objects: ObjectDoor },
  input: BindUploadInput,
): Promise<Result<UploadBound, BindUploadRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const { workspaceId } = admin.value;

  // Both minted before anything is written, because the original's key is derived from the
  // document's id: the bytes have to be addressable before they are put (ADR 0035).
  const bindingId = ulid();
  const documentId = ulid();
  const originalKey = originalKeyOf(documentId);
  const auditEventId = ulid();

  const visibility = visibilityFrom({
    sensitivity: input.sensitivity ?? SENSITIVITY_DEFAULT,
    audience: input.audience ?? AUDIENCE_EVERYONE,
    audienceGroups: input.audienceGroups ?? null,
  });
  if (visibility === undefined) return err("malformed");

  // Both rows through the boundary before the put, as a governed write parses before it
  // commits: bytes put for a row the boundary would refuse are bytes nothing will ever name.
  const binding = boundarySchemas.sourceBinding.insert.safeParse({
    workspaceId,
    id: bindingId,
    name: input.name,
    connector: CONNECTOR_UPLOAD,
    sensitivity: visibility.sensitivity,
    audience: visibility.audience,
    audienceGroups: visibility.audienceGroups,
  });
  const document = boundarySchemas.sourceDocument.insert.safeParse({
    workspaceId,
    id: documentId,
    bindingId,
    sourceSystemId: input.fileName,
    title: input.fileName,
    mediaType: input.mediaType,
    byteSize: input.byteSize,
    originalKey,
  });
  if (!binding.success || !document.success) return err("malformed");

  // The two the caller declared, answered before a byte is read.
  if (!UPLOAD_MEDIA_TYPES.some((allowed) => allowed === document.data.mediaType)) {
    return err("media-type-refused");
  }
  if (document.data.byteSize > UPLOAD_BYTE_CAP) return err("too-large");

  // And the one that needs the database. A transaction of its own, opened only when the
  // audience names groups at all: an audience of *everyone* names none, so the ordinary bind
  // pays nothing for a question it has no reason to ask.
  const named = visibility.audienceGroups ?? [];
  if (named.length > 0) {
    const held = await inTransaction(principal, doors.postgres, (fresh, tx) =>
      holdsEveryGroup(fresh, tx, named),
    );
    if (!held.ok) return err(held.error);
    if (!held.value.ok) return err(held.value.error);
    if (!held.value.value) return err("no-such-group");
  }

  const put = await putObject(admin.value, doors.objects, originalKey, input.body);
  if (!put.ok) {
    // The key is this act's own, derived from an id it minted a moment ago, so a door that
    // refuses it is a broken derivation and never something a caller did.
    throw new Error(`sources: the original's key was refused (${put.error})`);
  }

  return inTransaction(principal, doors.postgres, async (fresh, tx) => {
    await tx.query(INSERT_BINDING, [
      binding.data.workspaceId,
      binding.data.id,
      binding.data.name,
      binding.data.connector,
      binding.data.sensitivity,
      binding.data.audience,
      binding.data.audienceGroups,
    ]);
    await tx.query(INSERT_DOCUMENT, [
      document.data.workspaceId,
      document.data.id,
      document.data.bindingId,
      document.data.sourceSystemId,
      document.data.title,
      document.data.mediaType,
      document.data.byteSize,
      document.data.originalKey,
    ]);
    await record(fresh, tx, {
      id: auditEventId,
      act: BINDING_ACTS.bound,
      subjectId: bindingId,
      detail: {
        bindingId,
        documentId,
        sensitivity: visibility.sensitivity,
        audience: visibility.audience,
      },
    });
    const queued = await enqueueJobIn(fresh, tx, {
      workspaceId,
      kind: INDEX_KIND,
      subjectId: bindingId,
      reason: "bound",
    });
    if (!queued.ok) {
      throw new Error(`sources: the index run was refused (${String(queued.error)})`);
    }
    return { bindingId, documentId, jobId: queued.value.jobId, auditEventId, originalKey };
  });
};

export type PublishBindingInput = {
  readonly bindingId: string;
  /**
   * The instant this publication happened, read by the api's Clock and handed here (ADR
   * 0040). One reading, stamped on the binding and on every chunk of it, so the two cannot
   * disagree by however long the transaction took.
   */
  readonly publishedAt: Date;
  readonly confirmations: {
    readonly lawfulBasisRecorded: boolean;
    readonly privacyInformationUpdated: boolean;
    readonly dpiaReferenced: boolean;
  };
};

/**
 * Why a publish was refused, each in one word a caller can act on.
 *
 * `not-indexed` is the one this act exists to say: the binding's latest `index` run has not
 * finished, so there is nothing anybody could have reviewed. `confirmation-missing` is an
 * Admin who has not made all three statements the act asks for.
 */
export type PublishBindingRefusal =
  | RoleRefusal
  | "malformed"
  | "no-such-binding"
  | "not-indexed"
  | "already-published"
  | "confirmation-missing"
  | Error;

export type BindingPublished = {
  readonly bindingId: string;
  readonly auditEventId: string;
  /** How many chunk copies wore the instant — every chunk of the binding's documents. */
  readonly chunks: number;
  /** The hash of the DPIA input this publication is covered by, as the ledger carries it. */
  readonly dpiaHash: string;
};

/**
 * **The gate: the binding's latest `index` run, by subject.** Not the `state` column — the
 * worker holds `SELECT` alone on `source_binding` (migration 0035), so the run's own row is
 * the only place the tier doing the work can say where it got to. *Done* alone lets a publish
 * through: queued and claimed have not finished, and a run that *failed* or was *poisoned*
 * found nothing for anybody to review, which is what a publish is a statement about (ADR
 * 0013, amended 2026-09-11). The road out of a failed run is a reprocess, never a publish.
 *
 * Latest by when it was enqueued, with the id breaking a tie, because a reprocess queues a
 * second run over the same binding and it is the newest that says where the binding stands.
 */
const LATEST_INDEX_RUN = `SELECT status FROM job
    WHERE workspace_id = $1 AND kind = $2 AND subject_id = $3
    ORDER BY enqueued_at DESC, id DESC
    LIMIT 1`;

/**
 * How many spans of each category this binding's documents hold. Joined through the catalogue
 * rather than read off a column, because a finding belongs to a document and a binding is what
 * the Admin is publishing.
 */
const FINDINGS_BY_CATEGORY = `SELECT f.category, count(*)::int AS found
    FROM finding f
    JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
   WHERE f.workspace_id = $1 AND d.binding_id = $2
   GROUP BY f.category`;

/**
 * **The publish**: an Admin's statement that this binding's evidence has been reviewed and may
 * enter the company's knowledge (ADR 0013, ADR 0020). Until it happens, nothing derived from
 * the binding is readable by anybody — the read predicate's first clause withholds a unit with
 * no published instant from Admins too — and after it, the class and the audience decide.
 *
 * Every refusal is decided before a row is written: the role, the shape of the id, the three
 * confirmations, the binding's existence, whether it is already published, and the run. The
 * first two are `adminOnBinding`'s, the head every Admin act on a binding it is handed the id
 * of opens with, and they are decided in that order there for the reason stated there. The
 * confirmations go next because they need no read — an Admin who has not made all three
 * statements is told so without the database being asked anything.
 *
 * Then, in the caller's one transaction: the binding's own row, **every chunk of it**, the
 * DPIA input read as a document and hashed, the totals by category, and the ledger row last
 * and **bare** (ADR 0014 rule 4). The chunks are reached by their `binding_id`, which every
 * chunk row carries because a chunk is always source-derived — a join through the catalogue
 * would find the same rows and say less about why they are the ones to stamp.
 *
 * **No run is queued.** The chunks exist from the bind's run and none of their content
 * changes; what changes is who may read them, and that is the app's to write.
 *
 * The state word moves *landed → published* and stops. *Indexing* and *indexed* are never
 * stored: they are the run's status, rendered between these two by a read.
 */
export const publishBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: PublishBindingInput,
): Promise<Result<BindingPublished, PublishBindingRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, bindingId, workspaceId } = acting.value;

  if (!CONFIRMATIONS.every((named) => input.confirmations[named] === true)) {
    return err("confirmation-missing");
  }

  // `FOR UPDATE`, so two publishes of one binding queue rather than both reading it
  // unpublished and both writing a ledger row for the one publication.
  const binding = await bindingNamed<{ published_at: Date | null }>(tx, acting.value, {
    columns: "published_at",
    lock: "for-update",
  });
  if (!binding.ok) return err(binding.error);
  if (binding.value.published_at !== null) return err("already-published");

  const run = await attempt(() =>
    tx.query<{ status: string }>(LATEST_INDEX_RUN, [workspaceId, INDEX_KIND, bindingId]),
  );
  if (!run.ok) return err(run.error);
  // A binding with no run at all is a binding nothing has been over, which is the same answer.
  if (run.value.rows[0]?.status !== JOB_DONE_STATUS) return err("not-indexed");

  const dpia = await dpiaInputFor(admin, tx, { bindingId: bindingId });
  if (!dpia.ok) return err(dpia.error);
  const counted = await attempt(() =>
    tx.query<{ category: string; found: number }>(FINDINGS_BY_CATEGORY, [workspaceId, bindingId]),
  );
  if (!counted.ok) return err(counted.error);
  const found = new Map(counted.value.rows.map((row) => [row.category, row.found]));

  const auditEventId = ulid();
  const published = await attempt(() =>
    tx.query(
      "UPDATE source_binding SET published_at = $3, state = $4 WHERE workspace_id = $1 AND id = $2",
      [workspaceId, bindingId, input.publishedAt, BINDING_PUBLISHED_STATE],
    ),
  );
  if (!published.ok) return err(published.error);
  const stamped = await attempt(() =>
    tx.query(
      `UPDATE "index".chunk SET published_at = $3 WHERE workspace_id = $1 AND binding_id = $2`,
      [workspaceId, bindingId, input.publishedAt],
    ),
  );
  if (!stamped.ok) return err(stamped.error);

  // Bare, after the rows: the door's rejection aborts the transaction they landed in.
  await record(admin, tx, {
    id: auditEventId,
    act: BINDING_ACTS.published,
    subjectId: bindingId,
    detail: {
      bindingId: bindingId,
      lawfulBasisRecorded: input.confirmations.lawfulBasisRecorded,
      privacyInformationUpdated: input.confirmations.privacyInformationUpdated,
      dpiaReferenced: input.confirmations.dpiaReferenced,
      ...countsOf(found),
      dpiaHash: dpia.value.hash,
    },
  });
  return ok({
    bindingId: bindingId,
    auditEventId,
    chunks: stamped.value.rowCount ?? 0,
    dpiaHash: dpia.value.hash,
  });
};

export type ReprocessBindingInput = {
  readonly bindingId: string;
  /**
   * Why this binding is being indexed again, in the queue's own words for an index run —
   * the caller's to say, because the caller is the act this one rides in: the erasure
   * routine's *wiped*, an edit to the rules in force's *rule-change*, a finding restored
   * into a document's *restored*.
   */
  readonly reason: IndexReason;
};

/**
 * Why a reprocess was refused. There is no word here for *nothing to do*: a binding whose
 * chunks are already gone is reprocessed all the same, because what the act promises is the
 * run that will land them again and not the rows it found.
 */
export type ReprocessBindingRefusal = RoleRefusal | "malformed" | "no-such-binding" | Error;

export type BindingReprocessed = {
  readonly bindingId: string;
  /** The `index` run that will land the binding's chunks again. */
  readonly jobId: string;
  /** How many chunk rows went — what that run has to put back. */
  readonly chunks: number;
};

/**
 * **The reprocess**: a binding's derived rows taken away and the run that will land them again
 * put on the queue, both **in the caller's transaction** (ADR 0036; the S1 spec, *The sources
 * slice's acts*). It is half an act rather than a whole one — the wipe's first half for S0's
 * erasure routine, and an edit to a binding's rules in force — so it writes no ledger row of
 * its own: what happened is the caller's act, and this is a step inside it. Riding in the
 * caller's transaction is the whole point: an erasure that rolls back leaves the binding's
 * passages exactly where it found them, and one that commits leaves none of them behind.
 *
 * **The run is queued before the rows go.** What ADR 0036 pairs is the deletion and the run,
 * not the order of two statements in one transaction — they commit together either way. The
 * order is for the one path where they do not: the queue is where a reason no index run carries
 * is answered, and a refusal handed back with the chunks already gone would be a caller's
 * transaction it has to remember to abort. Read the other way round: no path here takes a
 * binding's passages away without the work that replaces them already being on the queue.
 *
 * **The LMDB directory is not this act's.** The engine's store for this binding sits on the
 * worker's own volume, and the worker removes it at the head of the `index` run this enqueues
 * (ADR 0036, amended 2026-09-10). Two tiers, two stores, one order.
 *
 * The binding's row is taken `FOR UPDATE`, so a reprocess and a narrowing of the same binding
 * queue rather than one deleting the rows the other is rewriting. Before any of it, the role
 * and the id's shape: `adminOnBinding`, the head the publish above opens with too.
 */
export const reprocessBinding = async (
  principal: UserPrincipal,
  tx: Tx,
  input: ReprocessBindingInput,
): Promise<Result<BindingReprocessed, ReprocessBindingRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, bindingId, workspaceId } = acting.value;

  // No column: what this act needs off the row is that it is there and that it is held until
  // the transaction ends.
  const standing = await bindingNamed(tx, acting.value, { columns: "1", lock: "for-update" });
  if (!standing.ok) return err(standing.error);

  const queued = await enqueueJobIn(admin, tx, {
    workspaceId,
    kind: INDEX_KIND,
    subjectId: bindingId,
    reason: input.reason,
  });
  if (!queued.ok) return err(queued.error);
  const wiped = await attempt(() =>
    tx.query(`DELETE FROM "index".chunk WHERE workspace_id = $1 AND binding_id = $2`, [
      workspaceId,
      bindingId,
    ]),
  );
  if (!wiped.ok) return err(wiped.error);
  return ok({
    bindingId: bindingId,
    jobId: queued.value.jobId,
    chunks: wiped.value.rowCount ?? 0,
  });
};
