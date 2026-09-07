import { createHash } from "node:crypto";

import {
  AUDIENCE_EVERYONE,
  boundarySchemas,
  citedSourceOf,
  CONCEPT_DRAFT_STATUS,
  conceptIriOf,
  IRI,
  PUBLISHED_STATUSES,
  resolvedResource,
  SENSITIVITY_DEFAULT,
  SUGGESTION_ACCEPTED_STATUS,
  SUGGESTION_EDIT_KIND,
  SUGGESTION_REPAIR_KIND,
  SUGGESTION_SET_MAX,
  SUGGESTION_WAITING_STATUS,
  ULID,
  VERIFICATION_REPAIR_ORIGIN,
} from "@better-answers/schema";
import { z } from "zod";

import { readableClause, readableParameters } from "../access/index.ts";
import { act, declareActs, eventsOfAct, record } from "../audit/index.ts";
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
  type PlatformPrincipal,
  type Principal,
  type PrincipalRefusal,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
  type WorkspaceId,
} from "../kernel/index.ts";
import {
  commit as commitToBundle,
  commitsAfter,
  head,
  readCommit,
  withRepositoryLock,
  withRepositoryLockAs,
  type CommitAuthor,
  type CommitRead,
  type CommitRefusal,
  type Committed,
  type GitDoor,
} from "../store/git/index.ts";
import { writeConceptDelta } from "../store/graph/index.ts";
import { withMembership, withScope, type PostgresDoor, type Tx } from "../store/postgres/index.ts";
import { workspaceIds } from "../workspaces/index.ts";
import {
  markDeciding,
  payloadFor,
  returnToProposer,
  suggestionIsWaiting,
  targetOfMergeKey,
  type SuggestionKind,
  type SuggestionPayload,
} from "./inbox.ts";

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
 * the same transaction as the rows.
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
 * IRI. `rename-refused` and `reclassification-refused` are the two moves this act never
 * makes, and `no-such-concept` is a write naming an IRI this workspace never minted, which
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
  | "no-such-concept"
  | "already-decided"
  | "resolution-moved";

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

/** One line of the frontmatter as the renderer writes it: a JSON-quoted key, a colon, then a value or nothing. */
const FRONTMATTER_LINE = /^("(?:[^"\\]|\\.)*"):(?: (.*))?$/;

/** A JSON text read as one scalar the frontmatter may hold, or nothing for anything else. */
const scalarOf = (text: string): string | number | boolean | null | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
      ? value
      : undefined;
  } catch {
    // Text that is not JSON is a line the renderer never wrote, and "no scalar" is the
    // whole of what a caller needs to know about it — the parse below answers `malformed`.
    return undefined;
  }
};

/** A frontmatter line split into its key and what follows the colon — `undefined` when a list follows. */
const pairOf = (
  line: string,
): { readonly key: string; readonly rest: string | undefined } | undefined => {
  const match = FRONTMATTER_LINE.exec(line);
  const key = match?.[1] === undefined ? undefined : scalarOf(match[1]);
  return match === null || typeof key !== "string" ? undefined : { key, rest: match[2] };
};

/**
 * The items of one list, from the line after its key: `  - ` opens an item, and an entry's
 * later fields sit indented beneath it. A list is strings or OKF's objects and never a mix —
 * the renderer writes no other shape, so a mix is a file it did not write.
 */
const listItemsOf = (
  lines: readonly string[],
  from: number,
  close: number,
):
  | { readonly value: readonly string[] | readonly FrontmatterSource[]; readonly next: number }
  | undefined => {
  const strings: string[] = [];
  const entries: FrontmatterSource[] = [];
  let at = from;
  while (at < close && (lines[at] ?? "").startsWith("  - ")) {
    const opener = (lines[at] ?? "").slice(4);
    at += 1;
    let field = pairOf(opener);
    if (field === undefined) {
      const item = scalarOf(opener);
      if (typeof item !== "string") return undefined;
      strings.push(item);
      continue;
    }
    const entry: Record<string, string | number | boolean | null> = {};
    while (field !== undefined) {
      const value = field.rest === undefined ? undefined : scalarOf(field.rest);
      if (value === undefined) return undefined;
      entry[field.key] = value;
      const continuation = lines[at] ?? "";
      if (at >= close || !continuation.startsWith("    ")) break;
      field = pairOf(continuation.slice(4));
      if (field === undefined) return undefined;
      at += 1;
    }
    entries.push(entry);
  }
  if (strings.length > 0 && entries.length > 0) return undefined;
  return { value: entries.length > 0 ? entries : strings, next: at };
};

/**
 * The file read back — `renderConceptFile`'s inverse, and deliberately no more than that.
 *
 * The bundle is written only by the app, one commit per act (ADR 0012), so every file on
 * the ref was rendered by the function above and this reads exactly that grammar: quoted
 * keys, JSON values, OKF's one list of objects. A general YAML reader would accept files
 * the platform never wrote and read some of them differently from the Python tier, whose
 * parser the nightly audit cross-checks against this one hash by hash (T-057). What the
 * grammar does not cover answers `malformed`, and the reconciler stops at such a commit
 * rather than guessing what it meant.
 *
 * The body comes back as the renderer normalised it — one trailing newline — which is what
 * the content hash is over either way (`contentHashOf`).
 */
export const parseConceptFile = (
  content: string,
): Result<{ readonly frontmatter: Frontmatter; readonly body: string }, "malformed"> => {
  const lines = content.split("\n");
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (close === -1 || lines[close + 1] !== "") return err("malformed");
  const frontmatter: Record<string, FrontmatterValue> = {};
  let at = 1;
  while (at < close) {
    const pair = pairOf(lines[at] ?? "");
    if (pair === undefined) return err("malformed");
    at += 1;
    if (pair.rest !== undefined) {
      const value = pair.rest === "[]" ? [] : scalarOf(pair.rest);
      if (value === undefined) return err("malformed");
      frontmatter[pair.key] = value;
      continue;
    }
    const items = listItemsOf(lines, at, close);
    if (items === undefined) return err("malformed");
    frontmatter[pair.key] = items.value;
    at = items.next;
  }
  return ok({ frontmatter, body: lines.slice(close + 2).join("\n") });
};

/** The two roles that may change the bundle: an Editor and an Admin, never a Viewer. */
const mayWrite = (principal: UserPrincipal): boolean => principal.role !== "Viewer";

/**
 * The file's frontmatter as the act writes it: what the caller gave, the `type` the act
 * was told where the file names none, the `status` it names, and the IRI the platform
 * minted — OKF's own keys and ADR 0002's one platform key, nothing else. The row is built
 * from the same facts, so the file says what the row says: the bundle is the truth and the
 * row is derived from it (ADR 0012), and the reconciler's replay of this commit reads
 * these three back off the file rather than off a row that was lost. A caller's own
 * `type` and `status` keys stand as written (ADR 0019 keeps every key verbatim).
 */
const fileFrontmatterOf = (input: WriteConceptInput, iri: string) => {
  const named = { ...input.frontmatter };
  if (typeof named["type"] !== "string") named["type"] = input.kind;
  if (input.status !== undefined) named["status"] = input.status;
  named["iri"] = iri;
  return named;
};

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

/**
 * What the index already holds for this IRI — the facts a re-write keeps or may not move,
 * and the three a replayed commit falls back on when its file does not carry them.
 */
type Held = {
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly mergeKey: string;
  readonly sensitivity: string;
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
 */
const heldByIri = async (principal: Principal, tx: Tx, iri: string): Promise<Held | undefined> => {
  const found = await tx.query<HeldRow>(
    `SELECT c.path, c.kind, c.title, i.merge_key, c.sensitivity, c.status, c.content_hash,
            c.published_at
       FROM concept_index c
       JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
      WHERE c.workspace_id = COALESCE($1::text, (select current_workspace_id())) AND c.iri = $2`,
    [principal.kind === "user" ? principal.workspaceId : null, iri],
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
        status: row.status,
        contentHash: row.content_hash,
        publishedAt: row.published_at,
      };
};

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
 * A status the write does not name is the one the concept already holds, exactly as its
 * class is: the draft default is what a concept is *born* at, and applying it to a re-write
 * would un-publish a stable concept nobody asked to un-publish. Published once and kept: a
 * concept that reaches a readable status carries the instant it first did, and one that
 * leaves those statuses loses it, so the predicate's first arm is a fact about the concept
 * rather than a stamp every write renews.
 */
const indexRowOf = (facts: RowFacts, held: Held | undefined) => {
  const status = facts.status ?? held?.status ?? CONCEPT_DRAFT_STATUS;
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
      ? (held?.publishedAt ?? new Date())
      : null,
    sensitivity: held?.sensitivity ?? facts.sensitivity ?? SENSITIVITY_DEFAULT,
    audience: AUDIENCE_EVERYONE,
  });
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

  const contentHash = contentHashOf(input.frontmatter, input.body, input.path);
  // A write that names no concept is a creation, and mints the one form an IRI has
  // (ADR 0002); one that names a concept is held below to a concept that already exists.
  const iri = input.iri ?? conceptIriOf(ulid());
  const frontmatter = fileFrontmatterOf(input, iri);
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
      withMembership(principal, doors.postgres, async (fresh, tx) => ({
        held: await heldByIri(fresh, tx, iri),
        // The merge key's resolution, read here rather than beside the act, so an
        // acceptance resolves identity *at acceptance* and inside the lock that holds it.
        resolved: await targetOfMergeKey(fresh, tx, input.mergeKey),
        waiting:
          input.acceptance === undefined ||
          (await suggestionIsWaiting(fresh, tx, input.acceptance.suggestionId)),
      })),
    );
    if (!existing.ok) return err(existing.error);
    if (!existing.value.ok) return err(existing.value.error);
    const { held, resolved, waiting } = existing.value.value;

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
  /** The suggestion this act decided, when it was an acceptance; absent otherwise. */
  readonly acceptance: Acceptance | undefined;
};

/**
 * The rows the act writes, in one place so the order they are written in is one fact — and
 * the one landing routine: the reconciler's replay lands through this too, under the platform
 * principal, which is why the Principal is either kind.
 */
const landRows = async (principal: Principal, tx: Tx, index: Landing): Promise<void> => {
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
  // The bundle-and-record graph delta, last of the bundle's rows: it resolves link targets
  // against the index this transaction just wrote, and it lands or rolls back with
  // everything above — which is what "the map is never behind for an edit" means (ADR 0023,
  // ADR 0032). An acceptance writes it too: the decision below is one act with these rows.
  await writeConceptDelta(principal, tx, {
    workspaceId: index.workspaceId,
    iri: index.iri,
    kind: index.kind,
    path: index.path,
    body: index.body,
    frontmatter: index.frontmatter ?? {},
    publishedAt: index.publishedAt ?? null,
    sensitivity: index.sensitivity,
    audience: index.audience,
    // The derivation (T-055, `visibility.ts`) is what will decide the pair from the bindings
    // of the cited evidence; until it lands here every write is for everyone.
    audienceGroups: null,
    status: index.status,
  });
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
      [iri, ...readableParameters(principal)],
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

/**
 * **The reconciler** (ADR 0012's 2026-09-06 amendment; T-006 spec, *The reconciler*). The
 * window between a governed write's commit and its rows — step 4 to step 5 above — is the
 * one place the platform can die with the bundle ahead of what Postgres knows, and this is
 * the defined action for it: find the repository head ahead of the last `bundle_commit`,
 * and replay the missed commits **in order, oldest first, through the same handler the live
 * write uses** — `indexRowOf` builds the row and `landRows` lands it, exactly as they do for
 * the live act — idempotent on the ids the trailers carry.
 *
 * It runs under the platform's own principal, `process:better-answers-reconciler`, and its
 * acts are audited under that identity and never a person's. What a replay lands is
 * **recovery, not re-authorization**: the act was authorised when its commit was made — an
 * acceptance's Admin gate and its `{base}` precondition were both read before that commit
 * existed — so the replay carries that context in the commit itself (the `Actor:` trailer
 * names who acted, `Suggestion:` says it was an acceptance) rather than judging a role it
 * does not hold. A revocation that landed inside the window changes nothing about this:
 * authorization is judged at time-of-act, and unwanted content is undone forward.
 */

/** The reconciler's actor id — the platform principal's one form (`CONTEXT.md`, *actor id*). */
const RECONCILER_ACTOR = "process:better-answers-reconciler";

/**
 * The reconciler's principal, narrowed to its own actor: the type is what holds "under
 * `process:better-answers-reconciler`" at compile time, so no other platform act can replay
 * a bundle under its own name. `AdminUserPrincipal` is the same shape for a role.
 */
export type ReconcilerPrincipal = PlatformPrincipal & {
  readonly actorId: typeof RECONCILER_ACTOR;
};

export const RECONCILER: ReconcilerPrincipal = { kind: "platform", actorId: RECONCILER_ACTOR };

/**
 * The reconciler's one act on the ledger. Its row takes the **commit's own `Audit:` id**, so
 * `bundle_commit.audit_event_id` joins the ledger on one id whichever road landed the rows
 * (ADR 0014 rule 4) — the person's act live, the reconciler's replay after a crash — and the
 * subject is the commit replayed. The detail says what the commit put in the bundle; who
 * acted is on the commit and on `bundle_commit.actor`, as the `Actor:` trailer wrote it.
 *
 * *Reconciler hits* are a query over these rows (ADR 0025) and never a counter.
 */
const RECONCILER_ACTS = declareActs("platform", {
  replayed: act("platform.reconciler.replayed", {
    iri: "iri",
    commitSha: "gitSha",
    contentHash: "contentHash",
  }),
});

/**
 * Why one commit could not be replayed. `unreadable-commit` is a commit the governed write
 * did not make — no `Actor:` or `Audit:` trailer, no single concept file, a file outside the
 * renderer's grammar, or a creation whose file names no `type` or `title`. The other two are
 * the index refusing the rows the commit would need, which is what a commit the live act
 * could not record either looks like on replay.
 */
export type ReplayRefusal = "unreadable-commit" | "path-taken" | "merge-key-taken";

export type Reconciled = {
  readonly workspaceId: string;
  /** The bundle's head as the run found it; `null` for a bundle with no commits. */
  readonly head: string | null;
  /** The last commit the rows knew before the run; `null` when they knew none. */
  readonly watermark: string | null;
  /** The commits this run landed, oldest first. */
  readonly replayed: readonly string[];
  /** The commits whose trailer id already had its rows: already landed, left as they were. */
  readonly skipped: readonly string[];
  /**
   * The commit the run stopped at and why, when the rows did not catch up with the head.
   * Every commit before it landed; nothing after it was attempted, because each commit's
   * row names its parent's and the prefix invariant is what the replay preserves.
   */
  readonly stopped: { readonly sha: string; readonly reason: ReplayRefusal | Error } | undefined;
};

/**
 * Why a run refused as a whole. `history-diverged` is the recorded history not being a
 * prefix of the bundle's — a database and a repository that disagree about the past, which
 * no replay makes right and a person has to look at; `no-such-repository` is a workspace
 * whose bundle is not on disk, which on a restore means the repository store was not.
 */
export type ReconcileRefusal = "malformed" | "no-such-repository" | "history-diverged";

/** What one replayed commit came to: landed, or already there. */
type Replayed = "landed" | "skipped";

/** The facts a replay reads off one commit: who acted, the ledger id, the file, its identity. */
type CommitFacts = {
  readonly sha: string;
  readonly parent: string | null;
  readonly actor: ActorId;
  readonly auditEventId: string;
  readonly suggestionId: string | undefined;
  readonly path: string;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly iri: string;
};

/**
 * A commit as the governed write made it, or nothing: the two trailers every act carries
 * in the kernel's and the minter's shapes, one concept file, and the IRI the file carries —
 * the one identity a commit does carry (ADR 0002), read off the file rather than minted.
 */
const factsOf = (read: CommitRead): CommitFacts | undefined => {
  const actor = read.trailers["Actor"];
  const audit = read.trailers["Audit"];
  if (actor === undefined || !isActorId(actor) || audit === undefined || !ULID.test(audit)) {
    return undefined;
  }
  if (read.change === undefined) return undefined;
  const parsed = parseConceptFile(read.change.content);
  if (!parsed.ok) return undefined;
  const iri = parsed.value.frontmatter["iri"];
  if (typeof iri !== "string" || !IRI.test(iri)) return undefined;
  return {
    sha: read.sha,
    parent: read.parent,
    actor,
    auditEventId: audit,
    suggestionId: read.trailers["Suggestion"],
    path: read.change.path,
    frontmatter: parsed.value.frontmatter,
    body: parsed.value.body,
    iri,
  };
};

/** A frontmatter key's value when it is a string, as `type`, `title` and `status` are. */
const stringIn = (frontmatter: Frontmatter, key: string): string | undefined => {
  const value = frontmatter[key];
  return typeof value === "string" ? value : undefined;
};

/**
 * The merge key for a replayed creation that carries none. A person's own write names its
 * merge key to the act and nowhere else — it is a row's fact and the commit does not carry
 * it — so a lost creation gets ADR 0003's derivation, the kind and the normalised label:
 * what a producer means by "this concept" when it has no IRI. A derived key another concept
 * already holds falls back to the IRI itself, which is unique by construction: the restore
 * path lands rather than stopping on two concepts sharing a title.
 */
const derivedMergeKey = async (
  platform: PlatformPrincipal,
  tx: Tx,
  iri: string,
  kind: string,
  title: string,
): Promise<string> => {
  const derived = `${kind}:${title.trim().replaceAll(/\s+/g, " ").toLowerCase()}`;
  const holder = await targetOfMergeKey(platform, tx, derived);
  return holder === undefined || holder === iri ? derived : iri;
};

/** The last commit the rows know about, or nothing — the watermark the scan starts after. */
const lastRecordedCommit = async (tx: Tx, workspaceId: string): Promise<string | null> => {
  const found = await tx.query<{ sha: string }>(
    "SELECT sha FROM bundle_commit WHERE workspace_id = $1 ORDER BY committed_at DESC, sha DESC LIMIT 1",
    [workspaceId],
  );
  return found.rows[0]?.sha ?? null;
};

/**
 * One commit replayed: read back, its rows built as the live act builds them, and landed in
 * one transaction under the platform's scope — the ledger row first, as every act in this
 * slice writes it, so the fail-together proof provokes its failure after the row exists.
 *
 * **Idempotent on the trailer id.** A commit whose `Audit:` id — or whose sha — already has
 * its `bundle_commit` row is already landed: skipped, never re-written and never an error,
 * which is what lets the periodic check and the restore path run as often as they like.
 * The unique index over `(workspace_id, audit_event_id)` holds the same rule for anything
 * that got past this read.
 *
 * What the commit carries is what the replay lands, and what it does not carry it recovers
 * as fail-closed as the live act would: the class is the concept's own where it exists and
 * the most restrictive of the three otherwise (a widening is an Admin's recorded act, never a
 * recovery's guess); the status and kind are the file's, or the concept's; evidence rows
 * are not recovered, because the file's `sources[]` is a projection and the document id is
 * not in it. An acceptance — the `Suggestion:` trailer — decides its suggestion through the
 * same rows and the same marker as the live act, from the payload the decision was made
 * from; a suggestion decided in the meantime has no payload left to read, and the commit
 * lands as the commit it is, its decision left with whoever made it.
 */
const replayCommit = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  workspaceId: WorkspaceId,
  sha: string,
  batchId: string | undefined,
): Promise<Result<Replayed, ReplayRefusal | Error>> => {
  const read = await attempt(() => readCommit(platform, doors.git, workspaceId, sha));
  if (!read.ok) return err(read.error);
  const facts = factsOf(read.value);
  if (facts === undefined) return err("unreadable-commit");

  const landed = await attempt(() =>
    withScope(
      platform,
      doors.postgres,
      workspaceId,
      async (tx): Promise<Result<Replayed, ReplayRefusal>> => {
        const known = await tx.query(
          "SELECT 1 FROM bundle_commit WHERE workspace_id = $1 AND (sha = $2 OR audit_event_id = $3)",
          [workspaceId, facts.sha, facts.auditEventId],
        );
        if ((known.rowCount ?? 0) > 0) return ok("skipped");

        const held = await heldByIri(platform, tx, facts.iri);
        const payload =
          facts.suggestionId === undefined
            ? undefined
            : await payloadFor(platform, tx, facts.suggestionId);
        const acceptance: Acceptance | undefined =
          facts.suggestionId === undefined || payload === undefined
            ? undefined
            : { suggestionId: facts.suggestionId, setId: payload.setId, kind: payload.kind };
        const kind = stringIn(facts.frontmatter, "type") ?? held?.kind;
        const title = stringIn(facts.frontmatter, "title") ?? held?.title;
        if (kind === undefined || title === undefined) return err("unreadable-commit");
        const contentHash = contentHashOf(facts.frontmatter, facts.body, facts.path);
        const parsed = indexRowOf(
          {
            workspaceId,
            iri: facts.iri,
            path: facts.path,
            kind,
            title,
            frontmatter: facts.frontmatter,
            body: facts.body,
            contentHash,
            status: stringIn(facts.frontmatter, "status"),
            sensitivity: undefined,
          },
          held,
        );
        if (!parsed.success) return err("unreadable-commit");
        const row = parsed.data;
        const mergeKey =
          payload?.mergeKey ??
          held?.mergeKey ??
          (await derivedMergeKey(platform, tx, row.iri, row.kind, row.title));

        // The door is called bare (ADR 0014 rule 4): its rejection aborts this transaction.
        await record(platform, tx, {
          id: facts.auditEventId,
          act: RECONCILER_ACTS.replayed,
          subjectId: facts.sha,
          batchId,
          detail: { iri: row.iri, commitSha: facts.sha, contentHash },
        });
        await landRows(platform, tx, {
          ...row,
          mergeKey,
          commit: { sha: facts.sha, parent: facts.parent },
          actor: facts.actor,
          auditEventId: facts.auditEventId,
          evidence: [],
          acceptance,
        });
        return ok("landed");
      },
    ),
  );
  if (!landed.ok) {
    const named = refusalFor(landed.error, WRITE_CONSTRAINTS);
    return err(typeof named === "string" ? named : landed.error);
  }
  return landed.value;
};

/**
 * Reconcile one workspace's bundle with its rows: the defined action, on demand. The
 * periodic head check in the api process calls this for every workspace, and
 * `pnpm ops reconcile-watermark` calls it for one — the restore path, when a database has
 * been restored from a dump and the repository is ahead of it.
 *
 * **Under the per-repository lock**, held from the watermark read through the last commit's
 * landing: a live write waits behind a replay and a replay behind a live write, so the
 * prefix invariant holds through both, and a second run of this function on the same
 * bundle waits rather than replaying beside the first. A run that finds nothing missed
 * costs one read of `bundle_commit` and one of the ref.
 *
 * A run stops at the first commit it cannot land and says which; everything before it has
 * landed, each in its own transaction, and a later run picks up where this one stopped
 * once whatever stopped it has been put right. A bulk replay's ledger rows share one batch
 * id (ADR 0014 rule 4).
 */
export const reconcile = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: { readonly workspaceId: string },
): Promise<Result<Reconciled, ReconcileRefusal | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const workspaceId = workspace.data;

  return withRepositoryLockAs(platform, doors.git, workspaceId, async () => {
    const watermark = await attempt(() =>
      withScope(platform, doors.postgres, workspaceId, (tx) => lastRecordedCommit(tx, workspaceId)),
    );
    if (!watermark.ok) return err(watermark.error);
    const scanned = await commitsAfter(platform, doors.git, workspaceId, watermark.value);
    if (!scanned.ok) return err(scanned.error);

    const batchId = scanned.value.missed.length > 1 ? ulid() : undefined;
    const replayed: string[] = [];
    const skipped: string[] = [];
    let stopped: Reconciled["stopped"];
    for (const sha of scanned.value.missed) {
      const outcome = await replayCommit(platform, doors, workspaceId, sha, batchId);
      if (!outcome.ok) {
        stopped = { sha, reason: outcome.error };
        break;
      }
      (outcome.value === "landed" ? replayed : skipped).push(sha);
    }
    return ok({
      workspaceId,
      head: scanned.value.head,
      watermark: watermark.value,
      replayed,
      skipped,
      stopped,
    });
  });
};

/** One reconciler hit: a commit the replay landed, as its ledger row records it. */
export type ReconcilerHit = {
  readonly commitSha: string;
  /** The commit's `Audit:` id — the row's id, and `bundle_commit.audit_event_id`. */
  readonly auditEventId: string;
  readonly at: Date;
  /** The batch a bulk replay's rows share; `null` for a run that landed one commit. */
  readonly batchId: string | null;
};

/**
 * *Reconciler hits* — the signal ADR 0012 names, in the sense ADR 0025 gives the word: a
 * query over rows the platform already keeps, never a counter. The rows are the
 * `platform.reconciler.replayed` events the replay writes, one per commit landed, oldest
 * first, from an instant when the caller names one. The api's head check writes nothing
 * else about a hit, so the ledger is the whole record and this read is the whole signal.
 */
export const reconcilerHits = async (
  platform: PlatformPrincipal,
  door: PostgresDoor,
  input: { readonly workspaceId: string; readonly since?: Date | undefined },
): Promise<Result<readonly ReconcilerHit[], "malformed" | Error>> => {
  const workspace = boundarySchemas.workspace.select.shape.id.safeParse(input.workspaceId);
  if (!workspace.success) return err("malformed");
  const read = await attempt(() =>
    withScope(platform, door, workspace.data, (tx) =>
      eventsOfAct(platform, tx, RECONCILER_ACTS.replayed, input.since),
    ),
  );
  if (!read.ok) return err(read.error);
  return ok(
    read.value.map((row) => ({
      commitSha: row.subjectId,
      auditEventId: row.id,
      at: row.at,
      batchId: row.batchId,
    })),
  );
};

/** One workspace's outcome of a run over every workspace. */
export type WorkspaceReconciled = {
  readonly workspaceId: string;
  readonly outcome: Result<Reconciled, ReconcileRefusal | Error>;
};

/**
 * The periodic head check's whole pass: every workspace the platform holds, reconciled one
 * after the other. One bundle's refusal is that bundle's fact and never a reason to leave
 * the others behind, so each carries its own `Result`, as a bulk acceptance's items do.
 */
export const reconcileEveryWorkspace = async (
  platform: ReconcilerPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
): Promise<Result<readonly WorkspaceReconciled[], Error>> => {
  const held = await workspaceIds(platform, doors.postgres);
  if (!held.ok) return err(held.error);
  const outcomes: WorkspaceReconciled[] = [];
  for (const workspaceId of held.value) {
    outcomes.push({ workspaceId, outcome: await reconcile(platform, doors, { workspaceId }) });
  }
  return ok(outcomes);
};
