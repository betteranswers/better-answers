import { createHash } from "node:crypto";

import {
  AUDIENCE_EVERYONE,
  boundarySchemas,
  citedSourceOf,
  CONCEPT_DRAFT_STATUS,
  PUBLISHED_STATUSES,
  resolvedResource,
  SENSITIVITY_DEFAULT,
} from "@better-answers/schema";
import type { z } from "zod";

import { readableClause, readableParameter } from "../access/index.ts";
import { act, declareActs, record } from "../audit/index.ts";
import {
  actorIdOf,
  attempt,
  err,
  isActorId,
  ok,
  refusalFor,
  ulid,
  type ActorId,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  commit as commitToBundle,
  withRepositoryLock,
  type CommitAuthor,
  type CommitRefusal,
  type Committed,
  type GitDoor,
} from "../store/git/index.ts";
import { writeConceptDelta } from "../store/graph/index.ts";
import { withMembership, type PostgresDoor, type Tx } from "../store/postgres/index.ts";

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
 * **What this act does not do**: mint the IRI. A concept's IRI has exactly one form —
 * `https://better-answers.com/c/<ulid>`, opaque and on the bare apex (ADR 0002's amendments)
 * — which the boundary holds it to and `conceptIriOf` is the one way to make. The caller
 * hands one in because a re-write has to name the concept it re-writes; the identity row this
 * act writes is what makes that IRI the concept's key from then on.
 *
 * ADR 0002 also says the key is **never caller-settable**, which this act does not yet
 * enforce: a creation should mint its own and a supplied IRI should have to exist already.
 * The read this act makes before it commits is where that check belongs, and it is a ticket
 * rather than a line — flagged to the owner with T-054, which owns the acceptance path that
 * mints on a suggestion's behalf.
 */

/**
 * The slice's acts on the ledger. One act today: a concept committed to the bundle. The
 * subject is the concept, by IRI — every record about a concept attaches by IRI (ADR 0014) —
 * and the detail names the commit, the content it hashed and how many pieces of evidence it
 * recorded, so the ledger answers "what did this act put in the bundle" without opening git.
 */
const CONCEPT_ACTS = declareActs("knowledge", {
  committed: act("knowledge.concept.committed", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
    evidenceCount: "count",
  }),
});

/**
 * One `sources[]` entry (`docs/okf-v02.md`): OKF's provenance object — `resource` required,
 * `id`, `title`, `author`, `usage_count`, `last_modified` — and the platform's `locator`
 * beside them — one of the two keys the platform may add to a concept file at all (ADR 0002).
 */
export type FrontmatterSource = Readonly<Record<string, string | number | boolean | null>>;

/**
 * An OKF frontmatter value: scalars, string lists, and the one list of objects the spec
 * defines. One level of nesting and no more, which is what the boundary narrows to.
 */
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly FrontmatterSource[];

export type Frontmatter = Readonly<Record<string, FrontmatterValue>>;

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

/** One piece of evidence recorded at commit time (`CONTEXT.md`, *evidence*). */
export type EvidenceInput = {
  readonly sourceDocumentId: string;
  readonly locator: string;
  /** The rendered projection off the document — what a reader is shown, never the key. */
  readonly resource: string;
  readonly contentVersion?: string;
};

export type WriteConceptInput = {
  /** The concept's IRI (ADR 0002) — its key, in the one form `conceptIriOf` makes. */
  readonly iri: string;
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
  /** What the caller expects the ref to hold; `null` for a bundle's first commit. */
  readonly expectedHead: string | null;
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
 * content moved under them (ADR 0012) — and the two `-taken` words are a bundle that already
 * holds this path or this merge key under another IRI. `rename-refused` and
 * `reclassification-refused` are the two moves this act never makes; the principal refusals
 * are `withMembership`'s, which judges the caller's authority at time-of-act.
 */
export type WriteConceptRefusal =
  | RoleRefusal
  | CommitRefusal
  | PrincipalRefusal
  | "malformed"
  | "path-taken"
  | "merge-key-taken"
  | "rename-refused"
  | "reclassification-refused";

/**
 * The frontmatter keys ADR 0014's content hash leaves out: the trust the platform derives
 * and the identity it minted. Hashing them would make a check of its own recording move the
 * hash and turn *Checked* into *Changed since checked* on the next read.
 */
const UNHASHED_KEYS: ReadonlySet<string> = new Set([
  "generated",
  "verified",
  "stale_after",
  "status",
  "iri",
]);

/** The body as ADR 0014 normalises it: `\r\n` to `\n`, no trailing whitespace, one final newline. */
const normalisedBody = (body: string): string =>
  `${body
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "")}\n`;

// `resolvedResource` — the hash's path resolution — is the boundary's (`@better-answers/schema`),
// beside `citedSourceOf` and for the same reason: the graph door's delta resolves the same
// references, and two resolutions would be two chances to disagree about which concept a
// file names (ADR 0019).

/** One `sources[]` entry as the hash carries it: the resolved resource, then the locator. */
type HashedSource = readonly [string, string | null];

/**
 * One `sources[]` entry, read whichever way a file writes it — **the boundary's own reader**
 * (`citedSourceOf`), which the boundary's `sources[]` refinement asks the same question of.
 * One definition, so the validator and the hash can never part company: two readers over one
 * shape was exactly the defect that had `evidenceOf` dropping entries the hash still counted.
 */
export { citedSourceOf as citedSource } from "@better-answers/schema";

/**
 * `sources[]` **reduced to ordered `(resource, locator)` pairs** with paths resolved — ADR
 * 0019's own reduction, and what makes a source-title fix or a `usage_count` update leave a
 * check standing while a swapped source un-checks it.
 */
const reducedSources = (
  value: FrontmatterValue | undefined,
  path: string,
): readonly HashedSource[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const cited = citedSourceOf(entry);
    return cited === undefined ? [] : [[resolvedResource(cited.resource, path), cited.locator]];
  });
};

/**
 * The frontmatter as ADR 0014's hash reads it, written straight as canonical JSON: keys
 * sorted, the trust and identity keys dropped, `sources[]` reduced. A string rather than an
 * object, because the object was never anything but a step on the way to these bytes.
 */
const canonicalFrontmatter = (frontmatter: Frontmatter, path: string): string => {
  const pairs = Object.keys(frontmatter)
    .toSorted()
    .filter((key) => !UNHASHED_KEYS.has(key))
    .map((key) => {
      const value = frontmatter[key];
      const reduced = key === "sources" ? reducedSources(value, path) : value;
      return `${JSON.stringify(key)}:${JSON.stringify(reduced)}`;
    });
  return `{${pairs.join(",")}}`;
};

/**
 * The content hash a check confirms (ADR 0014, ADR 0019): SHA-256 over the canonical JSON of
 * the frontmatter — trust and identity keys removed, `sources[]` reduced to its ordered
 * `(resource, locator)` pairs — and the normalised body.
 *
 * RFC 8785's canonicalisation is *sorted keys, no insignificant whitespace*, which is what
 * this produces for the one shape a concept's frontmatter can hold: scalars, string lists and
 * `sources[]`'s objects, whose own keys never reach the hash because the reduction replaces
 * them with a pair. The concept's own path is an argument because the reduction resolves a
 * relative `resource` against it.
 */
export const contentHashOf = (frontmatter: Frontmatter, body: string, path: string): string =>
  createHash("sha256")
    .update(`${canonicalFrontmatter(frontmatter, path)}\n${normalisedBody(body)}`, "utf8")
    .digest("hex");

/** One `sources[]` entry as YAML: a block of quoted keys under a list dash. */
const yamlEntry = (entry: FrontmatterSource): string =>
  Object.entries(entry)
    .map(
      ([key, value], index) =>
        `${index === 0 ? "  - " : "    "}${JSON.stringify(key)}: ${JSON.stringify(value)}`,
    )
    .join("\n");

/** One frontmatter value as YAML: a list over lines, everything else as JSON, which YAML reads. */
const yamlValue = (value: FrontmatterValue): string => {
  if (!Array.isArray(value)) return ` ${JSON.stringify(value)}`;
  if (value.length === 0) return " []";
  return `\n${value
    .map((item) =>
      typeof item === "object" && item !== null ? yamlEntry(item) : `  - ${JSON.stringify(item)}`,
    )
    .join("\n")}`;
};

/**
 * The file as it lands in the bundle: YAML frontmatter between `---` fences, then the body.
 * Keys keep the order they were given, because that is the order a person wrote them and
 * the file is the thing a company keeps; the content hash above is what needs an order
 * nobody chose, and it sorts its own.
 *
 * **Every key is quoted**, not only every value. A concept's frontmatter is open — OKF's keys
 * plus whatever else the file carried, preserved verbatim (ADR 0019) — so a key holding a
 * colon, a `#` or a leading `-` would otherwise write YAML that parses as something else.
 * JSON is a subset of YAML 1.2, so quoting is all that is needed and any YAML parser reads
 * the result back, which is what "readable by any OKF tool" (ADR 0012) has to mean for a file
 * this tier writes and the Python tier parses.
 */
export const renderConceptFile = (frontmatter: Frontmatter, body: string): string => {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${JSON.stringify(key)}:${yamlValue(value)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${normalisedBody(body)}`;
};

/** The two roles that may change the bundle: an Editor and an Admin, never a Viewer. */
const mayWrite = (principal: UserPrincipal): boolean => principal.role !== "Viewer";

/**
 * The index row's columns less the commit's sha, which does not exist yet when this parse
 * runs: everything a caller supplies is checked at the boundary **before** the commit, so a
 * row the boundary would refuse never becomes a commit nobody can record. The sha comes from
 * the git door, which answers a git object name or a refusal and nothing else.
 */
const conceptRow = boundarySchemas.conceptIndex.insert.omit({ commitSha: true });

/** The constraints this act refuses over; every other violation stays the store's Error. */
const WRITE_CONSTRAINTS = {
  concept_index_workspace_id_path_uidx: "path-taken",
  concept_identity_merge_key_uidx: "merge-key-taken",
} as const;

/** What the index already holds for this IRI — the facts a re-write keeps or may not move. */
type Held = {
  readonly path: string;
  readonly sensitivity: string;
  readonly status: string;
  /** When it first became readable; kept across a re-write, so publishing happens once. */
  readonly publishedAt: Date | null;
};

type HeldRow = {
  readonly path: string;
  readonly sensitivity: string;
  readonly status: string;
  readonly published_at: Date | null;
};

/**
 * The Principal first, as every function here that reaches tenant data takes it: the
 * workspace this reads in is the one the caller is acting in, and never a string a call site
 * chose (ADR 0029). RLS scopes the statement already; naming the pair says so where a reader
 * of the SQL can see it.
 */
const heldByIri = async (
  principal: UserPrincipal,
  tx: Tx,
  iri: string,
): Promise<Held | undefined> => {
  const found = await tx.query<HeldRow>(
    `SELECT path, sensitivity, status, published_at
       FROM concept_index WHERE workspace_id = $1 AND iri = $2`,
    [principal.workspaceId, iri],
  );
  const row = found.rows[0];
  return row === undefined
    ? undefined
    : {
        path: row.path,
        sensitivity: row.sensitivity,
        status: row.status,
        publishedAt: row.published_at,
      };
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
 * Both are decided by the read this act makes **before it commits**, so a refused re-write
 * leaves no commit at all: a rename that refused after committing would leave a file at a
 * path no row names, and a replay that refuses for ever.
 */
export const writeConcept = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: WriteConceptInput,
): Promise<Result<ConceptWritten, WriteConceptRefusal | Error>> => {
  if (!mayWrite(principal)) return err("role-forbids");

  const contentHash = contentHashOf(input.frontmatter, input.body, input.path);
  // The file carries its own IRI (ADR 0002's platform key), whatever the caller passed.
  const frontmatter = { ...input.frontmatter, iri: input.iri } satisfies Frontmatter;
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
    // The act's first transaction: what the index already holds for this IRI, read under the
    // authority this act will write with. Its refusals cost no commit, which is why the two
    // that are decidable from the concept's own row are made here.
    const existing = await attempt(() =>
      withMembership(principal, doors.postgres, (fresh, tx) => heldByIri(fresh, tx, input.iri)),
    );
    if (!existing.ok) return err(existing.error);
    if (!existing.value.ok) return err(existing.value.error);
    const held = existing.value.value;

    if (held !== undefined && held.path !== input.path) return err("rename-refused");
    if (
      held !== undefined &&
      input.sensitivity !== undefined &&
      input.sensitivity !== held.sensitivity
    ) {
      return err("reclassification-refused");
    }

    // A status the write does not name is the one the concept already holds, exactly as its
    // class is: the draft default is what a concept is *born* at, and applying it to a
    // re-write would un-publish a stable concept nobody asked to un-publish.
    const status = input.status ?? held?.status ?? CONCEPT_DRAFT_STATUS;
    // Everything the rows will hold, parsed at the boundary before anything is committed: a
    // commit whose rows the boundary would refuse is the head-ahead state provoked on
    // purpose, and there is no reason to make one.
    const parsed = conceptRow.safeParse({
      workspaceId: principal.workspaceId,
      iri: input.iri,
      path: input.path,
      kind: foldKind(input.kind),
      title: input.title,
      frontmatter,
      body: input.body,
      contentHash,
      status,
      // Published once and kept: a concept that reaches a readable status carries the instant
      // it first did, and one that leaves those statuses loses it, so the predicate's first
      // arm is a fact about the concept rather than a stamp every write renews.
      publishedAt: PUBLISHED_STATUSES.some((published) => published === status)
        ? (held?.publishedAt ?? new Date())
        : null,
      sensitivity: held?.sensitivity ?? input.sensitivity ?? SENSITIVITY_DEFAULT,
      audience: AUDIENCE_EVERYONE,
    });
    if (!parsed.success) return err("malformed");
    const row = parsed.data;

    const committed = await commitToBundle(principal, doors.git, {
      path: row.path,
      content: renderConceptFile(frontmatter, input.body),
      message: input.message,
      author: input.author,
      trailers: { actor: actorIdOf(principal), audit: auditEventId },
      expectedHead: input.expectedHead,
    });
    if (!committed.ok) return err(committed.error);

    const landed = await attempt(() =>
      // The door re-reads the membership in the transaction that writes, under a shared lock
      // on the row: a revocation landing in the window this act cannot see refuses the rows
      // here, and the commit is left as the reconciler's to find.
      withMembership(principal, doors.postgres, async (fresh, tx) => {
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
        await landRows(fresh, tx, {
          ...row,
          mergeKey: mergeKey.data,
          commit: committed.value,
          actor: actorIdOf(fresh),
          auditEventId,
          evidence: evidence.data,
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
 * Everything the act's transaction writes beside its ledger row: the index row the boundary
 * parsed, and the facts the act itself supplies. The row's columns are named once — by
 * the boundary — rather than restated here and again at the call site.
 */
type Landing = z.infer<typeof conceptRow> & {
  readonly mergeKey: string;
  readonly commit: Committed;
  readonly actor: ActorId;
  readonly auditEventId: string;
  readonly evidence: readonly z.infer<typeof boundarySchemas.evidence.insert>[];
};

/** The rows the act writes, in one place so the order they are written in is one fact. */
const landRows = async (principal: UserPrincipal, tx: Tx, index: Landing): Promise<void> => {
  // The identity first: the index row's composite key points at it, and a merge key that
  // moved is upkeep on the row that already exists rather than a second identity.
  await tx.query(
    `INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, iri) DO UPDATE SET merge_key = EXCLUDED.merge_key`,
    [index.workspaceId, index.iri, index.mergeKey],
  );
  await tx.query(
    `INSERT INTO concept_index (workspace_id, iri, path, kind, title, frontmatter, body,
                                content_hash, commit_sha, status, published_at, sensitivity,
                                audience)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (workspace_id, iri) DO UPDATE
        SET path = EXCLUDED.path, kind = EXCLUDED.kind, title = EXCLUDED.title,
            frontmatter = EXCLUDED.frontmatter, body = EXCLUDED.body,
            content_hash = EXCLUDED.content_hash, commit_sha = EXCLUDED.commit_sha,
            status = EXCLUDED.status, published_at = EXCLUDED.published_at,
            sensitivity = EXCLUDED.sensitivity, audience = EXCLUDED.audience,
            updated_at = now()`,
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
      index.sensitivity,
      index.audience,
    ],
  );
  await tx.query(
    `INSERT INTO bundle_commit (workspace_id, sha, parent_sha, audit_event_id, actor)
     VALUES ($1, $2, $3, $4, $5)`,
    [index.workspaceId, index.commit.sha, index.commit.parent, index.auditEventId, index.actor],
  );
  for (const piece of index.evidence) {
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
  // The bundle-and-record graph delta, last: it resolves link targets against the index
  // this transaction just wrote, and it lands or rolls back with everything above, which
  // is what "the map is never behind for an edit" means (ADR 0023, ADR 0032).
  await writeConceptDelta(principal, tx, {
    iri: index.iri,
    kind: index.kind,
    path: index.path,
    body: index.body,
    frontmatter: index.frontmatter ?? {},
    publishedAt: index.publishedAt ?? null,
    sensitivity: index.sensitivity,
    audience: index.audience,
    status: index.status,
  });
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
    tx.query<ConceptRow>(
      `SELECT c.iri, c.path, c.kind, c.title, c.frontmatter, c.body, c.status,
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
        WHERE c.iri = $1 AND ${readableClause("c", 2)}`,
      [iri, readableParameter(principal)],
    ),
  );
  if (!found.ok) return err(found.error);
  const row = found.value.rows[0];
  if (row === undefined) return ok(undefined);

  return ok({
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
