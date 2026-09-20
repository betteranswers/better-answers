import {
  INDEX_KIND,
  REDACTION_ALWAYS_TIER,
  SENSITIVITIES,
  SENSITIVITY_DEFAULT,
  type FINDING_REVIEW_STATES,
} from "@better-answers/schema";

import { narrower, type Sensitivity } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import { openingACascadeOverHeldGroups } from "../concepts/index.ts";
import {
  attempt,
  err,
  ok,
  ulid,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { enqueueJobIn } from "../runs/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { adminOnBinding, bindingNamed } from "./admin-binding.ts";
import { cascadeOverEvidence } from "./cascade.ts";
import { REDACTION_CATEGORIES } from "./dpia.ts";
import { restoreFinding } from "./findings.ts";

/**
 * The **review** of what the redaction seam found in one binding (ADR 0020; the S1 spec,
 * *The sources slice's acts*): the read an Admin opens it with, and the two bulk acts taken
 * over what that read lists.
 *
 * The read is `findingsOf` — a binding's findings grouped by **category × rule**, with how
 * many of each and the document each group sits in. It carries no value and no offset,
 * because a finding is a location and never a quotation, and a review screen that listed the
 * span would put the personal data back on a page the seam took it off.
 *
 * The two acts are the review's verbs, and both are bulk (`CONTEXT.md`; ADR 0014 rule 4 —
 * N rows sharing one batch id, never one row hiding N):
 *
 * - **keep in text**, an Admin saying of named spans that they are the company's own business
 *   facts — its sort code on its own supplier form — which restores each through S0's act and
 *   queues the `index` run that will let them back into the text;
 * - **narrow these documents**, an Admin taking whole documents down to a narrower class
 *   rather than span by span, which rewrites their chunk copies, runs the visibility cascade
 *   outward from the concepts citing them and queues the `index` run with reason *narrowed*.
 *
 * Both are Admin-only and refuse before a row is written; each writes its ledger rows inside
 * the caller's transaction, bare, so a rejected event aborts the act that wrote it.
 *
 * **A keep is a review, and it leaves its mark on the finding** (the S0 spec, the `finding`
 * family: the app updates the review columns through the slice's acts). It moves the spans it
 * was given to *kept in text*, with the acting Admin, the instant and the batch's reason — the
 * column a widening is held against while special-category findings are unreviewed (ADR 0013,
 * ADR 0020; the block is S4's).
 */

/**
 * What a group of the review read is keyed by, and what a caller may do with it: the
 * document, the category and the rule that raised it — never the span and never its text.
 *
 * The class is the document's **effective** one: its own where it carries one, and its
 * binding's otherwise, which is how the derivation folds them. It is on the line because the
 * one thing an Admin needs to know before reaching for *narrow these documents* is whether
 * this document has already been taken down — a document the seam's special-category verdict
 * narrowed reads as Restricted here, and needs no act at all.
 */
export type FindingGroup = {
  readonly documentId: string;
  readonly title: string;
  readonly sensitivity: string;
  readonly category: string;
  readonly ruleId: string;
  readonly tier: string;
  /** Whether the category is special category data, as the `redaction` agreement declares it. */
  readonly specialCategory: boolean;
  /** How many spans of this category and rule that document holds. */
  readonly found: number;
};

export type FindingsOfRefusal = RoleRefusal | "malformed" | "no-such-binding" | Error;

/**
 * Which categories the agreement calls special category, as one set rather than a scan per
 * row. Nothing imports the agreement (ADR 0031); `REDACTION_CATEGORIES` is the slice's own
 * reading of it, and this is that reading indexed.
 */
const SPECIAL_CATEGORIES = new Set<string>(
  REDACTION_CATEGORIES.filter((entry) => entry.specialCategory).map((entry) => entry.category),
);

/** One of the three classes, or nothing — a column's word read as the vocabulary's. */
const classOf = (word: string): Sensitivity | undefined =>
  SENSITIVITIES.find((known) => known === word);

/**
 * **The class a document is actually read at**: the narrower of the binding's and the class
 * the document carries of its own (ADR 0013, amended 2026-09-11; ADR 0023). A document with
 * no class of its own is read at its binding's.
 *
 * It is the narrower and not the document's-or-else-the-binding's, because the two move
 * independently: narrowing a binding rewrites the binding's row and the chunk copies and
 * leaves `source_document.sensitivity` alone, so a document that carried Internal before its
 * binding went to Restricted still carries Internal while nobody below Admin can see it. Read
 * as the document's own, it would look a class wider than it is — on the review screen, and to
 * the widening check the narrowing act makes before it writes.
 *
 * `undefined` is a word outside the vocabulary, which both columns' CHECKs make impossible: a
 * broken database, not something a caller could put right by asking differently.
 */
const effectiveClass = (own: string | null, binding: string): Sensitivity | undefined => {
  const inherited = classOf(binding);
  if (inherited === undefined || own === null) return inherited;
  const held = classOf(own);
  return held === undefined ? undefined : narrower(held, inherited);
};

/** What a class outside the vocabulary answers, written once for the read and the act alike. */
const BROKEN_CLASS = new Error("a source document's class is not one the visibility words hold");

/**
 * The review read, in one statement: the counts grouped by document, category and rule, with
 * the document's title and **both** class words beside them.
 *
 * Both, and not one `COALESCE`: the derivation folds the *narrower* of the binding's class and
 * the document's (ADR 0013, amended 2026-09-11), and a document carrying Internal of its own
 * under a binding since taken to Restricted is Restricted to a reader. Coalescing would read
 * that document as Internal — wider than anybody can actually see it — so the two words come
 * back and the fold happens once, in the access module, where the ranking lives.
 *
 * The ordering is the screen's — category, then rule, then the document — so two calls over
 * unchanged rows answer the same list and a caller never sorts what the store can.
 */
const FINDING_GROUPS = `SELECT d.id AS "documentId", d.title,
            d.sensitivity AS "documentSensitivity", b.sensitivity AS "bindingSensitivity",
            f.category, f.rule_id AS "ruleId", f.tier, count(*)::int AS found
       FROM finding f
       JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
       JOIN source_binding b ON b.workspace_id = d.workspace_id AND b.id = d.binding_id
      WHERE f.workspace_id = $1 AND d.binding_id = $2
      GROUP BY d.id, d.title, d.sensitivity, b.sensitivity, f.category, f.rule_id, f.tier
      ORDER BY f.category, f.rule_id, d.title, d.id`;

type GroupRow = Omit<FindingGroup, "specialCategory" | "sensitivity"> & {
  readonly documentSensitivity: string | null;
  readonly bindingSensitivity: string;
};

/**
 * Every finding in one binding as a reviewer reads them: by category × rule, with counts and
 * the document each group sits in. Admin only, and a read, so it writes no ledger row: the one
 * view the constitution counts as an act is an Admin opening a document's withheld original
 * bytes (ADR 0020), and this is a count of what the seam found, not a sight of it.
 *
 * A binding nobody has run yet answers an empty list rather than a refusal: nothing found is
 * a whole answer, and the screen says so.
 */
export const findingsOf = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly bindingId: string },
): Promise<Result<readonly FindingGroup[], FindingsOfRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { workspaceId, bindingId } = acting.value;

  // A read, so no lock: there is nothing here for a second act to queue behind.
  const standing = await bindingNamed(acting.value, tx, { columns: "1", lock: "none" });
  if (!standing.ok) return err(standing.error);

  const grouped = await attempt(() => tx.query<GroupRow>(FINDING_GROUPS, [workspaceId, bindingId]));
  if (!grouped.ok) return err(grouped.error);

  const groups: FindingGroup[] = [];
  for (const { documentSensitivity, bindingSensitivity, ...row } of grouped.value.rows) {
    const sensitivity = effectiveClass(documentSensitivity, bindingSensitivity);
    if (sensitivity === undefined) return err(BROKEN_CLASS);
    groups.push({ ...row, sensitivity, specialCategory: SPECIAL_CATEGORIES.has(row.category) });
  }
  return ok(groups);
};

export type KeepInTextInput = {
  readonly bindingId: string;
  /** The spans this act is taken over — the ids the review read's groups were opened from. */
  readonly findingIds: readonly string[];
  /** Why these spans are business facts — one sentence an Admin typed for the batch. */
  readonly reason: string;
};

/**
 * Why a *keep in text* was refused. `no-such-finding` covers a span this binding does not
 * hold as well as one nothing holds: the act is a binding's review, and a finding of another
 * binding is not in it, whatever the caller meant. `not-the-always-set` is S0's own refusal,
 * handed back unchanged — the two default tiers are switched at the binding rather than span
 * by span, so a restore of one would reach past the binding's rules in force.
 */
export type KeepInTextRefusal =
  | RoleRefusal
  | "malformed"
  | "no-such-binding"
  | "no-such-finding"
  | "not-the-always-set"
  | Error;

export type KeptInText = {
  readonly bindingId: string;
  /** The spans restored, in the order the caller named them. */
  readonly findingIds: readonly string[];
  /** The id the N ledger rows share; `undefined` when the act kept one span (ADR 0014 rule 4). */
  readonly batchId: string | undefined;
  /** The `index` run that will let the spans back into the text. */
  readonly jobId: string;
};

/**
 * The spans of this binding among those named, with the tier each sits at — the act's two
 * preconditions in one statement, because both are about the batch rather than about a span:
 * a keep is one transaction, and a batch holding a span it may not restore lands none of it.
 */
const FINDINGS_UNDER = `SELECT f.id, f.tier
       FROM finding f
       JOIN source_document d ON d.workspace_id = f.workspace_id AND d.id = f.document_id
      WHERE f.workspace_id = $1 AND d.binding_id = $2 AND f.id = ANY($3::text[])
        FOR UPDATE OF f`;

/** The state a keep leaves a finding at, in the finding table's own closed words. */
const KEPT_IN_TEXT = "kept-in-text" satisfies (typeof FINDING_REVIEW_STATES)[number];

/**
 * The review's mark on the spans a keep restored. The Admin, the instant and the reason are
 * copied off the restore columns S0's act wrote a statement ago rather than derived a second
 * time, so the review and the restore it rests on can never name two actors, two instants or
 * two spellings of one reason.
 */
const KEPT_IN_TEXT_REVIEW = `UPDATE finding
        SET review_state = $3, reviewed_by = restored_by,
            reviewed_at = restored_at, review_reason = restore_reason
      WHERE workspace_id = $1 AND id = ANY($2::text[])`;

/**
 * **Keep in text**: an Admin restores named spans of one binding as business facts, and the
 * `index` run that will put them back into the document's text is queued with them.
 *
 * Each span goes through S0's own restore act rather than a second statement over the same
 * columns, so the row the restore writes, the actor derivation and the reason's bound are one
 * implementation; the batch id this act mints is handed to each, so the N ledger rows read as
 * the one act they were. The review's mark follows the restores in one statement over the
 * spans named, and the job is queued last, inside the same transaction: a run queued for
 * restores that did not land would index the document unchanged.
 *
 * **Every refusal is decided before the first span moves.** The batch is one transaction and
 * a caller reads one word off it, so a keep that restored two spans and then answered
 * `not-the-always-set` would leave the caller to work out how much of its own transaction to
 * take back. The membership read answers both of the act's questions at once — which of these
 * spans this binding holds, and what tier each sits at — and the restores run only after both.
 *
 * **A malformed span id reads as `no-such-finding`.** The membership statement runs first and
 * asks one question — which of these ids this binding holds — and an id of the wrong shape is
 * simply not among them. The word a caller acts on is the same either way: that span is not
 * this binding's to keep.
 */
export const keepInText = async (
  principal: UserPrincipal,
  tx: Tx,
  input: KeepInTextInput,
): Promise<Result<KeptInText, KeepInTextRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, workspaceId, bindingId } = acting.value;

  const named = [...new Set(input.findingIds)];
  // An act over no span at all is a caller that meant something else. It is refused rather
  // than answered empty, because an empty keep would still queue a run over the binding.
  if (named.length === 0) return err("malformed");

  const standing = await bindingNamed(acting.value, tx, { columns: "1", lock: "for-update" });
  if (!standing.ok) return err(standing.error);

  const held = await attempt(() =>
    tx.query<{ readonly id: string; readonly tier: string }>(FINDINGS_UNDER, [
      workspaceId,
      bindingId,
      named,
    ]),
  );
  if (!held.ok) return err(held.error);
  if (held.value.rows.length !== named.length) return err("no-such-finding");
  // The batch's own refusal, ahead of the first restore. S0's act asks the same question of
  // the one span it is given; asking it of all of them here is what makes the batch
  // all-or-nothing rather than a restore or two followed by a word the caller has to undo.
  if (held.value.rows.some((row) => row.tier !== REDACTION_ALWAYS_TIER)) {
    return err("not-the-always-set");
  }

  const batchId = named.length > 1 ? ulid() : undefined;
  for (const findingId of named) {
    const restored = await restoreFinding(admin, tx, {
      findingId,
      reason: input.reason,
      batchId,
    });
    if (!restored.ok) return err(restored.error);
  }
  const reviewed = await attempt(() =>
    tx.query(KEPT_IN_TEXT_REVIEW, [workspaceId, named, KEPT_IN_TEXT]),
  );
  if (!reviewed.ok) return err(reviewed.error);

  const queued = await enqueueJobIn(admin, tx, {
    workspaceId,
    kind: INDEX_KIND,
    subjectId: bindingId,
    reason: "restored",
  });
  if (!queued.ok) return err(queued.error);
  return ok({ bindingId, findingIds: named, batchId, jobId: queued.value.jobId });
};

/**
 * The narrowing act over a document. Its subject is the document and its detail the binding
 * it belongs to and the class it now carries, in the glossary's words.
 */
const REVIEW_ACTS = declareActs("sources", {
  narrowed: act("sources.document.narrowed", {
    documentId: "id",
    bindingId: "id",
    sensitivity: "sensitivity",
  }),
});

export type NarrowDocumentsInput = {
  readonly bindingId: string;
  readonly documentIds: readonly string[];
  /**
   * The class the named documents take. **Restricted unless said** — the narrowest of the
   * three, which is what *narrow these documents* means on a review screen. The field exists
   * because the act's promise is that it never widens, and a promise nothing can break is a
   * promise nothing proves: a caller that names a class is held to it against the document's.
   */
  readonly sensitivity?: string | undefined;
};

/**
 * Why a narrowing of documents was refused. `widening-refused` is the one this act exists to
 * say: a document's own class can only ever take visibility away from its binding's (ADR
 * 0013), so a class looser than the one the document effectively carries is a widening, and
 * widening is a gated act of its own.
 */
export type NarrowDocumentsRefusal =
  | RoleRefusal
  | "malformed"
  | "no-such-binding"
  | "no-such-document"
  | "widening-refused"
  | Error;

export type DocumentsNarrowed = {
  readonly bindingId: string;
  /** The documents narrowed, oldest id first — the order the ledger rows were written in. */
  readonly documentIds: readonly string[];
  readonly sensitivity: Sensitivity;
  /** The id the N ledger rows share; `undefined` when the act narrowed one document. */
  readonly batchId: string | undefined;
  /**
   * The `index` run standing for the binding when the act ended: this act's own, with the
   * reason *narrowed*, or the run already queued for it, which answers its own id and keeps
   * the reason it was queued with (the queue's rule: one queued run per binding).
   */
  readonly jobId: string;
  /** The concepts the first level of the cascade rewrote, by IRI. */
  readonly concepts: readonly string[];
  /** The compositions the second level rewrote. */
  readonly compositions: readonly string[];
};

/** The named documents of this binding, with the class each carries of its own. */
const DOCUMENTS_UNDER = `SELECT id, sensitivity FROM source_document
      WHERE workspace_id = $1 AND binding_id = $2 AND id = ANY($3::text[])
      ORDER BY id
        FOR UPDATE`;

type DocumentRow = { readonly id: string; readonly sensitivity: string | null };

/**
 * **Narrow these documents**: an Admin takes named documents of one binding down to a class
 * of their own, and everything derived from them follows, in one transaction.
 *
 * Every refusal is decided before a row is written: the role, the shapes, the binding, the
 * documents this binding actually holds, and — against each document as it stands — whether
 * the move would widen it. Then the document rows, then **their chunk copies** (the derived
 * rows the read predicate is applied to, so a narrowing that left them is one a reader reads
 * straight past), then the ledger rows written **bare**, and then the rest of the cascade:
 * every concept citing one of these documents re-derived, and every composition including one
 * of those concepts after it. The order is outward from the documents, and it is one
 * transaction, so no reader sees a level that has moved beside one that has not.
 *
 * **The `index` run is queued last, with the reason *narrowed*** — the fifth of the five
 * things that put a binding back through the index (the S1 spec, *The queue*). The chunk
 * copies are already right when the act commits, so the run is not what narrows a reader's
 * view; it is the worker's own pass over a binding whose documents moved, ending in the
 * re-copy that settles a race with a run already in flight.
 *
 * **The workspace's cascade lock is taken at the head**, as a binding's narrowing takes it:
 * two cascades in one workspace that met through a shared concept would each hold its own
 * rows and want the other's, and Postgres would end the deadlock by killing an Admin's act.
 *
 * The chunk copies take the new class outright rather than the fold of it and the binding's.
 * They are the same value, and the widening check above is what makes them so: the new class
 * is no wider than the document's effective one, and the effective class is the fold of the
 * document's and its binding's, so it is no wider than the binding's either.
 */
export const narrowDocuments = async (
  principal: UserPrincipal,
  tx: Tx,
  input: NarrowDocumentsInput,
): Promise<Result<DocumentsNarrowed, NarrowDocumentsRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, workspaceId, bindingId } = acting.value;

  const next = classOf(input.sensitivity ?? SENSITIVITY_DEFAULT);
  if (next === undefined) return err("malformed");
  const named = [...new Set(input.documentIds)];
  if (named.length === 0) return err("malformed");

  // The lock first, and only then the rows: a cascade that took its rows before the lock
  // would be the deadlock the lock exists to close. The act names no group, so the question
  // the head also answers — whether this workspace holds them — is asked of an empty list.
  const opened = await openingACascadeOverHeldGroups(admin, tx, []);
  if (!opened.ok) return err(opened.error);

  const binding = await bindingNamed<{ readonly sensitivity: string }>(acting.value, tx, {
    columns: "sensitivity",
    lock: "for-update",
  });
  if (!binding.ok) return err(binding.error);

  const documents = await attempt(() =>
    tx.query<DocumentRow>(DOCUMENTS_UNDER, [workspaceId, bindingId, named]),
  );
  if (!documents.ok) return err(documents.error);
  const rows = documents.value.rows;
  if (rows.length !== named.length) return err("no-such-document");

  // A class no narrower than the one this document is effectively read at would let a reader
  // in that it currently keeps out. Every document is answered before any row moves, so a
  // batch with one widening in it lands nothing at all.
  for (const row of rows) {
    const effective = effectiveClass(row.sensitivity, binding.value.sensitivity);
    if (effective === undefined) return err(BROKEN_CLASS);
    if (narrower(next, effective) !== next) return err("widening-refused");
  }

  const narrowed = await attempt(() =>
    tx.query(
      `UPDATE source_document SET sensitivity = $4
        WHERE workspace_id = $1 AND binding_id = $2 AND id = ANY($3::text[])`,
      [workspaceId, bindingId, named, next],
    ),
  );
  if (!narrowed.ok) return err(narrowed.error);
  const copies = await attempt(() =>
    tx.query(
      `UPDATE "index".chunk SET sensitivity = $3
        WHERE workspace_id = $1 AND source_document_id = ANY($2::text[])`,
      [workspaceId, named, next],
    ),
  );
  if (!copies.ok) return err(copies.error);

  const documentIds = rows.map((row) => row.id);
  const batchId = documentIds.length > 1 ? ulid() : undefined;
  for (const documentId of documentIds) {
    // Bare, after the rows: the door's rejection aborts the transaction they landed in.
    await record(admin, tx, {
      id: ulid(),
      act: REVIEW_ACTS.narrowed,
      subjectId: documentId,
      detail: { documentId, bindingId, sensitivity: next },
      batchId,
    });
  }

  const cascaded = await attempt(() => cascadeOverEvidence(admin, tx, { bindingId, documentIds }));
  if (!cascaded.ok) return err(cascaded.error);

  // Last, as a keep queues its own: a run queued for a narrowing that did not land would put
  // the binding back through the index for nothing. One run whatever the count, because the
  // run's subject is the binding; a run already queued for it answers its own id.
  const queued = await enqueueJobIn(admin, tx, {
    workspaceId,
    kind: INDEX_KIND,
    subjectId: bindingId,
    reason: "narrowed",
  });
  if (!queued.ok) return err(queued.error);
  return ok({
    bindingId,
    documentIds,
    sensitivity: next,
    batchId,
    jobId: queued.value.jobId,
    ...cascaded.value,
  });
};
