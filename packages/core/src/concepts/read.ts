import {
  citedSourceOf,
  ids,
  MAP_EDGE_LABELS,
  ULID_CHARACTERS,
  type ConceptIri,
} from "@better-answers/schema";
import { CONCEPT_IRI_PREFIX } from "@better-answers/schema/concept-file";

import { readableClause, readableParameters } from "../access/index.ts";
import {
  attempt,
  err,
  isActorId,
  NOT_FOUND,
  ok,
  type ActorId,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { Frontmatter, FrontmatterSource } from "./file.ts";

/** One `sources` entry as a reader sees it: the file's label, and what opens it, when anything does. */
type EvidenceItem = {
  readonly id?: string;
  readonly source: string;

  /** The file's own place in the source, such as `p.4`, which opens nothing. */
  readonly at?: string;
  readonly locator?: string;
  readonly iri?: ConceptIri;
};

export type EvidencePane = {
  readonly access: "included" | "partly-included" | "not-included";

  readonly lead: string;

  readonly evidence: readonly EvidenceItem[];

  readonly sharedBeyondEvidence: { readonly by: ActorId; readonly at: Date } | undefined;

  readonly next: string;
};

export type Relation = {
  readonly kind: string;
  readonly target: ConceptIri;
  readonly title: string;
};

/** Reads the passage at a locator for the reader; `not-found` when they cannot, whatever the reason. */
export type PassageReader = (locator: string) => Promise<Result<unknown, typeof NOT_FOUND | Error>>;

/** Whether a locator has a passage address's shape, so a page reference is never read as withheld. */
export type PassageNamer = (locator: string) => boolean;

/** The override that let this reader see the concept, when one is recorded. */
type Sharer = { readonly actor: string; readonly at: Date } | undefined;

const PANE_COPY = {
  nothingCited: "This concept cites no source, so there is nothing to include.",
  nothingToOpen: "This concept names its sources, but none of them has a passage to open.",
  included: "Based on your current access, the evidence is included.",
  partlyIncluded: "Based on your current access, some of the evidence isn't included.",
  notIncluded: "Based on your current access, the evidence isn't included.",
  sharedBeyondEvidence: "An Admin shared this concept beyond its evidence.",
  nextWhenIncluded: "Open a source to read the passage the concept rests on.",
  nextWhenWithheld: "Ask an Admin for access to the sources, or read the concept as it stands.",
  nextWhenNothingCited: "Read the concept as it stands.",
} as const;

const PANE_WORDS = {
  "nothing-cited": { lead: PANE_COPY.nothingCited, next: PANE_COPY.nextWhenNothingCited },
  "nothing-to-open": { lead: PANE_COPY.nothingToOpen, next: PANE_COPY.nextWhenNothingCited },
  included: { lead: PANE_COPY.included, next: PANE_COPY.nextWhenIncluded },
  "partly-included": { lead: PANE_COPY.partlyIncluded, next: PANE_COPY.nextWhenWithheld },
  "not-included": { lead: PANE_COPY.notIncluded, next: PANE_COPY.nextWhenWithheld },
} as const satisfies Record<
  EvidencePane["access"] | "nothing-cited" | "nothing-to-open",
  { readonly lead: string; readonly next: string }
>;

type SourceEntry = string | FrontmatterSource;

/** `points` is whether the file names a passage or a concept for it; `opens`, whether this reader may. */
type Resolved = {
  readonly entry: SourceEntry;
  readonly item: EvidenceItem;
  readonly points: boolean;
  readonly opens: boolean;
};

type Doors = {
  readonly principal: UserPrincipal;
  readonly tx: Tx;
  readonly passageAt: PassageReader;
  readonly namesPassage: PassageNamer;
};

const READABLE_CONCEPT = `SELECT 1 FROM concept_index c
  WHERE c.workspace_id = $1 AND c.iri = $4 AND ${readableClause("c", 2)}`;

const readsConcept = (doors: Doors, iri: ConceptIri): Promise<Result<boolean, Error>> =>
  attempt(async () => {
    const read = await doors.tx.query(READABLE_CONCEPT, [
      doors.principal.workspaceId,
      ...readableParameters(doors.principal),
      iri,
    ]);
    return read.rows.length > 0;
  });

const readsPassage = async (doors: Doors, locator: string): Promise<Result<boolean, Error>> => {
  const read = await doors.passageAt(locator);
  if (read.ok) return ok(true);
  return read.error === NOT_FOUND ? ok(false) : err(read.error);
};

const labelOf = (entry: SourceEntry, resource: string): string => {
  // Stryker disable next-line ConditionalExpression,StringLiteral: a string entry has no title, read or not; hides → true and "title" → "", both killed in concept-read.test.ts
  const title = typeof entry === "string" ? undefined : entry["title"];
  return typeof title === "string" && title.trim() !== "" ? title : resource;
};

type Opening = { readonly locator: string } | { readonly iri: ConceptIri };

/** A passage when the entry's locator has an address's shape, else a concept when its resource is a concept IRI. */
const openingNamed = (
  doors: Doors,
  locator: string | null,
  resource: string,
): Opening | undefined => {
  if (locator !== null && doors.namesPassage(locator)) return { locator };
  const iri = ids.conceptIri.safeParse(resource);
  return iri.success ? { iri: iri.data } : undefined;
};

const opensFor = (doors: Doors, opening: Opening): Promise<Result<boolean, Error>> =>
  "locator" in opening ? readsPassage(doors, opening.locator) : readsConcept(doors, opening.iri);

/** Any run a document id could be, so a malformed passage address is never shown as a place. */
const NAMES_A_DOCUMENT = new RegExp(ULID_CHARACTERS, "i");

/** A locator with no passage address's shape, such as `p.4`: it names nothing a reader is kept from. */
const placeOf = (doors: Doors, locator: string | null): string | undefined =>
  locator === null ||
  locator.trim() === "" ||
  doors.namesPassage(locator) ||
  NAMES_A_DOCUMENT.test(locator)
    ? undefined
    : locator;

const namedItem = (id: string | null, source: string, place: string | undefined): EvidenceItem => {
  const named = id === null ? { source } : { id, source };
  return place === undefined ? named : { ...named, at: place };
};

const resolvedOf = async (
  doors: Doors,
  entry: SourceEntry,
): Promise<Result<Resolved | undefined, Error>> => {
  const cited = citedSourceOf(entry);
  // Stryker disable next-line ConditionalExpression: the insert boundary refuses an entry naming no resource, so none reaches this; hides → true, killed in import-bundle.test.ts
  if (cited === undefined) return ok(undefined);
  const source = labelOf(entry, cited.resource);
  const named = namedItem(cited.id, source, placeOf(doors, cited.locator));
  const opening = openingNamed(doors, cited.locator, cited.resource);
  if (opening === undefined) return ok({ entry, item: named, points: false, opens: false });
  const opens = await opensFor(doors, opening);
  if (!opens.ok) return err(opens.error);
  return ok({
    entry,
    item: opens.value ? { ...named, ...opening } : named,
    points: true,
    opens: opens.value,
  });
};

/** One per entry that names a resource, in the file's order, so a citation mark's index finds its item. */
export const resolvedSourcesOf = async (
  doors: Doors,
  frontmatter: Frontmatter,
): Promise<Result<readonly Resolved[], Error>> => {
  const sources = frontmatter["sources"];
  const resolved: Resolved[] = [];
  for (const entry of Array.isArray(sources) ? sources : []) {
    const one = await resolvedOf(doors, entry);
    if (!one.ok) return err(one.error);
    // Stryker disable next-line ConditionalExpression: the insert boundary refuses an entry naming no resource, so none is undefined here; hides → false, killed in answering.test.ts
    if (one.value !== undefined) resolved.push(one.value);
  }
  return ok(resolved);
};

/** A resource holding `#` is closed with one, so the string never reads as resource and locator. */
const labelOnlyText = (label: string, place: string | undefined): string => {
  if (place !== undefined) return `${label}#${place}`;
  return label.includes("#") ? `${label}#` : label;
};

const labelOnlyRecord = (
  entry: FrontmatterSource,
  label: string,
  place: string | undefined,
): FrontmatterSource => {
  const kept: Record<string, FrontmatterSource[string]> = {};
  const { id, title } = entry;
  if (id !== undefined) kept["id"] = id;
  if (title === label) kept["title"] = label;
  kept["resource"] = label;
  if (place !== undefined) kept["locator"] = place;
  return kept;
};

const projectedSources = (
  resolved: readonly Resolved[],
): readonly string[] | readonly FrontmatterSource[] => {
  const texts = resolved.flatMap(({ entry, item, opens }) =>
    // Stryker disable next-line ConditionalExpression,ArrayDeclaration: the text list is returned only when no entry is a record; hides → false and the first list → [], killed in concept-read.test.ts
    typeof entry === "string" ? [opens ? entry : labelOnlyText(item.source, item.at)] : [],
  );
  const records = resolved.flatMap(({ entry, item, opens }) =>
    typeof entry === "string" ? [] : [opens ? entry : labelOnlyRecord(entry, item.source, item.at)],
  );
  // The file parser holds a `sources` list to strings alone or records alone.
  return records.length === 0 ? texts : records;
};

/**
 * The frontmatter with each source this reader cannot open cut to its label, id and any place, and
 * any entry naming no resource left out. A `sources` that is no list is left out whole: it may hold a locator.
 */
export const projectedFrontmatter = (
  frontmatter: Frontmatter,
  resolved: readonly Resolved[],
): Frontmatter => {
  const { sources, ...rest } = frontmatter;
  // Stryker disable next-line ConditionalExpression: with no sources key, rest holds the same frontmatter; hides → true, killed in concept-read.test.ts
  if (sources === undefined) return frontmatter;
  return Array.isArray(sources) ? { ...rest, sources: projectedSources(resolved) } : rest;
};

const sharerOf = (sharer: Sharer): EvidencePane["sharedBeyondEvidence"] =>
  sharer !== undefined && isActorId(sharer.actor) ? { by: sharer.actor, at: sharer.at } : undefined;

const accessOf = (pointing: number, opening: number): EvidencePane["access"] => {
  if (opening === pointing) return "included";
  return opening === 0 ? "not-included" : "partly-included";
};

const wordsFor = (access: EvidencePane["access"], cited: number, pointing: number) => {
  if (access !== "included") return PANE_WORDS[access];
  if (cited === 0) return PANE_WORDS["nothing-cited"];
  return pointing === 0 ? PANE_WORDS["nothing-to-open"] : PANE_WORDS.included;
};

/** Every source is listed; only one naming a passage or concept the reader cannot open is withheld. */
export const paneOf = (resolved: readonly Resolved[], sharer: Sharer): EvidencePane => {
  const pointing = resolved.filter((one) => one.points).length;
  const opening = resolved.filter((one) => one.opens).length;
  const access = accessOf(pointing, opening);
  const sharedBeyondEvidence = access === "included" ? undefined : sharerOf(sharer);
  const { lead, next } = wordsFor(access, resolved.length, pointing);
  return {
    access,
    lead: sharedBeyondEvidence === undefined ? lead : `${lead} ${PANE_COPY.sharedBeyondEvidence}`,
    evidence: resolved.map((one) => one.item),
    sharedBeyondEvidence,
    next,
  };
};

/** Sized so a concept's read stays a small part of what an MCP client takes in one answer. */
const RELATIONS_AT_MOST = 25;

const BOOKKEEPING: readonly string[] = [
  "DERIVED_FROM",
  "SAME_AS",
] satisfies (typeof MAP_EDGE_LABELS)[number][];

/** The platform's own bookkeeping edges are not relations. */
const RELATION_LABELS = MAP_EDGE_LABELS.filter((label) => !BOOKKEEPING.includes(label));

const RELATIONS = `SELECT e.label AS kind, t.iri AS target, t.title
    FROM map_generation g
    JOIN map_edge e ON e.workspace_id = g.workspace_id AND (e.gen IS NULL OR e.gen = g.live_gen)
    JOIN concept_index t ON t.workspace_id = e.workspace_id AND t.iri = e.to_uid
   WHERE g.workspace_id = $1 AND e.from_uid = $4 AND e.label = ANY($5::text[])
     AND ${readableClause("e", 2)}
     AND ${readableClause("t", 2)}
   GROUP BY e.label, t.iri, t.title
   ORDER BY e.label, t.title, t.iri
   LIMIT ${RELATIONS_AT_MOST}`;

/** The concepts the map says `iri` points at that this reader may read, capped and never counted. */
export const relationsOf = (
  principal: UserPrincipal,
  tx: Tx,
  iri: ConceptIri,
): Promise<Result<readonly Relation[], Error>> =>
  attempt(async () => {
    const read = await tx.query<{ kind: string; target: string; title: string }>(RELATIONS, [
      principal.workspaceId,
      ...readableParameters(principal),
      iri,
      RELATION_LABELS,
    ]);
    return read.rows.map((row) => ({
      kind: row.kind,
      target: ids.conceptIri.parse(row.target),
      title: row.title,
    }));
  });

const CONCEPT_PAGE = "/knowledge/search/";

/** The concept page's address on the web, which a citation links to. */
export const conceptPageOf = (iri: ConceptIri): string =>
  `${CONCEPT_PAGE}${iri.slice(CONCEPT_IRI_PREFIX.length)}`;
