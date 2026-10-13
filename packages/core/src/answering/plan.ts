import {
  CONCEPT_NODE_LABEL,
  ids,
  type ConceptIri,
  type JudgeState,
  type QuestionVerdict,
} from "@better-answers/schema";

import {
  conceptPageOf,
  conceptsByIris,
  evidenceOf,
  findConcepts,
  readableCollections,
  trustOf,
  trustWords,
  type OpenedConcept,
  type Trust,
} from "../concepts/index.ts";
import { attempt, err, NOT_FOUND, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
import { findPassages, parseLocator, passageAt } from "../sources/index.ts";
import { walkFromEntries, walkTimedOut, type WalkStep } from "../store/map/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type { AskInput, Evidence, PassageView } from "./boundary.ts";
import type { RecordedConcept } from "./record.ts";

export type MapState =
  | { readonly state: "live" }
  | { readonly state: "as_of"; readonly at: string }
  | { readonly state: "unavailable_since"; readonly since: string };

/** A concept an answer returns as it stands. `Iri` is `string` where an iri is only read as text. */
export type ReturnedConcept<Iri extends string = ConceptIri> = {
  readonly iri: Iri;
  /** The concept's page on the web. */
  readonly url: string;
  readonly kind: string;
  /** For an `Answer`, the question it answered. */
  readonly title: string;
  /** Null for a concept in no collection. */
  readonly collection: string | null;
  readonly body: string;
  readonly trust: Trust;
  readonly trustWords: string;
  readonly evidence: readonly Evidence<Iri>[];
};

/** An answer before its record is kept: everything `ask` answers but the record's id. */
export type PlannedAnswer<Iri extends string = ConceptIri> = {
  readonly verdict: QuestionVerdict;
  readonly judgeState: JudgeState;
  /** Every `Answer` a judge found to fit the question. */
  readonly answers: readonly ReturnedConcept<Iri>[];
  /** The concepts that bear on the question, an `Answer` no judge passed among them. */
  readonly related: readonly ReturnedConcept<Iri>[];
  readonly conflicts: readonly {
    readonly subject: string;
    readonly values: readonly { readonly value: string; readonly evidence: string }[];
  }[];
  readonly unmappedPassages: readonly PassageView[];
  readonly map: MapState;
  /** The collections considered: those named, or every one the reader may read. */
  readonly collections: readonly string[];
  /** The collections the reader may name. */
  readonly readableCollections: readonly string[];
};

export type AskCaps = {
  /** The entry points taken, best first: the walk's seeds. */
  readonly entryPoints: number;
  /** The concepts an answer returns: entry points first, then what the walk reached. */
  readonly related: number;
  readonly unmappedPassages: number;
};

/** A start, to be set from measured recall. Each applies to what the reader may read. */
export const ASK_CAPS: AskCaps = { entryPoints: 10, related: 20, unmappedPassages: 3 };

/** Runs `work` in a short read-only transaction of its own, and answers what it answered. */
export type ReadStep<Refused = never> = <Read, Failure>(
  work: (tx: Tx) => Promise<Result<Read, Failure>>,
) => Promise<Result<Read, Failure | Refused>>;

type ReadFailure = Extract<
  Awaited<ReturnType<typeof readableCollections>>,
  { readonly ok: false }
>["error"];

type Asked = {
  readonly reader: UserPrincipal;
  readonly question: string;
  /** Undefined where none was named: every collection the reader may read. */
  readonly collections: readonly string[] | undefined;
  readonly now: Date;
  readonly caps: AskCaps;
};

/** Strong matches hold more of the question's words than weak ones, so the runs join in rank order. */
const entryPoints = async (
  { reader, question, collections, caps }: Asked,
  tx: Tx,
): Promise<Result<readonly OpenedConcept[], Error>> => {
  const search = { query: question, collections };
  const strong = await findConcepts(reader, tx, {
    ...search,
    strength: "strong",
    limit: caps.entryPoints,
  });
  if (!strong.ok) return strong;
  const weak = await findConcepts(reader, tx, {
    ...search,
    strength: "weak",
    limit: caps.entryPoints - strong.value.length,
  });
  if (!weak.ok) return weak;
  return ok([...strong.value, ...weak.value].map(({ concept }) => concept));
};

/** Never narrowed by collection: a passage no concept rests on belongs to none. */
const unmappedPassagesFor = async (
  { reader, question, caps }: Asked,
  tx: Tx,
): Promise<Result<readonly PassageView[], Error>> => {
  const found = await findPassages(reader, tx, { query: question, limit: caps.unmappedPassages });
  if (!found.ok) return found;
  const passages: PassageView[] = [];
  for (const { passage } of found.value) {
    const read = await passageAt(reader, tx, passage.locator);
    if (read.ok) {
      const { locator, title, text, sensitivity } = read.value;
      passages.push({ locator, source: title, text, sensitivity });
    } else if (read.error !== NOT_FOUND) return err(read.error);
  }
  return ok(passages);
};

type Matched = {
  readonly entries: readonly OpenedConcept[];
  readonly unmappedPassages: readonly PassageView[];
  readonly readable: readonly string[];
};

const matched = async (asked: Asked, tx: Tx): Promise<Result<Matched, ReadFailure>> => {
  const entries = await entryPoints(asked, tx);
  if (!entries.ok) return entries;
  const unmappedPassages = await unmappedPassagesFor(asked, tx);
  if (!unmappedPassages.ok) return unmappedPassages;
  const readable = await readableCollections(asked.reader, tx);
  if (!readable.ok) return readable;
  return ok({
    entries: entries.value,
    unmappedPassages: unmappedPassages.value,
    readable: readable.value,
  });
};

type Walked = { readonly steps: readonly WalkStep[]; readonly map: MapState };

/**
 * The walk takes a transaction to itself: its timeout binds whatever shares one. Past it, the
 * answer stands on its entry points.
 */
const walkedFrom = async <Refused>(
  { reader, collections, now }: Asked,
  read: ReadStep<Refused>,
  entries: readonly OpenedConcept[],
): Promise<Result<Walked, Refused | Error>> => {
  const seeds = entries.map((entry) => entry.iri);
  const walked = await read((tx) => attempt(() => walkFromEntries(reader, tx, seeds, collections)));
  if (walked.ok) return ok({ steps: walked.value, map: { state: "live" } });
  return walked.error instanceof Error && walkTimedOut(walked.error)
    ? ok({ steps: [], map: { state: "unavailable_since", since: now.toISOString() } })
    : walked;
};

/** The concepts the walk reached beyond its seeds, nearest first. */
const reachedBeyond = (
  entries: readonly OpenedConcept[],
  steps: readonly WalkStep[],
): readonly ConceptIri[] => {
  const seeds = new Set<string>(entries.map((entry) => entry.iri));
  return steps.flatMap((step) => {
    const iri = ids.conceptIri.safeParse(step.uid);
    return step.label === CONCEPT_NODE_LABEL && !seeds.has(step.uid) && iri.success
      ? [iri.data]
      : [];
  });
};

type Returned = { readonly shown: ReturnedConcept; readonly kept: RecordedConcept };

const returnedOf = (
  concept: OpenedConcept,
  evidence: ReturnedConcept["evidence"],
  now: Date,
): Returned => {
  const { iri, kind, title, collection, body, contentHash } = concept;
  const trust = trustOf(concept, now);
  return {
    shown: {
      iri,
      url: conceptPageOf(iri),
      kind,
      title,
      collection,
      body,
      trust,
      trustWords: trustWords(trust),
      evidence,
    },
    kept: { iri, contentHash, trust },
  };
};

/**
 * Entry points, then the walk's nearest, cut at the cap. The walk kept to what the reader may
 * read, so nothing withheld takes a slot.
 */
const returnedBy = async (
  { reader, caps, now }: Asked,
  tx: Tx,
  entries: readonly OpenedConcept[],
  steps: readonly WalkStep[],
): Promise<Result<readonly Returned[], ReadFailure>> => {
  const bearing = [...entries.map((entry) => entry.iri), ...reachedBeyond(entries, steps)];
  const slots = bearing.slice(0, caps.related);
  const reached = await conceptsByIris(reader, tx, slots.slice(entries.length));
  if (!reached.ok) return reached;
  const byIri = new Map([...entries, ...reached.value].map((concept) => [concept.iri, concept]));
  const returned: Returned[] = [];
  for (const concept of slots.flatMap((iri) => byIri.get(iri) ?? [])) {
    const evidence = await evidenceOf(reader, tx, concept.frontmatter, {
      passageAt: (locator) => passageAt(reader, tx, locator),
      namesPassage: (locator) => parseLocator(locator).ok,
    });
    if (!evidence.ok) return evidence;
    returned.push(returnedOf(concept, evidence.value, now));
  }
  return ok(returned);
};

export type AnswerPlan = {
  readonly answer: PlannedAnswer;
  /** What a record keeps of each concept the answer returns. */
  readonly concepts: readonly RecordedConcept[];
};

/**
 * Reads what bears on the question for the reader its action admitted, in three short reads, and
 * writes nothing. No judge runs, so every `Answer` it finds is related knowledge.
 */
export const answerPlanned = async <Refused>(
  reader: UserPrincipal,
  read: ReadStep<Refused>,
  input: AskInput,
  now: Date,
  caps: AskCaps,
): Promise<Result<AnswerPlan, ReadFailure | Refused>> => {
  const collections = input.collections.length === 0 ? undefined : input.collections;
  const asked: Asked = { reader, question: input.question, collections, now, caps };

  const found = await read((tx) => matched(asked, tx));
  if (!found.ok) return found;
  const { entries, unmappedPassages, readable } = found.value;
  const walked = await walkedFrom(asked, read, entries);
  if (!walked.ok) return walked;
  const returned = await read((tx) => returnedBy(asked, tx, entries, walked.value.steps));
  if (!returned.ok) return returned;

  const related = returned.value.map(({ shown }) => shown);
  return ok({
    answer: {
      verdict: related.length === 0 ? "refuse" : "related",
      judgeState: "not-judged",
      answers: [],
      related,
      conflicts: [],
      unmappedPassages,
      map: walked.value.map,
      collections: collections ?? readable,
      readableCollections: readable,
    },
    concepts: returned.value.map(({ kept }) => kept),
  });
};
