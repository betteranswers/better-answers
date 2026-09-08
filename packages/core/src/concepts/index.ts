import {
  boundarySchemas,
  conceptIriOf,
  SUGGESTION_EDIT_KIND,
  SUGGESTION_SET_MAX,
} from "@better-answers/schema";
import { z } from "zod";

import { readableClause, readableParameters, widens } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  isActorId,
  ok,
  personOfActor,
  refusalFor,
  requireAdmin,
  ulid,
  type ActorId,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  commit as commitToBundle,
  head,
  withRepositoryLock,
  type CommitAuthor,
  type CommitRefusal,
  type GitDoor,
} from "../store/git/index.ts";
import { withMembership, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { contentHashOf, renderConceptFile, type Frontmatter } from "./file.ts";
import {
  payloadFor,
  returnToProposer,
  suggestionIsWaiting,
  targetOfMergeKey,
  type SuggestionKind,
  type SuggestionPayload,
} from "./inbox.ts";
import {
  foldKind,
  heldByIri,
  heldVisibilityOf,
  indexRowOf,
  landRows,
  WRITE_CONSTRAINTS,
} from "./landing.ts";
import { conceptVisibilityFrom } from "./visibility.ts";

export {
  contentHashOf,
  parseConceptFile,
  renderConceptFile,
  type Frontmatter,
  type FrontmatterSource,
  type FrontmatterValue,
} from "./file.ts";
export { foldKind } from "./landing.ts";
export {
  RECONCILER,
  reconcile,
  reconcileEveryWorkspace,
  reconcilerHits,
  type ReconcileRefusal,
  type Reconciled,
  type ReconcilerHit,
  type ReconcilerPrincipal,
  type ReplayRefusal,
  type WorkspaceReconciled,
} from "./reconciler.ts";
export {
  declineSuggestion,
  submitSuggestionSet,
  suggestionSetSummary,
  type DecideSuggestionInput,
  type DecideSuggestionRefusal,
  type SubmitSuggestionSetInput,
  type SubmitSuggestionSetRefusal,
  type SuggestionDecided,
  type SuggestionKind,
  type SuggestionRequest,
  type SuggestionSetSubmitted,
  type SuggestionStatus,
  type SuggestionSummaryItem,
} from "./inbox.ts";
export {
  evidencePaneOf,
  overrideConceptClass,
  openingACascadeOverHeldGroups,
  recomputeVisibilitySourcedFrom,
  type ConceptClassOverridden,
  type EvidencePane,
  type OverrideConceptClassInput,
  type OverrideConceptClassRefusal,
  type ReadableEvidence,
} from "./visibility.ts";
export {
  GRAPH_MAINTENANCE,
  graphCounts,
  sweepGraph,
  type GraphMaintenancePrincipal,
  type GraphMaintenanceRefusal,
} from "./graph-maintenance.ts";
export type { GraphCounts, SweptGeneration } from "../store/graph/index.ts";

/**
 * Slice: **concepts** — the concept write path. Suggestions, the inbox, minting and
 * identity, the acceptance transaction, verification and trust events, evidence at commit
 * time (ADRs 0011, 0012, 0019).
 *
 * The acceptance transaction writes concepts, audit and the graph delta in one
 * transaction and belongs here, because a transaction that spans slices lives in the
 * slice that owns the **act** — composing store doors and other slices' interfaces, never
 * a free-floating orchestrator layer (ADR 0029).
 *
 * **The governed write** (`writeConcept`) is the act this slice is built around, and its
 * order is the whole design (ADR 0012; T-006 spec, *The governed write*):
 *
 * 1. mint the `audit_event` id — **before** the commit, so the commit can carry it in its
 *    `Audit:` trailer and the reconciler's replay has an idempotency key on every commit
 *    it will ever find;
 * 2. take the per-repository lock, and hold it for the whole act;
 * 3. read what the index already holds for this IRI, through `withMembership` — so every
 *    refusal decidable from the concept's own row is made before a commit exists;
 * 4. commit to the bundle, the hash precondition checked against the ref under that lock;
 * 5. open **the slice's own transaction**, through `withMembership` again, and write the
 *    ledger row, the identity, the index row, the bundle commit, the evidence and the
 *    bundle-and-record graph delta in it — the authority resolved in the same transaction
 *    as the writes it authorises, and the map never behind for an edit (ADR 0023);
 * 6. release the lock when Postgres has committed, not before.
 *
 * The window between 4 and 5 is the reconciler's territory and nobody else's: a failure
 * there leaves a repository head ahead of the last `bundle_commit`, which is exactly the
 * state T-056 replays. Because the lock spans both stores, `bundle_commit` history is
 * always a **prefix** of git history, so the reconciler is a watermark scan and never a
 * hole scan.
 *
 * **The IRI is never caller-settable** (ADR 0002). A concept's IRI has exactly one form —
 * `https://better-answers.com/c/<ulid>`, opaque and on the bare apex (ADR 0002's amendments)
 * — which the boundary holds it to and `conceptIriOf` is the one way to make. So a write
 * that names none is a **creation** and mints its own, and a write that names one is a
 * **re-write** whose IRI has to be a concept this workspace already holds: the read at step
 * 3 is where that is decided, before a commit exists, so a caller can neither choose a
 * concept's key nor mint an identity for a key somebody else chose.
 *
 * **The inbox** — submitting a set, opening one, declining, returning — is `inbox.ts`,
 * because none of it makes a commit. The acceptance is here, because an acceptance *is* a
 * governed write: one act, one commit, one transaction, with the suggestion decided inside
 * the same transaction as the rows. The file's grammar — render, parse, hash — is `file.ts`;
 * what the index holds, the row a write builds and the routine that lands it is
 * `landing.ts`, which the live act and the replay both land through; the reconciler's replay
 * is `reconciler.ts`; the class and audience a concept lands with is `visibility.ts`. This
 * module re-exports all of it, so the slice has one face.
 */

/**
 * The slice's acts on the ledger. Both are governed writes, and they differ by what was
 * acted on: a **commit** is a person's own change and its subject is the concept, by IRI —
 * every record about a concept attaches by IRI (ADR 0014); an **acceptance** is a decision
 * about a suggestion and its subject is the suggestion, so the queue's history is readable
 * off the ledger without joining the bundle. The detail names the commit and the content it
 * hashed either way, so the ledger answers "what did this act put in the bundle" without
 * opening git.
 *
 * The inbox's two decisions that make no commit — declined, returned — are `inbox.ts`'s.
 */
const CONCEPT_ACTS = declareActs("knowledge", {
  committed: act("knowledge.concept.committed", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
    evidenceCount: "count",
  }),
  accepted: act("knowledge.suggestion.accepted", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
    setId: "id",
  }),
});

/** One piece of evidence recorded at commit time (`CONTEXT.md`, *evidence*). */
export type EvidenceInput = {
  readonly sourceDocumentId: string;
  readonly locator: string;
  /** The rendered projection off the document — what a reader is shown, never the key. */
  readonly resource: string;
  readonly contentVersion?: string;
};

/**
 * What a write expects to find before it makes a commit — ADR 0012's precondition, in the
 * two forms its two writers have.
 *
 * A person's edit names the **head** their content was written against (`null` for a
 * bundle's first commit), and a ref that has moved refuses the write loudly rather than
 * silently overwriting somebody else's change.
 *
 * An acceptance names the **base**: the content hash the payload was written against
 * (`null` when it proposed a concept that did not exist). That is the precondition ADR
 * 0012's 2026-08-27 amendment gives a suggestion, and it is not the ref's — a set is
 * decided item by item against concepts that moved independently, so refusing an
 * acceptance because somebody edited an unrelated concept would be refusing the wrong
 * thing. Under this act's own lock the ref cannot move between the read and the commit, so
 * an acceptance takes it as it stands.
 */
export type WritePrecondition = { readonly head: string | null } | { readonly base: string | null };

/**
 * The suggestion an acceptance decides (ADR 0012). Its presence is what turns a governed
 * write into an acceptance: the commit carries the `Suggestion:` trailer, the ledger row is
 * the acceptance act, and the suggestion's decision lands in the same transaction as the
 * rows — so a suggestion is never accepted without its concept, or the other way about.
 */
export type Acceptance = {
  readonly suggestionId: string;
  readonly setId: string;
  readonly kind: SuggestionKind;
  /** The id N rows of one bulk act share (ADR 0014 rule 4); absent when the act touched one. */
  readonly batchId?: string | undefined;
};

export type WriteConceptInput = {
  /**
   * The concept this write re-writes, or **nothing** to create one. Never caller-settable
   * (ADR 0002): a creation mints its own through `conceptIriOf`, and a named one has to be
   * a concept this workspace already holds.
   */
  readonly iri?: string | undefined;
  /** What an acceptance resolves this concept by, so identity survives a rename (ADR 0012). */
  readonly mergeKey: string;
  /** Where the file goes in the bundle, relative to its root. */
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  /** The commit's subject line; the trailers are the act's. */
  readonly message: string;
  /** The person the commit is attributed to — the git author line's name and address. */
  readonly author: CommitAuthor;
  /** What this write was made against, in one of its two forms. */
  readonly expects: WritePrecondition;
  /**
   * The suggestion this write decides, when it is an acceptance rather than an edit.
   *
   * **An acceptance is an Admin's, and its precondition is the `{base}` form.** The two are
   * coupled at runtime rather than in this type: a discriminated union here would be a
   * union every caller and every test constructing a `Partial<>` of this would have to
   * narrow, for a coupling `writeConcept` has to check anyway — the act is reached by more
   * than one road (the reconciler's replay is the next), and a type is not what holds a
   * road the type system never sees.
   */
  readonly acceptance?: Acceptance | undefined;
  /**
   * The concept's confidentiality class. On a **new** concept the most restrictive of the
   * three when unnamed; on a re-write it may only be the class the concept already holds —
   * a class is derived from the evidence a concept cites (ADR 0023), never chosen by an edit.
   */
  readonly sensitivity?: string;
  readonly status?: string;
  readonly evidence?: readonly EvidenceInput[];
};

export type ConceptWritten = {
  readonly iri: string;
  /** The commit this act made — the sha the `bundle_commit` row and the index row both carry. */
  readonly sha: string;
  /** The ledger row minted before the commit, and carried in its `Audit:` trailer. */
  readonly auditEventId: string;
  readonly contentHash: string;
};

/**
 * Why a governed write was refused. `stale-precondition` is the one a person is shown — the
 * content moved under them, whichever form the precondition took (ADR 0012) — and the two
 * `-taken` words are a bundle that already holds this path or this merge key under another
 * IRI. `rename-refused` and `reclassification-refused` are two moves this act never makes,
 * and `widening-refused` the third: a re-write whose new citations would derive a class or
 * an audience wider than the concept holds, which is an Admin's recorded act
 * (`overrideConceptClass`) and never a re-write's. `no-such-concept` is a write naming an IRI
 * this workspace never minted — **or one the read predicate withholds from the writer**,
 * answered in the same word so a re-write is no oracle for what a person may not see — which
 * ADR 0002 refuses because the key is never a caller's to choose. `already-decided` is an
 * acceptance of a suggestion somebody decided first, and `resolution-moved` one whose named
 * target no longer answers to the merge key it was proposed under. The principal refusals
 * are `withMembership`'s, which judges the caller's authority at time-of-act.
 *
 * **Every one of them is read before the commit.** A refusal that came after would leave a
 * commit no row records — which is the reconciler's territory, and the reconciler is for
 * crashes, not for acts the platform meant to refuse.
 */
export type WriteConceptRefusal =
  | RoleRefusal
  | CommitRefusal
  | PrincipalRefusal
  | "malformed"
  | "path-taken"
  | "merge-key-taken"
  | "rename-refused"
  | "reclassification-refused"
  | "widening-refused"
  | "no-such-concept"
  | "already-decided"
  | "resolution-moved";

/**
 * One `sources[]` entry, read whichever way a file writes it — **the boundary's own reader**
 * (`citedSourceOf`), which the boundary's `sources[]` refinement asks the same question of.
 * One definition, so the validator and the hash can never part company: two readers over one
 * shape was exactly the defect that had `evidenceOf` dropping entries the hash still counted.
 */
export { citedSourceOf as citedSource } from "@better-answers/schema";

/** The two roles that may change the bundle: an Editor and an Admin, never a Viewer. */
const mayWrite = (principal: UserPrincipal): boolean => principal.role !== "Viewer";

/**
 * The file's frontmatter as the act writes it: what the caller gave, the `type` and the
 * `title` the act was told where the file names neither, the `status` it names, and the IRI
 * the platform minted — OKF's own keys and ADR 0002's one platform key, nothing else. The
 * row is built from the same facts, so the file says what the row says: the bundle is the
 * truth and the row is derived from it (ADR 0012), and the reconciler's replay of this
 * commit reads all four back off the file rather than off a row that was lost — a creation
 * whose file carried no title would be a commit the replay could not land. A caller's own
 * `type`, `title` and `status` keys stand as written (ADR 0019 keeps every key verbatim).
 *
 * **The content hash is taken over this, the frontmatter the file carries**, never over
 * what the caller gave: `type` and `title` are hashed keys, so a row hashed before they
 * were written in would carry a number the nightly audit's parse of the file could never
 * reproduce, and every such concept would read as mismatched.
 */
const fileFrontmatterOf = (input: WriteConceptInput, iri: string) => {
  const named = { ...input.frontmatter };
  if (typeof named["type"] !== "string") named["type"] = input.kind;
  if (typeof named["title"] !== "string") named["title"] = input.title;
  if (input.status !== undefined) named["status"] = input.status;
  named["iri"] = iri;
  return named;
};

/**
 * One governed write: one act, one commit, one transaction (ADR 0012).
 *
 * The act's own transaction is opened **after** the commit and inside the lock, which is
 * the decision this ticket was gated on: a transaction held open across a git commit would
 * be a transaction waiting on a subprocess, and the transport's transaction is a request's
 * and not an act's. The ledger row is written first inside it, as provisioning's and the
 * access request's are, so the fail-together test provokes its failure *after* the row
 * exists and proves the row rolled back with the act rather than that it was never reached.
 *
 * The audit door is called **bare** (ADR 0014 rule 4): its rejection is what aborts this
 * transaction, and a `Result` it handed back could be one this act did not read.
 *
 * **Two things a re-write never moves: the concept's path and its class.** Both are minted
 * with the concept and both are decided elsewhere afterwards — a rename is a governed *move*
 * that rewrites inbound links in the same commit (ADR 0012), and a class is derived from the
 * evidence a concept cites or set by a recorded Admin override (ADR 0023). Left open, this
 * act would be the shortest path to both a silent reclassification (an Editor widening a
 * Restricted concept to Public) and a silent narrowing (a re-write that names no class and
 * takes the safe default, hiding a concept its readers can see today). So an existing
 * concept's class is **kept** when the write names none, and **refused** when it names a
 * different one; a differing path is refused the same way.
 *
 * **Nor may a re-write widen the class by swapping its evidence.** What lands is the
 * derivation over the new citations, not the word the write names, so the act derives what
 * the new evidence *would* land — the same derivation the landing runs, over the documents
 * about to be cited — and refuses when that is wider on any term than what the concept
 * holds: a narrowing is what evidence does, a widening is an Admin's recorded act (ADR 0023,
 * ADR 0039). And the concept has to be one the writer may see: the read at step 3 applies
 * the predicate's class and audience arms, so a withheld concept is refused as one nobody
 * minted.
 *
 * All of it is decided by the read this act makes **before it commits**, so a refused
 * re-write leaves no commit at all: a rename that refused after committing would leave a
 * file at a path no row names, and a replay that refuses for ever.
 */
export const writeConcept = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: WriteConceptInput,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  if (!mayWrite(principal)) return err("role-forbids");
  // **What makes this an acceptance is checked here, not at the road that reached it.**
  // `acceptSuggestions` is one caller and the reconciler's replay will be another, so the
  // Admin gate and the precondition's form belong to the act: a write handed an
  // `acceptance` by any road decides a suggestion, writes the acceptance's ledger row and
  // carries the `Suggestion:` trailer, and doing that from an Editor's authority — or
  // against the ref's head rather than the payload's base — would be the gate ADR 0012
  // puts in front of the bundle, skipped.
  if (input.acceptance !== undefined) {
    const admin = requireAdmin(principal);
    if (!admin.ok) return err(admin.error);
    if (!("base" in input.expects)) return err("malformed");
  }

  // A write that names no concept is a creation, and mints the one form an IRI has
  // (ADR 0002); one that names a concept is held below to a concept that already exists.
  const iri = input.iri ?? conceptIriOf(ulid());
  const frontmatter = fileFrontmatterOf(input, iri);
  const contentHash = contentHashOf(frontmatter, input.body, input.path);
  const mergeKey = boundarySchemas.conceptIdentity.insert.shape.mergeKey.safeParse(input.mergeKey);
  // Evidence goes through the boundary too, and before the commit: a locator the boundary
  // would refuse is one this act should never have made a commit for (ADR 0028).
  const evidence = boundarySchemas.evidence.insert.array().safeParse(
    (input.evidence ?? []).map((piece) => ({
      workspaceId: principal.workspaceId,
      sourceDocumentId: piece.sourceDocumentId,
      locator: piece.locator,
      resource: piece.resource,
      contentVersion: piece.contentVersion ?? null,
    })),
  );
  if (!mergeKey.success || !evidence.success) return err("malformed");

  // Minted before the commit so the commit carries it (ADR 0012's 2026-09-06 amendment):
  // an id minted after the commit would leave the trailer empty exactly when the row was
  // never written, which is the one case the reconciler exists for.
  const auditEventId = ulid();

  return withRepositoryLock(principal, doors.git, async () => {
    // **The act's first transaction, and every refusal that can be read out of a row.** It
    // runs inside the lock, so nothing it reads can move before the rows land: identity is
    // written only by this act, and a suggestion's decision is held by the same lock. That
    // is what makes each of these refusals cost **no commit** — the difference between a
    // caller being told no and a commit nobody can record.
    const existing = await attempt(() =>
      withMembership(principal, doors.postgres, async (fresh, tx) => {
        const held = await heldByIri(fresh, tx, iri);
        return {
          held,
          // What the new citations would derive for a concept that exists — asked of the
          // same derivation the landing runs, so the widening check and the landing cannot
          // disagree about what the evidence says.
          derived:
            held === undefined
              ? undefined
              : await conceptVisibilityFrom(fresh, tx, {
                  iri,
                  kind: foldKind(input.kind),
                  fallback: heldVisibilityOf(held),
                  citing: evidence.data.map((piece) => piece.sourceDocumentId),
                }),
          // The merge key's resolution, read here rather than beside the act, so an
          // acceptance resolves identity *at acceptance* and inside the lock that holds it.
          resolved: await targetOfMergeKey(fresh, tx, input.mergeKey),
          waiting:
            input.acceptance === undefined ||
            (await suggestionIsWaiting(fresh, tx, input.acceptance.suggestionId)),
        };
      }),
    );
    if (!existing.ok) return err(existing.error);
    if (!existing.value.ok) return err(existing.value.error);
    const { held, derived, resolved, waiting } = existing.value.value;

    // ADR 0002: the key is never caller-settable. A creation minted its own above; a write
    // that named one has to name a concept this workspace already holds, or it would mint
    // an identity for a key its caller chose.
    if (input.iri !== undefined && held === undefined) return err("no-such-concept");
    // A suggestion somebody decided while this act was being prepared. Refused here and not
    // in the transaction that lands the rows, because a commit whose `Suggestion:` trailer
    // named a declined suggestion is an orphan the reconciler's replay would land.
    if (!waiting) return err("already-decided");
    // One concept per merge key: the unique index says so and this says so first, so the
    // refusal is a word a caller can act on rather than a commit the act cannot record.
    // A key that resolves to nothing is free — a creation takes it, and a re-write may
    // move its own concept onto it.
    if (resolved !== undefined && resolved !== iri) return err("merge-key-taken");
    // **And the other half of that sentence, for an acceptance that named its target.** A
    // key resolving to nothing is free for an ordinary write — a re-write may move its own
    // concept onto one — but an acceptance was prepared against a concept the merge key
    // *did* resolve to, and a key that now resolves to nothing means somebody moved that
    // concept onto another key after the summary was rendered. Landing it would silently
    // put the old key back, undoing a move nobody asked to undo. The change is not lost:
    // it goes back to whoever prepared it, like every other moved ground (ADR 0012's
    // 2026-08-27 amendment).
    if (input.acceptance !== undefined && input.iri !== undefined && resolved !== iri) {
      return err("resolution-moved");
    }
    // The acceptance's own precondition: what the payload was written against, against
    // what the concept says now (ADR 0012's 2026-08-27 amendment). Read here, before the
    // commit, so a suggestion written against content that moved costs no commit at all.
    if ("base" in input.expects && (held?.contentHash ?? null) !== input.expects.base) {
      return err("stale-precondition");
    }
    if (held !== undefined && held.path !== input.path) return err("rename-refused");
    if (
      held !== undefined &&
      input.sensitivity !== undefined &&
      input.sensitivity !== held.sensitivity
    ) {
      return err("reclassification-refused");
    }
    // The class the new evidence derives, against the class the concept holds: wider on
    // any term — a looser class, everyone where groups were named, a group the list did not
    // hold — is the un-narrowing only an Admin's recorded override may make. A standing
    // override is what the derivation answers and what the row holds, so it never reads as
    // a widening here.
    if (held !== undefined && derived !== undefined && widens(heldVisibilityOf(held), derived)) {
      return err("widening-refused");
    }

    // Everything the rows will hold, parsed at the boundary before anything is committed: a
    // commit whose rows the boundary would refuse is the head-ahead state provoked on
    // purpose, and there is no reason to make one.
    const parsed = indexRowOf(
      {
        workspaceId: principal.workspaceId,
        iri,
        path: input.path,
        kind: input.kind,
        title: input.title,
        frontmatter,
        body: input.body,
        contentHash,
        status: input.status,
        sensitivity: input.sensitivity,
      },
      held,
    );
    if (!parsed.success) return err("malformed");
    const row = parsed.data;

    const committed = await commitToBundle(principal, doors.git, {
      path: row.path,
      content: renderConceptFile(frontmatter, input.body),
      message: input.message,
      author: input.author,
      trailers: {
        actor: actorIdOf(principal),
        audit: auditEventId,
        // The `Suggestion:` trailer ADR 0012 fixes, on the acceptance's commit and on no
        // other — so the bundle's history says which changes came through the gate.
        suggestion: input.acceptance?.suggestionId,
      },
      // A person's edit names the head it was written against; an acceptance takes the ref
      // as it stands, because its own precondition is the base and this act holds the lock.
      expectedHead: "head" in input.expects ? input.expects.head : await head(principal, doors.git),
    });
    if (!committed.ok) return err(committed.error);

    const landed = await attempt(() =>
      // The door re-reads the membership in the transaction that writes, under a shared lock
      // on the row: a revocation landing in the window this act cannot see refuses the rows
      // here, and the commit is left as the reconciler's to find.
      withMembership(principal, doors.postgres, async (fresh, tx) => {
        // Two acts and one shape: a commit's subject is the concept, an acceptance's is the
        // suggestion it decided. Each door call is **bare** either way, because its
        // rejection is what aborts this transaction (ADR 0014 rule 4).
        const acceptance = input.acceptance;
        if (acceptance === undefined) {
          await record(fresh, tx, {
            id: auditEventId,
            act: CONCEPT_ACTS.committed,
            subjectId: row.iri,
            detail: {
              iri: row.iri,
              commitSha: committed.value.sha,
              contentHash,
              evidenceCount: evidence.data.length,
            },
          });
        } else {
          await record(fresh, tx, {
            id: auditEventId,
            act: CONCEPT_ACTS.accepted,
            subjectId: acceptance.suggestionId,
            batchId: acceptance.batchId,
            detail: {
              iri: row.iri,
              commitSha: committed.value.sha,
              contentHash,
              setId: acceptance.setId,
            },
          });
        }
        await landRows(fresh, tx, {
          ...row,
          mergeKey: mergeKey.data,
          commit: committed.value,
          actor: actorIdOf(fresh),
          auditEventId,
          evidence: evidence.data,
          restsAlsoOn: [],
          acceptance,
        });
      }),
    );
    if (!landed.ok) {
      // A refusal this act names is a fact a caller can act on; everything else is the
      // store's own failure, and either way no row landed and the commit is now ahead of
      // the last `bundle_commit` — the reconciler's finding, by construction.
      const named = refusalFor(landed.error, WRITE_CONSTRAINTS);
      return err(typeof named === "string" ? named : landed.error);
    }
    if (!landed.value.ok) return err(landed.value.error);

    return ok({ iri: row.iri, sha: committed.value.sha, auditEventId, contentHash });
  });
};

/**
 * One item of an acceptance act: the suggestion, and **what the summary rendered as its
 * target** when the person deciding it looked. `null` says the merge key named no concept
 * then; a string says it named that one.
 *
 * It is a precondition and not an instruction: the acceptance resolves the merge key again,
 * and an acceptance whose resolution has moved since the summary was rendered is refused and
 * returned to the proposer, rather than landing on a concept nobody was shown.
 */
export type AcceptanceDecision = {
  readonly suggestionId: string;
  readonly expectedTarget: string | null;
};

/**
 * What an acceptance act is allowed to be asked for, read off the boundary that already
 * narrows the two columns these name — the suggestion's id and a resolved target's IRI —
 * and bounded by the size of a set, since a bulk acceptance decides one.
 */
const ACCEPTANCE_DECISIONS = z
  .object({
    suggestionId: boundarySchemas.suggestion.select.shape.id,
    expectedTarget: boundarySchemas.suggestion.select.shape.targetIri,
  })
  .array()
  .nonempty()
  .max(SUGGESTION_SET_MAX);

export type AcceptSuggestionRefusal =
  | WriteConceptRefusal
  | "no-such-suggestion"
  | "already-decided"
  | "resolution-moved";

/**
 * What became of one suggestion in an acceptance act. Per item, because each acceptance is
 * its own governed write and its own commit: one item's refusal is a fact about that item
 * and never a reason to un-land the ones before it — so the act as a whole succeeds and each
 * item carries its own `Result`, which is the shape every other refusal in `core` takes.
 */
export type AcceptanceOutcome = {
  readonly suggestionId: string;
  readonly outcome: Result<ConceptWritten, AcceptSuggestionRefusal | Error>;
};

/** The person a commit is attributed to, read off the identity set by their person id. */
type AuthorRow = { readonly name: string; readonly email: string };

/**
 * The git author for one acceptance: **the proposer, where ADR 0012's *edit* kind says so**
 * — a person's own change, decided by somebody else, is still that person's change — and the
 * accepting Admin for every other kind, whose proposer is a run's agent or a process and has
 * no author line to write.
 *
 * A git author line is a name and an address, which is deliberately what the ledger's
 * `human:<person id>` is not (ADR 0035), so the two are read from different places: the actor
 * off the record, the line off the person the actor names.
 *
 * **Only a member of this workspace can be named**, which is the join and not a courtesy: a
 * proposer is a string a producer wrote, and `user` is global by design (ADR 0009), so a
 * lookup by id alone would let a compromised producer put any person on the platform — their
 * name and their address — into another tenant's commit. A proposer who is not a member here
 * falls back to whoever is deciding, who is a member by construction.
 */
const authorFor = async (
  principal: UserPrincipal,
  tx: Tx,
  payload: SuggestionPayload,
): Promise<CommitAuthor | undefined> => {
  const proposer =
    payload.kind === SUGGESTION_EDIT_KIND ? personOfActor(payload.proposer) : undefined;
  for (const personId of proposer === undefined
    ? [principal.userId]
    : [proposer, principal.userId]) {
    const found = await tx.query<AuthorRow>(
      `SELECT u.name, u.email FROM "user" u
         JOIN member m ON m.user_id = u.id AND m.workspace_id = $2
        WHERE u.id = $1`,
      [personId, principal.workspaceId],
    );
    const row = found.rows[0];
    if (row !== undefined) return { name: row.name, email: row.email };
  }
  return undefined;
};

/** What the acceptance path needs before it can write: the payload, the target, the author. */
type Prepared = {
  readonly payload: SuggestionPayload;
  readonly target: string | undefined;
  readonly author: CommitAuthor;
};

/**
 * The commit's subject for an acceptance. One line whatever the payload's title held: a
 * title is open text and a newline in it would otherwise open a trailer of its own, which
 * the git door refuses (and is right to).
 */
const acceptanceMessage = (title: string): string =>
  `Accept the suggested change to ${title.replaceAll(/\s+/gu, " ").trim()}`;

/**
 * Accept suggestions — **each one its own governed write and its own commit** (ADR 0012,
 * user story 3), whether an Admin accepted the set in bulk or reached one item.
 *
 * The order of one acceptance is the whole of this ticket:
 *
 * 1. read the payload through `concept_write_request_for`, which is the only road to it,
 *    and the merge key's resolution beside it — what the person deciding was shown;
 * 2. refuse and **return to the proposer** when that resolution is not what the summary
 *    rendered — the change is not lost, it is back with whoever prepared it;
 * 3. hand the whole thing to `writeConcept`, which **reads the resolution again inside its
 *    own lock, before it commits**, mints an IRI when the merge key resolves to nothing and
 *    re-writes the concept when it resolves to one, holds the payload's base hash as its
 *    precondition, and decides the suggestion in the same transaction as the rows.
 *
 * **Step 1 is a courtesy and step 3 is the guarantee.** The resolution read here is outside
 * the act's lock and could move before the act runs; the read inside the lock cannot, because
 * `concept_identity` is written only by a governed write and a suggestion's decision is held
 * by the same lock. So an acceptance whose ground moved is refused with no commit either
 * way — this step only decides which word the caller hears, and whether the item goes back.
 *
 * A bulk act's rows share one batch id and are never one row hiding N (ADR 0014 rule 4).
 */
export const acceptSuggestions = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: { readonly decisions: readonly AcceptanceDecision[] },
): Promise<
  Result<readonly AcceptanceOutcome[], RoleRefusal | PrincipalRefusal | "malformed" | Error>
> => {
  // An Admin decides. ADR 0012's amendment also gives the *edit* kind to the target's
  // owner; a concept has no owner record yet, so that arm waits for the column.
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  // The request's own shape, through the boundary before any work: this is a transport's
  // argument, so an id of no known form or a target that is not an IRI is a caller's
  // mistake to be told about — not a statement to be sent, an item at a time, to a store
  // that will refuse it in the store's own words. The ceiling is a set's, because a bulk
  // acceptance decides a set and each item is its own commit.
  const decisions = ACCEPTANCE_DECISIONS.safeParse(input.decisions);
  if (!decisions.success) return err("malformed");

  const batchId = decisions.data.length > 1 ? ulid() : undefined;
  const outcomes: AcceptanceOutcome[] = [];
  for (const decision of decisions.data) {
    outcomes.push(await acceptOne(principal, doors, decision, batchId));
  }
  return ok(outcomes);
};

/** One suggestion's acceptance: the read that decides it, then the governed write. */
const acceptOne = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  decision: AcceptanceDecision,
  batchId: string | undefined,
): Promise<AcceptanceOutcome> => {
  const refused = (why: AcceptSuggestionRefusal | Error): AcceptanceOutcome => ({
    suggestionId: decision.suggestionId,
    outcome: err(why),
  });
  /** Hand this item back to whoever prepared it, and answer with the word that sent it. */
  const returning = async (why: AcceptSuggestionRefusal, reason: string) => {
    const returned = await returnToProposer(principal, doors, {
      suggestionId: decision.suggestionId,
      reason,
    });
    return refused(returned.ok ? why : returned.error);
  };

  const prepared = await attempt(() =>
    withMembership(principal, doors.postgres, async (fresh, tx) => {
      const payload = await payloadFor(fresh, tx, decision.suggestionId);
      if (payload === undefined) return undefined;
      const target = await targetOfMergeKey(fresh, tx, payload.mergeKey);
      const author = await authorFor(fresh, tx, payload);
      return author === undefined ? undefined : { payload, target, author };
    }),
  );
  if (!prepared.ok) return refused(prepared.error);
  if (!prepared.value.ok) return refused(prepared.value.error);
  const found: Prepared | undefined = prepared.value.value;
  if (found === undefined) return refused("no-such-suggestion");

  const moved = "the concept this suggestion resolves to moved after the set was opened";
  // The resolution the summary rendered, against the one this act just read.
  if ((found.target ?? null) !== decision.expectedTarget) {
    return returning("resolution-moved", moved);
  }

  const written = await writeConcept(principal, doors, {
    // The resolution this act just read: a concept to re-write, or nothing to mint one.
    // The act reads it again under its own lock, which is what actually decides it.
    iri: found.target,
    mergeKey: found.payload.mergeKey,
    path: found.payload.path,
    kind: found.payload.conceptKind,
    title: found.payload.title,
    frontmatter: found.payload.frontmatter,
    body: found.payload.body,
    message: acceptanceMessage(found.payload.title),
    author: found.author,
    expects: { base: found.payload.baseContentHash },
    acceptance: {
      suggestionId: decision.suggestionId,
      setId: found.payload.setId,
      kind: found.payload.kind,
      batchId,
    },
  });
  if (written.ok) return { suggestionId: decision.suggestionId, outcome: ok(written.value) };

  // The refusals the act read under its lock that mean *this suggestion's ground moved*:
  // the merge key now belongs to another concept or to none, and the content the payload
  // was written against is no longer what the concept says. All are "fails loudly and
  // returns to the proposer" (ADR 0012's 2026-08-27 amendment), and none cost a commit.
  if (written.error === "merge-key-taken" || written.error === "resolution-moved") {
    return returning("resolution-moved", moved);
  }
  if (written.error === "stale-precondition") {
    return returning("stale-precondition", "the concept moved after this suggestion was written");
  }
  return refused(written.error);
};

/** The latest check of a concept, as the trust projection reads it (ADR 0019). */
export type ConceptCheck = {
  /** Who checked — a person, the platform or an agent, in the kernel's one shape (ADR 0035). */
  readonly actor: ActorId;
  readonly at: Date;
  /** What was confirmed; `null` on an imported check, which never reads *Changed since checked*. */
  readonly contentHash: string | null;
};

/** A concept as `open` returns it: the file's own content, and the facts trust is derived from. */
export type OpenedConcept = {
  readonly iri: string;
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly status: string;
  readonly contentHash: string;
  readonly commitSha: string;
  readonly check: ConceptCheck | undefined;
};

type ConceptRow = {
  readonly iri: string;
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly status: string;
  readonly content_hash: string;
  readonly commit_sha: string;
  readonly checked_by: string | null;
  readonly checked_at: Date | null;
  readonly checked_hash: string | null;
};

/**
 * The one SELECT every read of a concept shares — `open`'s by IRI and `find`'s by query —
 * with the read predicate on the row and the latest check beside it: two statements that
 * projected a concept differently would be two chances to leak a column one of them
 * withholds. `$1` is the read's own term; the predicate's two parameters follow it.
 */
const CONCEPT_SELECT = `SELECT c.iri, c.path, c.kind, c.title, c.frontmatter, c.body, c.status,
              c.content_hash, c.commit_sha,
              v.actor AS checked_by, v.checked_at, v.content_hash AS checked_hash
         FROM concept_index c
         LEFT JOIN LATERAL (
                SELECT actor, checked_at, content_hash
                  FROM concept_verification
                 WHERE workspace_id = c.workspace_id AND iri = c.iri
                 ORDER BY checked_at DESC, id DESC
                 LIMIT 1
              ) v ON true
        WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}`;

const openedOf = (row: ConceptRow): OpenedConcept => ({
  iri: row.iri,
  path: row.path,
  kind: row.kind,
  title: row.title,
  frontmatter: row.frontmatter,
  body: row.body,
  status: row.status,
  contentHash: row.content_hash,
  commitSha: row.commit_sha,
  check: checkOf(row),
});

/**
 * One concept by its IRI, or nothing — the read `open` serves (ADR 0018).
 *
 * **A concept this caller may not see and a concept nobody minted answer the same way**:
 * the read predicate is part of the WHERE clause, so a withheld concept is not a row this
 * statement returns and there is nothing left to leak by. Probing IRIs reveals nothing,
 * which is user story 13's whole requirement.
 *
 * The latest check comes back in the same statement rather than a second read, because
 * trust is a projection of it (ADR 0019) and a concept with no check is *Unchecked* rather
 * than a row that is missing.
 */
export const conceptByIri = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: string,
): Promise<Result<OpenedConcept | undefined, Error>> => {
  const found = await attempt(() =>
    tx.query<ConceptRow>(`${CONCEPT_SELECT} AND c.iri = $4`, [
      principal.workspaceId,
      ...readableParameters(principal),
      iri,
    ]),
  );
  if (!found.ok) return err(found.error);
  const row = found.value.rows[0];
  return ok(row === undefined ? undefined : openedOf(row));
};

/** The three characters `LIKE` reads as pattern, escaped, so a query is only ever text. */
const likeEscaped = (text: string): string => text.replaceAll(/[\\%_]/g, String.raw`\$&`);

/**
 * The concepts whose title or body holds the query, as this caller may see them — `find`'s
 * first real read over `concept_index` (T-055), through the same SELECT and the same
 * predicate as `open`, so a hit is exactly a concept the caller could open. **A withheld
 * concept is not a hit, not a count and not a hint** (ADR 0016): the predicate is in the
 * WHERE clause, and the list is what came back.
 *
 * Matching is a substring, case-folded, by title first — ranking is B9's, and this read
 * exists to be predicate-true over real rows rather than product-complete. A query with
 * nothing in it matches nothing rather than everything.
 */
export const findConcepts = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly query: string; readonly limit: number },
): Promise<Result<readonly OpenedConcept[], Error>> => {
  const query = input.query.trim();
  if (query === "" || input.limit < 1) return ok([]);
  const found = await attempt(() =>
    tx.query<ConceptRow>(
      `${CONCEPT_SELECT} AND (c.title ILIKE $4 OR c.body ILIKE $4)
        ORDER BY c.title, c.iri LIMIT $5`,
      [
        principal.workspaceId,
        ...readableParameters(principal),
        `%${likeEscaped(query)}%`,
        input.limit,
      ],
    ),
  );
  if (!found.ok) return err(found.error);
  return ok(found.value.rows.map(openedOf));
};

/**
 * The latest check as the trust projection reads it, or nothing. The actor column is parsed
 * on the way out rather than asserted: a value that is not one of the three forms is a broken
 * database, and a check nobody can attribute moves no tier — so it reads as *Unchecked*,
 * which is the fail-closed answer and not a guess about who checked.
 */
const checkOf = (row: ConceptRow): ConceptCheck | undefined => {
  if (row.checked_by === null || row.checked_at === null || !isActorId(row.checked_by)) {
    return undefined;
  }
  return { actor: row.checked_by, at: row.checked_at, contentHash: row.checked_hash };
};
