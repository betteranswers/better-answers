export const holdingAt =
  (pause: number, held: Promise<void>) =>
  (at: number): Promise<void> =>
    at === pause ? held : Promise.resolve();

export const abortingAt =
  (pause: number, leaving: AbortController) =>
  async (at: number): Promise<void> => {
    if (at === pause) leaving.abort();
  };
