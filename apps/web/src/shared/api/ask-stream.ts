/** The event that opens an answer's stream: the whole result, before any prose. */
export type AskStreamEvent<Result extends object> = {
  readonly kind: "result";
  readonly result: Result;
};

/** The result an answer's stream carries, with the prose drafted after it. */
export type Asked<Result extends object> = Result & { readonly prose: readonly string[] };

/**
 * Folds a stream's events, as far as they have arrived, into one result. Nothing has arrived
 * until the first event, which is always the result.
 */
export const askedFrom = <Result extends object>(
  events: readonly AskStreamEvent<Result>[],
): Asked<Result> | undefined => {
  const [opening] = events;
  return opening === undefined ? undefined : { ...opening.result, prose: [] };
};
