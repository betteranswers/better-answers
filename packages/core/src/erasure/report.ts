import type { ErasureFamily, ErasureMap } from "./map.ts";
import type { SubjectRequest } from "./requests.ts";

/**
 * The **erasure report** (ADR 0020, the amendments of 2026-08-28 and 2026-08-30; the S0 spec,
 * the routine's step 9): the document the routine's last step writes onto the request beside
 * `completed_at`, and the one a subject or a regulator reads.
 *
 * **A pure function, and deliberately a starved one.** It reaches no store, takes no
 * Principal and reads no clock: everything it says, it says from the request's id, the row
 * the routine wrote, the record of what each store family did and the map of where the person
 * was held. That is what lets the fixed wording be held to a literal in a test from the first
 * iteration onward, before any store act exists to write about — and what lets the later
 * steps grow the document by filling `actions` rather than by rewriting this.
 *
 * **What it is not given.** Not the subject request's identifier set, and not the erasure
 * pseudonym. The set is the emails and names the person wrote down, and a report cannot print
 * what it was never handed; the pseudonym is the id two workspaces' rewritten histories would
 * be joined on if anyone ever held both (ADR 0035), and a document that named it would be
 * that join, written down and handed out.
 *
 * **The anchor.** Both fixed paragraphs date themselves from one instant, and the report says
 * which instant that is. Today it is the moment the routine took the erasure lock: the last
 * dump necessarily precedes it, so every date computed from it is the latest a copy can
 * expire rather than the exact day. When O1 lands `backup_run`, the anchor becomes the last
 * dump's stamp and the dates become exact — and a reader of an old report has to be able to
 * tell which of the two they are holding, which is why the sentence is in the document and
 * not only in this comment.
 */

/**
 * What one store family's line in `actions` holds: a flat object of words, counts and flags.
 * Flat because this is the record of what was done about a person and a nested shape would be
 * somewhere a name could sit unseen — the same reason the ledger's detail is flat.
 */
export type ErasureAction = Readonly<Record<string, string | number | boolean | null>>;

/**
 * The routine's record of what each store family did, keyed by the **erasure map's own union**
 * rather than by a second list of family words — so a family added to the map is a family this
 * record and this report already know how to carry, and a step that forgets to write its line
 * shows up as a family with nothing recorded rather than as a family nobody can see.
 */
export type ErasureActions = Readonly<Partial<Record<ErasureFamily, ErasureAction>>>;

/** The columns of the erasure request the report quotes: the anchor and the four dates it fixed. */
export type ErasureRecord = {
  readonly id: string;
  readonly anchoredAt: Date;
  readonly beyondUseHourlyAt: Date;
  readonly beyondUseDailyAt: Date;
  readonly beyondUseWeeklyAt: Date;
  readonly beyondUseMonthlyAt: Date;
};

export type ErasureReportInput = {
  /** The request being answered — its id alone, for the reason the docblock above gives. */
  readonly request: Pick<SubjectRequest, "id">;
  readonly erasure: ErasureRecord;
  readonly actions: ErasureActions;
  readonly map: ErasureMap;
  /**
   * The concepts whose body names this person, by IRI: the map's concept-file locations
   * resolved to the identities an owner opens to edit, because a path at a commit is not
   * something anybody can act on and an IRI is.
   */
  readonly concepts: readonly string[];
};

/** Every instant in this document is written the one unambiguous way a regulator can read. */
const stamped = (at: Date): string => at.toISOString();

/**
 * ADR 0020's amendment of 2026-08-30, in place of any wording implying total erasure. Written
 * in fragments so the file stays readable; the sentence it makes is the ADR's, word for word.
 */
const rewritten = (anchor: string): string =>
  "Every actor identifier for this person has been rewritten across the repository's history, " +
  "the index, the evidence and the map, and in the backup copies listed below. Names this " +
  "person wrote or that were written about them inside concept bodies are listed for the " +
  "owner to edit; an edit is a new commit and does not remove the name from earlier commits, " +
  `from copies already exported, or from backup copies taken before ${anchor}.`;

/**
 * ADR 0020's backups amendment of 2026-08-28, which `docs/operations/BACKUPS.md` quotes in its
 * retention schedule. The last clause is the one that makes *beyond use* honest, and it names
 * a thing the platform actually does: `replay-erasures --since` runs before `api` turns healthy.
 */
const beyondUse = (anchor: string, erasure: ErasureRecord): string =>
  `Backup copies taken before ${anchor} are beyond use: restored only in a disaster, ` +
  "encrypted at rest, deletable only by the escrowed credential, expiring on " +
  `${stamped(erasure.beyondUseHourlyAt)} · ${stamped(erasure.beyondUseDailyAt)} · ` +
  `${stamped(erasure.beyondUseWeeklyAt)} · ${stamped(erasure.beyondUseMonthlyAt)}. ` +
  "Should a restore from such a copy occur, this request is re-applied before the platform " +
  "serves reads.";

/** Which of the two anchors the dates above were computed from, so the two are never confused. */
const ANCHOR_NAMED =
  "The anchor above is the instant this routine took the erasure lock, not the stamp of the " +
  "last dump before it: no backup run is recorded, so the last dump precedes the anchor and " +
  "every date above is the latest a copy can expire.";

/** Step 8, said in the document: a document that mentions a person is narrowed, never removed. */
const OBJECT_STORE_UNTOUCHED =
  "The object store is untouched: a company document that mentions a person is suppressed " +
  "when it is next reprocessed, never deleted.";

/**
 * The other thing a rewrite cannot reach. Written as a standing sentence with its count rather
 * than left out, because "no export was recalled" and "no export exists" are different facts
 * and the day the second stops being true the first still has to be said.
 */
const EXPORTS_NOT_RECALLED = "Exports already issued are not recalled. None have been issued.";

/** No concept body names the person — said plainly, because an empty heading reads as an omission. */
const NO_CONCEPT_NAMES = "None: no concept body names this person.";

/**
 * One family's line, from whatever that family's step recorded. The fields are sorted by name
 * so the document reads the same however a step happened to build its object, and a family no
 * step has written a line for says so rather than being left out of the list.
 */
const wordsFor = (action: ErasureAction | undefined): string => {
  const fields = Object.entries(action ?? {});
  if (fields.length === 0) return "nothing recorded";
  return fields
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([field, value]) => `${field} ${String(value)}`)
    .join(", ");
};

/**
 * The report, from the routine's own record of what it found and did. Every later step of the
 * routine reaches this document by writing its family's line into `actions`; none of them
 * changes this function.
 */
export const erasureReportOf = (input: ErasureReportInput): string => {
  const anchor = stamped(input.erasure.anchoredAt);
  const named =
    input.concepts.length === 0
      ? [NO_CONCEPT_NAMES]
      : [...input.concepts].sort().map((iri) => `- ${iri}`);
  return [
    `Erasure report for subject request ${input.request.id}.`,
    "",
    rewritten(anchor),
    "",
    beyondUse(anchor, input.erasure),
    "",
    ANCHOR_NAMED,
    "",
    "Names inside concept bodies, for the owner to edit:",
    ...named,
    "",
    "Where this person was held, and what the routine did:",
    ...input.map.map((entry) => `- ${entry.family}: ${wordsFor(input.actions[entry.family])}`),
    "",
    OBJECT_STORE_UNTOUCHED,
    "",
    EXPORTS_NOT_RECALLED,
    "",
  ].join("\n");
};
