import {
  AUDIENCE_EVERYONE,
  boundarySchemas,
  CONNECTOR_UPLOAD,
  INDEX_KIND,
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
import { enqueueJobIn } from "../runs/index.ts";
import { putObject, type ObjectDoor } from "../store/objects/index.ts";
import { withMembership, type PostgresDoor, type Tx } from "../store/postgres/index.ts";

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
const BINDING_ACTS = declareActs("sources", {
  bound: act("sources.binding.bound", {
    bindingId: "id",
    documentId: "id",
    sensitivity: "sensitivity",
    audience: "audience",
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
