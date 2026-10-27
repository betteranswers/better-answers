import {
  citedSourceOf,
  citedSourcesOf,
  ids,
  isList,
  LINKS_TO_LABEL,
  MAP_EDGE_LABELS,
  ULID_CHARACTERS,
  type ConceptIri,
} from "@better-answers/schema";
import { CONCEPT_IRI_PREFIX, linksAndMarksOf } from "@better-answers/schema/concept-file";

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
import { targetOf } from "../store/map/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { Frontmatter, FrontmatterSource } from "./file.ts";

type EvidenceItem = {
  readonly id?: string;
  readonly source: string;

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

export type PassageReader = (locator: string) => Promise<Result<unknown, typeof NOT_FOUND | Error>>;

export type PassageNamer = (locator: string) => boolean;

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

const readsConcept = (doors: Doors, iri: ConceptIri): Promise<Result<boolean>> =>
  attempt(async () => {
    const read = await doors.tx.query(READABLE_CONCEPT, [
      doors.principal.workspaceId,
      ...readableParameters(doors.principal),
      iri,
    ]);
    return read.rows.length > 0;
  });

const readsPassage = async (doors: Doors, locator: string): Promise<Result<boolean>> => {
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

const openingNamed = (
  doors: Doors,
  locator: string | null,
  resource: string,
): Opening | undefined => {
  if (locator !== null && doors.namesPassage(locator)) return { locator };
  const iri = ids.conceptIri.safeParse(resource);
  return iri.success ? { iri: iri.data } : undefined;
};

const opensFor = (doors: Doors, opening: Opening): Promise<Result<boolean>> =>
  "locator" in opening ? readsPassage(doors, opening.locator) : readsConcept(doors, opening.iri);

const NAMES_A_DOCUMENT = new RegExp(ULID_CHARACTERS, "i");

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
): Promise<Result<Resolved | undefined>> => {
  const cited = citedSourceOf(entry);
  // Stryker disable next-line ConditionalExpression: the insert boundary refuses an entry naming no resource, so none reaches this; hides → true, killed in import-bundle.test.ts
  if (cited === undefined) return ok(undefined);
  const opening = openingNamed(doors, cited.locator, cited.resource);
  const named = (label: string) => namedItem(cited.id, label, placeOf(doors, cited.locator));
  if (opening === undefined) {
    return ok({ entry, item: named(labelOf(entry, cited.resource)), points: false, opens: false });
  }
  const opens = await opensFor(doors, opening);
  if (!opens.ok) return err(opens.error);
  if (opens.value) {
    return ok({
      entry,
      item: { ...named(labelOf(entry, cited.resource)), ...opening },
      points: true,
      opens: true,
    });
  }
  const points = "iri" in opening ? await mintedConcept(doors, opening.iri) : ok(true);
  if (!points.ok) return err(points.error);
  const label =
    "iri" in opening ? labelOf(entry, WITHHELD_CONCEPT) : labelOf(entry, cited.resource);
  return ok({ entry, item: named(label), points: points.value, opens: false });
};

const WITHHELD_CONCEPT = "A concept you cannot open";

const MINTED_CONCEPT = "SELECT 1 FROM concept_identity WHERE workspace_id = $1 AND iri = $2";

const mintedConcept = (doors: Doors, iri: ConceptIri): Promise<Result<boolean>> =>
  attempt(async () => {
    const minted = await doors.tx.query(MINTED_CONCEPT, [doors.principal.workspaceId, iri]);
    return minted.rows.length > 0;
  });

export const resolvedSourcesOf = async (
  doors: Doors,
  frontmatter: Frontmatter,
): Promise<Result<readonly Resolved[]>> => {
  const sources = frontmatter["sources"];
  const resolved: Resolved[] = [];
  for (const entry of isList(sources) ? sources : []) {
    const one = await resolvedOf(doors, entry);
    if (!one.ok) return err(one.error);
    // Stryker disable next-line ConditionalExpression: the insert boundary refuses an entry naming no resource, so none is undefined here; hides → false, killed in answering.test.ts
    if (one.value !== undefined) resolved.push(one.value);
  }
  return ok(resolved);
};

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
  return records.length === 0 ? texts : records;
};

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

const RELATIONS_AT_MOST = 25;

const BOOKKEEPING: readonly string[] = [
  "DERIVED_FROM",
  "SAME_AS",
] satisfies (typeof MAP_EDGE_LABELS)[number][];

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

export const relationsOf = (
  principal: UserPrincipal,
  tx: Tx,
  iri: ConceptIri,
): Promise<Result<readonly Relation[]>> =>
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

export type BodyLink = {
  readonly ordinal: number;
  readonly address: string;
  readonly target: ConceptIri;
};

const LINKED = `SELECT t.iri, t.path
    FROM map_generation g
    JOIN map_edge e ON e.workspace_id = g.workspace_id AND e.gen = g.live_gen
    JOIN concept_index t ON t.workspace_id = e.workspace_id AND t.iri = e.to_uid
   WHERE g.workspace_id = $1 AND e.from_uid = $4 AND e.label = '${LINKS_TO_LABEL}'
     AND ${readableClause("e", 2)}
     AND ${readableClause("t", 2)}
   GROUP BY t.iri, t.path`;

type Linked = {
  readonly iris: ReadonlySet<string>;
  readonly byPath: ReadonlyMap<string, string>;
};

const linkedBy = (linked: Linked, address: string, from: string): string | undefined => {
  const named = targetOf(address, from);
  if (named === undefined) return undefined;
  if ("path" in named) return linked.byPath.get(named.path);
  return linked.iris.has(named.iri) ? named.iri : undefined;
};

export const bodyLinksOf = (
  principal: UserPrincipal,
  tx: Tx,
  concept: {
    readonly iri: ConceptIri;
    readonly path: string;
    readonly body: string;
    readonly frontmatter: Frontmatter;
  },
): Promise<Result<readonly BodyLink[]>> =>
  attempt(async () => {
    const read = await tx.query<{ iri: string; path: string }>(LINKED, [
      principal.workspaceId,
      ...readableParameters(principal),
      concept.iri,
    ]);
    const linked: Linked = {
      iris: new Set(read.rows.map((row) => row.iri)),
      byPath: new Map(read.rows.map((row) => [row.path, row.iri])),
    };
    const { links } = linksAndMarksOf(concept.body, citedSourcesOf(concept.frontmatter["sources"]));
    return links.flatMap(({ ordinal, target: address }) => {
      const iri = linkedBy(linked, address, concept.path);
      return iri === undefined ? [] : [{ ordinal, address, target: ids.conceptIri.parse(iri) }];
    });
  });

const CONCEPT_PAGE = "/knowledge/search/";

export const conceptPageOf = (iri: ConceptIri): string =>
  `${CONCEPT_PAGE}${iri.slice(CONCEPT_IRI_PREFIX.length)}`;
