import {
  useQueryClient,
  type DataTag,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

export type Undo = { readonly undo: () => void };

/**
 * Undone only into the read it was taken from: a switch drops the workspace left's reads, and
 * writing to a dropped key makes it again.
 */
export const takenFrom = (queryClient: QueryClient, queryKey: QueryKey): Undo => {
  const reads = queryClient.getQueryCache();
  const read = reads.find({ queryKey, exact: true });
  const before = read?.state.data;
  return {
    undo: () => {
      if (read !== undefined && reads.find({ queryKey, exact: true }) === read) {
        queryClient.setQueryData(queryKey, before);
      }
    },
  };
};

/**
 * A click must read as done within a tenth of a second, so the cache takes the action before the
 * api answers.
 */
export const useOptimistic = () => {
  const queryClient = useQueryClient();
  return async <Data>(
    queryKey: DataTag<QueryKey, Data, unknown>,
    change: (data: Data) => Data,
  ): Promise<Undo> => {
    await queryClient.cancelQueries({ queryKey });
    const taken = takenFrom(queryClient, queryKey);
    queryClient.setQueryData(queryKey, (held) => (held === undefined ? held : change(held)));
    return taken;
  };
};
