/** How one collection's drafted part ended; `paused` means drafting stopped at the spending limit. */
type DraftOutcome = "drafted" | "refused" | "failed" | "paused";

/** One drafted sentence, with the concepts it cites. */
type DraftedSentence = { readonly sentence: string; readonly concepts: readonly string[] };

/**
 * An answer's stream: its phase, then the whole result before any prose, then each drafted
 * sentence and each part's end. A keep-alive carries nothing.
 */
export type AskStreamEvent<Result extends object> =
  | { readonly kind: "phase"; readonly phase: string }
  | { readonly kind: "keep-alive" }
  | { readonly kind: "result"; readonly result: Result }
  | ({ readonly kind: "sentence"; readonly collection: string | null } & DraftedSentence)
  | {
      readonly kind: "part";
      readonly collection: string | null;
      readonly outcome: DraftOutcome;
    };

/** One collection's prose; its outcome is undefined while it is still being drafted. */
type ProsePart = {
  readonly collection: string | null;
  readonly sentences: readonly DraftedSentence[];
  readonly outcome: DraftOutcome | undefined;
};

/** The result an answer's stream carries, with the prose drafted after it, part by part. */
export type Asked<Result extends object> = Result & { readonly prose: readonly ProsePart[] };

/** A collection's part is made by its first event, and each later one adds to it. */
const withEvent = <Result extends object>(
  parts: readonly ProsePart[],
  event: AskStreamEvent<Result>,
): readonly ProsePart[] => {
  if (event.kind !== "sentence" && event.kind !== "part") return parts;
  const { collection } = event;
  const known = parts.some((part) => part.collection === collection);
  const every = known ? parts : [...parts, { collection, sentences: [], outcome: undefined }];
  return every.map((part) => {
    if (part.collection !== collection) return part;
    if (event.kind === "part") return { ...part, outcome: event.outcome };
    const { sentence, concepts } = event;
    return { ...part, sentences: [...part.sentences, { sentence, concepts }] };
  });
};

/** Folds the events so far into one result: none before the result, and a keep-alive is nothing. */
export const askedFrom = <Result extends object>(
  events: readonly AskStreamEvent<Result>[],
): Asked<Result> | undefined => {
  const at = events.findIndex((event) => event.kind === "result");
  const opening = events[at];
  if (opening?.kind !== "result") return undefined;
  const prose = events.slice(at + 1).reduce<readonly ProsePart[]>(withEvent, []);
  return { ...opening.result, prose };
};
