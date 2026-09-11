import {
  AUDIENCE_EVERYONE,
  boundarySchemas,
  CONCEPT_DRAFT_STATUS,
  PUBLISHED_STATUSES,
  SENSITIVITY_DEFAULT,
  SUGGESTION_ACCEPTED_STATUS,
  SUGGESTION_REPAIR_KIND,
  SUGGESTION_WAITING_STATUS,
  VERIFICATION_ERASURE_ORIGIN,
  VERIFICATION_REPAIR_ORIGIN,
} from "@better-answers/schema";
import type { z } from "zod";

import {
  readableParameters,
  sensitivityAndAudienceClause,
  visibilityOf,
  type Visibility,
} from "../access/index.ts";
import type { ActorId, PlatformPrincipal, Principal } from "../kernel/index.ts";
import { fileAt, type Committed, type GitDoor } from "../store/git/index.ts";
import { recomputeCompositionsIncluding } from "../guides/index.ts";
import { writeConceptDelta } from "../store/graph/index.ts";
import { scopeClause, scopeParameter, type Tx } from "../store/postgres/index.ts";
import { contentHashOf, parseConceptFile, type Frontmatter, type HashedSource } from "./file.ts";
import { markDeciding } from "./inbox.ts";
import type { Acceptance } from "./index.ts";
import { conceptVisibilityFrom, replaceCitations } from "./visibility.ts";

/**
 * The **landing**: what the index already holds for a concept, the row a write builds from
 * its facts, and the one routine that lands the rows (ADRs 0012, 0023, 0039). Two roads
 * reach it — the governed write's live act and the reconciler's replay of a commit whose
 * rows were lost — and both build the row through `indexRowOf` and land it through
 * `landRows`, which is what makes a replayed commit land the row its act would have.
 *
 * It is its own module because the two roads are two modules: the live write in `index.ts`
 * and the replay in `reconciler.ts` each import this, and neither imports the other. The
 * order the rows are written in — identity, evidence, citations, the derived index row, the
 * bundle commit, the graph delta, the cascade, the suggestion's decision — is stated once,
 * in `landRows`, and nowhere else.
 */

/**
 * A kind, folded for **case and plural only** (ADR 0012's 2026-08-30 amendment, ADR 0026): an
 * unknown kind is the ordinary case, so `policy`, `Policy` and `Policies` are one kind and the
 * type vocabulary counts them once.
 *
 * The fold reaches the **row** and never the file: `type` is not a code-owned key, and ADR
 * 0019 keeps every key the platform does not own verbatim in the bundle. So a person's
 * spelling survives export while the index groups by one word.
 *
 * The plural rule is the conservative English one and says so: `-ies` → `-y`, `-ses`/`-xes`/
 * `-zes`/`-ches`/`-shes` → drop `-es`, a trailing `-s` dropped unless the word ends `-ss`,
 * `-us` or `-is`. Irregulars (`Analyses`) fold wrongly and are folded consistently, which is
 * what matters for grouping; a kind vocabulary that ever needs more is a ticket, not a guess.
 *
 * **Case and plural, and nothing else** — the amendment's word is *only*. Whatever separates
 * the words of a kind is left exactly as it was written, because collapsing it would be a
 * third fold nobody decided: `Rate  Card` and `Rate Card` stay two kinds, and the day they
 * should not is a rule to write down first. The boundary trims the ends.
 */
export const foldKind = (kind: string): string =>
  kind.replaceAll(/\S+/g, (word) => {
    const cased = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    if (cased.endsWith("ies")) return `${cased.slice(0, -3)}y`;
    if (/(s|x|z|ch|sh)es$/.test(cased)) return cased.slice(0, -2);
    if (/(ss|us|is)$/.test(cased) || !cased.endsWith("s")) return cased;
    return cased.slice(0, -1);
  });

/**
 * The index row's columns less the commit's sha, which does not exist yet when this parse
 * runs: everything a caller supplies is checked at the boundary **before** the commit, so a
 * row the boundary would refuse never becomes a commit nobody can record. The sha comes from
 * the git door, which answers a git object name or a refusal and nothing else.
 */
const conceptRow = boundarySchemas.conceptIndex.insert.omit({ commitSha: true });

/** The constraints this act refuses over; every other violation stays the store's Error. */
export const WRITE_CONSTRAINTS = {
  concept_index_workspace_id_path_uidx: "path-taken",
  concept_identity_merge_key_uidx: "merge-key-taken",
} as const;

/**
 * What the index already holds for this IRI — the facts a re-write keeps or may not move,
 * and the three a replayed commit falls back on when its file does not carry them.
 */
export type Held = {
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly mergeKey: string;
  /** The class and audience as derived at the last act — the fallback a re-write rests on. */
  readonly sensitivity: string;
  readonly audience: string;
  readonly audienceGroups: readonly string[] | null;
  readonly status: string;
  /** What the concept says now — what an acceptance's payload was written against. */
  readonly contentHash: string;
  /** When it first became readable; kept across a re-write, so publishing happens once. */
  readonly publishedAt: Date | null;
};

type HeldRow = {
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly merge_key: string;
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
  readonly status: string;
  readonly content_hash: string;
  readonly published_at: Date | null;
};

/**
 * The Principal first, as every function here that reaches tenant data takes it: the
 * workspace this reads in is the one the caller is acting in, and never a string a call site
 * chose (ADR 0029). RLS scopes the statement already; naming the pair says so where a reader
 * of the SQL can see it — and for the platform principal, which carries no workspace, the
 * scope alone says which one is read, as the audit door reads it.
 *
 * **A person reaches the row through the class and audience arms of the read predicate.** A
 * concept a writer may not see for its class or its audience is not theirs to re-write, and
 * a row this read withholds is a row this act never held — so the write answers exactly as
 * it does for an IRI nobody minted, and a re-write is no oracle for what `open` withholds.
 * **The published arm is not applied, by decision**: it gates readers, and a writer is an
 * Editor or an Admin (ADR 0012), whose re-write of a draft is the road to publishing it —
 * every creation lands as a draft, so applying that arm here would make every draft
 * un-rewritable by anyone, and a draft has no author of record to make an exception for
 * (the commit's author is git's fact, never the row's). What withholds a concept from a
 * writer is its class and its audience, exactly the two arms a Viewer is withheld by. The
 * platform reads every row, because the replay is recovery of an act that was authorised
 * when its commit was made, never a second judgement of it.
 */
export const heldByIri = async (
  principal: Principal,
  tx: Tx,
  iri: string,
): Promise<Held | undefined> => {
  const predicate = principal.kind === "user" ? `AND ${sensitivityAndAudienceClause("c", 3)}` : "";
  const found = await tx.query<HeldRow>(
    `SELECT c.path, c.kind, c.title, i.merge_key, c.sensitivity, c.audience, c.audience_groups,
            c.status, c.content_hash, c.published_at
       FROM concept_index c
       JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
      WHERE c.workspace_id = ${scopeClause(1)} AND c.iri = $2
        ${predicate}`,
    [
      scopeParameter(principal),
      iri,
      ...(principal.kind === "user" ? readableParameters(principal) : []),
    ],
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : {
        path: row.path,
        kind: row.kind,
        title: row.title,
        mergeKey: row.merge_key,
        sensitivity: row.sensitivity,
        audience: row.audience,
        audienceGroups: row.audience_groups,
        status: row.status,
        contentHash: row.content_hash,
        publishedAt: row.published_at,
      };
};

/** Whether two visibilities are one: the same class, the same word, the same groups in the same order. */
const sameVisibility = (one: Visibility, other: Visibility): boolean =>
  one.sensitivity === other.sensitivity &&
  one.audience === other.audience &&
  (one.audienceGroups ?? []).join(" ") === (other.audienceGroups ?? []).join(" ");

/** The pair a concept holds, read as a `Visibility` — the fallback a re-write's derivation rests on. */
export const heldVisibilityOf = (held: Held) =>
  visibilityOf({
    sensitivity: held.sensitivity,
    audience: held.audience,
    audience_groups: held.audienceGroups,
  });

/**
 * What a write supplies for its index row, by whichever road it came: the file's facts, and
 * the status and class it names or leaves to what the concept already holds.
 */
type RowFacts = {
  readonly workspaceId: string;
  readonly iri: string;
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly contentHash: string;
  readonly status: string | undefined;
  readonly sensitivity: string | undefined;
};

/**
 * The index row as the boundary parses it, built the one way for both roads to the rows —
 * the live write's and the reconciler's replay — so a replayed commit lands the row its act
 * would have.
 *
 * A status the write does not name is **the one the file carries**, where the file names
 * one — the file is the truth and the row is derived from it (ADR 0012), and a row that
 * said *draft* under a file that said *stable* would hide a concept its own file publishes
 * and then flip it on replay — and otherwise the one the concept already holds, exactly as
 * its class is: the draft default is what a concept is *born* at, and applying it to a
 * re-write would un-publish a stable concept nobody asked to un-publish. Published once and kept: a
 * concept that reaches a readable status carries the instant it first did, and one that
 * leaves those statuses loses it, so the predicate's first arm is a fact about the concept
 * rather than a stamp every write renews.
 *
 * The class and audience here are the **fallback** the derivation rests on when the
 * concept cites nothing that resolves to a binding (`visibility.ts`): the writer's word on
 * a creation, and on anything else what the row holds now — the audience included, so a
 * re-write that drops its citations never widens a named-group audience back to everyone.
 * What the row lands with is what the derivation says, not this.
 *
 * `now` is the platform's instant for a first publish (ADR 0040): the caller's own Clock,
 * read once and handed in — never read here — so a held concept's `publishedAt` is the
 * platform's instant, never the transaction's, and a test can pin it to a literal.
 */
export const indexRowOf = (facts: RowFacts, held: Held | undefined, now: Date) => {
  const fileStatus = facts.frontmatter["status"];
  const status =
    facts.status ??
    (typeof fileStatus === "string" ? fileStatus : undefined) ??
    held?.status ??
    CONCEPT_DRAFT_STATUS;
  return conceptRow.safeParse({
    workspaceId: facts.workspaceId,
    iri: facts.iri,
    path: facts.path,
    kind: foldKind(facts.kind),
    title: facts.title,
    frontmatter: facts.frontmatter,
    body: facts.body,
    contentHash: facts.contentHash,
    status,
    publishedAt: PUBLISHED_STATUSES.some((published) => published === status)
      ? (held?.publishedAt ?? now)
      : null,
    sensitivity: held?.sensitivity ?? facts.sensitivity ?? SENSITIVITY_DEFAULT,
    audience: held?.audience ?? AUDIENCE_EVERYONE,
    audienceGroups: held?.audienceGroups ?? null,
  });
};

/**
 * Everything the act's transaction writes beside its ledger row: the index row the boundary
 * parsed, and the facts the act itself supplies. The row's columns are named once — by
 * the boundary — rather than restated here and again at the call site.
 */
type Landing = z.infer<typeof conceptRow> & {
  readonly mergeKey: string;
  readonly commit: Committed;
  readonly actor: ActorId;
  readonly auditEventId: string;
  /**
   * The file's `sources[]` as the content hash reduced it — the one reduction the write path
   * makes (`hashedFileOf`), handed on so the graph derives lineage from the same pairs the
   * hash was made from, never from a second reading of the frontmatter.
   */
  readonly sources: readonly HashedSource[];
  /**
   * The evidence the act was handed — the whole of what the concept cites after this act,
   * an empty list clearing its citations — or `undefined` for a road that recovers none:
   * the reconciler's replay, whose commit carries no document id, leaves the citations as
   * they stand rather than clearing them and widening a derived audience by recovery.
   */
  readonly evidence: readonly z.infer<typeof boundarySchemas.evidence.insert>[] | undefined;
  /**
   * Units the concept rests on beside the bindings of its citations: nothing for the live
   * act, and for a replay whose file cites what the standing citations do not, the most
   * restrictive visibility there is — so a recovery that cannot recover the evidence lands
   * the concept Restricted rather than at the class the citations it lost derived.
   */
  readonly restsAlsoOn: readonly Visibility[];
  /** The suggestion this act decided, when it was an acceptance; absent otherwise. */
  readonly acceptance: Acceptance | undefined;
};

/**
 * The rows the act writes, in one place so the order they are written in is one fact — and
 * the one landing routine: the reconciler's replay lands through this too, under the platform
 * principal, which is why the Principal is either kind.
 *
 * The evidence and the citations land **before** the index row, because the row's class and
 * audience are derived from the bindings of what the concept cites (`visibility.ts`; ADR
 * 0023, ADR 0039): the parsed row's pair is the fallback, and what lands is the derivation
 * — on the index row and on the map's copies of it alike, in this one transaction, so a
 * concept is never readable for an instant at a class its evidence does not allow. The
 * derivation rests on the row's own pair at that instant too, so a re-write never lands
 * wider than the row it re-writes, whatever narrowed it since the act's check. And
 * when the derivation moves the pair off what the row held, the cascade's second level runs
 * here as it runs inside a narrowing: every composition including this concept is
 * re-derived in the same transaction, so a re-write that narrows a concept never leaves a
 * guide page wider than what it includes.
 */
export const landRows = async (principal: Principal, tx: Tx, index: Landing): Promise<void> => {
  // The identity first: the index row's composite key points at it, and a merge key that
  // moved is upkeep on the row that already exists rather than a second identity.
  await tx.query(
    `INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, iri) DO UPDATE SET merge_key = EXCLUDED.merge_key`,
    [index.workspaceId, index.iri, index.mergeKey],
  );
  for (const piece of index.evidence ?? []) {
    await tx.query(
      `INSERT INTO evidence (workspace_id, source_document_id, locator, resource, content_version)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, source_document_id, locator) DO UPDATE
          SET resource = EXCLUDED.resource, content_version = EXCLUDED.content_version`,
      [
        piece.workspaceId,
        piece.sourceDocumentId,
        piece.locator,
        piece.resource,
        piece.contentVersion ?? null,
      ],
    );
  }
  if (index.evidence !== undefined) {
    await replaceCitations(principal, tx, index.iri, index.evidence);
  }
  const held = visibilityOf({
    sensitivity: index.sensitivity,
    audience: index.audience,
    audience_groups: index.audienceGroups ?? null,
  });
  // And on the row as it stands *now*, not as the act read it before its commit: a
  // narrowing's cascade may have moved the row between the two, and a re-write that swapped
  // its evidence would otherwise land what its new citations derive over a row that had
  // already narrowed — the widening the pre-commit check refuses, a moment late.
  const visibility = await conceptVisibilityFrom(principal, tx, {
    iri: index.iri,
    kind: index.kind,
    fallback: held,
    alsoOn: index.restsAlsoOn,
    onTheRow: true,
  });
  await tx.query(
    `INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter, body,
                                content_hash, commit_sha, status, published_at, sensitivity,
                                audience, audience_groups)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (workspace_id, iri) DO UPDATE
        SET path = EXCLUDED.path, kind = EXCLUDED.kind, title = EXCLUDED.title,
            frontmatter = EXCLUDED.frontmatter, body = EXCLUDED.body,
            content_hash = EXCLUDED.content_hash, commit_sha = EXCLUDED.commit_sha,
            status = EXCLUDED.status, published_at = EXCLUDED.published_at,
            sensitivity = EXCLUDED.sensitivity, audience = EXCLUDED.audience,
            audience_groups = EXCLUDED.audience_groups, updated_at = now()`,
    [
      index.workspaceId,
      index.iri,
      index.path,
      index.kind,
      index.title,
      index.frontmatter,
      index.body,
      index.contentHash,
      index.commit.sha,
      index.status,
      index.publishedAt,
      visibility.sensitivity,
      visibility.audience,
      visibility.audienceGroups,
    ],
  );
  await tx.query(
    `INSERT INTO bundle_commit (workspace_id, sha, parent_sha, audit_event_id, actor)
     VALUES ($1, $2, $3, $4, $5)`,
    [index.workspaceId, index.commit.sha, index.commit.parent, index.auditEventId, index.actor],
  );
  // The bundle-and-record graph delta, last of the bundle's rows: it resolves link targets
  // against the index this transaction just wrote, and it lands or rolls back with
  // everything above — which is what "the map is never behind for an edit" means (ADR 0023,
  // ADR 0032). An acceptance writes it too: the decision below is one act with these rows.
  // The map's copies of the three columns are the derivation's, as the row's are.
  await writeConceptDelta(principal, tx, {
    workspaceId: index.workspaceId,
    iri: index.iri,
    kind: index.kind,
    path: index.path,
    body: index.body,
    sources: index.sources.map(([resource, locator]) => ({ resource, locator })),
    publishedAt: index.publishedAt ?? null,
    ...visibility,
    status: index.status,
  });
  // The cascade's second level, when the pair moved: a composition's columns are the most
  // restrictive of its includes, and an include that just narrowed narrows it now, in this
  // transaction — the same rule the narrowing act runs (ADR 0023, ADR 0039).
  if (!sameVisibility(held, visibility)) {
    await recomputeCompositionsIncluding(principal, tx, { iris: [index.iri] });
  }
  if (index.acceptance === undefined) return;

  // The suggestion's decision, in the same transaction as the rows its acceptance wrote:
  // a suggestion is never accepted without its concept, or the other way about. `status`
  // is in the WHERE, so a suggestion two people decide at once is decided once — and the
  // loser aborts here rather than committing a decision that never happened.
  //
  // The marker first, because the row's trigger refuses a decision from a transaction that
  // has not said it is making one (migration 0018): an acceptance is the one road that may
  // decide by accepting, and this is where it says so.
  await markDeciding(tx, index.acceptance.suggestionId);
  const decided = await tx.query<{ id: string }>(
    `UPDATE suggestion
        SET status = $3, decider = $4, decided_at = now(), target_iri = $5
      WHERE workspace_id = $1 AND id = $2 AND status = $6
    RETURNING id`,
    [
      index.workspaceId,
      index.acceptance.suggestionId,
      SUGGESTION_ACCEPTED_STATUS,
      index.actor,
      index.iri,
      SUGGESTION_WAITING_STATUS,
    ],
  );
  if (decided.rows.length === 0) {
    throw new Error("the suggestion was decided by somebody else while this act was in flight");
  }
  if (index.acceptance.kind !== SUGGESTION_REPAIR_KIND) return;

  // **The repair re-hash** (T-006 spec, *Evidence, verification and repair*). Repairing a
  // locator moves the content hash, so every standing check on this concept would read
  // *Changed since checked* the moment this act commits — for a change nobody made to the
  // fact. The checks are re-pointed at what the repair wrote, in this act's own
  // transaction, and marked as hashes a routine moved: the actor and the instant stand, so
  // *Checked by Ada* stays *Checked by Ada* and the cadence still reads the real date.
  // An imported check carries no hash and is left exactly alone (ADR 0019).
  await tx.query(
    `UPDATE concept_verification SET content_hash = $3, origin = $4
      WHERE workspace_id = $1 AND iri = $2 AND content_hash IS NOT NULL`,
    [index.workspaceId, index.iri, index.contentHash, VERIFICATION_REPAIR_ORIGIN],
  );
};

/**
 * Carry the bundle's commit rows onto a rewritten history: one pair per commit whose hash
 * moved, old then new, as the git door's rewrite reported them.
 *
 * **This is the concepts slice's because `bundle_commit` is** (`packages/schema`'s ownership
 * map). The erasure routine is what calls it — the one slice that sits at the top of the
 * graph and may import another's face (ADR 0029 rule 4) — and it calls it rather than writing
 * SQL of its own, so the table keeps one writer and a reviewer reading this file sees every
 * statement that has ever moved a row in it.
 *
 * The platform principal, never a person's: a person's act adds a commit, and moving the rows
 * under one is a routine the platform runs on a valid erasure request (ADR 0020).
 *
 * **One statement for the rows, because of the chain.** `bundle_commit.parent_sha` is a
 * foreign key onto `bundle_commit.sha` in the same workspace, and it is not deferrable: a
 * statement that moved the hashes and left the parents behind would break it the moment it
 * ended. Both columns move in the one `UPDATE`, so the constraint is checked once, against a
 * table that is whole again. The index row's key into the same table is a second statement and
 * can be, because *that* constraint is deferred to the end of the transaction (migration 0015)
 * — which is also why the caller must do both inside one.
 *
 * A commit the rewrite did not move is not in the pairs, and a pair naming a commit this
 * workspace never recorded matches nothing. So a second run of the routine, which finds
 * nothing to rewrite and therefore reports no pairs, moves no row at all.
 */
export const moveBundleCommits = async (
  platform: PlatformPrincipal,
  tx: Tx,
  moved: readonly (readonly [string, string])[],
): Promise<number> => {
  if (moved.length === 0) return 0;
  const before = moved.map(([old]) => old);
  const after = moved.map(([, now]) => now);
  const rows = await tx.query(
    `WITH moved(before_sha, after_sha) AS (SELECT * FROM unnest($2::text[], $3::text[]))
     UPDATE bundle_commit AS c
        SET sha = COALESCE((SELECT m.after_sha FROM moved m WHERE m.before_sha = c.sha), c.sha),
            parent_sha = COALESCE(
              (SELECT m.after_sha FROM moved m WHERE m.before_sha = c.parent_sha),
              c.parent_sha
            )
      WHERE c.workspace_id = ${scopeClause(1)}
        AND (c.sha = ANY($2::text[]) OR c.parent_sha = ANY($2::text[]))`,
    [scopeParameter(platform), before, after],
  );
  await tx.query(
    `WITH moved(before_sha, after_sha) AS (SELECT * FROM unnest($2::text[], $3::text[]))
     UPDATE concept_index AS i
        SET commit_sha = m.after_sha
       FROM moved m
      WHERE i.workspace_id = ${scopeClause(1)} AND i.commit_sha = m.before_sha`,
    [scopeParameter(platform), before, after],
  );
  return rows.rowCount ?? 0;
};

/** What the erasure's step 4 moved: index rows carried on, and checks re-pointed at them. */
export type ChecksCarried = {
  /** Index rows whose file the rewrite changed, and which now hold what the file holds. */
  readonly concepts: number;
  /** Checks re-pointed at the moved hash and marked with the origin that says why. */
  readonly checks: number;
};

/** The index row this step reads back, and the file it claims to describe. */
type RewrittenRow = {
  readonly iri: string;
  readonly path: string;
  readonly commit_sha: string;
  readonly content_hash: string;
};

/**
 * **The checks the erasure rewrite moved** — the routine's step 4 (ADR 0019; ADR 0020; the S0
 * spec, step 4). The paths are the ones the erasure map found the person in; for each, the file
 * is read back from the commit its index row names and hashed again.
 *
 * **Most of the time nothing moves, and that is the design working.** A bundle names a person
 * as `human:<address>` in `generated` and `verified[].by`, and ADR 0019 keeps both out of the
 * content hash — a check must not move its own file's hash — so a rewrite that touches only
 * those keys leaves every hash exactly where it was and this step correctly does nothing. What
 * it is here for is the file that named the person inside the text the hash *is* taken over: a
 * body that quoted an actor id, a cited resource that did. There the canonical text really
 * changed, and without this step every standing check would read *Changed since checked* the
 * moment the erasure committed — for a change nobody made to the fact.
 *
 * So two rows move together. The index row is carried onto what the file now says, because it
 * is a copy of that file and an index still holding the address would be the erasure missing a
 * store. And the checks over it are re-pointed at the new hash and marked **erasure-rewrite**,
 * so the row still says who checked and when, and says that a routine moved its hash — the
 * origin `VERIFICATION_REPAIR_ORIGIN`'s docblock names as its twin. An imported check carries
 * no hash and is left exactly alone.
 *
 * **This is the concepts slice's because `concept_index` and `concept_verification` are**, as
 * `moveBundleCommits` above is; the erasure routine calls it inside the transaction that moved
 * the commits, rather than writing SQL of its own (ADR 0029 rule 4).
 *
 * A file the platform cannot read back is a throw and never a skip: the alternative is an index
 * row and a bundle that disagree about a concept, with nothing anywhere saying so.
 */
export const carryChecksOntoRewrite = async (
  platform: PlatformPrincipal,
  tx: Tx,
  door: GitDoor,
  input: { readonly workspaceId: string; readonly paths: readonly string[] },
): Promise<ChecksCarried> => {
  if (input.paths.length === 0) return { concepts: 0, checks: 0 };
  const indexed = await tx.query<RewrittenRow>(
    `SELECT iri, path, commit_sha, content_hash
       FROM concept_index
      WHERE workspace_id = ${scopeClause(1)} AND path = ANY($2::text[])`,
    [scopeParameter(platform), [...input.paths]],
  );

  let concepts = 0;
  let checks = 0;
  for (const row of indexed.rows) {
    const content = await fileAt(platform, door, input.workspaceId, row.commit_sha, row.path);
    // No file at the commit the row names: the row describes a concept this bundle does not
    // hold, which is the reconciler's to answer and not an erasure's to guess at.
    if (content === null) continue;
    const read = parseConceptFile(content);
    if (!read.ok) {
      throw new Error(`concepts: the bundle holds a file the platform cannot read: ${row.path}`);
    }
    const contentHash = contentHashOf(read.value.frontmatter, read.value.body, row.path);
    if (contentHash === row.content_hash) continue;

    await tx.query(
      `UPDATE concept_index SET frontmatter = $3, body = $4, content_hash = $5
        WHERE workspace_id = ${scopeClause(1)} AND iri = $2`,
      [scopeParameter(platform), row.iri, read.value.frontmatter, read.value.body, contentHash],
    );
    concepts += 1;
    const moved = await tx.query(
      `UPDATE concept_verification SET content_hash = $3, origin = $4
        WHERE workspace_id = ${scopeClause(1)} AND iri = $2 AND content_hash IS NOT NULL`,
      [scopeParameter(platform), row.iri, contentHash, VERIFICATION_ERASURE_ORIGIN],
    );
    checks += moved.rowCount ?? 0;
  }
  return { concepts, checks };
};
