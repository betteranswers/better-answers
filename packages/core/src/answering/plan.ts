import {
  ids,
  type ConceptIri,
  type JudgeState,
  type ModelProvider,
  type QuestionVerdict,
} from "@better-answers/schema";

import {
  conceptCountsOf,
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
import {
  attempt,
  err,
  NOT_FOUND,
  ok,
  type KernelRefusal,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { findPassages, parseLocator, passageAt } from "../sources/index.ts";
import { walkConceptsFromEntries, walkTimedOut, type WalkStep } from "../store/map/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { passageViewOf, type AskInput, type Evidence, type PassageView } from "./boundary.ts";
import type { RecordedConcept } from "./record.ts";

export type MapState =
  | { readonly state: "live" }
  | { readonly state: "as_of"; readonly at: string }
  | { readonly state: "unavailable_since"; readonly since: string };

export const ANSWER_KIND = "Answer";

export type PreviewedConcept<Iri extends string = ConceptIri> = {
  readonly iri: Iri;
  readonly url: string;
  readonly kind: string;
  readonly title: string;
  readonly collection: string | null;
  readonly trust: Trust;
  readonly trustWords: string;
};

export type ReturnedConcept<Iri extends string = ConceptIri> = PreviewedConcept<Iri> & {
  readonly body: string;
  readonly evidence: readonly Evidence<Iri>[];
};

export type RelatedConcept<Iri extends string = ConceptIri> =
  | ReturnedConcept<Iri>
  | PreviewedConcept<Iri>;

export type PlannedAnswer<Iri extends string = ConceptIri> = {
  readonly verdict: QuestionVerdict;
  readonly judgeState: JudgeState;
  readonly answers: readonly ReturnedConcept<Iri>[];
  readonly related: readonly RelatedConcept<Iri>[];
  readonly conflicts: readonly {
    readonly subject: string;
    readonly values: readonly { readonly value: string; readonly evidence: string }[];
  }[];
  readonly unmappedPassages: readonly PassageView[];
  readonly map: MapState;
  readonly collections: readonly string[];
  readonly readableCollections: readonly string[];
};

export type AskCaps = {
  readonly entryPoints: number;
  readonly related: number;
  readonly unmappedPassages: number;
  readonly candidates: number;
  readonly decisionThresholds: DecisionThresholds;
};

export type DecisionThresholds = ReadonlyMap<ModelProvider, ReadonlyMap<string, number>>;

export const ASK_CAPS: AskCaps = {
  entryPoints: 20,
  related: 28,
  unmappedPassages: 3,
  candidates: 20,
  decisionThresholds: new Map(),
};

/** Runs `work` in a short read-only transaction of its own, and answers what it answered. */
export type ReadStep<Refused = never> = <Read, Failure>(
  work: (tx: Tx) => Promise<Result<Read, Failure>>,
) => Promise<Result<Read, Failure | Refused>>;

type ReadFailure = KernelRefusal<"role-forbids"> | Error;

type Asked = {
  readonly reader: UserPrincipal;
  readonly question: string;
  readonly collections: readonly string[] | undefined;
  readonly now: Date;
  readonly caps: AskCaps;
};

const entryPoints = async (
  { reader, question, collections, caps }: Asked,
  tx: Tx,
): Promise<Result<readonly OpenedConcept[], Error>> => {
  const counts = await conceptCountsOf(reader, tx, question);
  if (!counts.ok) return counts;
  const search = { query: question, collections, counts: counts.value };
  const strong = await findConcepts(reader, tx, {
    ...search,
    strength: "strong",
    limit: caps.entryPoints,
  });
  if (!strong.ok) return strong;
  const taken = strong.value.map(({ concept }) => concept);
  const left = caps.entryPoints - taken.length;
  if (left === 0) return ok(taken);
  const weak = await findConcepts(reader, tx, { ...search, strength: "weak", limit: left });
  if (!weak.ok) return weak;
  return ok([...taken, ...weak.value.map(({ concept }) => concept)]);
};

const unmappedPassagesFor = async (
  { reader, question, caps }: Asked,
  tx: Tx,
): Promise<Result<readonly PassageView[], Error>> => {
  const found = await findPassages(reader, tx, { query: question, limit: caps.unmappedPassages });
  if (!found.ok) return found;
  const passages: PassageView[] = [];
  for (const { passage } of found.value) {
    const read = await passageAt(reader, tx, passage.locator);
    if (read.ok) passages.push(passageViewOf(read.value));
    else if (read.error !== NOT_FOUND) return err(read.error);
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

const walkedFrom = async <Refused>(
  { reader, collections, now }: Asked,
  read: ReadStep<Refused>,
  entries: readonly OpenedConcept[],
): Promise<Result<Walked, Refused | Error>> => {
  const seeds = entries.map((entry) => entry.iri);
  const walked = await read((tx) =>
    attempt(() => walkConceptsFromEntries(reader, tx, seeds, collections)),
  );
  if (walked.ok) return ok({ steps: walked.value, map: { state: "live" } });
  return walked.error instanceof Error && walkTimedOut(walked.error)
    ? ok({ steps: [], map: { state: "unavailable_since", since: now.toISOString() } })
    : walked;
};

const reachedBeyond = (
  entries: readonly OpenedConcept[],
  steps: readonly WalkStep[],
): readonly ConceptIri[] => {
  const seeds = new Set<string>(entries.map((entry) => entry.iri));
  return steps.flatMap((step) => {
    const iri = ids.conceptIri.safeParse(step.uid);
    return !seeds.has(step.uid) && iri.success ? [iri.data] : [];
  });
};

type Returned = { readonly shown: RelatedConcept; readonly kept: RecordedConcept };

const previewOf = (concept: OpenedConcept, trust: Trust): PreviewedConcept => {
  const { iri, kind, title, collection } = concept;
  return {
    iri,
    url: conceptPageOf(iri),
    kind,
    title,
    collection,
    trust,
    trustWords: trustWords(trust),
  };
};

type ReturnReads = Parameters<typeof evidenceOf>[3];

const returnedOf = async (
  reader: UserPrincipal,
  tx: Tx,
  concept: OpenedConcept,
  reads: ReturnReads,
  now: Date,
): Promise<Result<Returned, ReadFailure>> => {
  const trust = trustOf(concept, now);
  const kept = { iri: concept.iri, contentHash: concept.contentHash, trust };
  const preview = previewOf(concept, trust);
  if (concept.kind !== ANSWER_KIND) return ok({ shown: preview, kept });
  const evidence = await evidenceOf(reader, tx, concept.frontmatter, reads);
  if (!evidence.ok) return evidence;
  return ok({ shown: { ...preview, body: concept.body, evidence: evidence.value }, kept });
};

const passageReadOnce = (reader: UserPrincipal, tx: Tx) => {
  const read = new Map<string, ReturnType<typeof passageAt>>();
  return (locator: string): ReturnType<typeof passageAt> => {
    const held = read.get(locator) ?? passageAt(reader, tx, locator);
    read.set(locator, held);
    return held;
  };
};

const returnedBy = async (
  { reader, caps, now }: Asked,
  tx: Tx,
  entries: readonly OpenedConcept[],
  steps: readonly WalkStep[],
): Promise<Result<readonly Returned[], ReadFailure>> => {
  const bearing = [...entries.map((entry) => entry.iri), ...reachedBeyond(entries, steps)];
  const slots = bearing.slice(0, caps.related);
  const beyond = slots.slice(entries.length);
  const reached =
    beyond.length === 0
      ? ok<readonly OpenedConcept[]>([])
      : await conceptsByIris(reader, tx, beyond);
  if (!reached.ok) return reached;
  const byIri = new Map([...entries, ...reached.value].map((concept) => [concept.iri, concept]));
  const reads = {
    passageAt: passageReadOnce(reader, tx),
    namesPassage: (locator: string) => parseLocator(locator).ok,
  };
  const returned: Returned[] = [];
  for (const concept of slots.flatMap((iri) => byIri.get(iri) ?? [])) {
    const one = await returnedOf(reader, tx, concept, reads, now);
    if (!one.ok) return one;
    returned.push(one.value);
  }
  return ok(returned);
};

type Bearing = { readonly map: MapState; readonly returned: readonly Returned[] };

const NOTHING_BEARS: Bearing = { map: { state: "live" }, returned: [] };

const bearingOn = async <Refused>(
  asked: Asked,
  read: ReadStep<Refused>,
  entries: readonly OpenedConcept[],
): Promise<Result<Bearing, ReadFailure | Refused>> => {
  const walked = await walkedFrom(asked, read, entries);
  if (!walked.ok) return walked;
  const returned = await read((tx) => returnedBy(asked, tx, entries, walked.value.steps));
  if (!returned.ok) return returned;
  return ok({ map: walked.value.map, returned: returned.value });
};

export type AnswerPlan = {
  readonly answer: PlannedAnswer;
  readonly concepts: readonly RecordedConcept[];
};

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
  const bearing = entries.length === 0 ? ok(NOTHING_BEARS) : await bearingOn(asked, read, entries);
  if (!bearing.ok) return bearing;
  const { map, returned } = bearing.value;

  const related = returned.map(({ shown }) => shown);
  return ok({
    answer: {
      verdict: related.length === 0 ? "refuse" : "related",
      judgeState: "not-judged",
      answers: [],
      related,
      conflicts: [],
      unmappedPassages,
      map,
      collections: collections ?? readable,
      readableCollections: readable,
    },
    concepts: returned.map(({ kept }) => kept),
  });
};
