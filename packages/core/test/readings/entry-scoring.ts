import type { DecisionModelCall, ModelOutcome, Probabilities } from "../../src/llm/index.ts";
import { percentile } from "../figures.ts";
import { recallAt, type RecallQuestion, type Recalls } from "../recall.ts";

/** A concept the entry step returned, as a decision model is asked about it. */
export type EntryPoint = { readonly iri: string; readonly title: string; readonly body?: string };

const ENTRY_ASK = "Does this approved answer answer the question in the state?";

/** The question as the state, and one true-or-false question per entry point, numbered in order. */
export const scoringCall = (
  question: string,
  entries: readonly EntryPoint[],
): DecisionModelCall => ({
  state: question,
  questions: Object.fromEntries(
    entries.map((entry, place) => [
      String(place + 1),
      { ask: ENTRY_ASK, written_for: entry.title, answer: entry.body?.trimEnd() ?? "" },
    ]),
  ),
});

/** The entry points by their probability of yes, highest first; a tie keeps the entry step's order. */
export const reranked = (entries: readonly EntryPoint[], yes: Probabilities): readonly string[] =>
  entries
    .map(({ iri }, place) => ({ iri, place, yes: yes[String(place + 1)] ?? 0 }))
    .toSorted((one, other) => other.yes - one.yes || one.place - other.place)
    .map(({ iri }) => iri);

/** How the reading reaches `find`, the entry step and the decision model. */
export type EntryScoringDoors = {
  readonly found: (question: string) => Promise<readonly string[]>;
  readonly planned: (question: string) => Promise<readonly EntryPoint[]>;
  readonly decide: (call: DecisionModelCall) => Promise<ModelOutcome<Probabilities>>;
};

export type EntryScoring = {
  readonly byFind: Recalls;
  readonly byEntryStep: Recalls;
  readonly byDecision: Recalls;
  /** Questions whose call failed; their entry step's own order stands in the decision's figure. */
  readonly unscored: number;
  readonly tokensIn: number;
  readonly scoreMs: { readonly median: number; readonly worst: number };
};

/** Recall at `depth` by `find`, by the entry step, and by its points as a decision model reorders them. */
export const readEntryScoring = async (
  questions: readonly RecallQuestion[],
  landed: ReadonlyMap<string, string>,
  doors: EntryScoringDoors,
  depth: number,
): Promise<EntryScoring> => {
  const counted = { unscored: 0, tokensIn: 0 };
  const times: number[] = [];
  const byDecision = async ({ question }: RecallQuestion): Promise<readonly string[]> => {
    const entries = await doors.planned(question);
    const started = performance.now();
    const scored = await doors.decide(scoringCall(question, entries));
    times.push(performance.now() - started);
    counted.tokensIn += scored.spent.reduce((sum, { tokensIn }) => sum + tokensIn, 0);
    if (scored.outcome === "answered") return reranked(entries, scored.answer);
    counted.unscored += 1;
    return entries.map(({ iri }) => iri);
  };
  const byEntryStep = async ({ question }: RecallQuestion) =>
    (await doors.planned(question)).map(({ iri }) => iri);
  return {
    byFind: await recallAt(questions, landed, ({ question }) => doors.found(question), depth),
    byEntryStep: await recallAt(questions, landed, byEntryStep, depth),
    byDecision: await recallAt(questions, landed, byDecision, depth),
    ...counted,
    scoreMs: { median: percentile(times, 0.5), worst: Math.max(0, ...times) },
  };
};
